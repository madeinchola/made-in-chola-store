# Sprint 12 — Admin de pedidos y operación

**Release:** R3 · **Estimación:** 6 días · **Depende de:** S10 (pedidos/estados), S11 (pagos)

## Objetivo
Que los 2 admins gestionen el día a día: ver y avanzar pedidos, editarlos, crear pedidos manuales (ventas por WhatsApp), cancelar y reembolsar, administrar la lista negra y gestionar incidencias de entrega.

## Alcance
**Dentro:** bandeja de pedidos, detalle, transiciones de estado, edición de pedidos, pedidos manuales, cancelaciones y reembolsos (monto efectivamente pagado), devoluciones según política del admin, lista negra, contra entrega (cobrado/rechazado), incidencias, historial y auditoría.
**Fuera:** notificaciones salientes (S13), reportes (S14), facturación (S17).

## Reglas de negocio cubiertas
BR-ORD-01..04, BR-ORD-06, BR-PRC-03/04 (reversión de cupón y reembolso), BR-PAY-05, BR-PAY-07, BR-ADM-03, BR-SHP-03 (incidencias), S-05, S-06, S-07.

## Tareas

### BD
- [x] `refunds` (order_id, payment_id, monto ≤ pagado, motivo, estado `requested|approved|processed|rejected`, método, procesado_por). *(Hecho como `refunds` + `refund_items`. Estados `requested|approved|processed|rejected` (`approved` queda reservado para un proveedor con API); forma `same_method|bank_transfer|cash|other|provider`; el tope «monto ≤ pagado» lo hace la función y, además, un disparador de la tabla.)*
- [x] `returns` + `return_items` (order_item_id, cantidad, motivo, estado, reingreso a stock `si|no|inspección`) — configurable según política que defina el admin. *(Hechas como `order_returns` y `order_return_items` (`returns` es palabra reservada en SQL). Apagadas por `returns_enabled` hasta que la tienda redacte su política.)*
- [x] `blacklist_entries` (profile/teléfono/email, motivo, activo, creado_por, fechas) + función `is_blacklisted()` consumida por `create_order`. *(`is_blacklisted()` la consume `_checkout_compute`, que usan la vista previa y `create_order`; vale por cuenta, teléfono o correo.)*
- [x] `order_notes` (internas) y `order_incidents` (tipo `lost|damaged|wrong_address|absent|rejected`, estado, costo asumido, resolución).
- [x] RPC `admin_edit_order` (cambiar ítems/cantidades/dirección/envío antes de `shipped`): **recalcula** totales, ajusta stock con movimientos y deja **diff auditado**; bloqueada en estados finales. *(El diff queda en `order_edits` (libro inmutable). También se bloquea en `shipped`; bloqueo optimista con la versión del pedido; no vuelve a ejecutar el motor de ofertas (ver `docs/operacion-pedidos.md`).)*
- [x] RPC `admin_create_manual_order` (cliente existente o alta rápida, canal `manual|whatsapp`, método de pago, descuentos manuales con motivo) reutilizando `create_order` internamente. *(**Desviación:** NO reutiliza `create_order` (que toma la bolsa de la clienta y destruiría la que tenga); reutiliza el contador sin huecos, el stock firme, la franja y la máquina de estados. Solo para clientas **con cuenta**; la alta rápida sin cuenta no se hizo (exige el servicio de Auth).)*
- [x] RPC `refund_order` (total o parcial) que: calcula el reembolso = **monto pagado** prorrateando descuentos entre ítems devueltos, repone stock si corresponde, revierte uso de cupón si el pedido se cancela completo, llama `PaymentProvider.refund` o registra reembolso manual. *(Se llama `admin_refund_order` (todas las funciones que ejecuta el navegador llevan el prefijo `admin_`). No llama a `PaymentProvider.refund`: ningún método de hoy tiene API de reembolso, así que el reembolso es «solicitado → marcado como devuelto» (la misma función es idempotente). Con `p_dry_run` da la vista previa del impacto.)*
- [x] Alertas de pedidos `pending_payment` antiguos (WhatsApp/contra entrega, S-05). *(S10 ya las encola (`remind_pending_orders`); S12 las muestra en «Atención requerida».)*

### Admin UI
- [x] **Bandeja de pedidos:** filtros (estado, fecha, método de pago, canal, cliente, número), búsqueda, ordenamiento, contadores por estado, acciones masivas (marcar preparando, exportar) y atajos para el flujo típico. *(Acciones masivas: marcar preparando y exportar CSV (BR-ADM-02 completo es de S14). El «atajo» del flujo típico es el botón de avanzar de cada fila.)*
- [x] **Detalle del pedido:** cliente, dirección en mapa, ítems (con imagen), totales, pagos y comprobantes, historial/línea de tiempo, notas internas, acciones permitidas según estado. *(La dirección lleva un **enlace al mapa** (OpenStreetMap con el pin); no hay un mapa incrustado.)*
- [x] Avanzar estado con un clic y confirmación (con **deshacer** limitado dentro de una ventana segura cuando sea posible). *(Deshacer: solo pasos del flujo normal que no mueven stock, cupones ni dinero, dentro de 5 minutos.)*
- [x] **Editar pedido** con vista previa del diff de totales/stock antes de confirmar.
- [x] **Crear pedido manual** (flujo guiado para quien atiende WhatsApp). *(Sin franja de entrega ni pin de mapa en la pantalla (la función soporta la franja); exige que la clienta tenga cuenta.)*
- [x] **Cancelar y reembolsar** con asistente (cuánto, por qué, a dónde) y resumen del impacto (stock, cupón, dinero).
- [x] **Contra entrega:** registrar *cobrado*/*rechazado*; el rechazo registra costo asumido (BR-PAY-07) y sugiere añadir a lista negra.
- [x] **Lista negra:** alta/baja con motivo, ver pedidos relacionados, efecto (S-07 bloquea contra entrega y pedidos manuales).
- [x] **Incidencias** de entrega con seguimiento y resolución.
- [x] Vistas de "atención requerida": pagos por revisar, pedidos antiguos sin confirmar, stock insuficiente tras edición. *(«Stock insuficiente tras edición» no es una vista: la edición **se rechaza** si no hay stock (nunca queda un pedido sobrevendido que mirar).)*

## Criterios de aceptación
1. El admin procesa un pedido de `pending_payment` a `completed` solo con la bandeja y el detalle.
2. Editar un pedido recalcula totales y stock correctamente y queda auditado.
3. Un pedido manual creado por WhatsApp descuenta stock, genera número `MIC-…` y respeta lista negra/validaciones.
4. Reembolso = lo realmente pagado; parcial prorratea descuentos; no se puede reembolsar más de lo pagado ni dos veces.
5. Cliente en lista negra no puede usar contra entrega.
6. Ninguna acción de admin es posible sin rol admin (RLS + RPC).

## Testing
- **Unit:** prorrateo de reembolso (con cupón %, cupón monto fijo, 2x1, envío gratis, redondeo con centavos sobrantes), transiciones permitidas por estado, cálculo de diff de edición.
- **SQL/Integración:** `admin_edit_order` bajo concurrencia con una compra del mismo stock; `refund_order` idempotente (doble clic/doble admin); cancelación + reposición de stock + reversión de cupón; manual order con lista negra.
- **RLS:** cliente no ve notas internas ni lista negra; admin completo.
- **E2E:** flujo diario completo (nuevo pedido → pago → preparar → enviar → entregar → completar); cancelación con reembolso parcial; pedido manual; contra entrega rechazado → lista negra.
- **Auditoría:** cada acción deja registro con actor y diff.
- **Usabilidad:** sesión con admin real cronometrando tareas comunes.
- **Resiliencia:** reembolso al proveedor falla a mitad (estado `requested` con reintento seguro, sin doble reembolso).

## Edge cases
- Reembolso parcial de un pedido con cupón: monto proporcional y centavos de redondeo.
- Reembolso de pedido con envío gratis condicionado por monto (el cliente deja de cumplir el umbral al devolver parte).
- Reembolso de pedido pagado en efectivo contra entrega (devolución manual, sin proveedor).
- Editar pedido ya `paid`: diferencia a favor/en contra del cliente (cobrar extra/reembolsar).
- Editar cantidades sin stock; variante archivada desde el pedido original.
- Cambiar dirección tras asignar franja de entrega; cupo de franja.
- Dos admins editan/avanzan el mismo pedido a la vez → bloqueo optimista y mensaje.
- Cliente cancela justo cuando el admin lo pasa a `preparing`.
- Devolución con producto dañado (no vuelve a stock), producto sin etiqueta, fuera de plazo (política del admin).
- Cliente en lista negra con pedidos abiertos; persona intenta evadir con otra cuenta (mismo teléfono/dirección → coincidencias sugeridas).
- Pedido manual para cliente sin cuenta (alta rápida con teléfono) → alinear con BR-ACC-01 creando cuenta mínima.
- Incidencia (paquete perdido) tras estado `delivered`; reapertura de pedido completado.
- Importes en moneda no BOB (preparación multi-país).
- Reembolso a un método ya no disponible/cuenta cerrada.

## Revisión
- [~] Checklist universal. *(Ver «Estado real de entrega»: lo automático está verde; el responsive real en teléfono y el lector de pantalla no se probaron.)*
- [ ] Revisión de matriz de transiciones y permisos con el dueño. *(Pendiente del dueño: SPRINT_19 §Q; la matriz está en `docs/operacion-pedidos.md`.)*
- [~] Auditoría de funciones `SECURITY DEFINER` y locks. *(Autorrevisión hecha: orden fijo de candados pedido → cobros → variantes, `search_path` vacío en todas, lista blanca de lo ejecutable por el navegador en pgTAP 05, concurrencia real en la integración. **No** se hizo la revisión por un agente independiente que sí hubo en S3, S4, S10 y S11.)*
- [ ] Revisión contable del manejo de reembolsos (con quien lleva la contabilidad). *(Pendiente del dueño: SPRINT_19 §Q.)*
- [~] Revisión UX: textos claros, confirmaciones en acciones destructivas. *(Todas las acciones con efectos piden confirmación o muestran antes el impacto calculado por la base; la sesión de usabilidad con un administrador real no se hizo: SPRINT_19 §Q.)*

## Riesgos
- Política de devoluciones aún sin definir → implementar flujo configurable y activarlo cuando el admin la redacte.
- Complejidad de prorrateo → tests de propiedad (la suma de reembolsos parciales nunca excede lo pagado).

## Pendientes externos
Política de devoluciones/cambios, criterios de lista negra, quién asume cada costo en incidencias (PENDIENTES_ADMIN §B, §C, §D).

## Entregables para sprints siguientes
Operación completa de pedidos, reembolsos, lista negra, eventos de estado fiables para S13, datos fiables de utilidad/devoluciones para S14, base de notas de crédito para S17.

## Estado real de entrega (2026-11-14)

**Entregado:** la operación diaria de pedidos de punta a punta en `/admin/pedidos`: bandeja (estados con contador, búsqueda, filtros, avanzar con un clic, marcar varios, exportar CSV), detalle con todo el pedido, **deshacer** acotado, **edición** con vista previa del impacto y libro de ediciones, **pedido manual**, **cancelar y reembolsar** con asistente, reembolsos parciales con **prorrateo exacto** y tope por lo pagado, **devoluciones** (configurables, apagadas hasta que la tienda redacte su política), **contra entrega** cobrada o rechazada, **incidencias**, **lista negra** por cuenta, teléfono o correo, y **«atención requerida»**. Base de datos: 8 tablas, 22 funciones `admin_*` y 12 internas, libro de reembolsos con disparador de tope, bandera de edición del pedido, matriz de 12 transiciones del administrador. Detalle y decisiones en [../docs/operacion-pedidos.md](../docs/operacion-pedidos.md).

**Cómo se hizo:** todo por mí (base, funciones, pantallas y pruebas); cada cálculo (reembolso, edición, pedido manual) tiene un `p_dry_run` con la **misma cuenta** que al aplicar. Todo contra la nube (sin Docker ni base local). El SQL directo se hizo por el **pooler** (modo sesión): el host directo de la base es solo IPv6 y esta Mac no lo alcanza.

**Desviaciones respecto al plan (y por qué):**
- `refund_order` se llama **`admin_refund_order`** y **no llama a un proveedor**: ningún método de hoy tiene API de reembolso; el flujo es «solicitado → marcado como devuelto» (idempotente, apto para el reintento seguro que pide el sprint).
- `returns` y `return_items` se llaman **`order_returns` y `order_return_items`** (`returns` es palabra reservada).
- `admin_create_manual_order` **no reutiliza `create_order`**: este toma y convierte la bolsa de la clienta, y un pedido manual no debe tocar la bolsa que ella tenga. Reutiliza el contador sin huecos, el stock firme, la franja y la máquina de estados. Exige que la clienta **tenga cuenta**; la **alta rápida** no se hizo (crear una cuenta exige el servicio de Auth).
- El pedido manual **no ofrece franja de entrega ni pin de mapa en la pantalla** (la función soporta la franja). La dirección del detalle se muestra con un **enlace al mapa**, no con un mapa incrustado.
- «Stock insuficiente tras edición» no es una vista: la edición **se rechaza** si no hay stock.
- La matriz del administrador pasó de 9 a **12** transiciones (enviado → cancelado, entregado → reembolsado, completado → reembolsado); «reembolsado» ya no se marca a mano.
- Las líneas del pedido y el pedido tienen ahora una **vía de edición controlada** (bandera `app.order_edit`); antes eran totalmente inmutables.

**Bugs reales encontrados por las pruebas y corregidos:**
1. *(Al razonar los casos de la prueba)* `_order_balance` marcaba «falta cobrar» tras una devolución parcial: el total del pedido no baja al devolver una prenda. Ahora solo los reembolsos de monto libre o del proveedor entran en la cuenta.
2. *(Prueba de pantalla del asistente)* Casi todos los rechazos de la base mostraban el mensaje genérico en vez del motivo concreto: `resultCode` priorizaba el `outcome` («rejected») sobre su código.
3. ***(Integración contra la nube)*** Supabase rechaza un `DELETE` **sin `WHERE`** cuando llega por la API (`pg-safeupdate`); mi edición vaciaba su tabla temporal así y **fallaba siempre desde el navegador**, aunque pgTAP (que corre como `postgres` por `psql`) pasaba. Ahora usa `TRUNCATE`. *Ninguna prueba de una sola sesión lo habría visto.*
4. *(E2E)* Una clienta registrada solo con correo no tiene teléfono y el servidor lo exige: la pantalla decía «opcional». Ahora es obligatorio cuando la cuenta no lo tiene.
5. *(E2E)* El libro de ediciones mostraba «BOB 215,00» en vez de «Bs 215,00».
6. *(E2E móvil)* La tabla de productos del detalle se desplaza en horizontal y no se podía enfocar con el teclado (axe: `scrollable-region-focusable`).
7. *(pgTAP)* Cancelar y reembolsar un pedido con QR ya pagado dejaba una **revisión «tardía» abierta** en Pagos (la abre S11 al cancelar con dinero recibido): ahora se resuelve sola al devolver todo lo pagado.
8. *(Regresión en pruebas antiguas)* Las suites `06`–`12` se rompían con las tablas nuevas (su limpieza inicial las arrastraba con `TRUNCATE … CASCADE`); la `06` contaba 30 ajustes y ahora son 33; la `17` esperaba que `TRUNCATE order_items` llegara al disparador; la `05` tiene dos listas blancas que se amplían a propósito (8 tablas y 21 funciones nuevas). Todo ajustado y verificado verde.

**Verificación (2026-11-14):**
- **Unitarias:** **260 archivos y 5879 pruebas, todas verdes** (S11 cerró con 252 y 5751); 128 son nuevas (lógica, bandeja, detalle, asistente de reembolsos, edición, pedido manual, diálogos de acciones, atención, incidencias, lista negra). Tipos, lint y Prettier limpios.
- **pgTAP contra la nube** (con la migración definitiva aplicada): `19_s12_operacion_pedidos` **693 aserciones**, todas verdes. Los valores esperados se calcularon **a mano** (p. ej. reparto de 25,00 en 20,83 + 4,17 por el mayor resto; 99,98 ÷ 3 = 33,33 + 33,32 + 33,33) y hay una **propiedad** sobre 12 combinaciones incómodas de precio, cantidad y descuento (devolver unidad por unidad suma exactamente el valor de la línea). Suites antiguas con la migración puesta: `00` 7 · `01` 46 · `02` 22 · `03` 20 · `04` 29 · `05` 16 · `06` 111 · `07` 117 · `08` 149 · `09` 112 · `10` 95 · `11` 140 · `12` 75 · `13` 165 · `14` 473 · `15` 243 · `16` 520 · `17` 368 · `18` 311, todas verdes.
- **Integración contra la nube con concurrencia real** (`orders.integration.test.ts`, 11 casos, con una cuenta de administración de prueba que ya existía): tres administradores confirman el pago a la vez (gana uno, dos reciben `stale`); dos ediciones con la misma versión (una gana, la otra `stale`, el stock cuadra); **5 reembolsos de 40 sobre 100 pagados a la vez: caben exactamente 2**; el **mismo** reembolso 6 veces a la vez deja **una** fila; 3 pedidos manuales por la **última** unidad (se crea uno y el stock nunca baja de 0); permisos HTTP (la clienta recibe 403 en las funciones de administración y no lee las tablas nuevas; nadie escribe directo: ni ella, ni el administrador, ni la clave de servicio).
- **Integración completa contra la nube (2026-11-15)**, vuelta a correr entera porque S12 cambió `transition_order_status`, `payment_apply_event` y `_checkout_compute`: 16 archivos. **En verde:** `orders` 11/11, `payments` 21/21, `discounts`, `shipping`, `cart`, `config`, `taxonomy`, `auth` y `supabase`, y de pgTAP todas las suites salvo las cinco de abajo. **Falló algo mío y está corregido:** las suites pgTAP 01, 02, 03, 04 y 13 limpian con `delete from public.payments;` y ahora `refunds.payment_id` lo impide (`on delete restrict`) cuando la nube conserva reembolsos de otras corridas; antes pasaban porque aún no había ninguno. Ahora vacían primero los 8 libros de S12 con sus guardas apagadas, dentro de su transacción hermética, y dan sus mismos conteos (46, 22, 20, 29 y 165) con 25 reembolsos presentes. **Fallos que repetí solos y pasaron:** las 100 compras simultáneas (era un `ConnectTimeout` de red) y la alerta de stock (era carga). **Fallos que NO son de S12 y quedan abiertos:** (a) **9 pruebas de catálogo, tienda y auditoría** (`catalog` 2, una de ellas el contrato del seed; `shop` 6; `audit` 1) que asumen una base pequeña: piden `limit: 100` y buscan sus productos o filas entre los primeros 100, y la nube tiene 542 productos visibles y 151 filas de auditoría de categorías acumuladas por corridas anteriores; se arreglan con el vaciado de entrega (`db reset --linked --no-seed`) o endureciendo esas pruebas (S16); (b) **`reserve_stock` con 30 sesiones a la vez: NO se pudo verificar aquí**, porque el pooler en modo sesión admite 15 clientes (`EMAXCONNSESSION`) y el host directo no resuelve desde esta Mac; (c) **`update-contact` con dos cambios simultáneos** falla igual en dos corridas («ronda 2: 546/200»; el 546 es un límite de recursos de la Edge Function) mientras los otros 11 casos de esa función pasan; S12 no toca esa ruta, pero **no tengo una línea base anterior que lo demuestre**.
- **E2E contra la nube (Chromium escritorio y móvil):** `admin-orders` **14 de 14** (todas las pantallas con sus textos reales, axe AA y sin desbordes; **de «pendiente de pago» a «completado» solo con la bandeja y el detalle**; editar; cancelar y reembolsar; pedido manual; contra entrega rechazada → incidencia y lista negra; bloqueo optimista con dos pantallas). Regresión de lo que toqué: `checkout` 18/18, `payments` 10/10, `admin-payments` 12/12 (tras reintentar 4 que fallaron por el entorno: mi Mac no alcanza el host directo de la base —se les dio la conexión por el pooler— y por un fallo real de accesibilidad que se corrigió). **Un «Error interno» aislado** de `checkout` durante la corrida larga no se reprodujo en dos reintentos.
- **Mutación en la interfaz:** **22 mutantes** aplicados uno a uno a los archivos fuente y corridos contra sus pruebas; **22 mueren**. En la primera pasada sobrevivían 2, **ambos huecos reales de mis pruebas** (nadie probaba que un filtro nuevo vuelve a la página 1, y la prueba de «no se ofrece deshacer» usaba un estado donde deshacer no existe de todos modos, así que no probaba la condición del actor): se cerraron con pruebas nuevas.
- **Mutación en SQL:** **25 mutantes** (un cambio deliberado por vez en la migración: el tope del libro, el prorrateo, la matriz de estados, la lista negra, la edición, el pedido manual, las devoluciones, la RLS…), cada uno corrido contra la prueba 19 en una transacción que se revierte. **23 mueren en pgTAP**, cada uno en una aserción que habla de lo que se rompió (tope exacto, contra entrega sin cobrar, idempotencia, bloqueo por teléfono, versión vieja, descuento proporcional, canal inmutable, las 12 transiciones, «reembolsado» solo por el flujo, stock de la devolución, contracargos en «atención», ventana de deshacer, RLS de las notas, stock libre…). Dos de esas 23 (M04, tope que ignora lo ya devuelto, y M25, devolución fuera de plazo sin justificación) mueren por un ERROR y no por una aserción roja: la función deja pasar el dato malo y lo frena la **segunda barrera, en la tabla** (`refunds_guard` y la restricción `order_returns_override_needed`). Es una muerte válida y prueba la defensa en profundidad, pero el resto de aserciones de esa corrida no se ejecutó. **M22** (reembolso sin bloquear el pedido) **sobrevive en pgTAP** (una sola sesión no disputa candados) y **muere en la integración con concurrencia real**, aplicándolo de verdad a la nube y restaurando la migración al salir: «5 reembolsos de 40 a la vez» sigue pasando (el tope también lo serializa el disparador), pero «el MISMO reembolso enviado 6 veces a la vez» falla con un 23505 de llave duplicada en vez de responder `existing`. **M03** (la última unidad del prorrateo ya no toma el resto) **sobrevive y es equivalente**: con la última unidad el acumulado `round(final×n/n)` es siempre `final` (2,4 millones de combinaciones importe×cantidad, 0 diferencias), así que el `CASE` solo vuelve explícito lo que la cuenta ya da; que las partes sumen el total lo cubre la propiedad I20. Resultado: **24 de 24 mutantes no equivalentes mueren**. Nota de método: la primera pasada completa quedó contaminada por conexiones perdidas (la Mac se durmió y un `psql` quedó colgado 17 horas), así que se reforzó el ejecutor (tope de tiempo, 3 reintentos y veredicto `INFRA` aparte) y M10–M25 se repitieron; M01–M09 son de la corrida válida.

**Criterios de aceptación:**
1. *El admin procesa un pedido de `pending_payment` a `completed` solo con la bandeja y el detalle:* **cumplido** (E2E, escritorio y móvil).
2. *Editar un pedido recalcula totales y stock correctamente y queda auditado:* **cumplido** (pgTAP, integración con dos ediciones a la vez, E2E; el libro de ediciones y la auditoría general lo registran con quién).
3. *Un pedido manual por WhatsApp descuenta stock, genera número `MIC-…` y respeta lista negra y validaciones:* **cumplido** (pgTAP, integración, E2E).
4. *Reembolso = lo realmente pagado; parcial prorratea descuentos; no más de lo pagado ni dos veces:* **cumplido** (pgTAP con propiedad, integración con 5 y 6 llamadas a la vez, disparador del libro).
5. *Cliente en lista negra no puede usar contra entrega:* **cumplido** (pgTAP, E2E de `checkout` de S10, por cuenta, teléfono o correo).
6. *Ninguna acción de admin sin rol admin (RLS + RPC):* **cumplido** (pgTAP: las 22 funciones rechazan a una clienta con «solo administradores»; integración por HTTP; las 22 son ejecutables solo por usuarios autenticados y autorizan por dentro).

**Pendiente (no hecho / no verificado):**
- **Revisión independiente** por un agente sin contexto (se hizo en S3, S4, S10 y S11): **no se hizo** en este sprint. Es la única de las verificaciones habituales que falta.
- **Sesión de usabilidad con un administrador real** cronometrando tareas, **teléfono real**, lector de pantalla y Lighthouse (lo automático solo pasa axe y emulación): SPRINT_19 §Q.
- **Regresión E2E completa de todos los sprints:** no se corrió (solo lo que S12 toca: checkout, pagos y el panel de pagos). Siguen abiertos los 2 fallos antiguos de `layout.spec` (cabecera).
- **Concurrencia de las pruebas antiguas contra tráfico real:** las suites 01–13 deshabilitan disparadores y bloquean tablas dentro de su transacción; no correrlas con tráfico real.
- **Decisiones del dueño** (política de devoluciones, criterios de la lista negra, quién asume cada costo, alta rápida sin cuenta, franja y pin en el pedido manual) y **revisión contable de los reembolsos**: SPRINT_19 §Q y PENDIENTES_ADMIN «Añadido en Sprint 12».
- **Para S13:** los avisos de estado deben esperar al menos la ventana de «deshacer» (5 minutos).
- **Escala:** «atención requerida» recorre los pedidos activos en cada consulta (tope de 500 filas); con miles de pedidos conviene materializarla (S14/S16).
- **Seguridad (SPRINT_19):** revocar el token de acceso pegado en el chat y rotar la contraseña de la base y la clave `sb_secret_…`.
- **NO subido:** los cambios de S12 están en el árbol de trabajo, sin commit ni push (se hace cuando el dueño lo pida).

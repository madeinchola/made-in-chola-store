# Operación de pedidos (Sprint 12)

Qué hace, cómo está hecho y por qué. Cubre BR-ORD-01..04 y BR-ORD-06, BR-PRC-03/04 (reversión de cupón y reembolso), BR-PAY-05, BR-PAY-07, BR-ADM-03, BR-SHP-03 (incidencias), S-05, S-06 y S-07. Se apoya en lo que dejaron S10 (`orders`, `transition_order_status`) y S11 (`payments`, revisiones de pago).

## El día a día del equipo

```
 Pedidos ──────────────────────────────────────────────  /admin/pedidos
   │ bandeja: estados con su contador · búsqueda · filtros · avanzar con un clic · marcar varios · exportar CSV
   ├── Detalle del pedido ───────────────────────────────  /admin/pedidos/:id
   │      cliente · entrega (mapa) · productos · totales · pagos · reembolsos · devoluciones · incidencias
   │      historial · notas internas · libro de ediciones · cuentas relacionadas
   │      acciones según el estado: avanzar · deshacer · editar · cancelar y reembolsar · reembolsar · devolver
   │                                cobro / rechazo de contra entrega · incidencia · lista negra
   ├── Nuevo pedido manual ──────────────────────────────  /admin/pedidos/nuevo
   ├── Atención requerida ───────────────────────────────  /admin/pedidos/atencion
   ├── Incidencias ──────────────────────────────────────  /admin/pedidos/incidencias
   └── Lista negra ──────────────────────────────────────  /admin/pedidos/lista-negra
```

**Ninguna acción es posible sin ser administrador**, y no por esconder un botón: cada acción es una función SQL que se autoriza por dentro con `is_admin()`, bloquea el pedido, valida y deja rastro. Desde el navegador **nadie escribe** en las tablas de pedidos, reembolsos, devoluciones, incidencias, notas ni lista negra (ni siquiera el administrador ni `service_role`): solo esas funciones.

## Reglas que mandan (y por qué)

1. **El pedido sigue siendo una instantánea.** Editarlo no es poder tocar la tabla: la guarda de `orders` y la de `order_items` solo dejan pasar los cambios que hace `admin_edit_order` (una bandera `app.order_edit` que solo esa función enciende dentro de su transacción). El número, la clienta, la moneda, el método de pago, la franja y el canal **nunca** cambian, ni con la bandera; de una línea nunca cambian el producto, el precio unitario ni el costo.
2. **El dinero que sale pasa por un libro con tope.** `refunds` no admite más reembolsos que lo **efectivamente pagado** (BR-PRC-04): la función bloquea el pedido antes de calcular y, además, un disparador de la tabla lo vuelve a comprobar (aunque alguien escribiera directo, no cabe un centavo de más). Un reembolso no cambia su importe ni su motivo; solo avanza de estado (solicitado → devuelto, o → descartado).
3. **La vista previa y la aplicación son la misma cuenta.** Editar, reembolsar y crear un pedido manual tienen un `p_dry_run`: la pantalla muestra lo que calculó la base, no una copia en el navegador (que podría diverger).
4. **Lo que el administrador VIO es lo que se compara.** Avanzar manda el estado esperado y editar manda la versión (`updated_at`) del pedido: si otro administrador se adelantó, la base responde `stale` y la pantalla lo cuenta. Es el bloqueo optimista de «dos administradores a la vez».
5. **Las llaves de idempotencia nacen al abrir el asistente** y cambian si cambia lo que se pide: un doble clic o un reintento tras un corte devuelve el mismo reembolso o pedido; la misma llave con otro contenido es `idempotency_conflict`.

## Modelo de datos (`20261111000100_s12_operacion_pedidos.sql`)

| Tabla / cambio | Para qué |
| --- | --- |
| `orders` + `channel`, `edited_at`, `edit_count` | Canal (`web`, `manual`, `whatsapp`) y marca de que el pedido se editó. |
| `payments` + `collected_at`, `collected_by` | Contra entrega: el cobro se registra cuando el repartidor entrega el dinero (BR-PAY-07). |
| `order_edits` | Libro **inmutable** de ediciones: quién, por qué y el antes/después de importes y líneas. De los datos personales solo consta que cambiaron. |
| `order_notes` | Notas internas (inmutables). La clienta no las lee ni por la API. |
| `refunds`, `refund_items` | El libro de reembolsos (tipo, importe, envío devuelto, retención, motivo, estado, forma, referencia, llave de idempotencia) y su desglose por línea. |
| `order_returns`, `order_return_items` | Devoluciones: qué unidades, por qué, y si vuelven al stock (`yes`/`no`/`inspection`). |
| `order_incidents` | Incidencias de entrega: tipo, estado, costo asumido y **quién lo asume** (la tienda, la clienta, el transportista o nadie). |
| `blacklist_entries` | Lista negra por cuenta, teléfono o correo, con motivo, quién la puso y quién la levantó. |
| Ajustes | `returns_enabled` (apagado hasta que la tienda redacte su política), `return_window_days` (7), `order_undo_window_minutes` (5). |

`refunds`, `blacklist_entries`, `order_returns(+items)` e `order_incidents` están en la **auditoría** (BR-ADM-03) con la identidad de quien actuó; el destino de un reembolso, el teléfono y el correo de la lista negra constan como «cambiaron», nunca con su valor. Las tablas `orders`, `payments`, `payment_methods`, `payment_proofs` y `payment_reviews` ya dejaban rastro desde S10/S11 y ahora también se pueden filtrar en la pantalla de Auditoría.

## Cuánto se pagó, cuánto se devolvió, cuánto falta

- **Pagado** (`_order_paid_amount`): los cobros pagados (y los que ya reembolsamos), más lo recibido en un cobro que quedó sin confirmar (llegó un monto distinto y el pedido se canceló: ese dinero existe). Un cobro en **disputa** no cuenta (el banco ya se lo llevó). La **contra entrega** solo cuenta cuando está **cobrada**: «pagado» en S10 significaba «pedido confirmado», así que cancelar una contra entrega confirmada y nunca cobrada no deja nada que devolver (y su cobro queda cancelado).
- **Devuelto** (`_order_refunded_amount`): lo solicitado, aprobado y procesado (no lo descartado). Un reembolso que **hizo el proveedor** por su lado (aviso `refunded` de S11) también entra al libro, para que no se pueda devolver dos veces lo mismo.
- **Saldo** (`_order_balance`): positivo = falta cobrar; negativo = hay que devolver. Los reembolsos **por productos** no crean saldo (devolver una prenda baja lo que se merece cobrar en la misma medida); los de **monto libre** y los del proveedor sí.

## Reembolsos

`admin_refund_order` tiene tres modos y se puede combinar con **cancelar el pedido**:

| Modo | Qué devuelve |
| --- | --- |
| `all` | Todo lo pagado y aún no devuelto. Con `p_cancel`, además cancela: el stock vuelve, la franja se libera y el uso del cupón se revierte (BR-PRC-03). |
| `items` | Unidades de líneas concretas, más el envío pagado si se pide, menos una retención opcional (con motivo). |
| `amount` | Un monto libre (diferencia por una edición, excedente). |

**Prorrateo exacto.** Por línea, devolver `k` de `n` unidades vale el acumulado `round(final × m / n)` menos lo ya devuelto de esa línea, y **la última unidad toma el resto exacto**: la suma de reembolsos parciales **nunca** pasa del valor de la línea, centavos incluidos (probado con 12 combinaciones incómodas de precio, cantidad y descuento: `99,98 ÷ 3 = 33,33 + 33,32 + 33,33`). El descuento ya viene repartido por línea, así que la clienta recibe lo que pagó por esa unidad. Una unidad que tras el prorrateo vale 0,00 no genera un reembolso de cero (se devuelve junto con otra). El **envío** se devuelve una sola vez y solo lo pagado (costo − descuento de envío).

**Envío gratis condicionado a un monto.** Si el pedido tenía envío gratis y se devuelve solo parte, la vista previa **avisa** («puede que ya no correspondiera») y la tienda decide si pone una **retención** con motivo; el sistema no adivina la regla.

**Estados.** `requested` (hay que devolver el dinero) → `processed` (ya se devolvió; se avisa a la clienta) o `rejected` (descartado con motivo, el monto queda libre). Cuando lo devuelto (ya procesado) cubre todo lo pagado y el pedido está cancelado, entregado o completado, pasa solo a **«reembolsado»**. «Reembolsado» **no se marca a mano** (`admin_transition_order` lo rechaza con `use_refund`): no se puede declarar devuelto un dinero que no se devolvió. El estado `approved` está reservado para cuando exista un adaptador de proveedor.

**Reembolso por proveedor.** Hoy todos los métodos (WhatsApp, contra entrega, QR manual) se devuelven a mano, así que el reembolso es **solicitado → marcado como devuelto**. Esa es también la forma segura de reintentar: marcar como devuelto dos veces responde `already_processed` y no devuelve dos veces. Cuando haya un proveedor con API, creará el reembolso `requested`, llamará al proveedor y lo marcará (la misma función `admin_process_refund` es idempotente).

## Editar un pedido

`admin_edit_order` (antes de enviar: pendiente, pagado o en preparación). Se puede cambiar la cantidad de una línea (0 la quita), sumar productos nuevos, el costo de envío, el contacto y la dirección. Cómo se recalcula (es una **decisión de producto**, escrita aquí porque no es obvia):

- El precio unitario de una línea que ya estaba **no cambia**; una línea nueva toma el precio vigente (o el que fije el administrador).
- Al **bajar** la cantidad, el descuento de la línea baja en proporción; al **subir**, el descuento se queda igual (no se inventan descuentos). **El motor de ofertas no se vuelve a ejecutar**: para dar más descuento existe un «descuento extra» con motivo, repartido con el mayor resto.
- El **envío no se vuelve a cotizar solo**: el costo nuevo lo fija el administrador; si el envío era gratis, sigue gratis. Con una dirección nueva, la vista previa trae la cotización sugerida, sin aplicarla.
- El **stock** se ajusta con movimientos (`sale`/`cancel`), respeta lo que otras clientas retienen en su bolsa y nunca queda negativo (`unavailable` con el detalle).
- **Dinero:** antes de pagar, el cobro abierto pasa a cobrar el total nuevo. Ya pagado, queda un **saldo por cobrar** o **por devolver** que aparece en «Atención requerida»; la contra entrega sin cobrar simplemente cambia lo que se cobrará.
- No se edita con un **comprobante pendiente** de revisión, con **reembolsos** hechos o en curso, ni con una **devolución abierta** (el prorrateo se apoya en las líneas).

## Pedido manual (ventas por WhatsApp o mostrador)

`admin_create_manual_order` crea el pedido para una clienta **con cuenta** sin pasar por **su** bolsa (no la toca), pero reutiliza el contador sin huecos, el stock firme, la franja y la máquina de estados. Los descuentos son **manuales** (con motivo, repartidos sin perder un centavo); no hay cupón ni motor de ofertas. Respeta la **lista negra** (S-07), el tope de monto del método de pago y el stock. Si algo falla al escribir (franja llena), se revierte **todo** incluido el contador (la numeración no tiene huecos). «Ya recibí el pago» crea el pedido «pagado»; en contra entrega significa «confirmado», no cobrado.

## Contra entrega (BR-PAY-07)

- **Cobrado:** `admin_cod_collect` registra el cobro (por omisión el monto esperado; menos deja un saldo por cobrar). Una contra entrega ya entregada sin cobro ni rechazo registrado aparece en «Atención requerida».
- **Rechazado en la entrega:** `admin_cod_reject` (solo con el paquete en camino) cancela el pedido, el stock vuelve, deja una **incidencia «rechazado»** con el costo que asume la tienda y avisa cuántos rechazos previos tenía la clienta; con un clic se añade a la **lista negra**.

## Lista negra (S-07)

Bloquea la **contra entrega** y los **pedidos manuales**; el resto de la cuenta y el pedido por WhatsApp siguen funcionando. Vale por cuenta, teléfono o correo: quien abre otra cuenta con los mismos datos queda bloqueada igual. El checkout la consulta con `is_blacklisted()` (y no le dice a la clienta que está en la lista: «no disponible»). Las cuentas que ya tenían el interruptor de S1 pasaron a tener su entrada. En el detalle del pedido, «cuentas relacionadas» sugiere coincidencias por teléfono, correo o dirección.

## Devoluciones

Configurables: `returns_enabled` está **apagado** hasta que la tienda redacte su política (PENDIENTES_ADMIN §D). Con ellas encendidas, se abre una devolución de un pedido entregado o completado, dentro del plazo (`return_window_days`; fuera de plazo hay que escribir por qué se acepta), por unidad con motivo y destino de stock (`yes` / `no` / `inspection`). Al cerrarla, lo «por inspeccionar» se decide ahí y lo que vuelve **suma stock** (movimiento `return`, una sola vez). El reembolso se hace aparte, ligado a la devolución. Devolver **todas** las unidades de un pedido entregado lo lleva a «reembolsado».

## Deshacer (con límite)

`admin_undo_transition` deshace **solo** el último paso del flujo normal que no mueve stock, cupones ni dinero (preparando, enviado, entregado, completado), si lo hizo un administrador y está dentro de `order_undo_window_minutes` (5). Queda en el historial como un cambio más (nada se borra). Una cancelación **no** se deshace. **Cumplido en S13:** los avisos de empacado, enviado, entregado y completado **esperan esa ventana**; si se deshace el paso, el aviso se cancela y su clave queda libre (ver `docs/notificaciones.md`).

## Matriz de transiciones (revisión con el dueño)

El administrador pasó de 9 a **12** transiciones: S12 suma `enviado → cancelado` (rechazo en la entrega, paquete perdido; el stock vuelve), `entregado → reembolsado` y `completado → reembolsado` (devolución total). Un pedido entregado **no** se cancela (se devuelve) y uno completado tampoco. La clienta y el sistema no ganaron nada.

## Atención requerida

Se **deduce** de los datos (no hay una cola aparte que se desincronice): pedidos de WhatsApp o contra entrega sin confirmar más de `order_reminder_hours`, comprobantes por revisar, pagos que necesitan una decisión, contracargos (el pedido no se prepara ni se envía), reembolsos por marcar, dinero por devolver, saldo por cobrar, contra entrega sin cobro registrado, incidencias y devoluciones abiertas. El menú «Pedidos» muestra cuántos pedidos tienen algo pendiente.

## Permisos

| Quién | Qué |
| --- | --- |
| Clienta | Lee **solo** sus pedidos (como en S10). No ve notas, ediciones, reembolsos, devoluciones, incidencias ni la lista negra. |
| Administrador | Lee todo; **actúa solo** por las 22 funciones `admin_*` (cada una autoriza por dentro). No lee `order_items.cost_unit` ni el motivo/autor del historial desde el navegador: para eso existe `admin_order_history`. |
| `service_role` | No escribe en ninguna tabla nueva (solo las funciones). |
| `anon` | Nada. |

## Pruebas

pgTAP `19_s12_operacion_pedidos` (guardas, lista negra, avanzar y deshacer, edición, pedidos manuales, reembolsos con propiedades, cancelación con reposición de stock y reversión de cupón, devoluciones, contra entrega, incidencias, atención, RLS, permisos y auditoría), ajustes a las suites 05, 06 y 17 por lo que cambió a propósito, y pruebas de pantalla del panel. Ver «Estado real de entrega» en `Sprints/SPRINT_12_Admin_Pedidos_Operacion.md` para las cifras y lo que no se pudo verificar.

## Límites conocidos y decisiones abiertas

1. **Alta rápida de clienta sin cuenta** (edge case del sprint): **no se hizo.** Crear una cuenta exige el servicio de Auth (no se puede desde SQL). Hoy el pedido manual necesita una clienta que ya tenga cuenta; si no la tiene, se le pide registrarse en la tienda.
2. **Franja de entrega en el pedido manual:** la función la soporta (reserva el cupo y lo libera al cancelar), pero la pantalla todavía no la ofrece. Tampoco se «mueve» una entrega a otra franja al cambiar la dirección en una edición.
3. **Sin mapa para elegir el pin** en el pedido manual ni en la edición de dirección: la dirección va en texto y el pin de la dirección original se conserva al editar. Sin ubicación no se cotiza la distancia: el administrador fija el costo de envío.
4. **Excedente por pago duplicado (S-06):** el segundo pago de un mismo cobro queda como revisión de S11 (no es un cobro nuestro), así que no entra en «lo pagado»; sigue devolviéndose desde el banco y resolviendo la revisión en Pagos.
5. **El motor de ofertas no se re-ejecuta al editar** (ver arriba). El uso de un cupón ya reservado tampoco se recalcula.
6. **«Reembolsado» tras un reembolso total solo si el pedido está cancelado, entregado o completado.** Un pedido pagado y devuelto por completo sin cancelar queda «pagado» y aparece en atención como saldo por cobrar: el flujo correcto es «Cancelar y reembolsar».
7. **No hay concurrencia real probada en pgTAP** (una sesión): el orden de candados (pedido → cobros → variantes) se razona y se prueba por secuencia; la prueba de integración lanza llamadas simultáneas contra la nube.
8. **Datos personales en pedidos anonimizados (BR-ACC-07):** sigue pendiente decidir si la instantánea del pedido (contacto y dirección) se anonimiza (límite 7 de S10). El libro de ediciones y la auditoría ya no guardan esos datos.
9. **Costos, margen y reportes** (S14) leen `order_items.cost_unit` y los reembolsos; la contabilidad debe revisar cómo se registran (PENDIENTES_ADMIN §D, y la revisión contable del sprint).
10. **Política de devoluciones, criterios de la lista negra y quién asume cada costo en incidencias** siguen sin definir (PENDIENTES_ADMIN §B, §C, §D): el sistema los deja configurables o anotados, no los decide.

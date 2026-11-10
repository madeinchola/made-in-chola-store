# Sprint 10 — Pedidos y checkout (WhatsApp / contra entrega)

**Release:** R2 (cierre) · **Estimación:** 6 días · **Depende de:** S6 (cuenta, direcciones, datos fiscales), S7 (carrito), S8 (`quote_shipping`), S9 (`apply_discounts`)

## Objetivo
El primer flujo de compra de punta a punta: formulario único de checkout, creación **atómica** del pedido (stock firme, precios, descuentos, envío, número gapless) y envío del pedido por **WhatsApp** o **contra entrega**, con arquitectura lista para más proveedores.

## Alcance
**Dentro:** tablas de pedidos, `create_order`, máquina de estados, numeración, snapshots, checkout (formulario único), método WhatsApp y contra entrega, pantalla de confirmación, "Mis pedidos" real, cancelación por el cliente, expiración de pedidos no confirmados donde aplique, interfaz `PaymentProvider` base.
**Fuera:** QR/APIs de pago (S11), administración avanzada de pedidos (S12), envío de notificaciones (S13; aquí se escribe en `notification_outbox`).

## Reglas de negocio cubiertas
BR-CHK-01, BR-CHK-02, BR-CHK-04, BR-CHK-05, BR-ORD-01, BR-ORD-02, BR-ORD-04, BR-ORD-05, BR-ORD-06, BR-INV-02..04, BR-PRC-05, BR-PAY-01 (WhatsApp y contra entrega), BR-PAY-02, BR-PAY-06, BR-PAY-07 (base), BR-DAT-02, S-05.

## Tareas

### BD
- [ ] `orders`, `order_items` (con **snapshots**: nombre, color, talla, sku, imagen, precio unitario, costo, descuentos por línea), `order_status_history`, `order_counters`.
- [ ] Numeración **gapless** `MIC-000123`: contador con `UPDATE … RETURNING` en la misma transacción que crea el pedido.
- [ ] Snapshots de dirección de envío, datos de facturación, método de envío, franja de entrega, moneda y tipo de cambio.
- [ ] `payments` (base) + interfaz `PaymentProvider { createCharge, handleWebhook, refund, getStatus }`; implementaciones `whatsapp` y `cash_on_delivery`.
- [ ] RPC **`create_order(cart_id, address_id, tax_profile_id?, shipping_method, delivery_slot?, coupon?, payment_method, idempotency_key)`**, en **una transacción**:
  1. Bloquea variantes (`FOR UPDATE`, orden por id) y valida stock real.
  2. Recalcula precios (respeta precio del carrito, S-04), descuentos (S9) y envío (S8).
  3. Valida cobertura, franja, usuario activo, **lista negra** (bloquea contra entrega si aplica).
  4. Descuenta stock firme (`stock_movements`), consume reservas del carrito, registra redención de cupón.
  5. Asigna número, crea pedido/ítems/historial, marca carrito `converted`, escribe `notification_outbox`.
  - Devuelve diferencias por línea si algo cambió (no crea el pedido) para mostrarlas al cliente (BR-CHK-04).
  - **Idempotencia:** misma `idempotency_key` devuelve el mismo pedido (anti doble clic/reintento).
- [ ] RPC `transition_order_status` (única vía de cambio de estado; valida transiciones; historial; outbox).
- [ ] RPC `cancel_order_by_customer` (solo hasta `preparing`; repone stock; revierte cupón).
- [ ] Cron `expire_unconfirmed_orders` solo para métodos con ventana de pago (S11); WhatsApp/contra entrega **no expiran** (S-05) pero generan recordatorio al admin si superan X horas.
- [ ] RLS: cliente ve solo sus pedidos; admin todo; los totales **no** se escriben desde el cliente.

### Frontend
- [ ] `/checkout` **un solo formulario**: nombre, correo, teléfono (precargados), dirección (selector + pin), franja de entrega, datos fiscales (opcional), cupón, método de pago, resumen con desglose.
- [ ] **Revalidación antes de pagar**: modal con diferencias (precio/stock) y confirmación explícita (BR-CHK-04).
- [ ] Botón **"Enviar pedido por WhatsApp"** (Bolivia): crea el pedido y abre `wa.me` con mensaje pre-armado (n.º de pedido, ítems, total, dirección, franja) al número configurado; reintento si el navegador bloquea la ventana; enlace para reenviar.
- [ ] **Contra entrega** como método seleccionable (sujeto a reglas/lista negra).
- [ ] Selector de método de pago dirigido por configuración por país (permite añadir proveedores sin tocar el flujo).
- [ ] Pantalla de **confirmación** (`/pedido/:numero`) con estado, resumen y acciones.
- [ ] **Mis pedidos**: lista y detalle con línea de tiempo de estados; botón **Cancelar** habilitado según regla.
- [ ] Protección anti doble envío (deshabilitar + idempotency key).
- [ ] Eventos `begin_checkout`, `add_payment_info`, `purchase` en la capa `track`.

## Criterios de aceptación
1. Un cliente completa la compra por WhatsApp y por contra entrega; el pedido queda `pending_payment` con stock comprometido y n.º `MIC-…` correlativo.
2. Dos clientes que compran la última unidad: uno obtiene el pedido y el otro un aviso claro con detalle (test de concurrencia).
3. El pedido guarda snapshots; editar o archivar productos después no altera pedidos antiguos.
4. Doble clic o reintento de red no duplica pedidos ni descuenta stock dos veces.
5. Cancelar por el cliente repone stock y revierte el cupón.
6. Todos los importes del pedido se recalculan en servidor y cuadran al centavo.

## Testing
- **Unit:** formateador del mensaje de WhatsApp (escape de caracteres, longitud máxima de URL), máquina de estados (todas las transiciones válidas/inválidas), cálculo de totales.
- **SQL/Integración (crítico):**
  - `create_order` camino feliz, cada validación fallida, idempotencia.
  - **Concurrencia:** 100 pedidos simultáneos con 10 unidades → exactamente 10 vendidas, sin stock negativo, sin números de pedido duplicados ni huecos.
  - Rollback completo ante fallo en cualquier paso (no queda stock descontado a medias, ni cupón consumido).
  - Atomicidad con cupón de uso limitado + stock limitado a la vez.
- **RLS:** cliente A no ve pedidos de B; cliente no puede cambiar estado ni totales; admin sí.
- **E2E:** compra completa móvil; cambio de precio/stock durante el checkout; cupón vencido al enviar; dirección sin cobertura; cancelación; usuario en lista negra intentando contra entrega.
- **Contrato:** `PaymentProvider` con proveedor *fake* para probar el flujo genérico.
- **Resiliencia:** corte de red tras crear el pedido pero antes de abrir WhatsApp (el cliente puede recuperarlo en "Mis pedidos").

## Edge cases
- Pedido de 1 sola unidad vs. cientos de líneas; variante archivada/oculta/agotada entre carrito y pago.
- Reserva vencida al momento de pagar pero con stock disponible → se re-reserva atómicamente; si no hay, diff.
- Cambio de moneda/país durante el checkout; tipo de cambio actualizado por admin mientras tanto (congelar al crear).
- Precio que cambia en el instante exacto del envío del formulario.
- Teléfono/correo del formulario distinto al del perfil (¿actualiza el perfil o solo el pedido? → solo el pedido, con opción).
- Datos fiscales ausentes/inválidos; dirección archivada tras elegirla.
- Franja de entrega que se llena o se bloquea entre selección y envío.
- Pop-up de WhatsApp bloqueado; WhatsApp no instalado; teléfono de tienda mal configurado; mensaje demasiado largo.
- Usuario desactivado o en lista negra con sesión abierta.
- Carrito ya convertido (reenvío del formulario en otra pestaña) → mismo pedido por idempotencia.
- Pedido creado pero el cliente nunca contacta por WhatsApp (S-05): visibilidad al admin y recordatorio.
- Cancelación en el mismo instante que el admin pasa el pedido a `preparing` (carrera) → la transición se resuelve con bloqueo de fila, gana la primera.
- Reintentos de `create_order` tras timeout del cliente (el servidor sí lo creó).
- Totales con redondeo en múltiples líneas y descuentos (suma exacta, sin centavos perdidos).
- Fallo del trigger de outbox no debe revertir el pedido (se encola de forma resiliente).

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de `create_order` línea por línea (seguridad, locks, orden de bloqueo, `search_path`).
- [ ] Revisión de privacidad en el mensaje de WhatsApp (solo lo necesario).
- [ ] Prueba de carga básica del checkout (ráfaga simulada tipo campaña).
- [ ] Revisión de logs/auditoría de creación y cancelación.
- [ ] **Demo de cierre de R2** con el dueño: compra real de prueba end-to-end.

## Riesgos
- Es el sprint más crítico en integridad → tiempo de buffer para pruebas de concurrencia.
- Pedidos por WhatsApp sin confirmación pueden "bloquear" stock (S-05) → recordatorio y cancelación manual ágil (S12).
- `create_order` recibe una lista de líneas: aplicar lo decidido en S7 sobre el aviso de `zod` < 4.6.6 (tamaño del cuerpo y largo de lista antes de parsear).

## Pendientes externos
Número de WhatsApp y plantilla de mensaje; política de contra entrega (zonas/montos) y lista negra; formato de factura (si aplica).

## Entregables para sprints siguientes
Pedidos completos con snapshots y estados, `create_order`/`transition_order_status`/`cancel_order_by_customer`, interfaz `PaymentProvider`, checkout y "Mis pedidos", outbox de eventos.

## Estado real de entrega (2026-11-10)

**Entregado:** pedidos y checkout completos para **WhatsApp y contra entrega** (QR es de S11). Base de datos: 6 tablas (`orders`, `order_items`, `order_status_history`, `payments`, `payment_methods`, `order_counters`) con instantánea inmutable (guardas contra `UPDATE` del contenido, `DELETE` y `TRUNCATE`), `create_order` (una función, una transacción, orden de candados fijo, idempotente por llave **y contenido**, número `MIC-000123` sin huecos, stock firme al crear, tope de pedidos sin confirmar por clienta, avisos resilientes), `checkout_preview` (los mismos números que `create_order` por construcción), la máquina de estados (`transition_order_status`, `cancel_order_by_customer`, `admin_transition_order`), los cron de recordatorio y vencimiento, privilegios **por columna** (la clienta no lee el costo ni las notas internas) y `payment_methods` dirigido por tabla. Servidor: Edge Function `checkout` (`preview`, `create`, `cancel`) con la capa `PaymentProvider` (`whatsapp`, `cash_on_delivery`, y un proveedor falso para el contrato). Cliente: `/checkout` (un solo formulario, revalidación BR-CHK-04, anti doble envío), `/pedido/:numero` (confirmación y seguimiento), «Mis pedidos» con datos reales y «Cancelar el pedido», los eventos `begin_checkout`/`add_payment_info`/`purchase` y los dos ajustes nuevos en el panel (Configuración → «Pedidos»). Explicado en `docs/pedidos.md`.

**Cómo se hizo:** todo por mí (base, función, pantallas y pruebas), sin subagentes de implementación; una **revisión independiente** (un agente sin contexto, solo lectura, que leyó el código completo: 1 alto, 6 medios y 13 bajos) y mutaciones en SQL y en la interfaz. Todo contra la nube (sin Docker ni base local).

**Desviaciones respecto al plan (y por qué):**
- **`create_order` no recibe `cart_id` ni `coupon`:** los toma del servidor (el carrito activo de la clienta y su cupón). El navegador no elige qué carrito pagar. La firma difiere de la del sprint.
- **El stock se descuenta de forma firme al crear el pedido** y se consumen las reservas del carrito; no se crean reservas `owner_type='order'`. Cancelar repone con un movimiento `cancel`.
- **Los pedidos de WhatsApp y contra entrega no vencen** (S-05): comprometen stock hasta que el admin confirme o cancele; el sistema le recuerda a las `order_reminder_hours` (24) y cada 24 h. **Añadido tras la revisión:** un tope de **5 pedidos sin confirmar por clienta** (`open_orders_max`); sin él una cuenta podía acaparar el inventario.
- **Los avisos van al correo/teléfono de la cuenta**, no al escrito en el formulario (no está verificado: era un relevo de avisos a terceros). El contacto del formulario solo se guarda en el pedido.
- **La llave de idempotencia va ligada al contenido** (`orders.request_hash`): la misma llave con otro contenido da `idempotency_conflict`; la pantalla rota la llave si la persona cambia algo antes de reintentar.
- **«Mis pedidos» sin paginar** (los últimos 100) y **sin panel de pedidos para el admin** (S12): un pedido solo se confirma/cancela por `admin_transition_order` (SQL/RPC).
- **El `provider` de un método de pago se limita por `CHECK`** a los implementados (`whatsapp`, `cash_on_delivery`); se amplía por migración al sumar uno.

**Bugs reales encontrados por las pruebas y corregidos:**
- *JSON `null` ≠ SQL `NULL`:* lo ausente llegaba como `null` de `jsonb` y violaba los `CHECK` de la instantánea (franja, dirección, datos fiscales): `nullif(x, 'null'::jsonb)`.
- *La guarda del pedido bloqueaba el `ON DELETE SET NULL` de `orders.cart_id`* (los carritos se purgan): `cart_id` pasó a la lista de columnas libres.
- *Un clic con la vista previa vieja enviaba el pedido con números de otra elección* (hallazgo del E2E): el botón y `submit` esperan la vista previa fresca («Calculando tu total…»).
- *CLS de 1,1 y 0,53* (el checkout y su guarda de sesión aparecían por trozos): se reserva `min-h-[100svh]` y hasta tener los datos se muestra un esqueleto; ahora 0,044 (escritorio) y 0,029 (móvil).
- *`parseQuote` lanza si la cotización viene mal formada:* la sección de envío la captura y muestra el aviso.
- *`cleanLine` partía un emoji por la mitad* (corte por unidades UTF-16) y `encodeURIComponent` lanzaba `URIError` al armar el enlace de WhatsApp: ahora corta por puntos de código y neutraliza sustitutos sueltos.
- *«Confirmar con el nuevo total» podía no hacer nada:* el clic llegaba con la vista previa recalculándose y `submit` salía en silencio; ahora el botón espera.
- *El mensaje de corte de red decía «Tu pedido NO se envió»* (falso si el servidor ya lo había creado): ahora dice que no se pudo confirmar, cómo comprobarlo y que reintentar no duplica.
- *Las pruebas antiguas (06–12, 01–04, 13)* fallaban por las nuevas claves foráneas y guardas de pedidos: se ajustaron (vaciado de pedidos y triggers de `order_items` desactivados dentro de su transacción).

**Revisión independiente (agente sin contexto, solo lectura; sin críticos). Cada hallazgo se verificó leyendo el código antes de actuar.**
- *Corregidos con prueba:*
  1. **(Alto) La clienta podía leer `order_items.cost_unit`** (el costo del producto, o sea el margen de cada prenda comprada) con `GET /rest/v1/order_items?select=cost_unit`. Ahora `order_items` y `order_status_history` se leen solo por columnas permitidas (sin `cost_unit`, `reason` ni `actor_id`). Probado en pgTAP, integración HTTP y con mutantes.
  2. **Avisos al contacto sin verificar** (relevo): ahora van al correo/teléfono de la cuenta; sin ninguno de los dos no se avisa.
  3. **Sin tope de pedidos abiertos** (acaparar inventario): `open_orders_max`.
  4. **Llave de idempotencia sin contenido** y mensaje de red falso (ver arriba).
  5. **«Confirmar con el nuevo total» sin efecto** mientras se recalcula (ver arriba).
  6. **Pruebas que faltaban:** transiciones por **conjunto exacto** (no por conteo); fallos inyectados en descuentos, pedido, stock, reservas, carrito, historial y pago (cada uno deshace todo, también lo reservado antes); alerta de stock con la cola de avisos caída; dos variantes pedidas en orden inverso por 12 clientas a la vez (sin deadlock); cancelar contra `preparing` con 6 carreras simultáneas; `completeCharge` (proveedor ausente o que falla); E2E de lista negra, dirección sin cobertura y cupón que deja de valer.
  7. Menores: el enlace de WhatsApp se arma con el pedido del estado del router (sin esperar otra consulta); `cleanLine` por puntos de código; «Necesito factura» sin datos fiscales ya no envía sin factura; por descuento el diálogo ofrece «Ver el nuevo total» (antes la documentación decía que se podía confirmar); la confirmación titula según el estado actual (no siempre «¡Recibimos tu pedido!»); `/checkout` y `/pedido` en `robots.txt`; captura del E2E portable (`E2E_SHOTS_DIR`); `update stock_reservations` en orden de id; los cron aíslan los errores por pedido; la alerta de stock de S3, que corre dentro de la venta, ahora es resiliente; el `provider` de pagos se valida.
- *Documentados como límite, NO corregidos* (`docs/pedidos.md`, «Límites conocidos»): la cobertura por ciudad usa texto libre (S8); el límite por red de 60 pedidos/10 min con IP compartida; «Mis pedidos» sin paginar; el oráculo de la lista negra (`not_available` vs `over_max_amount`); las pruebas antiguas bloquean tablas (no correrlas con tráfico real); `orders.cancel_reason` y el desglose de la cotización siguen legibles por la dueña (el admin no debe escribir notas internas ahí); el texto «términos y condiciones» sin enlace (página legal de S15); y las **tres lecturas del carrito** de `create_order`: ahora hay una comparación Σ líneas = subtotal/descuento que devuelve `stale_prices`, con prueba (I5 desvía las líneas con un trigger; provocarlo de verdad exigiría cambiar un precio en ese milisegundo).

**Verificación (2026-11-10):**
- **Unitarias:** 5534 en 237 archivos (S9: 5424 / 230), con tipos, lint `--max-warnings=0` y Prettier limpios. Una corrida completa dio **14 fallos que no se reprodujeron**: la máquina tuvo un pico de carga de 78 (tiempos de espera agotados) y al repetir la suite entera con la carga normal pasaron 5534 de 5534; no se identificó cuál fue cada uno. Deno: 108 (`npm run test:edge`).
- **pgTAP contra la nube** (migración revisada aplicada; suite completa 00–17 verde): `17_s10_pedidos` **367 aserciones**, `05` 16, `06` 111, `14` 473, `15` 243, `16` 520. Los valores esperados están calculados **a mano** en el comentario de cada bloque.
- **Integración contra la nube** (`checkout.integration.test.ts`, 19): acceso y validación HTTP, camino feliz al centavo, idempotencia (y conflicto), BR-CHK-04, sin stock, lista negra, contra entrega, RLS entre clientas, costo oculto, tope de pedidos abiertos, 429, **100 intentos simultáneos de 25 clientas sobre 10 unidades = exactamente 10 pedidos, stock 0, números consecutivos sin huecos**, cupón de un uso + última unidad a la vez, dos variantes en orden inverso y cancelación contra `preparing`.
- **E2E contra la nube (Chromium escritorio y móvil):** `e2e/checkout.spec.ts` **18 de 18** (compra completa, doble clic, stock que cambia, contacto incompleto, recojo, axe AA + CLS + sin desbordes, lista negra, dirección sin cobertura, cupón que deja de valer). **Regresión** (carrito, envíos, descuentos, cuenta, direcciones, humo): 157 de 164; el único fallo causado por S10 era el E2E provisional de «Mis pedidos» (ya corregido y verde). Los otros 2 fallos distintos (`layout.spec.ts`: cabecera de páginas interiores y de la portada, en escritorio y móvil) **ya fallaban en el commit anterior a S10**, comprobado en una copia limpia del commit `1517871`; no se tocaron.
- **CLS del checkout:** 0,044 (escritorio) y 0,029 (móvil), bajo el umbral «bueno» (0,1).
- **Mutación SQL:** 66 mutantes de `create_order`, las transiciones, el cálculo, la cancelación, el vencimiento, la RLS, las guardas, el contador y las correcciones de la revisión (huella de idempotencia, tope de pedidos abiertos, avisos a la cuenta, `CHECK` del proveedor, privilegios por columna). **Primera vuelta: 61 de 66 detectados.** Los 5 supervivientes eran pruebas débiles y cada uno llevó a una prueba nueva: *llave por clienta* (la prueba aceptaba cualquier rechazo, también un conflicto con el pedido de otra persona: ahora exige «bolsa vacía»), *línea no disponible* (D3 solo miraba el estado de la línea, no el resultado), *total esperado sin redondear* (nadie probaba el ruido de decimales: F7), *aviso al teléfono del formulario* (nadie probaba una cuenta solo-teléfono: F8) y *pedido incoherente* (la comparación de líneas y totales no tenía prueba: I5, con dos triggers que desvían el descuento y el subtotal). **Repetidos tras reforzar: 66 de 66.** Sin equivalentes sin detectar; lo que NO se puede mutar con pgTAP (una sola sesión) son los candados reales, que se prueban en la integración con peticiones simultáneas.
- **Mutación en la interfaz:** 17 mutantes (llave por contenido, factura sin datos fiscales, diálogo de revalidación, pedido de otro número, título por estado, mensajes de error, corte por UTF-16, `robots`, ajustes del panel, mensaje de red): **17 de 17 detectados** (uno sobrevivió, la guardia `reason !== "price"` del diálogo, y llevó a una prueba nueva).

**Criterios de aceptación:**
1. *Compra por WhatsApp y contra entrega; `pending_payment` con stock comprometido y n.º `MIC-…` correlativo:* **cumplido** (integración y E2E).
2. *Dos clientes por la última unidad:* **cumplido** (un pedido y un `unavailable` con el detalle; con cupón de un uso a la vez; 100 simultáneas).
3. *Snapshots inmutables:* **cumplido** (guardas por trigger; probado que editar productos no cambia pedidos antiguos).
4. *Doble clic o reintento no duplica ni descuenta dos veces:* **cumplido** (pgTAP, integración, E2E de doble clic; la llave rota si cambia el contenido).
5. *Cancelar repone stock y revierte el cupón:* **cumplido** (pgTAP e integración).
6. *Importes recalculados en servidor y al centavo:* **cumplido** (CHECK exacto `total = subtotal − descuento + envío − descuento de envío`; el cliente solo da formato).

**Pendiente (no hecho / no verificado):**
- **Panel de pedidos del admin (S12)** y por tanto la **demo de cierre de R2** con el dueño (compra real → confirmación → entrega).
- **Navegador real y teléfono** (WhatsApp de verdad, popups bloqueados en iOS Safari / Chrome Android), lector de pantalla y Lighthouse: lo automático solo pasa axe y emulación.
- **Prueba de carga de campaña** (ráfaga sostenida): solo se probaron 100 intentos simultáneos.
- **E2E del cambio de precio con garantía vencida** (cubierto en pgTAP y en componentes, no en el navegador) y **resiliencia con corte de red real** tras crear el pedido (cubierta con el estado del router y «Mis pedidos», no cortando la red).
- **Moneda distinta de BOB y tipo de cambio:** el pedido ya los congela, pero no se ejercitó con otra moneda.
- **Decisiones del dueño** (PENDIENTES_ADMIN «Añadido en Sprint 10»): plantilla de WhatsApp, política de contra entrega, criterios de la lista negra, vencimiento de pedidos sin confirmar, formato de factura.
- **Seguridad (SPRINT_19):** revocar el token de acceso pegado en el chat y rotar la contraseña de la base y la clave `sb_secret_…`.
- **NO subido:** los cambios de S10 están en el árbol de trabajo, sin commit ni push (se hace cuando el dueño lo pida).

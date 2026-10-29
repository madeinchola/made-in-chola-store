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

## Pendientes externos
Número de WhatsApp y plantilla de mensaje; política de contra entrega (zonas/montos) y lista negra; formato de factura (si aplica).

## Entregables para sprints siguientes
Pedidos completos con snapshots y estados, `create_order`/`transition_order_status`/`cancel_order_by_customer`, interfaz `PaymentProvider`, checkout y "Mis pedidos", outbox de eventos.

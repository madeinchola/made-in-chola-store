# Pedidos y checkout (Sprint 10)

Qué hace, cómo está hecho y por qué. Cubre BR-CHK-01/02/04/05, BR-ORD-01/02/04/05/06, BR-INV-02..04, BR-PRC-05, BR-PAY-01 (WhatsApp y contra entrega), BR-PAY-02, BR-PAY-06/07 (base), BR-DAT-02, S-05 y S-07. Reúne lo que S7 (carrito), S8 (envíos) y S9 (descuentos) dejaron para este sprint.

## El flujo

```
Bolsa ─[Pagar]→ /checkout ─ vista previa (servidor) ─┬→ crear pedido ─→ /pedido/MIC-000123 ─→ WhatsApp / contra entrega
 (sesión)        un solo formulario                  │      atómico, idempotente
                                                     └→ «cambió el total / no hay stock»: se muestra la diferencia y NO se crea
```

- **Toda compra requiere cuenta** (BR-ACC-01): sin sesión, «Pagar» lleva a `/login` y vuelve.
- **Un solo formulario, sin pasos** (BR-CHK-01): contacto, entrega (forma, dirección con pin, franja), datos fiscales opcionales, cupón (el mismo campo de la bolsa), método de pago y resumen.
- **El cliente nunca manda precios, descuentos ni líneas.** Solo manda qué eligió (`address_id`, `shipping_method`, franja, método de pago, contacto) y el **total que vio** (`expected_total`). Las líneas salen del carrito de la clienta en el servidor.
- **Revalidación (BR-CHK-04):** si el total ya no es el que vio, o hay precio subido con la garantía vencida, o falta stock, el pedido **no se crea** y se muestra la diferencia («antes / ahora»). Con otro total se confirma y se reenvía con la **misma llave** (no se duplica). Con precio subido o sin stock solo se ofrece volver a la bolsa. Si dejó de valer un **descuento o cupón**, el servidor no puede dar el total nuevo (el descuento que falló seguía en la cuenta): el aviso solo ofrece «Ver el nuevo total» (el formulario ya lo recalculó) y «Revisar mi bolsa».
- **La llave de idempotencia va ligada a lo que se envía:** la misma llave solo devuelve el pedido ya creado si se pide **lo mismo** (dirección, datos fiscales, forma de entrega, franja, método de pago, contacto). Si la persona cambia algo antes de reintentar (típico tras un corte de red), la pantalla usa otra llave; y si el servidor recibe la misma llave con otro contenido responde `idempotency_conflict` en lugar de devolver el pedido viejo como si fuera el nuevo. Por eso, tras un corte de red el mensaje es honesto: «No pudimos confirmar si tu pedido se envió. Revisa «Mis pedidos» o inténtalo otra vez: si ya se había creado, no se duplica».
- **«Necesito factura»** sin datos fiscales elegidos no envía el pedido (saldría sin factura sin que la persona lo supiera): se explica junto a la sección.
- **WhatsApp (Bolivia):** se crea el pedido y se intenta abrir `wa.me` **una vez**; si el navegador lo bloquea, la pantalla de confirmación tiene siempre el botón (y «Mis pedidos» lo recupera). El enlace se arma con el pedido que la propia respuesta de «crear» trae (estado del router), sin esperar otra consulta a la base, para abrirse lo antes posible tras el clic. El mensaje lleva número, productos, importes, entrega y a nombre de quién; **no** el teléfono propio, el correo ni los datos fiscales, y **nunca** pasa de 1 800 caracteres de URL (se recortan productos: «…y 12 productos más»); el recorte es por puntos de código, así que un emoji en el borde no rompe el enlace.
- **Contra entrega:** método seleccionable; se bloquea a las cuentas en lista negra (S-07) sin decirles que lo están, y puede tener un tope de monto.

## Modelo de datos (`20261108000100_s10_pedidos.sql`)

| Tabla | Para qué |
| --- | --- |
| `orders` | El pedido: **instantánea inmutable** (contacto, dirección, método y cotización de envío, franja, datos fiscales, moneda, tipo de cambio, importes, descuentos aplicados). Solo cambian su estado y sus fechas. `total = subtotal − descuento + envío − descuento de envío` con un `CHECK` exacto. |
| `order_items` | Líneas con instantánea: nombre, color, talla, SKU, imagen, cantidad, precio unitario, descuento por línea, **costo** y el desglose de ofertas (para el reembolso prorrateado de S12). Inmutables. |
| `order_status_history` | Cada transición: de qué estado, a cuál, quién (clienta / admin / sistema) y por qué. Inmutable. |
| `payments` | Base de pagos (proveedor, método, estado, monto). S11 añade webhooks y comprobantes. |
| `payment_methods` | Los métodos de pago por país (tope de monto, ventana de pago, si se bloquea a la lista negra). El selector del checkout lo dirige esta tabla (BR-PAY-02); los de ejemplo («WhatsApp» y «Efectivo contra entrega») son de EJEMPLO. |
| `order_counters` | El contador del número `MIC-000123`: solo avanza de uno en uno y no se borra. |

Nada se borra: `orders` tiene guarda contra `DELETE`/`TRUNCATE`; `order_items` y el historial, contra `UPDATE`/`DELETE`. `orders.cart_id` es `on delete set null` (los carritos se purgan) y por eso está en la lista de columnas que la guarda permite cambiar.

### Seguridad

RLS en las 6 tablas. La clienta **solo lee** sus pedidos (`profile_id = auth.uid()`); el admin lee todos; nadie escribe desde el navegador (ni siquiera `service_role` tiene `INSERT`/`UPDATE`: solo las funciones).

**Lo que la clienta NO puede leer, aunque el pedido sea suyo** (privilegios **por columna**, no solo por fila): `order_items.cost_unit` (el costo del producto: dejaba ver el margen de cada prenda; lo encontró la revisión independiente) y, del historial, `reason` (nota interna) y `actor_id` (qué administrador hizo cada cambio). `select *` sobre esas tablas falla con 42501: el cliente pide columnas explícitas. Como el admin comparte el rol `authenticated`, **tampoco las lee desde el navegador**: el panel de pedidos (S12) las leerá por una función de administración (`is_admin()` adentro) o por la Edge Function; `service_role` sí las lee (informes de margen, S14). `orders.cancel_reason` y el desglose de la cotización de envío (`shipping_method.quote`) siguen siendo legibles por la dueña: **el admin no debe escribir ahí notas internas** (eso va en el motivo del historial, que está oculto). Las funciones del servidor (`create_order`, `checkout_preview`, `transition_order_status`, `cancel_order_by_customer`) solo las ejecuta `service_role`, a través de la Edge Function `checkout`. La única función que ejecuta el navegador es `admin_transition_order` (adentro exige ser admin). La auditoría registra que cambiaron los datos personales, nunca su valor.

## `create_order`: cómo se mantiene la integridad

Una sola función SQL, una sola transacción, con un **orden de candados fijo** para que dos pedidos nunca formen un ciclo:

1. Fila de **`profiles`** de la clienta (`FOR UPDATE`): serializa SUS pedidos. Cierra la obligación de S9: la elegibilidad de «primera compra» se evalúa con el candado puesto, así que dos pedidos simultáneos de la misma clienta no pueden usarla dos veces.
2. **Idempotencia:** `unique (profile_id, idempotency_key)` más una huella del contenido (`orders.request_hash`); bajo el candado, la misma llave **con el mismo contenido** devuelve el mismo pedido (`existing`) sin descontar nada otra vez; con otro contenido, `idempotency_conflict`.
2b. **Tope de pedidos sin confirmar** (`open_orders_max`, 5 por omisión; panel → «Pedidos»): S-05 hace que WhatsApp y contra entrega no venzan, así que cada pedido compromete stock hasta que el admin lo confirme o cancele; sin tope una sola cuenta podría acaparar el inventario. Al llegar al tope: `too_many_open_orders`. Un reintento de un pedido ya creado no cuenta como uno nuevo.
3. **Candado del carrito** (el mismo de las funciones del carrito): mientras se compra no se agrega nada.
4. **Variantes** `FOR UPDATE` en orden de id (y las reservas del carrito, al consumirlas, también por id: el mismo orden que usa el archivado de productos).
5. **Cálculo único** (`_checkout_compute`, el mismo de la vista previa): precios (respeta el precio del carrito, S-04), cotización de envío con el **subtotal sin descuento** (igual que el estimador de S8) y descuentos del motor de S9 sobre el envío ya cotizado. Si algo hay que corregir, **se devuelve sin escribir nada**.
6. Todo lo que **escribe** va en un sub-bloque que, si falla, revierte *todo* y devuelve un resultado estructurado: cupo de la franja → usos de descuentos/cupones (todos o ninguno) → **número** (el contador es el último candado disputado) → pedido y líneas → **stock firme** (`apply_stock_change(-qty, 'sale')`) → reservas del carrito `consumed` → carrito `converted` → historial y pago.
7. Avisos a la cola de notificaciones de forma **resiliente**: si la cola falla, el pedido no se revierte. Eso incluye la alerta de stock de S3 (`stock_movements_alert`), que corre **dentro** de la venta: se volvió resiliente (si encolar falla, avisa con `WARNING` y sigue). Los avisos van al **correo y teléfono de la cuenta** (`profiles`), no a los que se escribieron en el formulario: esos no están verificados y un pedido podría usarse para mandar avisos de la tienda a un tercero. El contacto del formulario se guarda solo como dato del pedido.

**Numeración sin huecos (BR-ORD-04):** el contador se incrementa en la misma transacción; si algo falla, el incremento también se revierte. Probado con un fallo provocado a mitad de la creación y con 100 intentos simultáneos.

### Resultados de `create_order`

| `outcome` | Qué pasó | Qué hace la pantalla |
| --- | --- | --- |
| `created` | Pedido creado | Navega a `/pedido/MIC-…` |
| `existing` | Reintento con la misma llave | Igual (el mismo pedido) |
| `changed` (`total`) | El total ya no es el que vio | Diálogo «antes / ahora»; confirmar reenvía con el nuevo total (el botón espera si la vista previa se está recalculando) |
| `changed` (`discount`) | Un descuento o cupón dejó de valer al reservar su uso | «Ver el nuevo total» (cierra; el formulario ya lo recalculó) o «Revisar mi bolsa» |
| `changed` (`price`) | Subió un precio con la garantía vencida | Solo «Revisar mi bolsa» (se acepta allí) |
| `unavailable` | Falta stock (detalle por línea) | Lista de líneas; solo «Revisar mi bolsa» |
| `rejected` | Algo que corregir (dirección, cobertura, franja llena, pago no disponible, cuenta inactiva, bolsa vacía, `too_many_open_orders`, `idempotency_conflict`, `stale_prices`…) | Resumen de errores con el foco, y junto a su sección |

## Estados y cancelación

```
pending_payment ──► paid ──► preparing ──► shipped ──► delivered ──► completed
      │               │          │
      └───────────────┴──────────┴──► cancelled ──► refunded
```

Solo `transition_order_status` cambia el estado (un trigger rechaza cualquier `UPDATE` directo), con bloqueo de la fila del pedido: si la clienta cancela en el mismo instante en que el admin pasa a `preparing`, gana la primera y la segunda recibe `invalid_transition` (BR-ORD-02). **Quién puede qué:** el admin recorre todo; la clienta solo cancela en `pending_payment` o `paid`; el sistema solo vence pedidos sin pagar.

Efectos: `→ paid` confirma los usos del descuento; `→ cancelled` **repone el stock**, libera la franja y **devuelve el uso del cupón**; `→ refunded` marca el pago. Cada transición encola su aviso (BR-SHP-04: confirmado, empacado, enviado, entregado…) y queda en el historial.

### Vencimiento y recordatorios (S-05)

- **WhatsApp y contra entrega no expiran** (`payment_expires_at` nulo). Comprometen stock hasta que el admin confirme o cancele.
- `remind_pending_orders` (cada hora) avisa al admin de los pedidos sin confirmar más de `order_reminder_hours` (24 por omisión; panel → «Pedidos») y repite cada 24 h. `expire_unconfirmed_orders` (cada 5 min) cancela solo los de métodos **con ventana de pago** (QR, S11). Ambas tratan cada pedido en su propio sub-bloque: una fila con problema se registra con `WARNING` y no detiene a las demás (ni se repite para siempre con el mismo pedido).

## Edge Function `checkout`

La única puerta (`verify_jwt = false`: verifica el JWT con Auth). Acciones `preview`, `create`, `cancel`. Esquema **estricto de valores sueltos** (decisión de S7 sobre el aviso de `zod`: ninguna lista en la petición), cuerpo ≤ 2 kB, y topes de tasa: crear pedidos 10 por clienta y 60 por red cada 10 minutos; vista previa 60 por minuto; cancelar 20 cada 10 minutos.

Tras crear el pedido pide al **proveedor de pago** la instrucción para completarlo (`PaymentProvider { createCharge, handleWebhook, refund, getStatus }`, `supabase/functions/_shared/payments/`; la función pura `completeCharge` de `charge.ts` está probada con éxito, proveedor que falla y proveedor ausente). S10 implementa `whatsapp` y `cash_on_delivery`; hay un proveedor falso para probar el contrato. Si el proveedor falla o no existe, **el pedido ya está creado**: la respuesta trae `payment_error` y la pantalla lo avisa sin perderlo. La base solo acepta métodos de pago con un proveedor implementado (`CHECK payment_methods_provider_supported`; se amplía por migración al sumar uno): un método con `provider='stripe'` dejaría pedidos sin forma de completarse.

## Pantallas

- `/checkout` (`src/features/checkout/`): formulario único con el resumen al lado (en móvil, debajo). Anti doble envío: el botón se bloquea y la llave de idempotencia hace que un reintento (también tras un corte de red) devuelva el mismo pedido.
- `/pedido/:numero`: confirmación y seguimiento; botón de WhatsApp siempre disponible mientras el pedido esté pendiente. Recién creado dice «¡Recibimos tu pedido!»; al volver (enlace guardado, «Mis pedidos») el título y el texto dicen cómo va **hoy** (confirmado, en preparación, cancelado…). `/checkout` y `/pedido` van con `noindex` y `Disallow` en `robots.txt`.
- `/cuenta/pedidos` y `/cuenta/pedidos/:id`: lista y detalle reales con línea de tiempo y «Cancelar el pedido».
- Eventos `begin_checkout`, `add_payment_info` y `purchase` en `track` (sin datos personales; el `transactionId` es el número del pedido).

## Límites conocidos y decisiones abiertas

1. **No hay panel de pedidos para el admin (S12).** Mientras tanto un pedido de WhatsApp o contra entrega solo se confirma o cancela con `admin_transition_order` (SQL/RPC). La **demo de cierre de R2** con el dueño necesita ese panel, o que se confirme a mano.
2. **Las notificaciones solo se encolan** (`notification_outbox`): nadie las envía hasta S13.
3. **El teléfono y el correo del formulario solo viajan al pedido**: no actualizan el perfil (decisión del sprint; queda como opción futura).
4. **Contra entrega:** la política real (zonas y montos máximos) y los criterios de la lista negra los define el dueño (PENDIENTES_ADMIN). Los métodos de pago y sus topes se editan hoy en la tabla `payment_methods`; **no hay pantalla de administración** para ello hasta S11/S12.
5. **Tipo de cambio:** solo existe BOB; el pedido ya congela moneda y tipo de cambio (`exchange_rate`), pero un pedido en otra moneda no se ha ejercitado.
6. **Impuestos:** el precio mostrado es final (BR-PRC-01); `orders.tax_included` es verdadero y no hay desglose fiscal hasta que el dueño lo defina.
7. **Anonimizar una cuenta (BR-ACC-07)** conserva sus pedidos para contabilidad, con el nombre, teléfono, correo y dirección que se congelaron al comprar: decidir con el dueño si esa instantánea debe anonimizarse también (S12/S15).
8. **Franjas:** la franja se reserva al crear el pedido y se libera al cancelar; no hay «mover» una entrega a otra franja (S12).
9. **Rendimiento:** probado con 100 intentos simultáneos sobre 10 unidades; no se ha medido con miles de pedidos al día ni con la bolsa de 30 líneas más grande permitida.
10. **Obligaciones que dejó S9, cumplidas:** `_customer_order_count` cuenta los pedidos no cancelados; los usos de descuentos se **liberan** al cancelar o vencer; «primera compra» se serializa por clienta; el desglose por línea queda en el pedido.
11. **S12 debe dar una vía de lectura de administración** para `order_items.cost_unit`, `order_status_history.reason`/`actor_id` (ver «Seguridad»): hoy solo `service_role` y las funciones los leen.
12. **Verificación de contactos (BR-ACC-03):** los avisos van al correo/teléfono de la cuenta, pero una cuenta con un correo AJENO sin verificar sigue pudiendo recibir los avisos de sus propios pedidos; el riesgo residual se cierra al exigir correo verificado para comprar o enviar (S13).
13. **Límites de tasa por red:** crear pedidos admite 60 cada 10 minutos por IP. Con IP compartida (datos móviles, una oficina) o en una campaña, personas distintas pueden toparse con un 429: medirlo antes del lanzamiento.
14. **«Mis pedidos»** lista los últimos 100 pedidos sin paginar.
15. **Cobertura por ciudad:** sigue usando el texto libre de la dirección (límite de S8); el aviso de S8 «validar la dirección al crear el pedido» no se atendió en S10.
16. **Lista negra:** a una cuenta en lista negra el método contra entrega le llega con `reason: 'not_available'`; un tope de monto, con `over_max_amount`. No se distinguen por el texto de pantalla, solo por ese código.
17. **Tres lecturas del carrito en `create_order`:** `_checkout_compute` evalúa el carrito en sentencias distintas (READ COMMITTED). Si el admin edita un precio o descuento justo entre ellas, las líneas y los totales podrían salir de fotos distintas. Para que no se guarde un pedido incoherente, `create_order` compara Σ líneas con el subtotal y el descuento del cálculo antes de descontar nada y, si difieren, devuelve `stale_prices` (se pide intentarlo de nuevo). La ventana es de milisegundos; la comparación está probada desviando las líneas con un trigger (pgTAP I5) y por mutación. No hay `CHECK` en la tabla que ate Σ líneas = subtotal − descuento.
18. **Contrato del sprint:** `create_order` no recibe `cart_id` ni `coupon`: los toma del servidor (carrito activo de la clienta y su cupón). Es más seguro (el navegador no elige qué carrito pagar) pero difiere de la firma que pedía el sprint.
19. **Pruebas antiguas (01–13) bloquean tablas:** deshabilitan triggers de `orders`, `order_items` e `order_status_history` dentro de su transacción (toma `SHARE ROW EXCLUSIVE` y frena `create_order` mientras corren). No ejecutarlas contra una base con tráfico real.

# Pagos con QR (Sprint 11)

Qué hace, cómo está hecho y por qué. Cubre BR-PAY-02/03/04/05, BR-DAT-03, S-05, S-06 y las decisiones del dueño sobre el plazo. Se apoya en lo que dejó S10 (`payments`, `PaymentProvider`, `transition_order_status`, `payment_methods`).

## El flujo

```
Checkout ─ «Pago con QR» ─→ pedido pendiente + cobro (referencia = n.º del pedido, vence en 24 h)
                                │
        la clienta escanea el QR, paga el monto EXACTO y sube la foto del comprobante
                                │
          ┌─────────────────────┴──────────────────────┐
   manual_qr: el admin APRUEBA / RECHAZA          qr_api: el banco o el proveedor avisa (webhook firmado)
          └─────────────────────┬──────────────────────┘
                     payment_apply_event  (el camino ÚNICO)
                                │
   monto exacto → pedido «paid» UNA vez │ distinto, duplicado, tardío, contracargo → REVISIÓN (el dinero no se pierde)
```

- **Plazo: 24 horas, no 10 minutos.** Lo decidió el dueño (2026-10-28) y sustituye al 10 min de BR-PAY-03. Es `payment_methods.window_minutes` (1 a 1440). La retención del carrito de S7 sigue en 10 min. Costo conocido: un pedido sin pagar retiene stock 24 h (se mitiga con recordatorios, el tope de pedidos abiertos de S10 y la cancelación manual).
- **Un cobro por intento.** La referencia que la clienta escribe y por la que el banco avisa es única: el primer cobro de un pedido usa su número (`MIC-000123`); un reintento suma `-2`, `-3`… (`payments.attempt`, hasta 5). Un índice único parcial impide **dos cobros abiertos** para un mismo pedido, aunque haya concurrencia.
- **Proveedores.** `manual_qr` (QR estático de la tienda + comprobante + revisión humana) y `qr_api` (la misma pantalla, pero confirma un aviso firmado). **No hay un adaptador de CobraFácil:** no hay documentación, sandbox ni credenciales, y inventar su API sería fabricarla. `qr_api` define el **contrato** que un adaptador real cumple o traduce (ver «Avisos de pago»). El proveedor falso solo existe para probar el contrato y **no** está en el registro de producción.
- **La interfaz solo ofrece el QR manual** (decisión del dueño, 2026-11-11: aún no hay cobro automático). El modo automático está **preparado en el código** y apagado en la interfaz con `AUTOMATIC_QR_IN_UI` (`src/features/payments/automaticQr.ts`): con `false` no se ve, en ninguna pantalla, nada de cobro automático (ver «Qué muestra hoy la interfaz»).

## Modelo de datos (`20261110000100_s11_pagos.sql`)

| Tabla / cambio | Para qué |
| --- | --- |
| `payments` (+ `attempt`, `reference`, `external_id`, `expires_at`, `received_amount`, `paid_at`, `reminder_sent_at`) | Estados `initiated, pending, paid, failed, cancelled, expired, refunded, disputed`. Sin `raw`: el aviso crudo vive en `webhook_events` (solo admin). |
| `payment_proofs` | Comprobantes: archivo en el bucket **privado**, huella sha256, tipo real, estado, motivo, quién y cuándo. `duplicate_of` marca un archivo ya usado en otro cobro. A lo sumo UNO pendiente por cobro. |
| `webhook_events` | Cada aviso recibido: único por `(proveedor, event_id)` con firma válida (idempotencia); los de firma inválida se guardan aparte, sin cuerpo. |
| `payment_reviews` | Pagos que el sistema no pudo aplicar solo: `late`, `duplicate`, `amount_mismatch`, `disputed`, `provider_refund`. Abiertas o resueltas con una nota. |
| `payment_methods` (+ `account_details`, `qr_image_path`) | Un método QR **activo** exige imagen del QR, datos de la cuenta y ventana (`CHECK`). Sembrados apagados: `qr_manual` y `qr_auto` («ejemplo»); `qr_auto` **no se muestra** en el panel mientras la interfaz del cobro automático esté apagada. |

Ajustes nuevos (Configuración → «Pedidos»): `payment_reminder_hours` (6; 0 = sin recordatorio) y `payment_proofs_max` (5 comprobantes por cobro).

## Seguridad

- **Quién lee qué.** La clienta lee **sus cobros** y nada más de este sprint: no `payment_proofs`, ni `payment_reviews`, ni `webhook_events` (solo el admin, por RLS). Se entera de su pago por `customer_payment_view` (una función que exige ser la dueña del pedido y devuelve solo lo que ella necesita: sin huella, ruta, revisor ni avisos). Un pedido ajeno es «no existe».
- **Nadie escribe desde el navegador**, ni siquiera `service_role`: solo las funciones. Las del servidor (`payment_apply_event`, `payment_proof_register`, `payment_retry`, `payment_log_invalid_event`) solo las ejecuta `service_role`, a través de las Edge Functions. Las que ejecuta el navegador (`admin_review_proof`, `admin_confirm_payment_manual`, `admin_resolve_review`, `customer_payment_view`) autorizan **por dentro** (`is_admin()` o `auth.uid()`).
- **Auditoría.** Cada decisión del administrador (aprobar, rechazar, resolver, confirmar) queda en `audit_log` con **su** identidad y en el historial del pedido; las revisiones y los comprobantes tienen triggers de auditoría.

## Comprobantes (bucket privado `payment-proofs`)

- Ruta `{clienta}/{pedido}/{uuid}.{jpg|jpeg|png|webp|pdf}`. La **política de subida** exige: ser la carpeta de quien sube, un pedido **suyo y pendiente**, un cobro QR **abierto y no vencido**, y no pasarse de `2 × payment_proofs_max` archivos por pedido. **No hay políticas de actualizar ni borrar** para la clienta: lo subido no se cambia.
- El bucket limita a 5 MiB y a jpeg/png/webp/pdf **por el tipo que declara el navegador**; eso lo pone quien sube. Por eso la función `payments` (acción `proof_submit`) **vuelve a revisar el archivo de verdad**: descarga el objeto, mira sus **bytes mágicos** (un SVG con script, un HTML o un ejecutable que se llame `.png` no pasa), exige que la extensión corresponda al tipo real, calcula la huella sha256 y recién entonces lo registra. Si no pasa (o no queda registrado ESTE archivo) lo **borra**, **salvo que esa ruta ya sea un comprobante registrado**: mandar la ruta de un comprobante ya registrado con un cobro inventado no borra la evidencia (la función comprueba `payment_proofs` antes de borrar; ante la duda no borra).
- Idempotencia: el mismo archivo otra vez (reintento de red) devuelve el mismo comprobante; la misma imagen en otra ruta (doble toque) también, y el archivo sobrante se borra. El mismo archivo en el cobro de **otra** clienta queda marcado como posible reutilización (`duplicate_of`) y el administrador lo ve.
- El administrador lo ve por una **URL firmada de 5 minutos**; el bucket nunca es público. El PDF se abre en una pestaña nueva (no se incrusta).

## `payment_apply_event`: el camino único (S-06)

Lo llaman la función del webhook (con la firma ya verificada) y la aprobación del comprobante. **Idempotente** por `(proveedor, event_id)`: el mismo aviso 20 veces, aunque sea a la vez, tiene un solo efecto (el índice único hace esperar al segundo hasta que el primero termina). Bloquea **el pedido y después el cobro** (el mismo orden que usan la cancelación y el vencimiento).

| Llega | Estado del cobro / pedido | Resultado |
| --- | --- | --- |
| `paid`, monto y moneda exactos | cobro abierto, pedido pendiente | cobro `paid`, pedido `paid` (el **sistema** puede confirmar pagos ahora), aviso a la clienta |
| `paid`, monto o moneda distintos (menos **o más**) | cobro abierto | el pedido **sigue pendiente**; revisión `amount_mismatch` + alerta |
| `paid` otra vez (aviso distinto) | cobro ya pagado | revisión `duplicate` + alerta |
| `paid`, monto exacto, tras un aviso de monto distinto | cobro abierto | se aplica y la revisión `amount_mismatch` abierta se **cierra sola** («llegó el monto exacto») |
| `paid` | pedido cancelado o vencido | el cobro queda `paid` (el dinero llegó) + revisión `late` + alerta |
| `paid` | cobro disputado o reembolsado | se ignora |
| `failed` | cobro abierto | cobro `failed`; el pedido sigue (stock retenido) y se puede reintentar |
| `disputed` | cualquiera | cobro `disputed` + revisión; **no se puede reintentar** |
| `refunded` | cobro pagado | cobro `refunded` + revisión `provider_refund` (el estado del pedido lo decide S12) |
| referencia que no existe, **o de otro proveedor** | — | el evento se registra (`unknown_reference`) y se alerta |

**Un aviso solo toca cobros de SU proveedor** (sin un administrador detrás): un aviso de `qr_api` sobre un cobro `manual_qr`, de contra entrega o de WhatsApp es una referencia desconocida y no paga nada. Las referencias son correlativas (`MIC-000123`) y se adivinan: sin esta regla, un secreto de webhook filtrado podría marcar como pagado cualquier pedido. Los avisos que entran por un administrador (aprobar un comprobante, confirmar a mano) llevan su identidad y no pasan por esta regla.

El monto se compara redondeado a los decimales de la moneda (80,004 de 80,00 coincide; 80,006 no). Aprobar un comprobante es el mismo camino con un evento `proof:<id>`: aprobar dos veces tiene un solo efecto, y si dos administradores deciden a la vez **gana la primera decisión** (bloqueo de fila; el otro recibe `already_reviewed`). Aprobar con un monto distinto al esperado **no** confirma el pedido: queda en revisión.

- **Confirmar a mano** (`admin_confirm_payment_manual`): el identificador del aviso lleva el **monto**, así que repetir exactamente lo mismo (doble clic) es una sola confirmación, pero **corregir un monto mal escrito** (79,50 → 80,00) sí se procesa. Con un identificador fijo por cobro, el primer monto equivocado «gastaba» el aviso y la corrección devolvía «duplicado» sin hacer nada: el pedido vencía con el dinero recibido. Un cobro ya pagado responde `already_paid`.
- **Orden de candados en las decisiones del admin**: pedido → cobro → comprobante, el mismo que la cancelación y el vencimiento (bloquear primero el comprobante provocaba un interbloqueo contra una cancelación a la vez). Una decisión `NULL` se rechaza (con `NULL` la validación se saltaba y caía en «aprobar»).
- **Un comprobante que nadie revisó se cierra como aprobado** («Pago confirmado por otra vía») cuando el pedido se paga por otro camino; así aprobarlo después no abre un falso «pago duplicado».

## Avisos de pago (`payment-webhook`)

`POST /functions/v1/payment-webhook/<proveedor>`; sin JWT (lo llama un servidor externo): lo autentica la **firma**.

- Cabecera `X-Signature: t=<segundos unix>,v1=<hex>[,v1=<hex>]`; firma = HMAC-SHA256(secreto, `${t}.${cuerpo crudo}`) en hexadecimal; varios `v1` permiten rotar el secreto; ventana de **5 minutos** (anti repetición, además de la unicidad por `event_id`); comparación en tiempo constante.
- Cuerpo (estricto, sin listas): `{ event_id, type: payment.paid|failed|disputed|refunded, reference, amount?, currency?, external_id? }`. Un «pagado» sin monto se rechaza (no se concilia adivinando).
- El secreto vive **solo** en los secretos de Supabase: `PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>` (p. ej. `PAYMENT_WEBHOOK_SECRET_QR_API`, mínimo 16 caracteres). Sin secreto, **nada** se acepta (503).
- Un aviso con firma inválida, sin firma o ilegible se rechaza (401 o 503) y **queda registrado** con el motivo y su tamaño, **nunca con su cuerpo**. Tope de 16 kB de cuerpo y 120 avisos por minuto por red.
- Un fallo nuestro responde 500 para que el proveedor reintente: el aviso no se pierde ni se duplica.

## Vencimiento, recordatorios y reintentos

- `expire_pending_payments` (cada **minuto**, pg_cron) cancela los pedidos con ventana vencida: el stock vuelve, se libera la franja, se devuelve el cupón y el cobro queda `expired`. **No cancela** un pedido con un comprobante pendiente de revisión (decide el administrador) **durante 3 días** después del vencimiento: pasado ese tope se cancela igual (sin él, subir un archivo cualquiera acapararía el stock). Al cancelar, el sistema **vuelve a comprobar con el pedido bloqueado** que siga vencido (una clienta pudo reintentar el pago un instante antes).
- **Cancelar no hace desaparecer el dinero.** Si el pedido QR se cancela con un cobro ya pagado, o con un comprobante que nadie revisó (la clienta puede haber pagado), queda una **revisión abierta** (`late`, con la causa: `cancelled_after_payment` o `proof_pending_at_cancel`) para devolver o reasignar. Los métodos sin QR (WhatsApp, contra entrega) los reembolsa la operación (S12). Cancelar cierra los comprobantes pendientes.
- `remind_expiring_payments` (cada 15 min) le recuerda a la clienta, una vez por cobro, cuando faltan `payment_reminder_hours` horas.
- **Reintentar el pago** (`payments` → `retry`): solo si el pedido sigue pendiente y no hay cobro abierto (típicamente tras un `failed`); crea un cobro nuevo con ventana nueva; hasta 5 intentos; bloqueado con un contracargo.
- **Un pedido vencido no se revive** (su stock ya volvió y los precios pudieron cambiar): la pantalla ofrece **«Volver a pedir»**, que rellena la bolsa con sus productos y pasa otra vez por el checkout (stock y precios al día, pedido y cobro nuevos).
- La cuenta regresiva usa la **hora del servidor** (`server_now` en cada lectura): un aparato con el reloj mal puesto ve la misma cuenta. Los lectores de pantalla solo oyen los cortes (una hora, diez minutos, un minuto, terminó), no cada segundo.

## Conciliación (`payment-reconcile`)

Solo un administrador (la función `payment-reconcile`; su botón «Conciliar ahora» **no se muestra** mientras la interfaz del cobro automático esté apagada). **Nunca inventa el monto**: `getStatus` solo dice «pagado», no cuánto, así que el aviso de conciliación va **sin monto** y la base lo manda a revisión del administrador (`amount_mismatch`); cuando un proveedor consultable informe el monto, `getStatus` lo devolverá y se usará. Pregunta al proveedor por los cobros abiertos que vencen en ±1 hora y aplica lo que diga por el mismo camino idempotente (evento `reconcile:<cobro>:<estado>`: correrla cien veces tiene un solo efecto; un proveedor que falla no detiene a los demás). **Hoy ningún proveedor de producción tiene API de consulta**, así que revisa y no cambia nada: la pieza está lista y probada con un proveedor de pruebas para cuando exista uno. No hay cron que la llame: pg_cron no invoca Edge Functions sin más cableado, y sin un proveedor consultable no haría nada.

## Pantallas

- **Clienta** (`/pedido/:numero` y `/cuenta/pedidos/:id`): QR, monto exacto, referencia (con «Copiar»), datos de la cuenta, cuenta regresiva, subida del comprobante con vista previa y un estado claro por cada punto del pago (esperando, en revisión, rechazado con motivo, confirmado, fallido, vencido, pago tardío en revisión, contracargo). Consulta cada 10 s mientras espera, así que ve la confirmación sin recargar.
- **Administración** (`/admin/pagos`): *Por revisar* (comprobantes con el archivo, la clienta y el monto esperado, aprobar con monto opcional o rechazar con motivo; y los pagos que necesitan una decisión, que se resuelven con una nota), *Pagos* (lista con filtros, detalle con los avisos recibidos y los comprobantes, y «Confirmar el pago a mano») y *Métodos* (nombre, ventana, monto máximo, datos de la cuenta e imagen del QR).

## Qué muestra hoy la interfaz (solo QR manual)

El código soporta el cobro QR automático (`qr_api`: aviso firmado, conciliación, base de datos), pero **la interfaz no lo ofrece ni lo menciona** hasta que haya un proveedor. Un único interruptor, `AUTOMATIC_QR_IN_UI` (`src/features/payments/automaticQr.ts`), lo decide. Con `false` (hoy):

| Pantalla | Qué se oculta |
|---|---|
| Administración → *Métodos de pago* | el método `qr_auto` («confirmación automática») |
| Administración → *Pagos* | la opción «QR automático» del filtro «Método», el botón «Conciliar ahora» y el «Id del proveedor» del detalle |
| Pantalla de la clienta | el texto «Tu pago se confirma solo»: un cobro `qr_api` explica el pago manual |

Un cobro `qr_api` suelto (no puede existir mientras el método esté oculto y apagado) se vería como «QR», sin decir «automático». **Para encenderlo:** poner el interruptor en `true`, elegir proveedor, fijar su secreto (`PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>`) y encender el método `qr_auto` desde *Métodos*. Las pruebas `*.automatic.test.tsx` comprueban el modo encendido; las demás, el apagado.

## Límites conocidos y decisiones abiertas

1. **No hay adaptador de CobraFácil** (ni de ningún proveedor real): falta elegir proveedor, su documentación, sandbox y credenciales (PENDIENTES_ADMIN §C). El dueño hoy **no tiene** servicio de cobro QR: lo que funciona de punta a punta es el **QR manual** con comprobante.
2. **El secreto del webhook no está fijado en Supabase** (`PAYMENT_WEBHOOK_SECRET_QR_API`): por eso un aviso con firma **válida** no se probó de extremo a extremo por HTTP contra la nube. Está cubierto por pruebas de la verificación de firma (Deno), por la función SQL que aplica el aviso (pgTAP, integración con 20 avisos a la vez) y por el rechazo de avisos sin firma o con firma falsa contra la función desplegada. Para fijarlo: `supabase secrets set PAYMENT_WEBHOOK_SECRET_QR_API=…`.
3. **Un pago que llega tarde** (el pedido ya se canceló y el stock volvió) queda registrado y en revisión: **el reembolso o la reasignación son de S12**. La nota de resolución dice qué se hizo; el dinero se devuelve desde el banco.
4. **Contra entrega registrada por el administrador** (cobrado o rechazado al entregar, costo de envío asumido por la tienda, lista negra: BR-PAY-07) **no se hizo**: es de S12 con el resto de la operación de entrega. Hoy, al confirmar un pedido de contra entrega, su cobro pasa a `paid` (S10).
5. **Comprobantes falsos.** Se detecta la reutilización **exacta** del archivo (huella) y los archivos que no son lo que dicen ser; una captura distinta de un pago ajeno o inventada solo la detecta el administrador al mirarla y al compararla con su banco.
6. **Archivos huérfanos.** Un archivo subido que nunca llega a registrarse (la clienta cierra la pestaña) queda en el bucket: está acotado (`2 × payment_proofs_max` por pedido) y es privado, pero no hay limpieza automática (Supabase solo permite borrar por su API).
7. **Eventos fuera de orden** (un pago que llega antes de que exista el cobro) se registran como `unknown_reference` y se alertan; no se reprocesan solos: el administrador lo confirma a mano.
8. **Los recordatorios y los avisos solo se encolan** (`notification_outbox`): nadie los envía hasta S13.
9. **Stock retenido 24 h** por pedido sin pagar (decisión del dueño). Con 5 pedidos abiertos por clienta (S10) el efecto está acotado, pero no es cero.
10. **Tipo de cambio:** el monto del cobro es el total del pedido en su moneda (BOB), fijado al crear; solo existe BOB.
11. **El panel no tiene paginación en «Por revisar»** (los 200 más antiguos) ni exporta; **la lista de pagos** sí pagina de a 25.
12. **Pago a última hora sin cómo avisar.** Si la clienta paga justo antes de que venza la ventana y sube el comprobante después, la política de subida lo rechaza (el cobro ya no está abierto) y la pantalla solo ofrece «Volver a pedir»: no hay un camino de «ya pagué, el comprobante llegó tarde». Con `qr_api` el aviso del banco sí queda en revisión (`late`); con QR manual hoy depende de que la clienta escriba a la tienda. Pendiente de decidir con el dueño (aceptar comprobantes tardíos hasta N días como revisión `late`).
13. **Tope de archivos por pedido, solo aproximado.** La política de subida cuenta con la instantánea de cada `INSERT`: subidas **en paralelo** pueden pasarse del tope (`2 × payment_proofs_max` archivos de 5 MB, solo para quien tiene un cobro QR abierto) y los archivos huérfanos (límite 6) cuentan para él.
14. **Pagos parciales.** Un segundo aviso de monto distinto **reemplaza** `received_amount` (40 + 40 de un cobro de 80 deja «recibido 40»): la lista de avisos del detalle no muestra el monto de cada uno (está en `webhook_events.payload`). No se suman. La revisión abierta la resuelve el administrador, o se cierra sola si llega el monto exacto.
15. **Contracargo.** Marca el **cobro** (`disputed`, sin reintento) y abre una revisión; el **pedido** sigue `paid` y puede avanzar a preparar y enviar sin una advertencia (S-06 dice «marca el pedido»). Tampoco hay forma de revertir `disputed` si el banco falla a favor de la tienda. Ambas cosas son de S12 (operación de pedidos): el panel de pedidos debe mostrar el contracargo y bloquear el despacho.
16. **Poca visibilidad operativa.** La lista de pagos filtra por estado y proveedor, **sin buscar por referencia**; los avisos de firma inválida (criterio 4) y las referencias desconocidas **no tienen pantalla** (solo `webhook_events`, por SQL); no hay contador de «Por revisar» en el menú; y las alertas solo se encolan hasta S13. Con el plazo de 24 h, un comprobante puede esperar sin que nadie lo vea.
17. **`webhook_events` crece sin retención.** Cualquiera puede enviar avisos con firma mala (120 por minuto por red) y cada uno deja una fila (sin cuerpo). No hay limpieza automática: conviene una retención (p. ej. 30 días de los rechazados) en S16.
18. **La carrera «aviso contra vencimiento» de la integración casi no ejercita el desenlace «tardío»:** lanza el vencimiento por `psql` como subproceso, que casi siempre corre después de los avisos; acepta los dos desenlaces. La carrera real está cubierta por el orden de candados (leído y probado en pgTAP en una sola sesión), no por una prueba concurrente.
19. **Las pruebas antiguas (01–13) vacían** `payment_proofs`, `payment_reviews` y `webhook_events` antes de `payments`: como las de S10, no se deben correr contra una base con tráfico real.

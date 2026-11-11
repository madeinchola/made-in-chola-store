# Sprint 11 — Pagos: QR boliviano y capa de proveedores

**Release:** R3 · **Estimación:** 5 días · **Depende de:** S10 (pedidos, `payments`, `PaymentProvider`, estados)

## Objetivo
Cobrar con **QR boliviano** (manual con comprobante y vía API, p. ej. CobraFácil) con ventana de **10 minutos**, conciliación automática y revisión manual, sobre una capa de proveedores intercambiable lista para Stripe, Mercado Pago y PayPal.

## Alcance
**Dentro:** proveedor `manual_qr` (cliente sube comprobante, admin aprueba/rechaza), proveedor `cobrafacil` (o el que se elija) con webhooks, ventana de pago de 10 min con expiración, conciliación, tratamiento de duplicados/parciales/contracargos, UI cliente y admin de pagos, registro de eventos.
**Fuera:** Stripe/MP/PayPal reales (S18), reembolsos operativos completos (S12; aquí se deja el método `refund` del provider), facturación (S17).

## Reglas de negocio cubiertas
BR-PAY-01..06, BR-DAT-03, BR-ORD-01, S-05, S-06, D-03.

## Tareas

### BD
- [ ] Completar `payments` (provider, method, amount, currency, status `initiated|pending|paid|failed|expired|refunded|disputed`, `external_id`, `idempotency_key`, `raw jsonb`, `expires_at`).
- [ ] `payment_proofs` (payment_id, `file_path` en bucket **privado**, hash del archivo, estado `pending|approved|rejected`, motivo, revisado_por/fecha).
- [ ] `webhook_events` (provider, `event_id` único, firma verificada, payload, procesado, intentos) → **idempotencia**.
- [ ] Ajustes de pago por país: métodos habilitados, datos de la cuenta/QR, ventana (10 min), proveedor activo.
- [ ] Cron `expire_pending_payments` (cada minuto): `pending_payment` con ventana vencida → `cancelled` + liberar stock + revertir cupón + outbox.
- [ ] Cron `reconcile_payments` (cada N min): consulta al proveedor los pagos `pending` próximos a vencer o recién vencidos para capturar webhooks perdidos; un pago llegado **tras** vencer → pedido en revisión manual (no se pierde dinero).
- [ ] Reglas S-06: duplicado → excedente a reembolso/crédito + alerta; monto menor/mayor → queda `pending_payment` + alerta; contracargo → `disputed` + alerta.

### Edge Functions
- [ ] `payment-create` (inicia cobro con el proveedor activo del país/método; devuelve QR/instrucciones).
- [ ] `payment-webhook-<provider>`: verifica **firma**, registra en `webhook_events`, procesa idempotente, llama `transition_order_status`.
- [ ] `payment-reconcile` (cron) y `payment-proof-review` (acción admin con auditoría).
- [ ] Implementaciones `manual_qr` y `cobrafacil` bajo la interfaz común; mapeo de estados del proveedor → estados internos.
- [ ] Gestión de secretos del proveedor solo en Supabase secrets.

### Frontend
- [ ] Pantalla de pago QR: QR, monto exacto, instrucciones, **cuenta regresiva de 10 min**, botón "Ya pagué / Subir comprobante" (manual) o auto-detección por polling/Realtime (API).
- [ ] Subida de comprobante (imagen/PDF, límite de tipo/tamaño, vista previa, reintento).
- [ ] Estados: pendiente de verificación, pago confirmado, rechazado (con motivo y opción de reintentar), expirado (reintentar si hay stock).
- [ ] Admin: bandeja de **comprobantes por revisar** con vista del archivo, monto/pedido, aprobar/rechazar con motivo; vista de pagos con filtros y detalles del evento.
- [ ] Reintentar pago de un pedido (misma orden, nuevo `payment` con nueva ventana) si aún hay stock.

## Criterios de aceptación
1. Pago por QR confirmado (webhook o aprobación admin) mueve el pedido a `paid` una sola vez, aunque el webhook llegue duplicado.
2. Sin pago en 10 minutos el pedido se cancela y el stock vuelve; el cliente lo ve y puede reintentar.
3. Un webhook perdido se recupera con la conciliación.
4. Webhooks con firma inválida se rechazan y quedan registrados.
5. Ningún archivo de comprobante es público; solo el cliente dueño y admin acceden (URL firmada).
6. Todas las decisiones de admin quedan auditadas.

## Testing
- **Unit:** mapeo de estados proveedor→interno, verificación de firma (válida/alterada/expirada), cálculo de monto esperado vs. recibido.
- **Integración con *fake provider* y sandbox del proveedor real:** pago exitoso, fallido, duplicado, parcial, exceso, tardío, reembolsado.
- **Concurrencia/idempotencia:** el mismo webhook 20 veces y en paralelo → un solo efecto; webhook vs. expiración en el mismo segundo.
- **SQL/RLS:** buckets privados, políticas de `payment_proofs`; el cliente no cambia estado de pago.
- **E2E:** flujo QR manual completo (subir comprobante → admin aprueba); QR API simulado; expiración; reintento; rechazo con motivo.
- **Seguridad:** replay de webhooks, falsificación sin firma, archivo malicioso (extensión falsa, SVG con script, archivo enorme), IDOR sobre comprobantes.
- **Resiliencia:** proveedor caído/timeouts, reintentos con backoff, circuito de falla sin bloquear la tienda.

## Edge cases
- Cliente paga **después** de vencer la ventana (stock ya liberado) → revisión manual: reasignar si hay stock o reembolsar.
- Cliente paga dos veces / monto distinto / paga desde otra cuenta.
- Comprobante falso, ilegible, reutilizado en otro pedido (hash duplicado) o de otro monto.
- El admin aprueba y otro admin rechaza el mismo comprobante a la vez → bloqueo de fila, gana el primero.
- Pedido cancelado manualmente mientras llega el pago.
- Expiración justo cuando se confirma el pago (carrera) → el pago confirmado prevalece.
- Cambio de tipo de cambio entre creación y pago (monto en BOB fijado al crear).
- QR duplicado entre pedidos si el monto es idéntico → referencia única por pedido en el cobro.
- Reloj del cliente vs. servidor en la cuenta regresiva (usar hora servidor).
- Webhook para un pedido inexistente/archivado; evento fuera de orden (pagado antes de creado).
- Proveedor cambia el formato del webhook (versionado, logs, alerta).
- Pérdida de red al subir el comprobante; subida duplicada.
- Contra entrega: pago registrado manualmente por admin al entregar (cobrado/rechazado); rechazo → costo de envío asumido por la tienda (BR-PAY-07) y posible entrada en lista negra (S12).

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de seguridad de webhooks y Storage por una segunda persona.
- [ ] Conciliación contable de prueba: pagos de sandbox vs. libro de movimientos.
- [ ] Revisión de logs: sin datos sensibles de pago.
- [ ] Prueba con dinero real de bajo monto en producción antes de abrir (cuando existan cuentas).

## Riesgos
- Disponibilidad/estabilidad del proveedor local (CobraFácil) y calidad de su documentación → capa de abstracción y modo manual como respaldo.
- Pagos tardíos y dinero "en el limbo" → alerta y proceso de revisión obligatorio.

## Pendientes externos
Elección entre QR manual y API, credenciales/sandbox, datos de la cuenta, criterios de contracargos (PENDIENTES_ADMIN §C); D-03.

## Entregables para sprints siguientes
Capa de pagos operativa (QR manual y API), webhooks idempotentes, conciliación, bandeja de comprobantes, método `refund` en la interfaz (S12), base para pasarelas internacionales (S18).

---

## Decisiones del admin que afectan a este sprint (2026-10-28)
Fuente: `docs/admin/Cuestionario_Admin_RESPONDIDO.pdf` y [../PENDIENTES_ADMIN.md](../PENDIENTES_ADMIN.md).
- Quieren QR con **confirmación automática** (4.1), pero **no tienen servicio ni banco de cobros QR**. Se construye la capa de proveedores y `manual_qr`; el modo automático queda bloqueado hasta elegir proveedor y tener credenciales.
- Pago tardío sin stock: **devolver el dinero y avisar al cliente** (4.2, de acuerdo).
- **Decidido por el dueño (2026-10-28): el QR se paga en 24 horas**, con aviso al cliente y recordatorios antes de vencer. Lo dicen las respuestas del admin (4.2) y el diseño no menciona plazos. La ventana es un ajuste configurable (`payment_window_minutes` = 1440) y **sustituye a los 10 min** de este documento y de BR-PAY-03; la retención de carrito de S7 sigue en 10 min. Costo conocido: retener stock 24 h por un pedido sin pagar puede bloquear inventario (mitigar con recordatorios y cancelación manual del admin).

---

## Estado real de entrega (2026-11-11)

**Entregado:** cobro con **QR boliviano** de punta a punta en modo **manual** (el QR de la tienda, monto exacto, referencia única por cobro, la clienta sube su comprobante y el administrador lo aprueba o rechaza) y la **capa de proveedores** lista para el modo automático (`qr_api`: la misma pantalla, pero confirma un aviso firmado con HMAC-SHA256). Base de datos: `payments` completo (intentos, referencia, vencimiento, monto recibido, `paid_at`; un solo cobro abierto por pedido), `payment_proofs`, `webhook_events`, `payment_reviews`, `payment_methods` con QR y datos de la cuenta, buckets `payment-proofs` (privado) y `payment-qr` (público), y las funciones `payment_apply_event` (el camino único del dinero, idempotente), `admin_review_proof`, `admin_confirm_payment_manual`, `admin_resolve_review`, `customer_payment_view`, `payment_retry`, `payment_proof_register` y los crons de vencimiento (cada minuto) y recordatorio (cada 15 min). Edge Functions: `payments` (reintentar y registrar comprobantes con revisión real del archivo), `payment-webhook` y `payment-reconcile`. Pantallas: la de pago de la clienta (confirmación del pedido y «Mis pedidos»: QR, cuenta regresiva con hora del servidor, subida de comprobante, estados, «Volver a pedir») y `/admin/pagos` (Por revisar, Pagos, Métodos). Detalle y decisiones en [../docs/pagos.md](../docs/pagos.md).

**Cómo se hizo:** todo por mí (base, funciones, pantallas y pruebas); una **revisión independiente** (un agente sin contexto, solo lectura: 21 hallazgos, 2 altos, 8 medios y 11 bajos, ninguno crítico) y mutaciones en SQL y en la interfaz. Todo contra la nube (sin Docker ni base local).

**Desviaciones respecto al plan (y por qué):**
- **Plazo de pago de 24 horas, no 10 minutos** (decisión del dueño, 2026-10-28): `payment_methods.window_minutes = 1440`. La retención del carrito de S7 sigue en 10 min. Costo: un pedido sin pagar retiene stock 24 h.
- **No hay adaptador de CobraFácil** ni de ningún proveedor real: no hay documentación, sandbox ni credenciales, y el dueño hoy **no tiene** servicio de cobro QR. `qr_api` define un **contrato genérico** (cuerpo estricto + firma) que un adaptador real cumple o traduce. El proveedor falso solo existe para probar el contrato y no está en el registro de producción.
- **Las Edge Functions son tres, no cuatro, y no se llaman como en el plan:** el cobro lo crea `create_order` (S10) y se reintenta con `payments`; **«payment-proof-review» no es una Edge Function** sino la función SQL `admin_review_proof` (autoriza por dentro con `is_admin()`, queda auditada por el trigger); el webhook es **uno** (`payment-webhook/<proveedor>`), no uno por proveedor.
- **La interfaz solo ofrece el QR manual** (decisión del dueño, 2026-11-11). El cobro automático (`qr_api`) está **preparado en el código y oculto** con un interruptor: `AUTOMATIC_QR_IN_UI` (`src/features/payments/automaticQr.ts`). Con `false` se ocultan el método `qr_auto` en *Métodos*, la opción «QR automático» del filtro de cobros, «Conciliar ahora», el «Id del proveedor» del detalle y el texto «Tu pago se confirma solo» de la clienta. Pruebas: las `*.automatic.test.tsx` (encendido) y las de siempre (apagado); 7 mutantes del apagado, todos muertos.
- **No hay cron de conciliación.** `payment-reconcile` existe (solo administrador; su botón «Conciliar ahora» está oculto en la interfaz) y se probó con un proveedor de pruebas, pero ningún proveedor real tiene API de consulta y pg_cron no invoca Edge Functions sin más cableado: llamarla cada N minutos no haría nada hoy.
- **`payments.raw` e `idempotency_key` no se añadieron:** el aviso crudo vive en `webhook_events.payload` (solo administrador) y la idempotencia es por `(proveedor, event_id)` con un índice único.
- **Un comprobante pendiente retiene el pedido hasta 3 días** pasado el vencimiento y luego se cancela igual (sin ese tope, subir un archivo cualquiera acapararía el stock).
- **Aviso por polling cada 10 s**, no Realtime. **«Reembolso/reasignación» de un pago tardío: S12** (aquí queda una revisión abierta con el dinero recibido).
- **Contra entrega registrada por el administrador al entregar** (cobrado/rechazado, costo de envío asumido, lista negra: BR-PAY-07): **no se hizo**, es de S12 con el resto de la operación de entrega.

**Bugs reales encontrados por las pruebas y corregidos:**
- *Un reintento y el pago del intento viejo:* el banco avisaba el pago del intento 1 después de que la clienta ya había reintentado (intento 2). `transition_order_status` marcaba pagados todos los intentos abiertos; ahora el que **recibió** el dinero queda `paid` y los demás se cierran como `cancelled`.
- *CLS de la pantalla de pago:* la página aparecía por trozos; ahora reserva su alto y espera los datos (0,044 móvil, 0,029 escritorio).
- *Accesibilidad (axe):* «Ver detalle» y la campana de stock («99+ …») tenían un nombre accesible que no contenía el texto visible.
- *Desborde horizontal de la lista de pagos en móvil (hallazgo del E2E, 444 px):* el texto `sr-only` del encabezado de acciones es `position:absolute` y, sin un ancestro posicionado dentro del contenedor con scroll, escapaba de su recorte y estiraba la **página** entera (el diálogo de detalle quedaba fuera de pantalla). Se arregló en el componente compartido `DataTable`.
- *Diálogos del panel con el desborde duplicado* (dos contenedores con scroll).

**Revisión independiente (agente sin contexto, solo lectura). Cada hallazgo se verificó leyendo el código antes de actuar.**
- *Corregidos con prueba:*
  1. **(Alto) La clienta podía borrar su propio comprobante ya registrado:** mandar la ruta de un comprobante registrado con un `payment_id` inventado hacía que la función `payments` lo borrara (el registro respondía «no existe» y la rama de descarte borraba el archivo), y la ruta quedaba libre para subir otro contenido que ya no se comparaba con la huella. Ahora solo se borra lo que **no** está en `payment_proofs`, y ante la duda no se borra. Probado en integración contra la nube.
  2. **(Alto) La confirmación manual quedaba sin salida tras un monto mal escrito**, y la pantalla decía «ya estaba confirmado» sin que lo estuviera: el identificador del aviso era fijo por cobro y el primer monto equivocado lo «gastaba». Ahora lleva el monto (el doble clic sigue siendo uno; corregir sí se procesa) y un cobro ya pagado responde `already_paid`.
  3. `admin_review_proof` con decisión `NULL` **aprobaba** el comprobante (`NULL not in (…)` es `NULL`, la validación se saltaba).
  4. **Interbloqueo** entre aprobar un comprobante y cancelar o vencer el pedido: se bloqueaba primero el comprobante; ahora el orden es pedido → cobro → comprobante (el mismo de todas las demás funciones).
  5. Un comprobante pendiente no se cerraba cuando el pedido se pagaba por otra vía y aprobarlo después abría un falso «pago duplicado» (hay que devolver el excedente): ahora se cierra como aprobado («Pago confirmado por otra vía»).
  6. **Dinero sin revisión:** cancelar un pedido QR con el cobro ya pagado, o con un comprobante que nadie miró, no dejaba ninguna tarea; ahora queda una revisión abierta (`late`, con la causa). La pantalla de la clienta solo dice «lo estamos revisando» mientras hay una revisión abierta.
  7. Un aviso del **proveedor** sobre un cobro de **otro** proveedor (o de contra entrega o WhatsApp) lo pagaba: las referencias son correlativas y se adivinan, así que un secreto filtrado habría alcanzado todos los pedidos. Ahora es una referencia desconocida.
  8. La **conciliación inventaba el monto exacto** al recibir «pagado» (se saltaba S-06 con un importe distinto): ahora va sin monto y la base lo manda a revisión.
  9. El panel dejaba ponerle una **ventana de pago a WhatsApp o contra entrega** (haría que sus pedidos se cancelaran solos): el campo ya no se muestra y no se envía.
  10. La revisión de «monto distinto» no se cerraba al llegar el monto exacto: ahora se cierra sola.
  11. La clienta veía el comprobante rechazado de un intento **anterior** en el cobro nuevo.
  12. El panel validaba los ajustes de pagos sin rango y la prueba fijaba el desajuste (130 como válido): ahora dicen lo mismo que la base (1–20 comprobantes, 0–720 horas).
  13. El vencimiento no volvía a comprobar nada con el pedido bloqueado (una clienta que reintentaba el pago un instante antes podía ver su pedido cancelado).
  14. Textos: el motivo del rechazo sin separador, «Volver a pedir» pisaba cantidades ya puestas en la bolsa (ahora queda el mayor), y vencido o cancelado ahora dicen «si ya habías pagado, escríbenos con tu comprobante».
- *Documentados como límite, NO corregidos* (`docs/pagos.md`, «Límites conocidos»): pago a última hora sin cómo subir el comprobante tardío (necesita una decisión del dueño); tope de archivos solo aproximado con subidas en paralelo; pagos parciales que se reemplazan; contracargo que marca el cobro y no el pedido (S12); poca visibilidad operativa (sin búsqueda por referencia, sin pantalla de avisos rechazados, sin contador en el menú); `webhook_events` sin retención (S16); `isQrMethod` como lista negra (S18); y la carrera real «aviso contra vencimiento» no tiene una prueba concurrente determinista (solo el orden de candados, leído y probado en una sesión).

**Verificación (2026-11-11):**
- **Unitarias:** **252 archivos y 5751 pruebas, todas verdes** tras ocultar el QR automático de la interfaz (2026-11-11; antes de ese cambio: 249 y 5742). La primera pasada de entonces dio 5741 de 5742: una prueba de envíos de S8, `StorePage`, venció su plazo de 15 s con la máquina cargada por la suite entera; sola pasa en 2,4 s y la segunda pasada completa dio 5742 de 5742), con tipos, lint `--max-warnings=0` y Prettier limpios. **Deno:** 139 (`npm run test:edge`).
- **pgTAP contra la nube** (migración corregida aplicada; suite completa 00–18 verde): `18_s11_pagos` **311 aserciones**, `17` 367, `16` 520, `14` 473. Los valores esperados se calcularon **a mano** (p. ej. 150,00 − 140,00; 80,004 de 80,00 redondea a 80,00 y 80,006 no).
- **Integración contra la nube** (`payments.integration.test.ts`, 21 casos): permisos HTTP, **el mismo aviso 20 veces a la vez = un solo `paid`**, dos avisos distintos a la vez (uno paga, el otro es duplicado), avisos para 4 pedidos de una misma prenda con vencimiento a la vez, archivos falsos (SVG con script, extensión cambiada, HTML) rechazados y borrados, IDOR sobre comprobantes (otra clienta no lee, sube ni registra; ni la dueña borra lo registrado), avisos con firma falsa, sin firma o ilegible rechazados y registrados contra la función desplegada.
- **E2E contra la nube (Chromium escritorio y móvil):** `e2e/payments.spec.ts` y `e2e/admin-payments.spec.ts` **22 de 22** (QR → subir comprobante → «en revisión»; el administrador ve el archivo por una URL firmada y aprueba o rechaza con motivo; monto distinto → decisión con nota; confirmar a mano; subir el QR de la tienda y ver el cambio en la pantalla de la clienta; axe AA; sin desbordes; **CLS** 0,044 móvil y 0,029 escritorio). **Regresión** (464 pruebas del resto de la tienda): 440 pasan; de los 17 fallos, **4** son `layout.spec` (preexistentes, ya fallaban en S9), **7** fueron cortes de red o de límite de peticiones y **pasan al repetirlos**, y **6** (`auth` «el bundle público no contiene la service key», la ficha con CPU 4× lenta y el enlace «Saltar al contenido» del panel) ocurren porque los E2E reutilizan el servidor de **desarrollo** que ya estaba abierto en el puerto 5173 en lugar de construir la versión de producción: los dos primeros **pasan contra el build de producción** (puerto 4173); el del enlace «Saltar al contenido» falla en desarrollo porque React ejecuta los efectos dos veces y mueve el foco al contenido, y **no se pudo comprobar en producción** (la función de ingreso desplegada rechaza ese origen). `AdminShell` no se tocó en S11.
- **Mutación SQL:** **83 mutantes** aplicados uno a uno a la migración y corridos contra la prueba 18 en la nube (cada uno en una transacción que se revierte). **79 mueren y 4 sobreviven, los cuatro explicados.** En la primera pasada murieron 67 de 82, pero uno de esos «muertos» era un mutante mal escrito (no compilaba) y 13 sobrevivían; de esos 13, **11 eran huecos reales de la prueba** (10 se cerraron con aserciones nuevas, en el bloque M y en dos pruebas existentes: un aviso «paid» sin monto no confirma; el segundo aviso no pisa los datos del primer pago; otra clienta con su propia carpeta y el pedido de otra; un cobro fallido no recibe comprobantes; el reintento renueva la ventana del PEDIDO — antes la prueba no lo veía porque `now()` no cambia dentro de una transacción y las dos ventanas valían 24 h; con un comprobante pendiente la vista no deja subir otro; el tipo del aviso al administrador; el permiso directo de `service_role`; la política de subida mira el estado del pedido; el segundo recordatorio no reprocesa). El hueco 11 lo dejó ver la propia reparación: la prueba de la restricción `payment_proofs_reject_reason` fallaba por OTRA restricción (`reviewed_coherent`), así que no probaba lo que decía; ahora fija `reviewed_at` y exige el nombre de la restricción. **Los 4 sobrevivientes:** (1) el vencimiento no vuelve a comprobar el comprobante bajo candado y (2) la lista del vencimiento no mira el comprobante: **cada comprobación es redundante por sí sola** (la otra lo cubre) y el mutante **combinado que quita las dos sí muere**; (3) cambiar el `CREATE TABLE` de la restricción del motivo no tiene efecto en una base donde la tabla ya existe (el mutante efectivo, que la quita con `ALTER`, muere); (4) el orden de candados del administrador (comprobante antes que pedido) solo produce un interbloqueo con **dos sesiones a la vez**, que una prueba de una sola sesión no puede provocar (cubierto por revisión de código y por el orden único documentado, **no** por una prueba). Los otros 2 de aquellos 13 son los equivalentes (2) y (3); (1) y (4) eran sobrevivientes ya conocidos de la primera pasada.
- **Mutación en la interfaz:** **55 mutantes** aplicados a archivos fuente de pagos (cliente, panel, `api`, cuenta regresiva, ajustes) y corridos contra sus pruebas; el arnés distingue una «muerte» real de un error de compilación y **ninguna fue por compilación**. **52 mueren y 3 sobreviven.** En la primera pasada sobrevivían 5: dos eran huecos reales y se cerraron: (a) la prueba «vuelve a la primera página» **empezaba ya en la página 0**, así que no probaba el reinicio (ahora parte de la página 2 y cubre también el filtro de método, con un mutante nuevo); (b) nada probaba que **repintar con otra función de aviso no repite** «se acabó el tiempo» del mismo vencimiento, y que un vencimiento nuevo (reintento) sí avisa. **Los 3 sobrevivientes son redundantes por diseño, no huecos:** el guarda `if (working) return`, el de `upload.isPending` y el de `reconciling` solo repiten lo que ya hace el botón (`disabled`, o `loading`, que el componente `Button` implementa descartando el clic); desde la interfaz no hay forma de disparar el manejador dos veces. Quitar el guarda sin quitar el bloqueo del botón no cambia nada observable.

**Criterios de aceptación:**
1. *Pago QR confirmado (webhook o aprobación) mueve el pedido a `paid` una sola vez aunque el aviso llegue duplicado:* **cumplido** (pgTAP, integración con 20 avisos a la vez, E2E).
2. *Sin pago en la ventana el pedido se cancela, el stock vuelve y la clienta puede reintentar:* **cumplido con 24 h** en lugar de 10 min (pgTAP, E2E; «Volver a pedir» recoge los productos).
3. *Un webhook perdido se recupera con la conciliación:* **parcial.** La pieza existe y está probada con un proveedor de pruebas, pero ningún proveedor real tiene API de consulta, no hay cron y el aviso de conciliación va **sin monto**, así que acaba en revisión del administrador (nunca confirma solo).
4. *Firma inválida se rechaza y queda registrada:* **cumplido** contra la función desplegada. **Una firma válida de punta a punta por HTTP no se probó:** el secreto del webhook no está fijado.
5. *Ningún comprobante público; solo la dueña y el administrador (URL firmada):* **cumplido** (bucket privado, pruebas de lectura, escritura y borrado entre clientas).
6. *Decisiones del administrador auditadas:* **cumplido** (cada aprobar, rechazar, resolver y confirmar queda en `audit_log` con su identidad).

**Pendiente (no hecho / no verificado):**
- **Elegir proveedor y escribir su adaptador** (CobraFácil u otro): documentación, sandbox y credenciales (PENDIENTES_ADMIN §C). Hasta entonces, el QR manual es lo que funciona.
- **Fijar el secreto del webhook** (`supabase secrets set PAYMENT_WEBHOOK_SECRET_QR_API=…`): lo debe hacer el dueño (la herramienta automática de esta sesión rechazó escribir un secreto en Supabase y no se reintentó). Sin él, el webhook rechaza todo con 503.
- **El dueño debe subir su QR, escribir los datos de su cuenta y encender el método** desde `/admin/pagos/metodos` (hoy están apagados con valores de ejemplo).
- **Prueba con dinero real de bajo monto** y conciliación contable de prueba con el sandbox del proveedor (el sprint las pide antes de abrir).
- **Navegador real y teléfono**, lector de pantalla y Lighthouse (lo automático solo pasa axe y emulación).
- **Comprobante a última hora** (decisión del dueño), **contracargo que bloquee el despacho** y **reembolso/reasignación de pagos tardíos** (S12), **retención de `webhook_events`** (S16).
- **Los fallos preexistentes de `layout.spec`** (cabecera) y la comprobación del enlace «Saltar al contenido» contra un build de producción con sesión.
- **Seguridad (SPRINT_19):** revocar el token de acceso pegado en el chat y rotar la contraseña de la base y la clave `sb_secret_…`.
- **NO subido:** los cambios de S11 están en el árbol de trabajo, sin commit ni push (se hace cuando el dueño lo pida).

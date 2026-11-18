# Runbooks: qué hacer cuando algo falla (Sprint 16)

Cada runbook dice **cómo notarlo**, **cómo confirmarlo**, **qué hacer** y **qué no hacer**. Marca **«ensayado»** lo que se ejecutó de verdad en la nube y **«no ensayado»** lo que está escrito a partir del código y la documentación del proveedor pero nunca se corrió: úsalo con más cuidado.

**Primer paso siempre:** `npm run health`. Un solo informe con lo que el sistema sabe de sí mismo (trabajos programados, avisos atrasados, cobros y reservas atascados, stock imposible, avisos de pago, tamaño). Sale con código 1 si algo está **crítico**. La primera línea de cada runbook dice qué comprobación del informe lo delata. Después, `npm run smoke -- https://tu-dominio` (solo lectura) comprueba la tienda publicada.

| Si ves… | Ve a |
| --- | --- |
| `cron.*` en crítico | [1. El cron se paró](#1-el-cron-se-paró) |
| `payments.stuck` o un cliente «ya pagué» | [2. Pago atascado](#2-pago-atascado) |
| `webhooks.problems` | [3. Avisos de pago rechazados](#3-avisos-de-pago-rechazados) |
| `stock.invariants` o `reservations.stuck` | [4. Stock inconsistente](#4-stock-inconsistente) |
| Dos pedidos iguales | [5. Pedido duplicado](#5-pedido-duplicado) |
| `outbox.*` o `notify.worker` | [6. Los avisos no salen](#6-los-avisos-no-salen) |
| Nadie puede entrar o recuperar contraseña | [7. Una persona se queda sin acceso](#7-una-persona-se-queda-sin-acceso) |
| Una cuenta abusa | [8. Bloquear una cuenta](#8-bloquear-una-cuenta) |
| Hay que parar las ventas ya | [9. Emergencia: parar las ventas](#9-emergencia-parar-las-ventas) |
| Cambiar de proveedor | [10. Cambiar de proveedor](#10-cambiar-de-proveedor) |
| Perdimos datos | [11. Copias y restauración](#11-copias-y-restauración) |
| Límite del plan | [12. Cuota agotada](#12-cuota-agotada) |
| Se filtró una clave | [13. Rotar secretos](#13-rotar-secretos) |

---

## 1. El cron se paró

**Cómo se nota:** `npm run health` marca `cron.<trabajo>` en **crítico** («la última corrida buena fue hace más de …»). Efectos mientras esté parado: los cobros pendientes no vencen, las reservas de stock no se liberan, los recordatorios y los avisos no salen, los carritos viejos no se limpian.

**Qué hacer**
1. Mira si es **un** trabajo o **todos**. Si son todos, `pg_cron` está parado (o la base está caída): panel de Supabase → Database → Extensions → `pg_cron`, y Logs → Postgres.
2. Si es uno solo, mira su último error: `select jobname, status, return_message, start_time from cron.job_run_details d join cron.job j using (jobid) where jobname = '<trabajo>' order by start_time desc limit 5;` (consulta de solo lectura, con la contraseña de la base).
3. Corre la función a mano (son las mismas que llama el cron, y cada una se puede repetir sin daño): `select public.expire_pending_payments();`, `select public.expire_reservations();`, `select public.remind_expiring_payments();`, `select public.remind_pending_orders();`, `select public.cart_abandon_stale();`, `select public.purge_old_carts();`, `select public.purge_stock_reservations();`.
4. Vuelve a correr `npm run health`: el trabajo debe pasar a «bien» en su siguiente corrida.

**Qué NO hacer:** borrar filas de `cron.job` a mano (usa `cron.unschedule` y `cron.schedule`, como la migración `20261118000600_s16_salud_sistema.sql`).

> Un trabajo recién programado (`purge-cron-history`) sale como **aviso** hasta su primera hora (03:41): es normal.

## 2. Pago atascado

**Síntomas:** una clienta dice que pagó y su pedido sigue «pendiente de pago»; o `payments.stuck` en crítico (un cobro pendiente venció hace más de 10 minutos y el cron no lo cerró).

**El flujo** (`docs/pagos.md`): la clienta escanea el QR, paga el monto exacto y **sube la foto del comprobante**; el administrador la aprueba o rechaza en `/admin/pagos` → *Por revisar*. Nada se confirma solo.

**Qué hacer**
1. **Una clienta que pagó:** `/admin/pagos` → *Por revisar*: busca su comprobante (por número de pedido o monto). Si no subió el comprobante, pídeselo por WhatsApp (el pedido no se cancela mientras haya un comprobante pendiente de revisión, hasta 3 días). Compara el **monto exacto**; si coincide, **Aprobar**; si no, la base lo manda a *Revisión* y el dinero no se pierde.
2. **El pedido ya venció y se canceló:** si había un comprobante sin revisar o un cobro pagado, queda una **revisión abierta** (`late`) en *Por revisar*: ahí se decide devolver o reasignar. **No** vuelvas a crear el pedido a mano: «Volver a pedir» rellena la bolsa con los mismos productos y pasa por el checkout (stock y precios al día).
3. **`payments.stuck` en crítico:** es el cron (runbook 1). Después de correr `select public.expire_pending_payments();` el cobro pasa a `expired` y el stock vuelve.

**Qué NO hacer:** cambiar el estado de un pedido o un cobro con SQL: las guardas lo impiden a propósito, también para el servicio (el historial es inmutable). Todo pasa por las pantallas o por `payment_apply_event`.

## 3. Avisos de pago rechazados

**Cómo se nota:** `webhooks.problems` en aviso (≥ 1 en 24 h) o crítico (≥ 20). Cuenta los avisos de un proveedor de pago con firma inválida, a revisión o sin pedido. Hoy la interfaz solo ofrece el **QR manual**, así que en la práctica no debería haber ninguno: si aparecen, alguien está llamando a `payment-webhook` (ruido o intento de fraude).

**Qué hacer:** en `/admin/pagos` → *Pagos* → detalle, mira los avisos recibidos (nunca guardan el cuerpo, solo el motivo). Una firma inválida repetida es un intento de falsificar un pago: **no se concilia nada** (la base exige firma y monto exacto). Si el proveedor es real y falló la firma, revisa el secreto (`PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>`) y rótalo (runbook 13; acepta dos firmas `v1` a la vez para rotar sin cortar).

## 4. Stock inconsistente

**Cómo se nota:** `stock.invariants` en crítico (una variante con stock distinto de la suma de sus movimientos, negativo, o con más reservado que existente: ninguna debería existir) o `reservations.stuck` (reservas activas que ya debieron expirar).

**Qué hacer**
1. **`reservations.stuck`:** es el cron `expire-stock-reservations` (runbook 1): `select public.expire_reservations();`.
2. **`stock.invariants`:** localiza la variante: `select v.id, v.sku, v.stock_on_hand, coalesce(sum(m.delta),0) as libro from product_variants v left join stock_movements m on m.variant_id = v.id group by v.id having v.stock_on_hand <> coalesce(sum(m.delta),0);` (la misma comprobación da 0 hoy). Si aparece alguna, **no la «arregles»**: avisa a quien desarrolla, porque significa que algo escribió el stock sin dejar movimiento (BR-INV-04) y hay que encontrar qué.
3. **Un conteo físico distinto del sistema** no es una inconsistencia: se corrige desde `/admin/productos/<id>` → *Stock* → ajustar con motivo (deja un movimiento `adjust`), o con la importación de tipo *Stock* (conteo) en `/admin/importar`; ambos quedan en el libro.

**Qué NO hacer:** `update product_variants set stock_on_hand = …` (las columnas de stock están cerradas incluso para el servicio: solo `apply_stock_change` la mueve).

## 5. Pedido duplicado

**Reintentos del navegador:** no crean duplicados. Cada pedido lleva una **llave de idempotencia** y la misma llave devuelve el mismo pedido (probado en pgTAP y por HTTP). Lo que **sigue abierto** es la prueba de 100 intentos simultáneos de clientas distintas sobre 10 unidades: falla en la nube con `fetch failed` (SPRINT_14 y SPRINT_15) y no se ha podido separar si es de la prueba o del sistema; no se hacen pruebas de carga contra la nube sin autorización.

**Dos pedidos reales de la misma clienta** (los hizo dos veces a propósito o por error): el límite `open_orders_max` (ajuste) acota cuántos pendientes puede tener a la vez.

**Qué hacer:** `/admin/pedidos` → abre el sobrante → **Cancelar** con motivo (el stock vuelve, el cupón se devuelve, la franja se libera). Si ya pagó los dos, el sobrante se **reembolsa** (flujo de reembolsos, `docs/operacion-pedidos.md`); «Deshacer» sirve durante `order_undo_window_minutes` minutos después de un cambio de estado equivocado.

## 6. Los avisos no salen

**Cómo se nota:** `outbox.backlog` (avisos que esperan hace más de 15 minutos), `outbox.dead` (perdidos), `notify.worker` (faltan secretos). El panel también lo dice con la causa: `/admin/notificaciones` (resumen de salud).

**Causas, de la más común a la menos:**
1. **Falta el proveedor de correo o los secretos** (así está hoy la nube: `notify_email_provider = none` y sin secretos en el vault): el cron figura «bien» pero **nunca llama al worker**. `npm run health` lo dice como `notify.worker`. Se arregla con los pasos de `docs/notificaciones.md` → «Para activar los correos».
2. `notify_enabled = false`: apagado a propósito (la cola sigue llenándose). Se enciende en `/admin/notificaciones` → *Envío y alertas*.
3. Un aviso **perdido** (`dead`): el proveedor lo rechazó varias veces. `/admin/notificaciones` → el aviso → ver el motivo → **Reenviar** (corrige el correo de la clienta antes si estaba mal escrito).
4. El proveedor está caído: los avisos reintentan solos con espera creciente (`notify_backoff_seconds`, hasta `notify_max_attempts`); cuando se recupere, la cola se vacía sola.

Una clienta **sin correo** (solo teléfono) se avisa por WhatsApp **manual**: el panel arma el enlace y una persona lo envía (`notify_whatsapp_mode = manual`).

**Los correos de Auth** (recuperar contraseña) son **otro canal**: usan el SMTP de Auth y hoy están limitados a 2 por hora (`docs/seguridad.md`, H-03). Si un aviso de pedido sale y la recuperación no, es esto.

## 7. Una persona se queda sin acceso

**Clienta que olvidó su contraseña:** «Olvidé mi contraseña» envía un correo de Auth. **Mientras Auth no tenga SMTP propio no llegará** (H-03): la solución es configurarlo antes del lanzamiento. Mientras tanto, un desarrollador puede generar el enlace de recuperación con la clave de servicio (`POST /auth/v1/admin/generate_link`, tipo `recovery`: es lo que usan los E2E; ensayado) y mandárselo por un canal seguro.

**El único administrador pierde el acceso** (o el otro está ausente): hay que tener **dos administradores** (condición de lanzamiento). Ningún administrador puede promover a otro desde el panel: se hace con `npm run admin:promote -- correo@dominio.com` (promueve una cuenta **existente**; ensayado), que ejecuta quien desarrolla con la clave de servicio. Sin ningún administrador: un desarrollador con la clave de servicio promueve una cuenta con ese mismo script y genera el enlace de recuperación como arriba. La clave de servicio **nunca** se pega en el chat ni se sube al repositorio.

**Qué NO hacer:** crear administradores de prueba nuevos en la base real (las cuentas quedan unidas a la auditoría y no se pueden borrar).

## 8. Bloquear una cuenta

- **Lista negra** (`/admin/pedidos/lista-negra`): por cuenta, teléfono o correo, con motivo; **bloquea** los métodos de pago marcados como «bloqueados para lista negra» (hoy solo **contra entrega**; se cambia en `/admin/pagos` → *Métodos*), también si abre otra cuenta con los mismos datos. Se levanta desde la misma pantalla. Ensayado (E2E de S12).
- **Desactivar una cuenta por completo** (`profiles.is_active = false`): no tiene pantalla de administración; la propia clienta puede desactivar la suya desde su cuenta. Una cuenta desactivada no compra (`account_inactive`, probado). Para desactivar una ajena un desarrollador usa la clave de servicio (`PATCH profiles?id=eq.<id>` con `{"is_active": false}`) **y** debe cerrar sus sesiones vigentes (Auth, `ban_duration` por la API de administración) — **no ensayado**.

## 9. Emergencia: parar las ventas

**No existe un interruptor único de «tienda cerrada»** (decisión pendiente, SPRINT_19). Lo que sí hay, de más a menos rápido:

1. **Desactivar todos los métodos de pago** en `/admin/pagos` → *Métodos* (hoy activos: WhatsApp y contra entrega; el QR manual está apagado hasta que haya cuenta bancaria): un método desactivado ni se ofrece ni se acepta en el pago (el SQL exige `is_active` al crear el pedido; ensayado en las pruebas de S10 y S11). Los pedidos ya creados siguen su curso.
2. **Solo cortar el pago automático** (cuando exista): el método `qr_auto` ya está apagado y la interfaz no lo ofrece (`AUTOMATIC_QR_IN_UI = false`).
3. **Modo «solo WhatsApp / contra entrega»** si cae un proveedor de pagos: desactiva solo el método caído; los otros siguen.
4. **Cancelar todo lo pendiente:** `/admin/pedidos` → filtra por «pendiente de pago» → cancela con motivo (stock, cupón y franja vuelven). No hay cancelación masiva con un botón: son pedidos uno a uno.
5. **Ocultar productos:** archivarlos o pasarlos a borrador desde `/admin/productos` (la importación con tipo *Stock* a cero también los agota).

**Para volver a vender:** reactiva los métodos de pago. Corre `npm run smoke` y un pedido de prueba pequeño.

## 10. Cambiar de proveedor

- **Correo** (`notify_email_provider`: `none`, `resend`, `fake`): cambiar de Resend a otro proveedor exige **código** (un adaptador nuevo en `supabase/functions/_shared/notifications/`), no solo un ajuste. El dominio (SPF, DKIM, DMARC) hay que verificarlo en el proveedor nuevo.
- **WhatsApp** (`notify_whatsapp_mode`: `manual` u `official`): el modo oficial no está implementado (no hay cuenta de la API); lo manual funciona hoy.
- **Pagos:** los proveedores que existen son `manual_qr`, `qr_api` (confirma un aviso firmado: **no hay adaptador de ningún banco**, falta su documentación), `whatsapp` y `cash_on_delivery`. Un proveedor nuevo exige código y su secreto (`PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>`); la base rechaza un método con un proveedor que no existe.
- **Analítica:** vacía los IDs en `/admin/ajustes` → *Analítica y publicidad* y todo queda inerte al instante.

## 11. Copias y restauración

> **Hoy el proyecto no tiene copias de seguridad.** Se comprobó con la API de gestión (solo lectura): `backups: []` y `pitr_enabled: false`. Es un **bloqueante de lanzamiento** (la lista pide una restauración probada en los últimos 7 días).

**Qué hacer antes de lanzar (decide el dueño):**
1. **Plan con copias** en Supabase (las diarias con 7 días; la recuperación a un punto en el tiempo, PITR, es un complemento aparte). Es la solución de fondo.
2. **Mientras tanto o además:** `npm run backup` hace un `pg_dump` de los esquemas `public`, `auth` y `storage` (sin vault) a `backups/` y lo verifica con `pg_restore --list` (ensayado: crea y verifica la copia; **no** ensayado: restaurarla).
3. **Los archivos de Storage** (imágenes de productos, QR, **comprobantes de pago**) **no** van en la copia de la base: tienen que copiarse aparte (descarga por la API de Storage o la herramienta de tu proveedor).
4. **Ensayar la restauración** en un proyecto de Supabase **vacío** (otro proyecto, no este): crear el proyecto, aplicar las migraciones de `supabase/migrations/` y restaurar con `pg_restore --no-owner --no-privileges --data-only --disable-triggers`. **Falta hacerlo** y anotar cuánto tardó (el RTO real).

**Restaurar de verdad (emergencia):** en un proyecto nuevo, nunca encima del actual; después, cambiar `VITE_SUPABASE_URL` y la clave pública en Vercel, volver a poner los secretos y los de `vault`, redesplegar las funciones y correr `npm run smoke` y `npm run health`.

## 12. Cuota agotada

Mira el uso en el panel de Supabase (Settings → Usage), de Vercel y del proveedor de correo; **las cifras de cada plan cambian**, no las copio aquí.

- **Base de datos:** `npm run health` → `db.size` (hoy ≈ 222 MB). El historial del cron se purga solo a los 14 días; la auditoría (`audit_log`) y los avisos enviados crecen sin límite y deben revisarse al acercarse al tope.
- **Storage:** las imágenes se reducen a ≤ 2000 px antes de subir; los videos tienen tope de 50 MB.
- **Correos de Auth:** `rate_limit_email_sent` (hoy 2 por hora, H-03): sube al configurar SMTP propio.
- **Correos de pedidos:** el tope de tu proveedor; cuando se agote los avisos reintentan y acaban en `dead` (runbook 6).
- **Funciones de Edge / ancho de banda:** al agotarse, el checkout y el carrito dejan de responder: es el momento de subir de plan, no de optimizar.

## 13. Rotar secretos

**Se rota** cuando una clave se pegó donde no debía (un chat, un correo, el repositorio) o cuando alguien con acceso se va. `npm run security:secrets` y `npm run security:secrets:history` buscan los valores reales de tus `.env*` en todo el repositorio.

| Secreto | Dónde vive | Cómo se rota y qué más cambia |
| --- | --- | --- |
| Clave de servicio (`SUPABASE_SERVICE_ROLE_KEY`) | Supabase (la inyecta a las funciones), `.env.e2e`, y el vault (`notify_worker_key`) | Panel → Settings → API. Actualiza `notify_worker_key` en el vault y `.env.e2e`. **Efecto:** las huellas de red de los consentimientos y reclamos usan esta clave como llave de HMAC, así que las anteriores dejan de ser comparables (solo importa para investigar abusos antiguos) |
| Clave pública (`VITE_SUPABASE_ANON_KEY`) | Vercel y `.env.local` | Cambia en Vercel y vuelve a desplegar. Es pública por diseño: se rota si Supabase lo pide |
| Contraseña de la base (`SUPABASE_DB_PASSWORD`) | `.env.e2e` | Panel → Database. Solo la usan pgTAP, el SQL manual y `npm run backup` |
| Token de acceso personal (`SUPABASE_ACCESS_TOKEN`) | `.env.e2e` | Revócalo en supabase.com/dashboard/account/tokens y crea otro solo cuando vayas a desplegar funciones. **Está pendiente revocar el que se pegó en el chat en sprints anteriores** |
| Firma de avisos de pago | secretos de Supabase `PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>` | La firma admite varios `v1`: pon el nuevo, cambia el proveedor y quita el viejo |
| Meta (`META_CAPI_ACCESS_TOKEN`) | secretos de Supabase | Se genera en Meta; sin él la API de conversiones no hace nada |
| Correo (`RESEND_API_KEY`) | secretos de Supabase | Se genera en Resend |

Después de rotar: `npm run smoke`, `npm run health` y un pedido de prueba pequeño.

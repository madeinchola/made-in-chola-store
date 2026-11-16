# Notificaciones y alertas (Sprint 13)

Qué avisos salen, cómo se arman y se entregan, qué hace falta del dueño para que los correos lleguen de verdad y qué se puede romper.
**Hoy no sale ningún correo real:** todo está construido, probado contra la nube con un proveedor de pruebas y detenido a propósito hasta
que el dueño conecte el proveedor (ver «Para activar los correos»).

## Qué se ve desde fuera

- **La clienta** recibe un aviso cuando se **crea**, **confirma**, **empaca**, **envía**, **entrega** o **cancela** su pedido, cuando se
  **edita**, cuando se le **devuelve dinero**, cuando su **pago falla o está por vencer** y cuando se **rechaza su comprobante**. Llega por
  **correo** o por **WhatsApp**, según lo que prefiera entre los medios que tiene (Mi cuenta → Notificaciones). Los avisos del pedido **no se
  pueden apagar**; las novedades de marketing son aparte y **nacen apagadas** (BR-LEG-01).
- **El equipo** recibe alertas internas: pedido nuevo, la clienta canceló, pedido sin confirmar, pago por revisar, comprobante recibido,
  referencia desconocida, **stock bajo o crítico** (una vez por cruce de umbral), firma inválida en un aviso de pago, un aviso que **no se pudo
  entregar** y una plantilla dañada.
- **Panel → Notificaciones:** *Registro* (cada aviso con su estado, error, mensaje enviado, reenviar, marcar enviado, descartar), *Plantillas*
  (editor con vista previa real y envío de prueba) y *Envío y alertas* (qué falta para enviar, ajustes y destinatarios de alertas).

## Cómo viaja un aviso

```
evento (pedido, pago, stock…) ──▶ notification_outbox (pending) ──▶ cron cada minuto ──▶ notify-worker ──▶ proveedor
                                       ▲  trigger / función SQL           pg_net + Vault        │
                                       └──────── reintento con retroceso ◀── error transitorio ─┘
```

1. **Se encola** dentro de la misma transacción del evento, **sin poder tumbarlo**: si la cola falla se registra una advertencia y el pedido
   sigue (criterio 2). La clave `dedupe_key` hace que un reintento de la transacción no duplique el aviso (criterio 1).
2. **El cron `notify-worker`** (cada minuto) llama a la Edge Function **solo si hay algo vencido** y si el dueño dejó sus dos secretos en el Vault.
3. **El worker** toma un lote con `claim_notifications` (**`FOR UPDATE SKIP LOCKED`**: dos workers nunca toman el mismo aviso), arma cada mensaje con
   su plantilla y lo entrega; cierra cada intento con `complete_notification`.
4. **Un fallo transitorio** (red, tiempo agotado, 429, 5xx, clave o dominio del proveedor sin arreglar) vuelve a la cola con **retroceso
   exponencial** (60 s, 120 s, 240 s… tope 6 h). Con 8 intentos se cubren **unas 2 horas** de caída del proveedor sin perder nada. Agotados los
   intentos el aviso pasa a **`dead`** y **se alerta al equipo una sola vez**. Un fallo permanente (dirección inválida) pasa a `failed` y no se
   reintenta. Desde el panel cualquier aviso se puede **reenviar** (crea una fila nueva; la original no se toca).

### Estados

`pending` (lista o esperando su hora) · `sending` (la tomó un worker) · `sent` · `failed` (permanente) · `dead` (agotó intentos) ·
`cancelled` (ya no vale) · `manual` (WhatsApp: lo envía una persona).

### Un aviso que ya no vale se cancela, no se envía

Antes de enviar, el worker descarta (`cancelled`, con el motivo en el registro) lo que engañaría: **`reverted`** (se deshizo el paso),
**`superseded`** (el pedido ya va más adelante: pasos rápidos seguidos se consolidan en el último aviso), **`account_inactive`**,
**`order_resolved`** (un recordatorio de un pedido que ya se pagó), `order_missing`. «Completado» vale como «entregado» para esta comparación.
Los avisos de los pasos que un administrador puede deshacer (**empacado, enviado, entregado, completado**) **esperan la ventana de «deshacer»**
(`order_undo_window_minutes`, 5 min): si se deshace, el aviso se cancela **y su clave queda libre**, así que al rehacer el paso la clienta sí
recibe el suyo. Un reenvío pedido por un administrador es una decisión explícita y se salta estas comprobaciones (salvo la cuenta activa).

## Reglas de seguridad y privacidad

- **El contenido de la cola no lleva datos personales**: solo número, estado, total y moneda. El nombre se consulta al enviar y el destinatario va
  en su columna. Al **anonimizar** una cuenta el destinatario se borra de todo el registro; al desactivarla, lo pendiente se cancela.
- **Siempre al contacto vigente** de la cuenta (no al del formulario del pedido, que no se verifica): si cambió el correo o el canal entre
  encolar y enviar, se usa el nuevo.
- **Plantillas = texto plano con variables.** El HTML sale de **escapar** ese texto: un `<script>` en un nombre o una dirección llega como texto.
  Los valores de las variables son de una línea (**sin inyección de cabeceras** en el asunto). Los botones solo aceptan enlaces `http(s)`.
- **Dominios reservados** (`.test`, `.example`, `.invalid`, `.localhost`, `example.com`…): **jamás se envían por un proveedor real** (quedan como
  `sink`); el proveedor de pruebas, a su vez, **solo entrega a ellos**. Así los miles de datos de prueba de la nube no pueden dañar la reputación
  del dominio el día que se active Resend.
- **Quién puede qué:** la cola y las plantillas las **lee solo el administrador** y nadie las escribe desde el navegador; el worker (clave de
  servicio) toma y cierra envíos pero **no escribe plantillas**; `notify-worker` solo acepta la clave de servicio (comparada en tiempo constante);
  `notify-admin` exige sesión de administrador y limita el envío de prueba a **tu propio correo** o a un destinatario de alertas. Los ajustes de
  notificación (incluidos los correos de las alertas) **no son públicos**.
- **Las preferencias** son de su dueña (RLS); la fecha del consentimiento la fija la base y **no se escribe a mano**; quién consintió y cuándo
  queda en la **auditoría** (`audit_log`).

## Datos

Migración `20261116000100_s13_notificaciones.sql` (idempotente).

| Objeto | Para qué |
|---|---|
| `notification_outbox` (completada) | + `template`, `order_id`/`profile_id` (**sin clave foránea**: el registro no estorba limpiar pedidos o cuentas), `sent_at`, `last_error` (código corto), `provider`, `provider_message_id`, `rendered_subject`/`rendered_body` (lo que se envió), `locked_at/by`, `resent_of`, `created_by`, `sent_by`; estados nuevos |
| `notification_templates` | una por (clave, canal, idioma): asunto, cuerpo, botón, activa, `is_default` («por revisar»); 36 de arranque; solo el admin escribe, con auditoría |
| `notification_preferences` | canal preferido y consentimiento de marketing por clienta |
| 9 ajustes | `notify_enabled`, `notify_max_attempts` (8), `notify_backoff_seconds` (60), `notify_email_provider` (`none`), `notify_from_name`, `notify_from_email`, `notify_reply_to`, `notify_whatsapp_mode` (`manual`), `alert_recipients` |
| funciones del worker | `claim_notifications`, `complete_notification` (solo `service_role`), `alert_recipients`, `notification_backoff_seconds`, `_notify_target`, `_notification_stale_reason` |
| funciones del panel | `admin_notification_resend/mark_sent/cancel/counts/health` |
| `notify_worker_kick()` + cron | despierta al worker (pg_net + Vault); sin secretos no hace nada |

`_order_notify` (S10/S11) se redefine con la **preferencia de canal** y la **espera del «deshacer»**; `admin_undo_transition` (S12) cancela el aviso
del paso deshecho. Las claves de los avisos de estado **no cambian** (`order_confirmed:<id>:c`…), así que las pruebas de S10–S12 siguen valiendo.

### Plantillas y variables

Texto plano; variables `{{nombre}}` (minúsculas, números y `_`). Las de la clienta: `customer_name` (primer nombre), `order_number`,
`order_total` (`Bs 1.234,50`), `order_url` (pide iniciar sesión), `payment_deadline` (hora de La Paz), `refund_amount`, `reason`, `store_name`.
Las de las alertas: `admin_url`, `provider`, `reference`, `product_name`, `product_code`, `variant`, `stock`, `threshold`, `light_label`,
`notification_type`, `channel`, `error`, `template_key`. **El editor no deja guardar** una llave suelta ni una variable que no existe (casi
siempre un error de tipeo que dejaría un hueco en el mensaje). Si una variable falta al enviar, se pinta vacía y se repara el saludo («Hola , » →
«Hola,»). **Plantilla apagada = no se envía** (sin alerta; es una decisión de la tienda). **Plantilla inexistente o dañada** = sale un texto de
respaldo y se alerta una vez por día. `order_completed` y `order_refunded` arrancan **apagadas** (las cubren «entregado» y «devolución procesada»).

## Proveedores

- **Correo: Resend** (decisión del dueño, D-03). Contrato verificado en su documentación el 2026-11-16: `POST https://api.resend.com/emails`, cabecera
  `Idempotency-Key` (1–256 caracteres, vigente 24 h; **una por aviso**, así un reintento tras perder la respuesta no envía dos veces), errores 400/422
  → permanente; 401/403 (clave, remitente o dominio sin verificar) → se reintenta para no perder el aviso mientras el dueño lo arregla; 409
  `invalid_idempotent_request` → permanente y visible (se reenvía); 429 → se respeta su espera (o hasta la medianoche UTC si es cuota); 5xx → reintento.
  **No se probó contra una cuenta real** (falta la clave y el dominio): lo verificado es la forma de la petición y cada clase de error con
  respuestas simuladas.
- **WhatsApp: modo manual** (el modo oficial no existe aún y se comporta como manual). El worker deja el aviso en `manual` con el mensaje ya escrito;
  el panel arma el enlace `wa.me` con ese mensaje; la persona lo envía y marca «Ya lo envié» (queda quién y cuándo).
- **Pruebas: `fake`.** Se controla por la parte local de la dirección (`transient@`, `transient-N@`, `permanent@`, `timeout@`, `ratelimit@`) y solo
  entrega a dominios reservados.

## Para activar los correos (lo debe hacer el dueño)

1. En Resend, **verificar el dominio** (SPF, DKIM y DMARC en el DNS). Hay que confirmar que `madeinchola.com` es suyo y quién maneja el DNS.
2. En Supabase → Edge Functions → Secrets: **`RESEND_API_KEY`** y **`SITE_URL`** (dirección pública de la tienda; sin ella los enlaces usan la URL de Vercel).
3. En Supabase → **Vault**, dos secretos: `notify_worker_url` (URL de la función `notify-worker`) y `notify_worker_key` (la **clave de servicio**, la misma
   que ve la función en `SUPABASE_SERVICE_ROLE_KEY`).
4. En Notificaciones → Envío y alertas: escribir el **correo remitente** (del dominio verificado) y cambiar el proveedor a **Resend**.
5. En Plantillas, abrir una y pulsar **«Enviarme una prueba»**: comprobar que llega a la bandeja principal y se ve bien en Gmail, Outlook y Apple Mail.
6. **Antes** de activar: revisar los textos «por revisar» (son de arranque, escritos por mí) y, si se quiere, vaciar los avisos de prueba acumulados.

Mientras falte cualquiera, los correos **esperan en la cola sin perderse ni gastar intentos**, y el panel dice **por qué** (`admin_notification_health`).
Los emails de **Auth** (confirmación y recuperación) usan el SMTP integrado de Supabase hasta que se configure SMTP propio en el panel de Auth;
eso queda como tarea del dueño (SPRINT_19 §R).

## Pruebas

pgTAP `20_s13_notificaciones` (**308** aserciones calculadas a mano: ajustes y validaciones, plantillas, retroceso con propiedades, canal, avisos
del pedido, «deshacer», tomar lote, rescate, descarte, cierre, **simulación de la caída del proveedor** —8 intentos en 127 min y una sola alerta—,
reenvío, WhatsApp manual, alertas, cuenta desactivada y anonimizada, RLS y permisos, cron); las suites `05` y `06` se ampliaron a propósito. Deno
`_shared/notifications` (125 pruebas: motor de plantillas con XSS e inyección, diseño, variables, **cada clase de error de Resend**, proveedor
de pruebas, vista previa y worker con dependencias inyectadas). Interfaz (116 pruebas nuevas). **Integración contra la nube (19)** con la
función **desplegada**: éxito, transitorio con su espera, permanente, 429, `dead` con alerta, **tres workers a la vez sobre 12 avisos → cada uno se
toma una vez**, un worker muerto que se rescata, el flujo de un pedido real con «deshacer», preferencias y plantillas con sus permisos, y la vista
previa y el envío de prueba de `notify-admin`. **E2E (20)**. Mutación SQL: **27 mutantes** (un cambio deliberado por vez en la migración: retroceso, `dead`, descarte, canal, «deshacer», reenvío, consentimiento, anonimizar, permisos, límites…) corridos contra la prueba 20: **24 mueren en pgTAP**, cada uno en una aserción que habla de lo que se rompió; **M03** (quitar `SKIP LOCKED`) **sobrevive en pgTAP** (una sola sesión no disputa candados) y **mi primera prueba de integración tampoco lo detectaba**: tres workers a la vez no duplican igual, porque `FOR UPDATE` los hace esperar y al volver a evaluar la fila ya no está pendiente; lo que `SKIP LOCKED` cambia es que **un worker no se bloquee** esperando a otro. Se añadió una prueba que retiene el candado de un aviso mientras el worker procesa otro (con el mutante el worker espera y la base lo corta con un 500) y **con ella M03 muere**. **M06** (la comprobación de cuenta inactiva dentro del descarte) es **equivalente**: el `claim` vuelve a comprobar el contacto con `_notify_target`, que aplica las mismas condiciones. **M20** (quitar el `revoke` del worker sobre las plantillas) es **no concluyente en este arnés**: la nube ya tenía el `revoke` aplicado y reaplicar la migración sin él no devuelve el permiso; se verificó directamente que `service_role` no puede escribir plantillas ni preferencias y se añadieron 3 aserciones exactas de privilegios (pgTAP 305 → 308), pero **no se probó una instalación nueva sin esa línea**. Resultado: **25 de 27 detectados, 1 equivalente, 1 no concluyente**.

## Límites conocidos y decisiones abiertas

1. **Ningún correo real se envió nunca**: falta la cuenta de Resend, el dominio verificado y los secretos. Entregabilidad (mail-tester, Gmail Postmaster),
   rebotes y el aspecto en Gmail/Outlook/Apple Mail móvil **no se pudieron verificar**; el diseño es provisional (colores de `layout.ts`, a falta de la
   identidad de la diseñadora).
2. **El cron → worker de punta a punta no se probó**: necesita los secretos del Vault. Sí se probó cada mitad (la función desplegada con la clave de
   servicio, y la lógica de `notify_worker_kick` hasta «not_configured»).
3. **El latido es de un minuto**: no hay disparo inmediato al encolar (la mejora sería un `pg_net` desde el trigger).
4. **WhatsApp oficial** (API de Meta con plantillas aprobadas) no existe: decisión y costo pendientes del dueño.
5. **Textos de arranque** escritos por mí; el dueño debe revisarlos (PENDIENTES_ADMIN §G). Un solo idioma (`es`): la columna `locale` deja el camino a S18.
6. **No hay marketing**: solo el consentimiento. Un newsletter (fuera del sprint) deberá respetar `marketing_*` y poner el enlace de baja.
7. **Los avisos de Auth** no usan estas plantillas (se configuran en el panel de Supabase Auth).
8. **Prueba de carga del worker** y de **un caída de 1 hora con el proveedor real**: la simulación SQL y la integración con el proveedor de pruebas cubren la lógica, no el rendimiento.
9. **Sin umbrales de «ruido» propios**: se reutilizan los de stock (Ajustes) y las alertas se deduplican (una por cruce de umbral, una por pedido y día, una por hora y proveedor).

-- Sprint 13 · Notificaciones y alertas.
-- Crea: public.notification_templates, public.notification_preferences; completa public.notification_outbox (plantilla, rastro del envío,
--       enlaces al pedido y a la clienta, estados sending/dead/cancelled/manual); 9 ajustes `notify_*` y `alert_recipients`;
--       worker en la base: claim_notifications (SKIP LOCKED), complete_notification, _notification_settle, _notification_stale_reason,
--       notification_backoff_seconds, _notify_target, alert_recipients, _enqueue_notification_ex; _order_notify y admin_undo_transition
--       redefinidas; admin_notification_resend/mark_sent/cancel/counts/health; triggers de avisos de pago con firma inválida y de limpieza
--       por cuenta desactivada; notify_worker_kick + cron `notify-worker` (pg_net + Vault).
-- Rollback (manual, orden inverso):
--   select cron.unschedule('notify-worker');
--   drop trigger profiles_notification_cleanup_trg on public.profiles; drop trigger webhook_events_alert_trg on public.webhook_events;
--   -- volver a crear _order_notify (S11) y admin_undo_transition (S12) con su cuerpo anterior (create or replace);
--   drop function public.admin_notification_health(), public.admin_notification_counts(), public.admin_notification_cancel(bigint),
--     public.admin_notification_mark_sent(bigint), public.admin_notification_resend(bigint), public.notify_worker_kick(),
--     public.profiles_notification_cleanup(), public.webhook_events_alert(), public.complete_notification(bigint, text, text, text, text, text, int, text, text),
--     public.claim_notifications(int, text, bigint[], text[]), public._notification_settle(bigint, text, text, text, text, int, text, text),
--     public._notification_stale_reason(public.notification_outbox), public._notification_status_rank(text),
--     public._enqueue_notification_ex(text, text, text, jsonb, text, uuid, uuid, timestamptz), public.alert_recipients(),
--     public._notify_target(uuid), public.notification_backoff_seconds(int, int), public.notification_preferences_guard(),
--     public.notification_template_validate(), public.notification_outbox_link(), public.store_settings_validate_s13(),
--     public.setting_text(text, text);
--   drop table public.notification_preferences, public.notification_templates;
--   alter table public.notification_outbox drop constraint notification_outbox_status_check,
--     drop column template, drop column order_id, drop column profile_id, drop column sent_at, drop column last_error,
--     drop column provider, drop column provider_message_id, drop column rendered_subject, drop column rendered_body, drop column locked_at, drop column locked_by, drop column resent_of,
--     drop column created_by, drop column sent_by, drop column updated_at;
--   alter table public.notification_outbox add constraint notification_outbox_status_check check (status in ('pending', 'sent', 'failed'));
--   delete from public.store_settings where key in ('notify_enabled', 'notify_max_attempts', 'notify_backoff_seconds', 'notify_email_provider',
--     'notify_from_name', 'notify_from_email', 'notify_reply_to', 'notify_whatsapp_mode', 'alert_recipients');

-- ── 0. Utilidades ───────────────────────────────────────────────────────────────────────────
-- Lectura de un texto con valor por defecto (uso interno en funciones del propietario).
create or replace function public.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.value #>> '{}' from public.store_settings s
                    where s.key = p_key and s.value_type in ('text', 'email', 'url', 'phone_e164')), p_default)
$$;
revoke all on function public.setting_text(text, text) from public, anon, authenticated;
grant execute on function public.setting_text(text, text) to service_role;

-- ── 1. Ajustes ──────────────────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('notify_enabled', 'true', 'bool', false,
   'Interruptor general de las notificaciones: apagado, la cola sigue llenándose pero el worker no envía nada'),
  ('notify_max_attempts', '8', 'int', false,
   'Intentos de envío antes de dar un aviso por perdido («dead») y alertar al administrador. Con el retroceso de abajo, 8 intentos cubren unas 2 horas de caída del proveedor'),
  ('notify_backoff_seconds', '60', 'int', false,
   'Espera tras el primer fallo transitorio; se duplica en cada intento (60 → 120 → 240 …, con tope de 6 horas)'),
  ('notify_email_provider', '"none"', 'text', false,
   'Proveedor de correo: none (no envía; los avisos esperan en la cola), resend o fake (solo pruebas: únicamente entrega a direcciones de dominios reservados)'),
  ('notify_from_name', '"Made In Chola"', 'text', false, 'Nombre del remitente de los correos'),
  ('notify_from_email', '""', 'text', false,
   'Correo remitente. Debe ser de un dominio verificado en el proveedor (SPF, DKIM y DMARC); vacío = no se envía ningún correo'),
  ('notify_reply_to', '""', 'text', false, 'Correo al que responden las clientas (vacío = el remitente)'),
  ('notify_whatsapp_mode', '"manual"', 'text', false,
   'WhatsApp: manual (el panel arma el enlace wa.me y una persona lo envía) u official (API oficial; aún no disponible: se comporta como manual)'),
  ('alert_recipients', '""', 'text', false,
   'Correos que reciben las alertas internas, separados por comas (vacío = todos los administradores activos)')
on conflict (key) do nothing;

create or replace function public.store_settings_validate_s13()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text := new.value #>> '{}';
  v_item text;
  v_n int := 0;
begin
  if new.key in ('notify_enabled') then
    if new.value_type <> 'bool' or jsonb_typeof(new.value) <> 'boolean' then
      raise exception 'el ajuste "%" debe ser verdadero o falso', new.key using errcode = '22023';
    end if;
  elsif new.key in ('notify_max_attempts', 'notify_backoff_seconds') then
    if new.value_type <> 'int' or jsonb_typeof(new.value) <> 'number' or v_text !~ '^[0-9]{1,9}$' then
      return new; -- el tipo lo rechaza la validación general
    end if;
    if (new.key = 'notify_max_attempts' and (v_text::int < 1 or v_text::int > 20))
       or (new.key = 'notify_backoff_seconds' and (v_text::int < 5 or v_text::int > 3600)) then
      raise exception 'el ajuste "%" está fuera de rango', new.key using errcode = '22023';
    end if;
  elsif new.key = 'notify_email_provider' then
    if jsonb_typeof(new.value) <> 'string' or v_text not in ('none', 'resend', 'fake') then
      raise exception 'notify_email_provider debe ser none, resend o fake' using errcode = '22023';
    end if;
  elsif new.key = 'notify_whatsapp_mode' then
    if jsonb_typeof(new.value) <> 'string' or v_text not in ('manual', 'official') then
      raise exception 'notify_whatsapp_mode debe ser manual u official' using errcode = '22023';
    end if;
  elsif new.key = 'notify_from_name' then
    if jsonb_typeof(new.value) <> 'string' or char_length(btrim(v_text)) not between 1 and 80 or v_text ~ '[\r\n<>"]' then
      raise exception 'notify_from_name debe tener entre 1 y 80 caracteres, sin saltos de línea ni < > "' using errcode = '22023';
    end if;
  elsif new.key in ('notify_from_email', 'notify_reply_to') then
    if jsonb_typeof(new.value) <> 'string'
       or (v_text <> '' and (v_text <> lower(btrim(v_text)) or char_length(v_text) > 254
                             or v_text !~ '^[^@[:space:],;<>"]+@[^@[:space:],;<>"]+\.[^@[:space:],;<>"]+$')) then
      raise exception '"%" debe estar vacío o ser un correo válido en minúsculas', new.key using errcode = '22023';
    end if;
  elsif new.key = 'alert_recipients' then
    if jsonb_typeof(new.value) <> 'string' then
      raise exception 'alert_recipients debe ser un texto' using errcode = '22023';
    end if;
    if btrim(v_text) <> '' then
      foreach v_item in array string_to_array(v_text, ',') loop
        -- Una coma de más (o espacios entre comas) no es un error: alert_recipients() también ignora las entradas vacías.
        continue when btrim(v_item) = '';
        v_n := v_n + 1;
        if btrim(v_item) !~ '^[^@[:space:],;<>"]+@[^@[:space:],;<>"]+\.[^@[:space:],;<>"]+$' or char_length(btrim(v_item)) > 254 then
          raise exception 'alert_recipients: «%» no es un correo válido', btrim(v_item) using errcode = '22023';
        end if;
      end loop;
      if v_n > 10 then
        raise exception 'alert_recipients admite hasta 10 correos' using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists store_settings_validate_s13_trg on public.store_settings;
create trigger store_settings_validate_s13_trg before insert or update on public.store_settings
  for each row when (new.key in ('notify_enabled', 'notify_max_attempts', 'notify_backoff_seconds', 'notify_email_provider',
                                 'notify_from_name', 'notify_from_email', 'notify_reply_to', 'notify_whatsapp_mode', 'alert_recipients'))
  execute function public.store_settings_validate_s13();

-- ── 2. La cola (outbox) completa ────────────────────────────────────────────────────────────
-- S3 la creó con lo mínimo. Aquí: plantilla, rastro del envío (proveedor, id del mensaje, error, quién lo tomó), enlaces al pedido y a
-- la clienta SIN clave foránea (el registro de envíos no debe impedir limpiar pedidos o cuentas) y los estados nuevos:
--   pending (lista o esperando su hora) · sending (la tomó un worker) · sent · failed (error permanente: no se reintenta)
--   dead (agotó sus intentos) · cancelled (ya no vale: cuenta desactivada, paso deshecho o superado…) · manual (WhatsApp: lo envía una persona)
alter table public.notification_outbox
  add column if not exists template            text check (template is null or template ~ '^[a-z][a-z0-9_]{0,59}$'),
  add column if not exists order_id            uuid,
  add column if not exists profile_id          uuid,
  add column if not exists sent_at             timestamptz,
  add column if not exists last_error          text check (last_error is null or char_length(last_error) <= 300),
  add column if not exists provider            text check (provider is null or char_length(provider) <= 40),
  add column if not exists provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  add column if not exists rendered_subject    text check (rendered_subject is null or char_length(rendered_subject) <= 300),
  add column if not exists rendered_body       text check (rendered_body is null or char_length(rendered_body) <= 4000),
  add column if not exists locked_at           timestamptz,
  add column if not exists locked_by           text check (locked_by is null or char_length(locked_by) <= 80),
  add column if not exists resent_of           bigint,
  add column if not exists created_by          uuid,
  add column if not exists sent_by             uuid,
  add column if not exists updated_at          timestamptz not null default now();
alter table public.notification_outbox drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'dead', 'cancelled', 'manual'));
create index if not exists notification_outbox_order_idx on public.notification_outbox (order_id, id desc) where order_id is not null;
create index if not exists notification_outbox_profile_idx on public.notification_outbox (profile_id, id desc) where profile_id is not null;
create index if not exists notification_outbox_status_idx on public.notification_outbox (status, id desc);
create index if not exists notification_outbox_sending_idx on public.notification_outbox (locked_at) where status = 'sending';

drop trigger if exists notification_outbox_set_updated_at on public.notification_outbox;
create trigger notification_outbox_set_updated_at before update on public.notification_outbox
  for each row execute function public.set_updated_at();

-- Rellena la plantilla (= el tipo, por omisión) y los enlaces al pedido y a la clienta a partir del contenido. La clienta solo se
-- enlaza en los avisos que se le envían a ella (con destinatario): las alertas internas no son de ninguna clienta.
create or replace function public.notification_outbox_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.template is null then
    new.template := new.type;
  end if;
  if new.order_id is null and (new.payload ->> 'order_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    new.order_id := (new.payload ->> 'order_id')::uuid;
  end if;
  if new.profile_id is null and new.order_id is not null and new.recipient is not null then
    select o.profile_id into new.profile_id from public.orders o where o.id = new.order_id;
  end if;
  return new;
end;
$$;
revoke all on function public.notification_outbox_link() from public, anon, authenticated;
drop trigger if exists notification_outbox_link_trg on public.notification_outbox;
create trigger notification_outbox_link_trg before insert on public.notification_outbox
  for each row execute function public.notification_outbox_link();

-- Lo que se encoló antes de S13 nunca llegó a nadie (no existía el worker): enviarlo ahora sería avisar con días de retraso.
-- (Corte fijo para que volver a aplicar la migración no cancele avisos nuevos.)
update public.notification_outbox
   set status = 'cancelled', last_error = 'before_s13'
 where status = 'pending' and created_at < timestamptz '2026-11-16 00:00:00+00';

-- ── 3. Plantillas editables ─────────────────────────────────────────────────────────────────
-- Una por (clave, canal, idioma). La clave es el tipo del aviso. Cuerpo en texto con párrafos y variables {{nombre}}; el correo
-- le pone la identidad de la tienda alrededor y un botón opcional. `is_default` = texto de arranque que la tienda aún no revisó.
create table if not exists public.notification_templates (
  id         bigint generated always as identity primary key,
  key        text not null check (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  channel    text not null check (channel in ('email', 'whatsapp')),
  locale     text not null default 'es' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  audience   text not null check (audience in ('customer', 'admin')),
  subject    text not null default '' check (char_length(subject) <= 200),
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  cta_label  text check (cta_label is null or char_length(cta_label) <= 60),
  active     boolean not null default true,
  is_default boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_templates_key_channel_locale unique (key, channel, locale),
  constraint notification_templates_subject_for_email check (channel <> 'email' or char_length(btrim(subject)) between 1 and 200),
  constraint notification_templates_whatsapp_len check (channel <> 'whatsapp' or char_length(body) <= 1000)
);

-- Sintaxis: toda llave pertenece a una variable válida {{nombre}} (minúsculas, dígitos y _). Una llave suelta rompería el mensaje.
create or replace function public.notification_template_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_field text;
  v_clean text;
begin
  foreach v_field in array array[coalesce(new.subject, ''), coalesce(new.body, ''), coalesce(new.cta_label, '')] loop
    v_clean := regexp_replace(v_field, '\{\{\s*[a-z_][a-z0-9_]{0,40}\s*\}\}', '', 'g');
    if v_clean ~ '\{\{|\}\}' then
      raise exception 'plantilla con una llave suelta o una variable inválida: usa {{nombre}} con minúsculas, números y _' using errcode = '22023';
    end if;
  end loop;
  if new.subject ~ '[\r\n]' then
    raise exception 'el asunto no puede tener saltos de línea' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
    if (old.subject, old.body, old.cta_label, old.active) is distinct from (new.subject, new.body, new.cta_label, new.active) then
      new.is_default := false;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.notification_template_validate() from public, anon, authenticated;
drop trigger if exists notification_templates_validate_trg on public.notification_templates;
create trigger notification_templates_validate_trg before insert or update on public.notification_templates
  for each row execute function public.notification_template_validate();
drop trigger if exists notification_templates_set_updated_at on public.notification_templates;
create trigger notification_templates_set_updated_at before update on public.notification_templates
  for each row execute function public.set_updated_at();

-- Solo el administrador escribe (con auditoría). Nadie borra: una plantilla que ya no se quiere se desactiva.
select public._apply_admin_rls('notification_templates',
  array['key', 'channel', 'locale', 'audience', 'subject', 'body', 'cta_label', 'active'],
  array['subject', 'body', 'cta_label', 'active']);
-- El worker solo LEE las plantillas: los privilegios por omisión de Supabase le darían escribirlas, y no hace falta.
revoke insert, update, delete, truncate on public.notification_templates from service_role;
grant select on public.notification_templates to service_role;
drop trigger if exists audit_notification_templates on public.notification_templates;
create trigger audit_notification_templates after insert or update on public.notification_templates
  for each row execute function public.audit_changes();

-- Textos de arranque (la tienda los revisa: PENDIENTES_ADMIN §G). Nunca se pisan los que ya editó (on conflict do nothing).
-- Variables de la clienta: customer_name, order_number, order_total, order_url, store_name, payment_deadline, refund_amount, reason.
insert into public.notification_templates (key, channel, audience, subject, body, cta_label, active) values
  ('order_created', 'email', 'customer', 'Recibimos tu pedido {{order_number}}',
   E'Hola {{customer_name}},\n\n¡gracias por tu compra en {{store_name}}! Recibimos tu pedido {{order_number}} por {{order_total}}.\n\nTe avisaremos en cuanto confirmemos el pago. Mientras tanto puedes revisar el detalle cuando quieras.', 'Ver mi pedido', true),
  ('order_confirmed', 'email', 'customer', 'Confirmamos tu pedido {{order_number}}',
   E'Hola {{customer_name}},\n\nconfirmamos tu pedido {{order_number}} (total {{order_total}}). Ya estamos preparándolo.\n\nTe avisaremos cuando salga hacia ti.', 'Ver mi pedido', true),
  ('order_packed', 'email', 'customer', 'Tu pedido {{order_number}} está empacado',
   E'Hola {{customer_name}},\n\ntu pedido {{order_number}} ya está empacado y listo para salir.', 'Ver mi pedido', true),
  ('order_shipped', 'email', 'customer', 'Tu pedido {{order_number}} va en camino',
   E'Hola {{customer_name}},\n\ntu pedido {{order_number}} ya salió hacia ti. Ten a mano el número de pedido al recibirlo.', 'Ver mi pedido', true),
  ('order_delivered', 'email', 'customer', 'Entregamos tu pedido {{order_number}}',
   E'Hola {{customer_name}},\n\ntu pedido {{order_number}} figura como entregado. Si algo no está bien, escríbenos y lo resolvemos.', 'Ver mi pedido', true),
  ('order_completed', 'email', 'customer', 'Tu pedido {{order_number}} está completo',
   E'Hola {{customer_name}},\n\ncerramos tu pedido {{order_number}}. ¡Gracias por elegirnos!', 'Ver mi pedido', false),
  ('order_cancelled', 'email', 'customer', 'Se canceló tu pedido {{order_number}}',
   E'Hola {{customer_name}},\n\nse canceló tu pedido {{order_number}}. Si ya pagaste, revisaremos la devolución y te avisaremos.\n\nSi fue un error o tienes dudas, escríbenos.', 'Ver mi pedido', true),
  ('order_refunded', 'email', 'customer', 'Reembolsamos tu pedido {{order_number}}',
   E'Hola {{customer_name}},\n\nreembolsamos tu pedido {{order_number}}.', 'Ver mi pedido', false),
  ('order_edited', 'email', 'customer', 'Actualizamos tu pedido {{order_number}}',
   E'Hola {{customer_name}},\n\nactualizamos tu pedido {{order_number}} y el total ahora es {{order_total}}. Revisa el detalle para ver qué cambió.', 'Ver mi pedido', true),
  ('order_refund_processed', 'email', 'customer', 'Te devolvimos {{refund_amount}} de tu pedido {{order_number}}',
   E'Hola {{customer_name}},\n\nregistramos la devolución de {{refund_amount}} de tu pedido {{order_number}}. El dinero puede tardar en reflejarse según tu medio de pago.', 'Ver mi pedido', true),
  ('payment_failed', 'email', 'customer', 'No pudimos confirmar el pago de tu pedido {{order_number}}',
   E'Hola {{customer_name}},\n\nel pago de tu pedido {{order_number}} no se completó. Puedes intentarlo de nuevo desde tu cuenta.', 'Volver a pagar', true),
  ('payment_expiring', 'email', 'customer', 'Tu pedido {{order_number}} vence pronto',
   E'Hola {{customer_name}},\n\nel pago de tu pedido {{order_number}} ({{order_total}}) vence el {{payment_deadline}}. Si no se completa, liberaremos los productos.', 'Pagar ahora', true),
  ('payment_proof_rejected', 'email', 'customer', 'No pudimos validar tu comprobante',
   E'Hola {{customer_name}},\n\nrevisamos el comprobante de tu pedido {{order_number}} y no pudimos validarlo.\n\nMotivo: {{reason}}\n\nPuedes subir uno nuevo desde tu pedido.', 'Subir otro comprobante', true),
  ('order_created', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, recibimos tu pedido {{order_number}} por {{order_total}}. Te avisamos cuando confirmemos el pago. Detalle: {{order_url}}', null, true),
  ('order_confirmed', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, confirmamos tu pedido {{order_number}} ({{order_total}}). Ya lo estamos preparando. Detalle: {{order_url}}', null, true),
  ('order_packed', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, tu pedido {{order_number}} ya está empacado y listo para salir.', null, true),
  ('order_shipped', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, tu pedido {{order_number}} ya salió hacia ti. Ten a mano el número de pedido al recibirlo.', null, true),
  ('order_delivered', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, tu pedido {{order_number}} figura como entregado. Si algo no está bien, escríbenos y lo resolvemos.', null, true),
  ('order_completed', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, cerramos tu pedido {{order_number}}. ¡Gracias por elegirnos!', null, false),
  ('order_cancelled', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, se canceló tu pedido {{order_number}}. Si ya pagaste, revisaremos la devolución y te avisamos. Si fue un error, escríbenos.', null, true),
  ('order_refunded', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, reembolsamos tu pedido {{order_number}}.', null, false),
  ('order_edited', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, actualizamos tu pedido {{order_number}}: el total ahora es {{order_total}}. Detalle: {{order_url}}', null, true),
  ('order_refund_processed', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, registramos la devolución de {{refund_amount}} de tu pedido {{order_number}}. Puede tardar en reflejarse según tu medio de pago.', null, true),
  ('payment_failed', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, el pago de tu pedido {{order_number}} no se completó. Puedes intentarlo de nuevo desde tu cuenta: {{order_url}}', null, true),
  ('payment_expiring', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, el pago de tu pedido {{order_number}} ({{order_total}}) vence el {{payment_deadline}}. Si no se completa, liberaremos los productos. {{order_url}}', null, true),
  ('payment_proof_rejected', 'whatsapp', 'customer', '', E'Hola {{customer_name}}, no pudimos validar el comprobante de tu pedido {{order_number}}. Motivo: {{reason}}. Puedes subir uno nuevo desde tu pedido: {{order_url}}', null, true)
on conflict (key, channel, locale) do nothing;

-- Alertas internas (solo correo). Variables: order_number, order_total, admin_url, reason, provider, reference, product_name,
-- product_code, variant, stock, threshold, light_label, notification_type, channel, error, template_key.
insert into public.notification_templates (key, channel, audience, subject, body, cta_label, active) values
  ('order_new', 'email', 'admin', 'Nuevo pedido {{order_number}}',
   E'Entró el pedido {{order_number}} por {{order_total}}.\n\nRevísalo y confírmalo desde el panel.', 'Abrir en el panel', true),
  ('order_cancelled_by_customer', 'email', 'admin', 'La clienta canceló el pedido {{order_number}}',
   E'La clienta canceló el pedido {{order_number}} ({{order_total}}).\n\nSi ya había pagado, revisa Pagos → Por revisar para devolver el dinero.', 'Abrir en el panel', true),
  ('order_pending_reminder', 'email', 'admin', 'Pedido {{order_number}} sin confirmar',
   E'El pedido {{order_number}} lleva tiempo sin confirmarse. Los pedidos por WhatsApp y contra entrega reservan stock hasta que los confirmes o canceles.', 'Abrir en el panel', true),
  ('payment_review_needed', 'email', 'admin', 'Un pago necesita tu revisión',
   E'Hay un pago por revisar (motivo: {{reason}}).\n\nEntra a Pagos → Por revisar.', 'Abrir en el panel', true),
  ('payment_unknown_reference', 'email', 'admin', 'Llegó un pago con una referencia desconocida',
   E'El proveedor {{provider}} avisó un pago con la referencia {{reference}}, que no corresponde a ningún pedido.\n\nRevísalo en Pagos.', 'Abrir en el panel', true),
  ('payment_proof_received', 'email', 'admin', 'Comprobante recibido del pedido {{order_number}}',
   E'La clienta subió un comprobante de pago del pedido {{order_number}}.\n\nApruébalo o recházalo en Pagos → Por revisar.', 'Abrir en el panel', true),
  ('stock_alert', 'email', 'admin', 'Stock {{light_label}}: {{product_name}}',
   E'{{product_name}} ({{product_code}}), {{variant}}: quedan {{stock}} unidades (umbral {{threshold}}).\n\nReponerlo a tiempo evita que se agote.', 'Abrir en el panel', true),
  ('notification_dead', 'email', 'admin', 'No pudimos entregar un aviso',
   E'Un aviso de tipo {{notification_type}} ({{channel}}) agotó sus intentos y no se entregó.\n\nRevísalo en Notificaciones → Registro y reenvíalo si corresponde.\n\nÚltimo error: {{error}}', 'Abrir en el panel', true),
  ('template_fallback', 'email', 'admin', 'Una plantilla de notificación tiene un error',
   E'La plantilla «{{template_key}}» ({{channel}}) está dañada o falta: se envió el texto de respaldo.\n\nCorrígela en Notificaciones → Plantillas.', 'Abrir en el panel', true),
  ('webhook_signature_invalid', 'email', 'admin', 'Aviso de pago con firma inválida',
   E'El proveedor {{provider}} envió avisos con una firma que no coincide. Puede ser un intento de fraude o un secreto mal configurado.', 'Abrir en el panel', true)
on conflict (key, channel, locale) do nothing;

-- ── 4. Preferencias de la clienta ───────────────────────────────────────────────────────────
-- El canal preferido solo elige ENTRE los medios que la clienta tiene; los avisos del pedido (transaccionales) no se pueden apagar.
-- El consentimiento de marketing (BR-LEG-01) es aparte y arranca apagado; quién lo cambió y cuándo queda en la auditoría.
create table if not exists public.notification_preferences (
  profile_id           uuid primary key references public.profiles (id) on delete cascade,
  -- `audit_changes` toma el id del registro de la columna `id`: así la evidencia de consentimiento se busca por clienta.
  id                   uuid generated always as (profile_id) stored,
  preferred_channel    text not null default 'auto' check (preferred_channel in ('auto', 'email', 'whatsapp')),
  marketing_email      boolean not null default false,
  marketing_whatsapp   boolean not null default false,
  marketing_consent_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function public.notification_preferences_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.marketing_email or new.marketing_whatsapp)
     and (tg_op = 'INSERT' or not (old.marketing_email or old.marketing_whatsapp)) then
    new.marketing_consent_at := now();
  elsif not (new.marketing_email or new.marketing_whatsapp) then
    new.marketing_consent_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.notification_preferences_guard() from public, anon, authenticated;
drop trigger if exists notification_preferences_guard_trg on public.notification_preferences;
create trigger notification_preferences_guard_trg before insert or update on public.notification_preferences
  for each row execute function public.notification_preferences_guard();
drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
revoke insert, update, delete, truncate on public.notification_preferences from service_role;
grant select on public.notification_preferences to authenticated, service_role;
grant insert (profile_id, preferred_channel, marketing_email, marketing_whatsapp) on public.notification_preferences to authenticated;
grant update (preferred_channel, marketing_email, marketing_whatsapp) on public.notification_preferences to authenticated;
drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());
drop policy if exists notification_preferences_insert on public.notification_preferences;
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (profile_id = auth.uid());
drop policy if exists notification_preferences_update on public.notification_preferences;
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop trigger if exists audit_notification_preferences on public.notification_preferences;
create trigger audit_notification_preferences after insert or update on public.notification_preferences
  for each row execute function public.audit_changes();

-- ── 5. Ayudas puras ─────────────────────────────────────────────────────────────────────────
-- Espera antes del intento siguiente: base × 2^(intentos−1), con tope de 6 horas (21 600 s). Con base 60: 60, 120, 240, 480, 960…
create or replace function public.notification_backoff_seconds(p_attempts int, p_base int default 60)
returns int
language sql
immutable
set search_path = ''
as $$
  select least(greatest(coalesce(p_base, 60), 1)::numeric * power(2, greatest(coalesce(p_attempts, 1) - 1, 0)), 21600)::int
$$;

-- A qué canal y dirección se le escribe a una clienta: su preferencia (auto = correo si tiene, si no WhatsApp) entre los medios que
-- SÍ tiene. Sin filas = no se le puede avisar (cuenta desactivada o anonimizada, o sin ningún medio).
create or replace function public._notify_target(p_profile_id uuid)
returns table (channel text, recipient text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p record;
  v_pref text;
begin
  select pr.email, pr.phone_e164, pr.is_active, pr.anonymized_at into p from public.profiles pr where pr.id = p_profile_id;
  if not found or not p.is_active or p.anonymized_at is not null then
    return;
  end if;
  select np.preferred_channel into v_pref from public.notification_preferences np where np.profile_id = p_profile_id;
  v_pref := coalesce(v_pref, 'auto');
  if v_pref = 'whatsapp' and p.phone_e164 is not null then
    return query select 'whatsapp'::text, p.phone_e164;
  elsif p.email is not null then
    return query select 'email'::text, p.email;
  elsif p.phone_e164 is not null then
    return query select 'whatsapp'::text, p.phone_e164;
  end if;
end;
$$;

-- Correos de las alertas internas: los configurados o, si no hay, todos los administradores activos.
create or replace function public.alert_recipients()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(distinct lower(btrim(x)) order by lower(btrim(x)))
       from unnest(string_to_array(public.setting_text('alert_recipients', ''), ',')) x
      where btrim(x) <> ''),
    (select array_agg(distinct lower(p.email) order by lower(p.email))
       from public.profiles p where p.role = 'admin' and p.is_active and p.anonymized_at is null and p.email is not null),
    '{}'::text[])
$$;
revoke all on function public.alert_recipients() from public, anon, authenticated;
grant execute on function public.alert_recipients() to service_role;

-- Como enqueue_notification (idempotente por dedupe_key) pero con el pedido, la clienta y la hora más temprana de envío.
create or replace function public._enqueue_notification_ex(
  p_type text, p_channel text, p_recipient text, p_payload jsonb, p_dedupe_key text,
  p_order_id uuid default null, p_profile_id uuid default null, p_not_before timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  insert into public.notification_outbox (type, channel, recipient, payload, dedupe_key, order_id, profile_id, next_retry_at)
  values (p_type, p_channel, p_recipient, coalesce(p_payload, '{}'), p_dedupe_key, p_order_id, p_profile_id, coalesce(p_not_before, now()))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- ── 6. Los avisos del pedido, ahora por la preferencia de la clienta y con la espera del «deshacer» ───────────────
-- Misma firma y mismas claves que en S11 (los avisos de estado siguen siendo UNO por tipo y pedido). Cambia:
--  · la clienta recibe el aviso por el canal que prefiere entre los que tiene; una cuenta desactivada no recibe nada;
--  · los avisos de los pasos que un administrador puede deshacer (empacado, enviado, entregado, completado) esperan la ventana
--    `order_undo_window_minutes`: si se deshace el paso, el aviso se cancela y la clienta nunca lo ve (admin_undo_transition).
create or replace function public._order_notify(p_order_id uuid, p_type text, p_audience text,
                                                p_suffix text default '', p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_target record;
  v_payload jsonb;
  v_key text;
  v_when timestamptz := now();
begin
  begin
    select * into o from public.orders where id = p_order_id;
    if not found then
      return;
    end if;
    v_payload := jsonb_build_object('order_id', o.id, 'number', o.number, 'status', o.status, 'total', o.total,
                                    'currency', o.currency) || coalesce(p_extra, '{}'::jsonb);
    v_key := p_type || ':' || o.id::text || coalesce(nullif(p_suffix, ''), '');
    if p_type in ('order_packed', 'order_shipped', 'order_delivered', 'order_completed') then
      v_when := now() + make_interval(mins => public.setting_int('order_undo_window_minutes', 5));
    end if;
    if p_audience = 'customer' then
      -- Al correo o teléfono de la CUENTA, no al que se escribió en el formulario: ese valor no se verifica y cualquiera podría
      -- hacer que la tienda escribiera a un tercero («relevo» de avisos). El contacto del formulario es un dato del pedido.
      select * into v_target from public._notify_target(o.profile_id);
      if v_target.channel is not null then
        perform public._enqueue_notification_ex(p_type, v_target.channel, v_target.recipient, v_payload, v_key || ':c',
                                                o.id, o.profile_id, v_when);
      end if;
    else
      perform public._enqueue_notification_ex(p_type, 'email', null, v_payload, v_key || ':a', o.id, null, v_when);
    end if;
  exception when others then
    raise warning 'no se pudo encolar el aviso % del pedido %: %', p_type, p_order_id, sqlerrm;
  end;
end;
$$;

-- ── 7. El worker: tomar, cerrar y descartar ──────────────────────────────────────────────────
-- Orden de los pasos del flujo normal. «completado» vale como «entregado»: no son dos avisos distintos para decidir si uno quedó atrás.
create or replace function public._notification_status_rank(p_status text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_status when 'pending_payment' then 0 when 'paid' then 1 when 'preparing' then 2 when 'shipped' then 3
                       when 'delivered' then 4 when 'completed' then 4 else null end
$$;

-- ¿Este aviso ya no vale? Devuelve el motivo o NULL. Un aviso de estado anuncia UN estado: si el pedido ya va más adelante (pasos
-- rápidos seguidos) se consolida en el último; si volvió atrás (se deshizo el paso) o se canceló, el aviso viejo engañaría.
create or replace function public._notification_stale_reason(n public.notification_outbox)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_want text;
  v_cur text;
  v_wr int;
  v_cr int;
begin
  if n.profile_id is not null
     and not exists (select 1 from public.profiles p where p.id = n.profile_id and p.is_active and p.anonymized_at is null) then
    return 'account_inactive';
  end if;
  -- Un reenvío pedido por un administrador es una decisión explícita: solo cuenta que la cuenta siga activa.
  if coalesce((n.payload ->> 'resend')::boolean, false) then
    return null;
  end if;
  v_want := case n.type when 'order_confirmed' then 'paid' when 'order_packed' then 'preparing' when 'order_shipped' then 'shipped'
                        when 'order_delivered' then 'delivered' when 'order_completed' then 'completed'
                        when 'order_cancelled' then 'cancelled' when 'order_refunded' then 'refunded' else null end;
  if v_want is not null and n.order_id is not null then
    select o.status into v_cur from public.orders o where o.id = n.order_id;
    if v_cur is null then
      return 'order_missing';
    end if;
    if v_want in ('cancelled', 'refunded') then
      return case when v_cur in ('cancelled', 'refunded') then null else 'reverted' end;
    end if;
    if v_cur in ('cancelled', 'refunded') then
      return 'superseded';
    end if;
    v_wr := public._notification_status_rank(v_want);
    v_cr := public._notification_status_rank(v_cur);
    if v_cr > v_wr then
      return 'superseded';
    elsif v_cr < v_wr then
      return 'reverted';
    end if;
  elsif n.type = 'order_pending_reminder' and n.order_id is not null then
    if not exists (select 1 from public.orders o where o.id = n.order_id and o.status = 'pending_payment') then
      return 'order_resolved';
    end if;
  end if;
  return null;
end;
$$;

-- Cierra un intento. Resultados: sent · manual (WhatsApp: lo envía una persona) · failed (permanente) · cancelled · retry (transitorio:
-- vuelve a la cola con retroceso exponencial, o a «dead» si agotó los intentos y entonces avisa al administrador).
-- (Las firmas de S13 sin el texto enviado ni los canales se reemplazan: se borran las anteriores.)
drop function if exists public._notification_settle(bigint, text, text, text, text, int);
drop function if exists public.complete_notification(bigint, text, text, text, text, text, int);
drop function if exists public.claim_notifications(int, text, bigint[]);

create or replace function public._notification_settle(
  p_id bigint, p_outcome text, p_provider text, p_message_id text, p_error text, p_retry_after int,
  p_subject text default null, p_body text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.notification_outbox;
  v_max int := public.setting_int('notify_max_attempts', 8);
  v_base int := public.setting_int('notify_backoff_seconds', 60);
  v_err text := left(nullif(btrim(coalesce(p_error, '')), ''), 300);
  v_wait int;
begin
  select * into n from public.notification_outbox where id = p_id for update;
  if not found then
    return 'not_found';
  end if;
  if p_outcome = 'sent' then
    update public.notification_outbox
       set status = 'sent', sent_at = now(), provider = left(p_provider, 40), provider_message_id = left(p_message_id, 200),
           last_error = null, locked_at = null, locked_by = null,
           rendered_subject = left(p_subject, 300), rendered_body = left(p_body, 4000)
     where id = p_id;
    return 'sent';
  elsif p_outcome = 'manual' then
    update public.notification_outbox
       set status = 'manual', provider = 'whatsapp_manual', last_error = null, locked_at = null, locked_by = null,
           rendered_subject = left(p_subject, 300), rendered_body = left(p_body, 4000)
     where id = p_id;
    return 'manual';
  elsif p_outcome in ('failed', 'cancelled') then
    update public.notification_outbox
       set status = p_outcome, last_error = v_err, provider = coalesce(left(p_provider, 40), provider), locked_at = null, locked_by = null
     where id = p_id;
    return p_outcome;
  elsif p_outcome = 'retry' then
    if n.attempts >= v_max then
      update public.notification_outbox
         set status = 'dead', last_error = v_err, locked_at = null, locked_by = null
       where id = p_id;
      -- Un aviso interno que muere no avisa de sí mismo (sería un bucle): los administradores ya eran los destinatarios.
      if n.type not in ('notification_dead', 'template_fallback') then
        perform public._payment_alert('notification_dead',
          jsonb_build_object('notification_id', n.id, 'notification_type', n.type, 'channel', n.channel,
                             'attempts', n.attempts, 'error', left(coalesce(v_err, ''), 120)),
          'notification_dead:' || n.id::text);
      end if;
      return 'dead';
    end if;
    v_wait := case when p_retry_after is not null and p_retry_after > 0 then least(p_retry_after, 21600)
                   else public.notification_backoff_seconds(n.attempts, v_base) end;
    update public.notification_outbox
       set status = 'pending', last_error = v_err, next_retry_at = now() + make_interval(secs => v_wait),
           locked_at = null, locked_by = null
     where id = p_id;
    return 'retry';
  end if;
  raise exception 'resultado desconocido: %', p_outcome using errcode = '22023';
end;
$$;

-- Toma un lote para enviarlo: `FOR UPDATE SKIP LOCKED` (dos workers a la vez nunca toman el mismo aviso). Antes rescata los que
-- un worker caído dejó en «sending» y descarta los que ya no valen. `p_ids` limita el lote (pruebas y reenvíos puntuales) y
-- `p_channels` los canales que el worker PUEDE enviar ahora: sin proveedor de correo pide solo WhatsApp y los correos esperan en la
-- cola sin gastar intentos.
create or replace function public.claim_notifications(p_limit int, p_worker text, p_ids bigint[] default null,
                                                      p_channels text[] default null)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.notification_outbox;
  c public.notification_outbox;
  t record;
  v_reason text;
begin
  if coalesce(p_limit, 0) not between 1 and 200 then
    raise exception 'p_limit debe estar entre 1 y 200' using errcode = '22023';
  end if;
  if btrim(coalesce(p_worker, '')) = '' or char_length(p_worker) > 80 then
    raise exception 'p_worker inválido' using errcode = '22023';
  end if;
  if not public.setting_bool('notify_enabled', true) then
    return;
  end if;

  -- Un worker que murió a mitad de un envío deja su fila en «sending»: tras 5 minutos vuelve a la cola (ese intento ya se contó).
  for r in select * from public.notification_outbox n
            where n.status = 'sending' and n.locked_at < now() - interval '5 minutes' and (p_ids is null or n.id = any (p_ids))
            order by n.id for update skip locked loop
    perform public._notification_settle(r.id, 'retry', null, null, 'worker_lost', 1);
  end loop;

  for r in select * from public.notification_outbox n
            where n.status = 'pending' and n.next_retry_at <= now() and (p_ids is null or n.id = any (p_ids))
              and (p_channels is null or n.channel = any (p_channels))
            order by n.next_retry_at, n.id limit p_limit for update skip locked loop
    v_reason := public._notification_stale_reason(r);
    if v_reason is not null then
      update public.notification_outbox set status = 'cancelled', last_error = v_reason where id = r.id;
      continue;
    end if;
    -- El contacto VIGENTE manda: si la clienta cambió de correo, de teléfono o de canal preferido entre encolar y enviar.
    if r.profile_id is not null then
      select * into t from public._notify_target(r.profile_id);
      if t.channel is null then
        update public.notification_outbox set status = 'cancelled', last_error = 'account_inactive' where id = r.id;
        continue;
      end if;
      if (t.channel, t.recipient) is distinct from (r.channel, r.recipient) then
        update public.notification_outbox set channel = t.channel, recipient = t.recipient where id = r.id;
      end if;
    end if;
    update public.notification_outbox
       set status = 'sending', attempts = attempts + 1, locked_at = now(), locked_by = p_worker, last_error = null
     where id = r.id
    returning * into c;
    return next c;
  end loop;
  return;
end;
$$;

-- Lo llama el worker al terminar cada envío. Solo cuenta si la fila sigue siendo suya (un worker lento cuyo envío ya se rescató no
-- pisa el resultado del nuevo).
create or replace function public.complete_notification(
  p_id bigint, p_worker text, p_outcome text, p_provider text default null, p_message_id text default null,
  p_error text default null, p_retry_after_seconds int default null, p_subject text default null, p_body text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n record;
begin
  select o.id, o.status, o.locked_by into n from public.notification_outbox o where o.id = p_id for update;
  if not found then
    return 'not_found';
  end if;
  if n.status <> 'sending' or n.locked_by is distinct from p_worker then
    return 'lost';
  end if;
  return public._notification_settle(p_id, p_outcome, p_provider, p_message_id, p_error, p_retry_after_seconds, p_subject, p_body);
end;
$$;

-- ── 8. Lo que hace el administrador con el registro ─────────────────────────────────────────
create or replace function public.admin_notification_resend(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.notification_outbox;
  v_root bigint;
  v_base text;
  v_n int;
  v_new bigint;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into n from public.notification_outbox where id = p_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if n.status in ('pending', 'sending') then
    return jsonb_build_object('outcome', 'in_progress');
  end if;
  v_root := coalesce(n.resent_of, n.id);
  select o.dedupe_key into v_base from public.notification_outbox o where o.id = v_root;
  select count(*)::int + 1 into v_n from public.notification_outbox o where o.resent_of = v_root;
  insert into public.notification_outbox (type, channel, recipient, payload, dedupe_key, template, order_id, profile_id, resent_of, created_by)
  values (n.type, n.channel, n.recipient, n.payload || '{"resend": true}'::jsonb, v_base || ':r' || v_n::text, n.template,
          n.order_id, n.profile_id, v_root, auth.uid())
  returning id into v_new;
  return jsonb_build_object('outcome', 'queued', 'id', v_new);
end;
$$;

-- WhatsApp manual: la persona abrió el enlace wa.me y envió el mensaje; aquí queda constancia.
create or replace function public.admin_notification_mark_sent(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.notification_outbox;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into n from public.notification_outbox where id = p_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if n.status <> 'manual' then
    return jsonb_build_object('outcome', 'not_manual', 'status', n.status);
  end if;
  update public.notification_outbox
     set status = 'sent', sent_at = now(), provider = 'whatsapp_manual', sent_by = auth.uid(), last_error = null
   where id = p_id;
  return jsonb_build_object('outcome', 'sent');
end;
$$;

-- Descartar un aviso que todavía no salió (esperando, o WhatsApp por enviar a mano).
create or replace function public.admin_notification_cancel(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.notification_outbox;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into n from public.notification_outbox where id = p_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if n.status not in ('pending', 'manual') then
    return jsonb_build_object('outcome', 'not_cancellable', 'status', n.status);
  end if;
  update public.notification_outbox set status = 'cancelled', last_error = 'cancelled_by_admin', sent_by = auth.uid() where id = p_id;
  return jsonb_build_object('outcome', 'cancelled');
end;
$$;

create or replace function public.admin_notification_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(s.status, s.n)
                     from (select o.status, count(*)::int as n from public.notification_outbox o
                            where o.created_at > now() - interval '30 days' or o.status in ('pending', 'sending', 'manual', 'dead', 'failed')
                            group by o.status) s), '{}'::jsonb);
end;
$$;

-- ── 9. «Deshacer» ya no deja avisos engañosos ───────────────────────────────────────────────
-- Igual que en S12, y además: el aviso del paso que se deshace (que esperaba su ventana) se cancela y SU CLAVE QUEDA LIBRE, así
-- que si el paso se vuelve a dar, la clienta sí recibe su aviso.
create or replace function public.admin_undo_transition(p_order_id uuid, p_expected_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  h record;
  v_window int := public.setting_int('order_undo_window_minutes', 5);
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if p_expected_status is not null and o.status <> p_expected_status then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'current', o.status);
  end if;
  select * into h from public.order_status_history x where x.order_id = p_order_id order by x.id desc limit 1;
  if not found or h.to_status <> o.status or h.from_status is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_undoable');
  end if;
  -- Solo los pasos del flujo normal que no mueven stock, cupones ni dinero.
  if (h.from_status, h.to_status) not in (('paid', 'preparing'), ('preparing', 'shipped'), ('shipped', 'delivered'),
                                           ('delivered', 'completed')) then
    return jsonb_build_object('ok', false, 'outcome', 'not_undoable');
  end if;
  if h.actor_kind <> 'admin' or h.created_at < now() - make_interval(mins => v_window) then
    return jsonb_build_object('ok', false, 'outcome', 'window_expired', 'window_minutes', v_window);
  end if;
  -- Un cobro contra entrega ya registrado no se deshace con la entrega.
  if h.to_status in ('delivered', 'completed')
     and exists (select 1 from public.payments p where p.order_id = p_order_id and p.collected_at is not null) then
    return jsonb_build_object('ok', false, 'outcome', 'not_undoable');
  end if;
  perform set_config('app.order_transition', '1', true);
  update public.orders set status = h.from_status, updated_at = now() where id = p_order_id;
  perform set_config('app.order_transition', '', true);
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, reason)
  values (p_order_id, h.to_status, h.from_status, auth.uid(), 'admin', 'Deshacer: ' || h.from_status || ' → ' || h.to_status);
  update public.notification_outbox n
     set status = 'cancelled', last_error = 'reverted', dedupe_key = n.dedupe_key || ':reverted:' || n.id::text
   where n.order_id = p_order_id and n.status = 'pending'
     and n.type = case h.to_status when 'preparing' then 'order_packed' when 'shipped' then 'order_shipped'
                                   when 'delivered' then 'order_delivered' when 'completed' then 'order_completed' end;
  return jsonb_build_object('ok', true, 'outcome', 'undone', 'from', h.to_status, 'to', h.from_status);
end;
$$;

-- ── 10. Alertas nuevas y limpieza por cuenta ────────────────────────────────────────────────
-- Un aviso de pago con firma inválida: una alerta por proveedor y por hora (sin ruido si alguien insiste).
create or replace function public.webhook_events_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signature_valid is false then
    perform public._payment_alert('webhook_signature_invalid', jsonb_build_object('provider', left(new.provider, 40)),
      'webhook_signature_invalid:' || left(new.provider, 40) || ':' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24'));
  end if;
  return null;
exception when others then
  raise warning 'no se pudo encolar la alerta del aviso de pago %: %', new.id, sqlerrm;
  return null;
end;
$$;
revoke all on function public.webhook_events_alert() from public, anon, authenticated;
drop trigger if exists webhook_events_alert_trg on public.webhook_events;
create trigger webhook_events_alert_trg after insert on public.webhook_events
  for each row execute function public.webhook_events_alert();

-- Una cuenta desactivada o anonimizada deja de recibir avisos: lo pendiente se cancela y, al anonimizar, el destinatario se borra de
-- todo el registro (el contenido no lleva datos personales: solo número, estado y total del pedido).
create or replace function public.profiles_notification_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox set status = 'cancelled', last_error = 'account_inactive'
   where profile_id = new.id and status in ('pending', 'manual');
  if new.anonymized_at is not null and old.anonymized_at is null then
    update public.notification_outbox set recipient = '[anonimizado]' where profile_id = new.id and recipient is not null;
  end if;
  return null;
end;
$$;
revoke all on function public.profiles_notification_cleanup() from public, anon, authenticated;
drop trigger if exists profiles_notification_cleanup_trg on public.profiles;
create trigger profiles_notification_cleanup_trg after update of is_active, anonymized_at on public.profiles
  for each row when ((old.is_active and not new.is_active) or (old.anonymized_at is null and new.anonymized_at is not null))
  execute function public.profiles_notification_cleanup();

-- ── 11. El cron que despierta al worker ─────────────────────────────────────────────────────
-- Cada minuto llama a la Edge Function `notify-worker` (pg_net) SOLO si hay algo que enviar y si el dueño dejó en el Vault los dos
-- secretos: `notify_worker_url` (la URL de la función) y `notify_worker_key` (la clave de servicio). Sin ellos no hace nada: el
-- panel lo avisa (admin_notification_health) y los avisos esperan en la cola sin perderse.
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net no está disponible (%): el worker no se despertará solo hasta que se active la extensión', sqlerrm;
end;
$$;

create or replace function public.notify_worker_kick()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if not public.setting_bool('notify_enabled', true) then
    return 'disabled';
  end if;
  if not exists (select 1 from public.notification_outbox n where n.status = 'pending' and n.next_retry_at <= now()) then
    return 'idle';
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'notify_worker_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'notify_worker_key';
  if v_url is null or v_key is null then
    return 'not_configured';
  end if;
  perform net.http_post(url := v_url,
                        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
                        body := '{}'::jsonb, timeout_milliseconds := 20000);
  return 'called';
exception when others then
  raise warning 'notify_worker_kick: %', sqlerrm;
  return 'error';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'notify-worker';
    perform cron.schedule('notify-worker', '* * * * *', 'select public.notify_worker_kick()');
  else
    raise notice 'pg_cron no está disponible: los avisos no se enviarán solos';
  end if;
end;
$$;

-- Estado del envío para el panel: ¿por qué no salen los correos? (solo lectura; sin secretos)
create or replace function public.admin_notification_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_due int;
  v_oldest timestamptz;
  v_secrets int;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select count(*)::int, min(n.next_retry_at) into v_due, v_oldest
    from public.notification_outbox n where n.status = 'pending' and n.next_retry_at <= now();
  select count(*)::int into v_secrets from vault.decrypted_secrets s where s.name in ('notify_worker_url', 'notify_worker_key');
  return jsonb_build_object(
    'enabled', public.setting_bool('notify_enabled', true),
    'email_provider', public.setting_text('notify_email_provider', 'none'),
    'from_email_set', public.setting_text('notify_from_email', '') <> '',
    'whatsapp_mode', public.setting_text('notify_whatsapp_mode', 'manual'),
    'worker_configured', v_secrets = 2,
    'due', v_due,
    'oldest_due_minutes', case when v_oldest is null then null else greatest(0, floor(extract(epoch from now() - v_oldest) / 60))::int end,
    'last_sent_at', (select max(n.sent_at) from public.notification_outbox n where n.status = 'sent' and n.provider not in ('whatsapp_manual', 'sink')),
    'recipients', coalesce(array_length(public.alert_recipients(), 1), 0));
end;
$$;

-- ── 12. Permisos ────────────────────────────────────────────────────────────────────────────
-- Las funciones nuevas nacen ejecutables por todos (privilegios por omisión de Supabase): las internas se cierran aquí.
revoke all on function
  public.notification_backoff_seconds(int, int), public._notify_target(uuid),
  public._enqueue_notification_ex(text, text, text, jsonb, text, uuid, uuid, timestamptz),
  public._order_notify(uuid, text, text, text, jsonb), public._notification_status_rank(text),
  public._notification_stale_reason(public.notification_outbox),
  public._notification_settle(bigint, text, text, text, text, int, text, text),
  public.claim_notifications(int, text, bigint[], text[]),
  public.complete_notification(bigint, text, text, text, text, text, int, text, text),
  public.notify_worker_kick(), public.notification_template_validate(), public.notification_preferences_guard(),
  public.notification_outbox_link(), public.store_settings_validate_s13(), public.webhook_events_alert(),
  public.profiles_notification_cleanup(), public.alert_recipients(), public.setting_text(text, text)
  from public, anon, authenticated, service_role;
-- Solo el worker (Edge Function con la clave de servicio) toma y cierra envíos y lee los destinatarios de las alertas.
grant execute on function
  public.claim_notifications(int, text, bigint[], text[]),
  public.complete_notification(bigint, text, text, text, text, text, int, text, text),
  public.alert_recipients(), public.setting_text(text, text)
  to service_role;
-- El administrador, ya autenticado (is_admin() adentro, como el resto de admin_*).
revoke all on function
  public.admin_notification_resend(bigint), public.admin_notification_mark_sent(bigint), public.admin_notification_cancel(bigint),
  public.admin_notification_counts(), public.admin_notification_health()
  from public, anon, service_role;
grant execute on function
  public.admin_notification_resend(bigint), public.admin_notification_mark_sent(bigint), public.admin_notification_cancel(bigint),
  public.admin_notification_counts(), public.admin_notification_health()
  to authenticated;

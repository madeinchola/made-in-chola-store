-- Corrección de S6 · el conflicto de contacto NO puede usar 40001.
-- PostgREST trata 40001 (serialization_failure) como un fallo pasajero y REPITE la transacción sin límite. Como este
-- conflicto es permanente (el perfil ya cambió y `p_expect` no volverá a coincidir), cada choque dejaba una conexión en
-- un bucle eterno de miles de transacciones por segundo, cada una escrita en el log de Postgres: agotaba el presupuesto de
-- disco I/O, la CPU y la memoria. `PT409` hace que PostgREST responda HTTP 409 con ese mismo código y no reintente.
-- Reemplazar la función corta además los bucles que ya estén girando (su siguiente intento recibe PT409).
-- Mismo cuerpo, firma y permisos; la Edge Function `update-contact` pasa a reconocer `PT409` (desplegar justo después).
-- Rollback: no se recomienda (volver a 40001 reabre el bucle).

create or replace function public.change_profile_contact(
  p_id uuid, p_email text, p_phone text, p_expect jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  update public.profiles
     set email      = nullif(lower(btrim(coalesce(p_email, ''))), ''),
         phone_e164 = nullif(btrim(coalesce(p_phone, '')), '')
   where id = p_id and is_active and anonymized_at is null
     and (p_expect is null
          or (email is not distinct from (p_expect ->> 'email')
              and phone_e164 is not distinct from (p_expect ->> 'phone')));
  if not found then
    if exists (select 1 from public.profiles where id = p_id and is_active and anonymized_at is null) then
      raise exception 'Otro cambio de contacto ocurrió a la vez' using errcode = 'PT409';
    end if;
    raise exception 'Perfil no encontrado' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.change_profile_contact(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.change_profile_contact(uuid, text, text, jsonb) to service_role;

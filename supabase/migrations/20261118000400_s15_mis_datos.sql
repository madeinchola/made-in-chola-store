-- Sprint 15 · Fase B — Exportar los datos personales a solicitud de su dueña (BR-ACC-07, derecho de acceso).
--
-- `my_data_export()`: devuelve, en un solo JSON, TODO lo que la tienda guarda de la persona que la llama y que ella misma puede ver:
-- su perfil, sus direcciones y datos fiscales, sus pedidos (con sus líneas, cobros e historial de estados), lo que aceptó (versión y
-- fecha de cada texto legal, sin la huella de red), sus preferencias de avisos y sus reclamos. NUNCA devuelve lo del negocio: ni el costo
-- de los productos (`order_items.cost_unit`), ni las notas internas de los pedidos, ni la huella de red, ni nada de otras personas.
-- Solo para quien tiene sesión; el límite de la base (8 s por llamada) acota las cuentas con muchísimos pedidos.
--
-- Rollback: drop function public.my_data_export();
-- Idempotente: se puede reaplicar.

create or replace function public.my_data_export()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'login_required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'format_version', 1,
    'generated_at', now(),
    'profile', (select to_jsonb(p) - 'role' from public.profiles p where p.id = v_uid),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.addresses a where a.profile_id = v_uid), '[]'::jsonb),
    'tax_profiles', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.tax_profiles x where x.profile_id = v_uid), '[]'::jsonb),
    'notification_preferences', (select to_jsonb(n) - 'id' from public.notification_preferences n where n.profile_id = v_uid),
    'orders', coalesce((
      select jsonb_agg(
               (to_jsonb(o) - 'idempotency_key' - 'request_hash' - 'cart_id' - 'profile_id')
               || jsonb_build_object(
                    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'cost_unit' - 'order_id' order by i.line_no)
                                         from public.order_items i where i.order_id = o.id), '[]'::jsonb),
                    'payments', coalesce((select jsonb_agg(jsonb_build_object('method', pay.method, 'status', pay.status, 'amount', pay.amount,
                                                                              'currency', pay.currency, 'created_at', pay.created_at, 'paid_at', pay.paid_at)
                                                           order by pay.created_at)
                                            from public.payments pay where pay.order_id = o.id), '[]'::jsonb),
                    'status_history', coalesce((select jsonb_agg(jsonb_build_object('from', h.from_status, 'to', h.to_status, 'at', h.created_at)
                                                                 order by h.created_at, h.id)
                                                  from public.order_status_history h where h.order_id = o.id), '[]'::jsonb))
               order by o.created_at)
        from public.orders o where o.profile_id = v_uid), '[]'::jsonb),
    'legal_acceptances', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'version', l.version, 'context', l.context,
                                                                       'accepted_at', l.accepted_at, 'order_id', l.order_id)
                                                    order by l.accepted_at)
                                     from public.legal_acceptances l where l.profile_id = v_uid), '[]'::jsonb),
    'complaints', coalesce((select jsonb_agg(jsonb_build_object('number', c.number, 'kind', c.kind, 'status', c.status, 'detail', c.detail,
                                                                'response', c.response, 'created_at', c.created_at, 'answered_at', c.answered_at,
                                                                'order_number', c.order_number)
                                             order by c.created_at)
                              from public.complaints c where c.profile_id = v_uid), '[]'::jsonb));
end;
$$;

revoke all on function public.my_data_export() from public, anon, service_role;
grant execute on function public.my_data_export() to authenticated;

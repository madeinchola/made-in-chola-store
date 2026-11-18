-- Sprint 16 · Endurecimiento tras la auditoría de seguridad (2026-11-18)
--
-- La auditoría del catálogo de la nube (docs/seguridad.md) encontró que tres tablas que la clienta lee (SOLO sus filas, las
-- filtra la RLS) tenían el privilegio SELECT a nivel de TABLA: `profiles`, `orders` y `payments`. Eso tiene dos defectos:
--   1. Lee TODAS las columnas, incluidas tres que son internas y que ninguna pantalla usa:
--        · profiles.blacklisted   → la clienta veía si el negocio la marcó en la lista negra;
--        · orders.request_hash    → huella interna de la petición de pago (la usa la idempotencia, dentro de funciones);
--        · payments.collected_by  → identificador del administrador que cobró (el historial de estados ya oculta a propósito
--                                   quién hizo cada cambio: solo muestra `actor_kind`).
--   2. Una columna NUEVA nacía legible: el próximo sprint que añadiera algo interno a `orders` (p. ej. la facturación de S17)
--      lo habría expuesto sin que nadie lo decidiera. `order_items` y `order_status_history` ya concedían por columnas y no
--      tenían ese problema.
-- Aquí las tres pasan a conceder SELECT por columnas, con la lista de lo que la clienta SÍ ve. Quien añada una columna
-- después tiene que concederla a propósito (y la prueba 27_s16_auditoria_seguridad.test.sql lo hace fallar si no lo declara).
-- El panel de administración usa el mismo rol (`authenticated`) y pide siempre listas explícitas de columnas (comprobado en
-- src/), de modo que no pierde nada. Las funciones SECURITY DEFINER y las funciones de Edge (service_role) no se ven afectadas.
--
-- Lo demás de la auditoría no necesitó cambios en la base (ver docs/seguridad.md).

revoke select on public.profiles from authenticated;
grant select (id, full_name, email, phone_e164, role, is_active, anonymized_at, created_at, updated_at,
              preferred_locale, preferred_currency)
  on public.profiles to authenticated;

revoke select on public.orders from authenticated;
grant select (id, number, profile_id, cart_id, status, currency, base_currency, exchange_rate, country, subtotal,
              discount_total, shipping_cost, shipping_discount, total, tax_included, contact_name, contact_email,
              contact_phone, shipping_method, shipping_address, delivery_slot, tax_profile, payment_method,
              payment_provider, payment_expires_at, coupon_code, discounts, idempotency_key, created_at, updated_at,
              paid_at, cancelled_at, cancelled_by, cancel_reason, reminder_sent_at, channel, edited_at, edit_count)
  on public.orders to authenticated;

revoke select on public.payments from authenticated;
grant select (id, order_id, provider, method, status, amount, currency, provider_ref, created_at, updated_at, attempt,
              reference, external_id, expires_at, received_amount, paid_at, reminder_sent_at, collected_at)
  on public.payments to authenticated;

-- Sprint 8 · Envíos y entregas programadas: cotización por distancia, cobertura, reglas, franjas, cupos, RLS y permisos.
-- Los valores esperados de distancias y tarifas se calcularon APARTE con un script independiente (Haversine con R = 6371,0088 km,
-- factor de ruta 1,3, redondeos como PostgreSQL), no con el código bajo prueba. Nada de esto deja datos: todo se revierte.
begin;
select plan(243);

-- HERMÉTICO: parte de cero dentro de su transacción. (`audit_log` es inmutable y la nube ya tiene filas de otras corridas y del
-- seed: la auditoría se cuenta como DIFERENCIA respecto de este punto de partida.)
create temp table t_audit0 as
  select count(*)::int as n from public.audit_log where table_name = 'shipping_zones' and action = 'INSERT';
delete from public.delivery_bookings;
delete from public.delivery_slots;
delete from public.blocked_dates;
delete from public.shipping_rate_rules;
delete from public.shipping_zones;
delete from public.shipping_methods where code <> 'delivery';
delete from public.store_locations;
update public.store_settings set value = '130' where key = 'shipping_route_factor_pct';
update public.store_settings set value = '24'  where key = 'delivery_min_lead_hours';
update public.store_settings set value = '30'  where key = 'delivery_max_days_ahead';

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'ana@test.com',   '{"full_name":"Ana Pérez"}', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'admin@test.com', '{"full_name":"Admin Uno"}',  'authenticated', 'authenticated');
select public.set_user_role('cccccccc-0000-0000-0000-00000000000c', 'admin');

-- Origen (La Paz) y puntos de prueba. Distancias en línea recta (km) y «ruta» = recta × 1,3, calculadas aparte:
--   Pa (-16.52,-68.15)  2.223902 → 2.89     Pb (-16.55,-68.15)  5.559754 → 7.23     Pc (-16.60,-68.15) 11.119508 → 14.46
--   Pe (-16.50,-68.00) 15.992405 → 20.79    Pcoch (-17.3895,-66.1568) 233.945239 → 304.13
-- Con factor 1,0 la ruta es la recta: Pa 2.22 · Pb 5.56 · Pc 11.12 · Pe 15.99.
insert into public.store_locations (id, name, address_text, city, lat, lng, is_active)
values ('11111111-0000-0000-0000-000000000001', 'Taller', 'Calle Ejemplo 1', 'La Paz', -16.5, -68.15, true);
insert into public.store_locations (id, name, address_text, city, lat, lng) values
  ('11111111-0000-0000-0000-000000000002', 'Depósito', 'Av. 2', 'El Alto', -16.51, -68.2);

-- ═══ A. Utilidades puras ═══════════════════════════════════════════════════════════════════
select is(public.haversine_km(-16.5, -68.15, -16.52, -68.15), 2.223902, 'Haversine: 0,02° de latitud = 2,223902 km');
select is(public.haversine_km(-16.5, -68.15, -16.6, -68.15), 11.119508, 'Haversine: 0,1° de latitud = 11,119508 km');
select is(public.haversine_km(-16.5, -68.15, -16.5, -68.0), 15.992405, 'Haversine: 0,15° de longitud a -16,5° = 15,992405 km');
select is(public.haversine_km(-16.5, -68.15, -17.3895, -66.1568), 233.945239, 'Haversine: La Paz → Cochabamba (aprox.) = 233,945239 km');
select is(public.haversine_km(-16.5, -68.15, -16.5, -68.15), 0.000000, 'Haversine: el mismo punto = 0');
select is(public.haversine_km(-16.52, -68.15, -16.5, -68.15), public.haversine_km(-16.5, -68.15, -16.52, -68.15), 'Haversine es simétrica');
select is(public.haversine_km(0, 0, 0, 180), 20015.114442, 'Haversine: medio planeta por el ecuador = π × R = 20015,114442 km');
select is(public.haversine_km(null, 1, 2, 3), null, 'Haversine con un dato nulo → null');
select is(public.haversine_km('NaN', 1, 2, 3), null, 'Haversine con NaN → null (no excepción)');
select is(public._ship_norm('  CÓCHA   bamba  '), 'cocha bamba', 'ciudad normalizada: tildes, mayúsculas y espacios');
select is(public._ship_norm('   '), null, 'texto vacío → null');

-- Parámetros de reglas
select is(public._ship_params_valid('flat', '{"cost": 10}'), true, 'flat válida');
select is(public._ship_params_valid('flat', '{"cost": 0}'), true, 'flat con costo 0 (envío gratis) válida');
select is(public._ship_params_valid('flat', '{"cost": -1}'), false, 'flat con costo negativo → inválida');
select is(public._ship_params_valid('flat', '{"cost": "10"}'), false, 'flat con costo texto → inválida');
select is(public._ship_params_valid('flat', '{"cost": 10, "x": 1}'), false, 'flat con claves de más → inválida');
select is(public._ship_params_valid('flat', '[]'), false, 'params que no es un objeto → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":3,"cost":15},{"up_to_km":6,"cost":20}]}'), true, 'distance válida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":6,"cost":20},{"up_to_km":3,"cost":15}]}'), false, 'tramos desordenados → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":3,"cost":15},{"up_to_km":3,"cost":20}]}'), false, 'tramos con el mismo límite → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[]}'), false, 'sin tramos → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":0,"cost":5}]}'), false, 'tramo hasta 0 km → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":3,"cost":-5}]}'), false, 'tramo con costo negativo → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":3}]}'), false, 'tramo sin costo → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":3,"cost":15}],"min_cost":50,"max_cost":10}'), false, 'mínimo mayor que el máximo → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":3,"cost":15}],"extra_per_km":-1}'), false, 'costo por km adicional negativo → inválida');
select is(public._ship_params_valid('distance', '{"tiers":[{"up_to_km":3,"cost":15}],"bonus":1}'), false, 'distance con claves de más → inválida');
select is(public._ship_params_valid('distance', (select jsonb_build_object('tiers', jsonb_agg(jsonb_build_object('up_to_km', g, 'cost', 1)))
  from generate_series(1, 21) g)), false, '21 tramos (el máximo es 20) → inválida');
select is(public._ship_params_valid('weight', '{"cost": 1}'), false, 'un tipo desconocido → inválida (nunca lanza)');
select is(public._ship_params_valid('flat', null), false, 'params nulo → inválida');

-- ═══ B. Restricciones de las tablas ═════════════════════════════════════════════════════════
select throws_ok($$insert into public.store_locations (name, address_text, city, lat, lng) values ('X', 'y', 'z', 91, 0)$$, '23514', null, 'latitud fuera de rango');
select throws_ok($$insert into public.store_locations (name, address_text, city, lat, lng) values ('X', 'y', 'z', 0, 181)$$, '23514', null, 'longitud fuera de rango');
select throws_ok($$insert into public.store_locations (name, address_text, city, lat, lng, is_primary, is_active) values ('X', 'y', 'z', 0, 0, true, false)$$, '23514', null, 'el origen del cálculo no puede estar inactivo');
select lives_ok($$update public.store_locations set is_primary = true where id = '11111111-0000-0000-0000-000000000001'$$, 'se marca el origen del cálculo');
select throws_ok($$insert into public.store_locations (name, address_text, city, lat, lng, is_primary) values ('Otro', 'y', 'z', 0, 0, true)$$, '23505', null, 'solo puede haber UN origen principal');
select throws_ok($$insert into public.shipping_methods (code, name, kind) values ('Mal Código', 'X', 'delivery')$$, '23514', null, 'el código del método es minúsculas y guion bajo');
select throws_ok($$insert into public.shipping_methods (code, name, kind) values ('recojo', 'Recojo', 'pickup')$$, '23514', null, 'un recojo exige su ubicación');
select throws_ok($$insert into public.shipping_methods (code, name, kind, pickup_location_id) values ('dom2', 'D2', 'delivery', '11111111-0000-0000-0000-000000000001')$$, '23514', null, 'un domicilio no lleva ubicación de recojo');
select throws_ok($$insert into public.shipping_methods (code, name, kind, eta_min_days, eta_max_days) values ('dom3', 'D3', 'delivery', 5, 2)$$, '23514', null, 'ETA con mínimo mayor que el máximo');
select throws_ok($$insert into public.shipping_zones (name, kind, cities) values ('Z', 'city', '{}')$$, '23514', null, 'una zona de ciudades no puede estar vacía');
select throws_ok($$insert into public.shipping_zones (name, kind, cities, radius_km) values ('Z', 'city', array['a'], 5)$$, '23514', null, 'una zona de ciudades no lleva radio');
select throws_ok($$insert into public.shipping_zones (name, kind, center_lat, center_lng) values ('Z', 'radius', 0, 0)$$, '23514', null, 'una zona de radio exige el radio');
select throws_ok($$insert into public.shipping_zones (name, kind, center_lat, center_lng, radius_km) values ('Z', 'radius', 0, 0, 0)$$, '23514', null, 'el radio debe ser mayor que 0');
select throws_ok($$insert into public.shipping_rate_rules (method_id, name, kind, params) select id, 'R', 'flat', '{"cost": -3}' from public.shipping_methods where code = 'delivery'$$, '23514', null, 'una regla con parámetros inválidos se rechaza');
select throws_ok($$insert into public.shipping_rate_rules (method_id, name, kind, params, min_order_amount, max_order_amount) select id, 'R', 'flat', '{"cost": 3}', 100, 50 from public.shipping_methods where code = 'delivery'$$, '23514', null, 'rango de monto con mínimo mayor que el máximo');
select throws_ok($$insert into public.shipping_rate_rules (method_id, name, kind, params, valid_from, valid_until) select id, 'R', 'flat', '{"cost": 3}', now(), now() - interval '1 day' from public.shipping_methods where code = 'delivery'$$, '23514', null, 'vigencia que termina antes de empezar');
select throws_ok($$insert into public.delivery_slots (method_id, weekday, start_time, end_time, capacity) select id, 8, '10:00', '12:00', 1 from public.shipping_methods where code = 'delivery'$$, '23514', null, 'día de la semana 8 no existe');
select throws_ok($$insert into public.delivery_slots (method_id, weekday, start_time, end_time, capacity) select id, 1, '12:00', '10:00', 1 from public.shipping_methods where code = 'delivery'$$, '23514', null, 'la franja termina antes de empezar');
select throws_ok($$insert into public.delivery_slots (method_id, weekday, start_time, end_time, capacity) select id, 1, '10:00', '12:00', 0 from public.shipping_methods where code = 'delivery'$$, '23514', null, 'cupo 0 no es válido');

-- ═══ C. Ajustes: rangos ═════════════════════════════════════════════════════════════════════
select throws_ok($$update public.store_settings set value = '99' where key = 'shipping_route_factor_pct'$$, '22023', null, 'factor de ruta menor que 100 % → rechazado');
select throws_ok($$update public.store_settings set value = '301' where key = 'shipping_route_factor_pct'$$, '22023', null, 'factor de ruta mayor que 300 % → rechazado');
select lives_ok($$update public.store_settings set value = '100' where key = 'shipping_route_factor_pct'$$, 'factor 100 % es válido (la ruta es la recta)');
select throws_ok($$update public.store_settings set value = '721' where key = 'delivery_min_lead_hours'$$, '22023', null, 'antelación mayor que 720 h → rechazada');
select throws_ok($$update public.store_settings set value = '0' where key = 'delivery_max_days_ahead'$$, '22023', null, 'tope de días 0 → rechazado');
select throws_ok($$update public.store_settings set value = '181' where key = 'delivery_max_days_ahead'$$, '22023', null, 'tope de días 181 → rechazado');
update public.store_settings set value = '130' where key = 'shipping_route_factor_pct';

-- ═══ D. Cotización: errores de configuración (nunca un costo 0 en silencio) ═════════════════
select is((public.quote_shipping('no_existe') -> 'errors' -> 0 ->> 'code'), 'method_not_found', 'método inexistente');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 0, 'XYZ') -> 'errors' -> 0 ->> 'code'), 'currency_unsupported', 'moneda no habilitada');
insert into public.currencies (code, name, symbol, decimals, enabled) values ('ZZZ', 'Moneda de prueba', 'Z', 2, false);
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 0, 'ZZZ') -> 'errors' -> 0 ->> 'code'), 'currency_unsupported', 'una moneda que EXISTE pero está deshabilitada tampoco se acepta');
delete from public.currencies where code = 'ZZZ';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', -1) -> 'errors' -> 0 ->> 'code'), 'invalid_order_amount', 'monto negativo');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 'NaN') -> 'errors' -> 0 ->> 'code'), 'invalid_order_amount', 'monto NaN');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz') -> 'errors' -> 0 ->> 'code'), 'coverage_not_configured', 'sin zonas permitidas: se rechaza (no se vende a todo el país por omisión)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz') -> 'cost'), 'null'::jsonb, '…y el costo es null, NUNCA 0');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz') ->> 'ok')::boolean, false, '…y ok es false');

-- Zonas: A = radio 25 km alrededor del origen; B = lista blanca de ciudades; C = ciudad BLOQUEADA
insert into public.shipping_zones (id, name, kind, center_lat, center_lng, radius_km, allowed) values
  ('22222222-0000-0000-0000-00000000000a', 'Cerca del taller', 'radius', -16.5, -68.15, 25, true);
insert into public.shipping_zones (id, name, kind, cities, allowed) values
  ('22222222-0000-0000-0000-00000000000b', 'Otras ciudades', 'city', array['Cochabamba', 'Santa Cruz de la Sierra'], true),
  ('22222222-0000-0000-0000-00000000000c', 'Sin servicio', 'city', array['Pueblo Chico'], false);

select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz') -> 'errors' -> 0 ->> 'code'), 'no_rate', 'con cobertura pero sin ninguna regla de tarifa: «no_rate», no un costo 0');

-- Reglas: R1 por distancia (zona A), R2 plana de 80 (zona B), R3 plana de 10 con monto ≥ 500 (zona A, más prioridad)
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority)
select '33333333-0000-0000-0000-000000000001', m.id, '22222222-0000-0000-0000-00000000000a', 'Tramos ciudad base', 'distance',
       '{"tiers":[{"up_to_km":3,"cost":15},{"up_to_km":6,"cost":20},{"up_to_km":10,"cost":30}],"extra_per_km":3,"min_cost":15,"max_cost":60}', 100
  from public.shipping_methods m where m.code = 'delivery';
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority)
select '33333333-0000-0000-0000-000000000002', m.id, '22222222-0000-0000-0000-00000000000b', 'Otras ciudades (courier)', 'flat', '{"cost": 80}', 50
  from public.shipping_methods m where m.code = 'delivery';
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority, min_order_amount)
select '33333333-0000-0000-0000-000000000003', m.id, '22222222-0000-0000-0000-00000000000a', 'Promo monto alto', 'flat', '{"cost": 10}', 200, 500
  from public.shipping_methods m where m.code = 'delivery';

-- Tramos de R1 con factor 1,3 (calculados aparte)
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 15.00, 'Pa: ruta 2,89 km → tramo «hasta 3 km» = 15,00');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'distance_km')::numeric, 2.89, '…y la distancia de ruta es 2,89');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'breakdown' -> 'rule' ->> 'name'), 'Tramos ciudad base', '…y dice QUÉ regla aplicó');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'breakdown' ->> 'tier')::int, 1, '…y el tramo (1)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'breakdown' ->> 'straight_km')::numeric, 2.22, '…y la distancia en línea recta (2,22)');
select is((public.quote_shipping('delivery', -16.55, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 30.00, 'Pb: ruta 7,23 km → tramo «hasta 10 km» = 30,00');
select is((public.quote_shipping('delivery', -16.55, -68.15, 'La Paz', 100) -> 'breakdown' ->> 'tier')::int, 3, '…tramo 3');
select is((public.quote_shipping('delivery', -16.6, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 43.37, 'Pc: ruta 14,46 km → pasa el último tramo: 30 + 4,4554 km × 3 = 43,37');
select is((public.quote_shipping('delivery', -16.6, -68.15, 'La Paz', 100) -> 'breakdown' ->> 'extra_km')::numeric, 4.46, '…con 4,46 km adicionales');
select is((public.quote_shipping('delivery', -16.6, -68.15, 'La Paz', 100) -> 'breakdown' ->> 'tier'), null, '…y sin tramo');
select is((public.quote_shipping('delivery', -16.5, -68.0, 'El Alto', 100) ->> 'cost')::numeric, 60.00, 'Pe: ruta 20,79 km → 30 + 10,79 × 3 = 62,37, pero el MÁXIMO es 60,00');
select is((public.quote_shipping('delivery', -16.5, -68.0, 'El Alto', 100) -> 'breakdown' ->> 'max_applied')::boolean, true, '…y avisa que se aplicó el máximo');
select is((public.quote_shipping('delivery', -16.5, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 15.00, 'distancia 0 (el mismo punto): tramo 1 = 15,00');
select is((public.quote_shipping('delivery', -17.3895, -66.1568, ' CÓCHABAMBA ', 100) ->> 'cost')::numeric, 80.00, 'Cochabamba (zona de ciudades, fuera del radio): regla plana de 80, ciudad normalizada');
select is((public.quote_shipping('delivery', -17.3895, -66.1568, 'Cochabamba', 100) -> 'breakdown' -> 'rule' ->> 'name'), 'Otras ciudades (courier)', '…y la regla que aplicó');
select is((public.quote_shipping('delivery', -17.3895, -66.1568, 'Cochabamba', 100) ->> 'distance_km')::numeric, 304.13, '…con su distancia de ruta (304,13)');

-- Cobertura
select is((public.quote_shipping('delivery', -17.3895, -66.1568, 'Oruro', 100) -> 'errors' -> 0 ->> 'code'), 'out_of_coverage', 'una ciudad que no está en ninguna zona permitida ni dentro del radio → out_of_coverage');
select is((public.quote_shipping('delivery', -17.3895, -66.1568, null, 100) -> 'errors' -> 0 ->> 'code'), 'out_of_coverage', 'sin ciudad, una zona de ciudades no cubre: out_of_coverage');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'Pueblo Chico', 100) -> 'errors' -> 0 ->> 'code'), 'blocked_zone', 'una zona BLOQUEADA gana aunque el punto esté dentro del radio permitido');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'pueblo   CHICO', 100) -> 'errors' -> 0 ->> 'code'), 'blocked_zone', '…también con la ciudad escrita distinto (normalizada)');
select is((public.quote_shipping('delivery', -12.0, -77.0, 'Lima', 100) -> 'errors' -> 0 ->> 'code'), 'out_of_coverage', 'otro país (1076 km): fuera de cobertura');
-- Una zona de RADIO bloqueada (1 km alrededor de Pa): bloquea dentro de su radio y no afecta fuera de él (Pb está a 3,34 km).
insert into public.shipping_zones (id, name, kind, center_lat, center_lng, radius_km, allowed) values
  ('22222222-0000-0000-0000-00000000000d', 'Cerco vedado', 'radius', -16.52, -68.15, 1, false);
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'errors' -> 0 ->> 'code'), 'blocked_zone', 'una zona de RADIO bloqueada bloquea el punto que cae dentro');
select is((public.quote_shipping('delivery', -16.55, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 30.00, '…y un punto fuera de ese radio sigue cubierto y se cotiza (30,00)');
delete from public.shipping_zones where id = '22222222-0000-0000-0000-00000000000d';
-- BORDE del radio: el punto (-16.518526, -68.15) está a EXACTAMENTE 2,060000 km del origen (calculado aparte); con un radio de
-- 2,06 km queda justo en el límite, que cuenta como DENTRO (inclusivo); un millonésimo de grado más lejos (2,060111 km) ya no.
select is(public.haversine_km(-16.5, -68.15, -16.518526, -68.15), 2.060000, 'Haversine: el punto de borde está a exactamente 2,06 km del origen');
insert into public.shipping_zones (id, name, kind, center_lat, center_lng, radius_km, allowed) values
  ('22222222-0000-0000-0000-00000000000e', 'Borde bloqueado', 'radius', -16.5, -68.15, 2.06, false);
select is((public.quote_shipping('delivery', -16.518526, -68.15, 'La Paz', 100) -> 'errors' -> 0 ->> 'code'), 'blocked_zone', 'BORDE: justo a la distancia del radio de una zona bloqueada = bloqueado (inclusivo)');
select is((public.quote_shipping('delivery', -16.518527, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 15.00, '…y un poco más lejos ya no está bloqueado (se cotiza: 15,00)');
delete from public.shipping_zones where id = '22222222-0000-0000-0000-00000000000e';
update public.shipping_zones set archived_at = now() where id = '22222222-0000-0000-0000-00000000000a';
insert into public.shipping_zones (id, name, kind, center_lat, center_lng, radius_km, allowed) values
  ('22222222-0000-0000-0000-00000000000f', 'Borde permitido', 'radius', -16.5, -68.15, 2.06, true);
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority)
select '33333333-0000-0000-0000-000000000007', m.id, '22222222-0000-0000-0000-00000000000f', 'Borde', 'flat', '{"cost": 9}', 100
  from public.shipping_methods m where m.code = 'delivery';
select is((public.quote_shipping('delivery', -16.518526, -68.15, null, 100) ->> 'cost')::numeric, 9.00, 'BORDE: justo a la distancia del radio de una zona PERMITIDA = cubierto (inclusivo)');
select is((public.quote_shipping('delivery', -16.518527, -68.15, null, 100) -> 'errors' -> 0 ->> 'code'), 'out_of_coverage', '…y un poco más allá del radio queda fuera de cobertura');
delete from public.shipping_rate_rules where id = '33333333-0000-0000-0000-000000000007';
delete from public.shipping_zones where id = '22222222-0000-0000-0000-00000000000f';
update public.shipping_zones set archived_at = null where id = '22222222-0000-0000-0000-00000000000a';

-- Ubicación y datos inválidos
select is((public.quote_shipping('delivery', null, null, 'La Paz') -> 'errors' -> 0 ->> 'code'), 'location_required', 'sin pin: location_required');
select is((public.quote_shipping('delivery', -16.52, null, 'La Paz') -> 'errors' -> 0 ->> 'code'), 'location_required', 'con solo la latitud: location_required');
select is((public.quote_shipping('delivery', 91, 0) -> 'errors' -> 0 ->> 'code'), 'invalid_coordinates', 'latitud 91 → invalid_coordinates');
select is((public.quote_shipping('delivery', -91, 0) -> 'errors' -> 0 ->> 'code'), 'invalid_coordinates', 'latitud -91');
select is((public.quote_shipping('delivery', 0, 181) -> 'errors' -> 0 ->> 'code'), 'invalid_coordinates', 'longitud 181');
select is((public.quote_shipping('delivery', 'NaN', 0) -> 'errors' -> 0 ->> 'code'), 'invalid_coordinates', 'latitud NaN');
select is((public.quote_shipping('delivery', 0, 'Infinity') -> 'errors' -> 0 ->> 'code'), 'invalid_coordinates', 'longitud infinita');

-- Prioridad, monto, vigencia y reglas inactivas
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 600) ->> 'cost')::numeric, 10.00, 'monto 600 ≥ 500: gana la regla de mayor prioridad (promo = 10,00)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 500) ->> 'cost')::numeric, 10.00, '…el monto exacto 500 TAMBIÉN cumple (≥)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 499.99) ->> 'cost')::numeric, 15.00, '…499,99 ya no: vuelve la tarifa por distancia');
update public.shipping_rate_rules set is_active = false where id = '33333333-0000-0000-0000-000000000003';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 600) ->> 'cost')::numeric, 15.00, 'una regla inactiva no cuenta');
update public.shipping_rate_rules set is_active = true, valid_until = now() - interval '1 second' where id = '33333333-0000-0000-0000-000000000003';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 600) ->> 'cost')::numeric, 15.00, 'una regla vencida no cuenta');
update public.shipping_rate_rules set valid_until = null, valid_from = now() + interval '1 hour' where id = '33333333-0000-0000-0000-000000000003';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 600) ->> 'cost')::numeric, 15.00, 'una regla que aún no empieza no cuenta');
update public.shipping_rate_rules set valid_from = null, archived_at = now() where id = '33333333-0000-0000-0000-000000000003';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 600) ->> 'cost')::numeric, 15.00, 'una regla archivada no cuenta');
update public.shipping_rate_rules set archived_at = null where id = '33333333-0000-0000-0000-000000000003';
-- A igualdad de prioridad gana la regla CON zona sobre la que no la tiene.
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority)
select '33333333-0000-0000-0000-000000000004', m.id, null, 'Tarifa general', 'flat', '{"cost": 99}', 100 from public.shipping_methods m where m.code = 'delivery';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 15.00, 'misma prioridad: gana la regla que tiene zona');
update public.shipping_rate_rules set priority = 101 where id = '33333333-0000-0000-0000-000000000004';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 99.00, 'más prioridad que la de zona: gana la general');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'breakdown' -> 'rule' ->> 'name'), 'Tarifa general', '…y el desglose lo dice');
delete from public.shipping_rate_rules where id = '33333333-0000-0000-0000-000000000004';
-- Una regla por distancia que no llega (sin km adicional) cede el paso a la siguiente.
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority)
select '33333333-0000-0000-0000-000000000005', m.id, null, 'Solo cerca', 'distance', '{"tiers":[{"up_to_km":1,"cost":5}]}', 300 from public.shipping_methods m where m.code = 'delivery';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 15.00, 'una regla de distancia que NO alcanza (ruta 2,89 > 1 km, sin km adicional) cede a la siguiente');
delete from public.shipping_rate_rules where id = '33333333-0000-0000-0000-000000000005';
-- Monto máximo INCLUSIVO: una regla «hasta 100» aplica con 100 exactos y no con 100,01.
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority, max_order_amount)
select '33333333-0000-0000-0000-000000000006', m.id, null, 'Pedido chico', 'flat', '{"cost": 7}', 300, 100 from public.shipping_methods m where m.code = 'delivery';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 7.00, 'monto máximo INCLUSIVO: con 100 exactos aplica la regla «hasta 100»');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100.01) ->> 'cost')::numeric, 15.00, '…con 100,01 ya no: vuelve la tarifa por distancia');
delete from public.shipping_rate_rules where id = '33333333-0000-0000-0000-000000000006';

-- Factor de ruta (ajuste) y borde inclusivo
update public.store_settings set value = '100' where key = 'shipping_route_factor_pct';
select is((public.quote_shipping('delivery', -16.55, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 20.00, 'factor 100: Pb ruta = 5,56 km → tramo «hasta 6 km» = 20,00');
select is((public.quote_shipping('delivery', -16.5, -68.0, 'El Alto', 100) ->> 'cost')::numeric, 47.98, 'factor 100: Pe 15,99 km → 30 + 5,992405 × 3 = 47,98 (sin máximo)');
select is((public.quote_shipping('delivery', -16.5, -68.0, 'El Alto', 100) -> 'breakdown' ->> 'max_applied')::boolean, false, '…y no se aplicó el máximo');
-- El borde: el tramo termina EXACTAMENTE en la ruta del punto → pertenece a ese tramo; un poco menos, al siguiente.
update public.shipping_rate_rules set params = '{"tiers":[{"up_to_km":5.559754,"cost":11},{"up_to_km":10,"cost":22}]}' where id = '33333333-0000-0000-0000-000000000001';
select is((public.quote_shipping('delivery', -16.55, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 11.00, 'BORDE: ruta 5,559754 con un tramo «hasta 5,559754» → pertenece a ese tramo (inclusivo)');
update public.shipping_rate_rules set params = '{"tiers":[{"up_to_km":5.559753,"cost":11},{"up_to_km":10,"cost":22}]}' where id = '33333333-0000-0000-0000-000000000001';
select is((public.quote_shipping('delivery', -16.55, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 22.00, 'BORDE: un millonésimo de km menos en el tramo → pasa al siguiente (22,00)');
update public.shipping_rate_rules set params = '{"tiers":[{"up_to_km":3,"cost":15},{"up_to_km":6,"cost":20},{"up_to_km":10,"cost":30}],"extra_per_km":3,"min_cost":15,"max_cost":60}'
  where id = '33333333-0000-0000-0000-000000000001';
update public.store_settings set value = '130' where key = 'shipping_route_factor_pct';

-- Mínimo
update public.shipping_rate_rules set params = '{"tiers":[{"up_to_km":3,"cost":5}],"min_cost":12}' where id = '33333333-0000-0000-0000-000000000001';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 12.00, 'el MÍNIMO sube un tramo barato (5 → 12,00)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'breakdown' ->> 'min_applied')::boolean, true, '…y avisa que se aplicó el mínimo');
update public.shipping_rate_rules set params = '{"tiers":[{"up_to_km":3,"cost":15},{"up_to_km":6,"cost":20},{"up_to_km":10,"cost":30}],"extra_per_km":3,"min_cost":15,"max_cost":60}'
  where id = '33333333-0000-0000-0000-000000000001';

-- Redondeo a los decimales de la moneda (BOB = 2): 1,005 → 1,01 (mitad hacia arriba)
update public.shipping_rate_rules set params = '{"cost": 1.005}', zone_id = null, kind = 'flat' where id = '33333333-0000-0000-0000-000000000001';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 1.01, 'el costo se redondea a 2 decimales (1,005 → 1,01)');
update public.shipping_rate_rules set kind = 'distance', zone_id = '22222222-0000-0000-0000-00000000000a',
  params = '{"tiers":[{"up_to_km":3,"cost":15},{"up_to_km":6,"cost":20},{"up_to_km":10,"cost":30}],"extra_per_km":3,"min_cost":15,"max_cost":60}'
  where id = '33333333-0000-0000-0000-000000000001';

-- Zonas inactivas / archivadas
update public.shipping_zones set is_active = false where id = '22222222-0000-0000-0000-00000000000c';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'Pueblo Chico', 100) ->> 'cost')::numeric, 15.00, 'una zona bloqueada INACTIVA ya no bloquea');
update public.shipping_zones set is_active = true where id = '22222222-0000-0000-0000-00000000000c';
update public.shipping_zones set archived_at = now() where id = '22222222-0000-0000-0000-00000000000a';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'errors' -> 0 ->> 'code'), 'out_of_coverage', 'sin la zona de radio (archivada), La Paz queda fuera de cobertura');
update public.shipping_zones set archived_at = null where id = '22222222-0000-0000-0000-00000000000a';

-- Origen, método inactivo y recojo
update public.store_locations set is_primary = false where id = '11111111-0000-0000-0000-000000000001';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'errors' -> 0 ->> 'code'), 'no_origin', 'sin origen principal: no_origin');
update public.store_locations set is_primary = true where id = '11111111-0000-0000-0000-000000000001';
update public.shipping_methods set is_active = false where code = 'delivery';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'errors' -> 0 ->> 'code'), 'method_inactive', 'método inactivo');
update public.shipping_methods set is_active = true where code = 'delivery';
insert into public.shipping_methods (code, name, kind, pickup_location_id, eta_min_days, eta_max_days)
values ('recojo', 'Recojo en tienda', 'pickup', '11111111-0000-0000-0000-000000000001', 0, 1);
select is((public.quote_shipping('recojo') ->> 'cost')::numeric, 0.00, 'recojo en tienda: costo 0 sin dirección');
select is((public.quote_shipping('recojo') ->> 'ok')::boolean, true, '…y ok');
select is((public.quote_shipping('recojo') -> 'pickup' ->> 'name'), 'Taller', '…y trae la ubicación de recojo');
insert into public.shipping_methods (code, name, kind, pickup_location_id) values ('recojo2', 'Recojo en el depósito', 'pickup', '11111111-0000-0000-0000-000000000002');
select is((public.quote_shipping('recojo2') ->> 'ok')::boolean, true, 'un recojo cuya ubicación está activa funciona');
update public.store_locations set is_active = false where id = '11111111-0000-0000-0000-000000000002';
select is((public.quote_shipping('recojo2') -> 'errors' -> 0 ->> 'code'), 'no_origin', 'un recojo cuya ubicación está INACTIVA no se ofrece (no_origin)');
update public.store_locations set is_active = true where id = '11111111-0000-0000-0000-000000000002';
delete from public.shipping_methods where code = 'recojo2';
select is((select count(*)::int from public.shipping_methods where code = 'recojo' and kind = 'pickup'), 1, 'el recojo existe como método');
delete from public.shipping_methods where code = 'recojo';

-- ═══ E. Invariantes (fuzz determinista): nunca excepción, nunca costo negativo, ok ⇔ costo ═════
select setseed(0.42);
select is((select count(*)::int from (
    select public.quote_shipping('delivery',
             case when i % 9 = 0 then null else round((random() * 200 - 100)::numeric, 6) end,
             case when i % 11 = 0 then null else round((random() * 400 - 200)::numeric, 6) end,
             case when i % 3 = 0 then 'La Paz' when i % 3 = 1 then 'Cochabamba' else null end,
             case when i % 7 = 0 then -5 else round((random() * 2000)::numeric, 2) end) as q
      from generate_series(1, 1500) i) f
   where ((q ->> 'ok')::boolean and ((q ->> 'cost') is null or (q ->> 'cost')::numeric < 0))
      or (not (q ->> 'ok')::boolean and (q -> 'cost') <> 'null'::jsonb)
      or q -> 'errors' is null), 0,
  '1500 consultas con coordenadas al azar (también fuera de rango y nulas): nunca excepción, ok ⇒ costo ≥ 0, no ok ⇒ costo null');
select is((select count(*)::int from (select public.quote_shipping('delivery', x, y, 'La Paz', 100) as q
    from (values (-90::numeric, -180::numeric), (90, 180), (-90, 180), (90, -180), (0, 0), (0.000001, 0.000001)) v(x, y)) f
   where q ->> 'ok' is null), 0, 'los extremos del planeta no rompen la cotización');

-- Tercer desempate: a igualdad de prioridad y de zona, gana la regla de MENOR id (resultado estable, no «el azar del plan»).
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority)
select x.id::uuid, m.id, null, x.name, 'flat', x.params::jsonb, 400
  from public.shipping_methods m,
       (values ('33333333-0000-0000-0000-000000000009', 'Empate B', '{"cost": 12}'),
               ('33333333-0000-0000-0000-000000000008', 'Empate A', '{"cost": 11}')) as x(id, name, params)
 where m.code = 'delivery';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'breakdown' -> 'rule' ->> 'name'), 'Empate A', 'empate total: gana la regla de menor id (…08, aunque se insertó después)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 11.00, '…y su costo es el que se cobra');
delete from public.shipping_rate_rules where id in ('33333333-0000-0000-0000-000000000008', '33333333-0000-0000-0000-000000000009');
-- «Envío gratis sobre un monto» (BR-PRC-07) es solo una regla plana de costo 0 con monto mínimo: un 0 EXPLÍCITO es válido.
insert into public.shipping_rate_rules (id, method_id, zone_id, name, kind, params, priority, min_order_amount)
select '33333333-0000-0000-0000-00000000000a', m.id, null, 'Gratis desde 200', 'flat', '{"cost": 0}', 500, 200 from public.shipping_methods m where m.code = 'delivery';
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 250) ->> 'cost')::numeric, 0.00, 'regla plana de costo 0 desde 200: con 250 el envío es gratis (0,00 explícito)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 250) ->> 'ok')::boolean, true, '…y la cotización es ok');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 200) ->> 'cost')::numeric, 0.00, '…el monto mínimo es inclusivo (200 exactos: gratis)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 199.99) ->> 'cost')::numeric, 15.00, '…y con 199,99 vuelve la tarifa por distancia');
delete from public.shipping_rate_rules where id = '33333333-0000-0000-0000-00000000000a';
-- ═══ F. Franjas, fechas bloqueadas, antelación y tope ══════════════════════════════════════
-- Hoy en La Paz y los días de la semana relativos (ISO). Con antelación 24 h:
--   S1: día de (hoy+1) 00:00–01:00 → ese día queda «demasiado pronto» (siempre: empieza a medianoche) pero SÍ sale 7 días después
--   S2: día de (hoy+2) 10:00–12:00, cupo 2 · S3: día de (hoy+3) 14:00–16:00, cupo 1
create temp table t_day as select (now() at time zone 'America/La_Paz')::date as today;
insert into public.delivery_slots (id, method_id, weekday, start_time, end_time, capacity)
select '44444444-0000-0000-0000-000000000001', m.id, extract(isodow from (select today + 1 from t_day))::int, '00:00', '01:00', 5 from public.shipping_methods m where m.code = 'delivery';
insert into public.delivery_slots (id, method_id, weekday, start_time, end_time, capacity)
select '44444444-0000-0000-0000-000000000002', m.id, extract(isodow from (select today + 2 from t_day))::int, '10:00', '12:00', 2 from public.shipping_methods m where m.code = 'delivery';
insert into public.delivery_slots (id, method_id, weekday, start_time, end_time, capacity)
select '44444444-0000-0000-0000-000000000003', m.id, extract(isodow from (select today + 3 from t_day))::int, '14:00', '16:00', 1 from public.shipping_methods m where m.code = 'delivery';
select throws_ok($$insert into public.delivery_slots (method_id, weekday, start_time, end_time, capacity)
  select m.id, extract(isodow from (select today + 2 from t_day))::int, '10:00', '11:00', 1 from public.shipping_methods m where m.code = 'delivery'$$,
  '23505', null, 'no se repite la misma hora de inicio el mismo día de la semana');

select is((select jsonb_array_length(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots')), 5, 'en 14 días salen 5 franjas: S1 (+8), S2 (+2 y +9), S3 (+3 y +10)');
select is((select string_agg(e ->> 'date', ',' order by e ->> 'date') from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where e ->> 'slot_id' = '44444444-0000-0000-0000-000000000002'),
  (select (today + 2)::text || ',' || (today + 9)::text from t_day), 'S2 sale en hoy+2 y hoy+9');
select is((select count(*)::int from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where e ->> 'slot_id' = '44444444-0000-0000-0000-000000000001' and (e ->> 'date')::date = (select today + 1 from t_day)), 0, 'S1 NO sale mañana (empieza a las 00:00: menos de 24 h de antelación)');
select is((select count(*)::int from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where e ->> 'slot_id' = '44444444-0000-0000-0000-000000000001' and (e ->> 'date')::date = (select today + 8 from t_day)), 1, '…pero SÍ dentro de una semana');
select is((select e ->> 'start' || '-' || (e ->> 'end') || ' cupo ' || (e ->> 'remaining') from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where e ->> 'slot_id' = '44444444-0000-0000-0000-000000000002' limit 1), '10:00-12:00 cupo 2', 'una franja trae su hora y su cupo restante');
select is((select jsonb_array_length(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', null, null, 1) -> 'slots')), 0, 'con p_list_days = 1 (solo hoy) no sale ninguna');
select is((select jsonb_array_length(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', null, null, 400) -> 'slots')) > 5, true, 'p_list_days se limita a 31 (no revienta) y trae más franjas');
update public.store_settings set value = '180' where key = 'delivery_max_days_ahead';
select is((select jsonb_array_length(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', null, null, 400) -> 'slots')), 13,
  'con p_list_days = 400 y un tope del negocio de 180 días, la lista se limita a 31 días: S1 (+8,+15,+22,+29) + S2 (+2,+9,+16,+23,+30) + S3 (+3,+10,+17,+24) = 13');
update public.store_settings set value = '30' where key = 'delivery_max_days_ahead';

-- Fecha bloqueada
insert into public.blocked_dates (blocked_on, reason) select today + 9, 'Feriado de prueba' from t_day;
select throws_ok($$insert into public.blocked_dates (blocked_on) select today + 9 from t_day$$, '23505', null, 'una fecha no se bloquea dos veces');
select is((select count(*)::int from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where (e ->> 'date')::date = (select today + 9 from t_day)), 0, 'las franjas de una fecha bloqueada no salen');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 9 from t_day), '44444444-0000-0000-0000-000000000002') -> 'errors' -> 0 ->> 'code'), 'date_blocked', 'elegir una fecha bloqueada: date_blocked');
update public.blocked_dates set archived_at = now() where blocked_on = (select today + 9 from t_day);
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 9 from t_day), '44444444-0000-0000-0000-000000000002') ->> 'ok')::boolean, true, 'al archivar el bloqueo, la fecha vuelve a estar disponible');

-- Elegir fecha y franja
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 2 from t_day), '44444444-0000-0000-0000-000000000002') ->> 'ok')::boolean, true, 'fecha y franja válidas: ok');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 2 from t_day), '44444444-0000-0000-0000-000000000002') -> 'selected' ->> 'start'), '10:00', '…y devuelve lo elegido');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 2 from t_day), '44444444-0000-0000-0000-000000000002') ->> 'cost')::numeric, 15.00, '…junto con el costo');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 1 from t_day), '44444444-0000-0000-0000-000000000001') -> 'errors' -> 0 ->> 'code'), 'date_too_soon', 'mañana a las 00:00: date_too_soon');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 37 from t_day), '44444444-0000-0000-0000-000000000002') -> 'errors' -> 0 ->> 'code'), 'date_too_far', 'a +37 días (tope 30): date_too_far');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today - 5 from t_day), '44444444-0000-0000-0000-000000000002') -> 'errors' -> 0 ->> 'code'), 'date_past', 'una fecha pasada: date_past');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 3 from t_day), '44444444-0000-0000-0000-000000000002') -> 'errors' -> 0 ->> 'code'), 'slot_mismatch', 'una franja de otro día de la semana: slot_mismatch');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 2 from t_day), '99999999-0000-0000-0000-000000000009') -> 'errors' -> 0 ->> 'code'), 'slot_not_found', 'una franja inexistente: slot_not_found');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 2 from t_day), null) -> 'errors' -> 0 ->> 'code'), 'slot_required', 'con franjas configuradas, la fecha sola no basta: slot_required');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', null, '44444444-0000-0000-0000-000000000002') -> 'errors' -> 0 ->> 'code'), 'date_required', 'una franja sin fecha: date_required');
select is((public.quote_shipping('delivery', -17.3895, -66.1568, 'Oruro', 100, 'BOB', (select today + 2 from t_day), '44444444-0000-0000-0000-000000000002') -> 'errors' ->> 0)::jsonb ->> 'code', 'out_of_coverage', 'un error de cobertura y una fecha buena: el error de cobertura sigue ahí');
-- Antelación configurable
update public.store_settings set value = '0' where key = 'delivery_min_lead_hours';
select is((select count(*)::int from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where e ->> 'slot_id' = '44444444-0000-0000-0000-000000000001' and (e ->> 'date')::date = (select today + 1 from t_day)), 1, 'con antelación 0, mañana a las 00:00 ya está disponible');
update public.store_settings set value = '24' where key = 'delivery_min_lead_hours';
update public.store_settings set value = '5' where key = 'delivery_max_days_ahead';
select is((select max((e ->> 'date')::date) <= (select today + 5 from t_day) from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e), true, 'con tope de 5 días, ninguna franja pasa de hoy+5');
update public.store_settings set value = '30' where key = 'delivery_max_days_ahead';

-- Método sin franjas: solo se valida la fecha
insert into public.shipping_methods (code, name, kind) values ('moto', 'Moto', 'delivery');
select is((public.quote_shipping('moto', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 3 from t_day)) -> 'errors' -> 0 ->> 'code'), 'no_rate', 'un método sin reglas: no_rate');
insert into public.shipping_rate_rules (method_id, name, kind, params) select id, 'Moto plana', 'flat', '{"cost": 7}' from public.shipping_methods where code = 'moto';
select is((public.quote_shipping('moto', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 3 from t_day)) ->> 'ok')::boolean, true, 'sin franjas, una fecha futura válida es ok');
select is((public.quote_shipping('moto', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today from t_day)) -> 'errors' -> 0 ->> 'code'), 'date_too_soon', 'sin franjas, hoy con antelación 24 h: date_too_soon');
select is((public.quote_shipping('moto', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today - 1 from t_day)) -> 'errors' -> 0 ->> 'code'), 'date_past', 'sin franjas, ayer: date_past');
select is((public.quote_shipping('moto', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 31 from t_day)) -> 'errors' -> 0 ->> 'code'), 'date_too_far', 'sin franjas, +31 días: date_too_far');

-- Calendario con RELOJ FIJO (`_ship_slot_ok(franja, día, ahora)`): la zona horaria y la antelación exacta no dependen de la hora a
-- la que corra la prueba. Franja S2 (10:00) en D = hoy + 9; con antelación de 24 h, empezar EXACTAMENTE 24 h después de «ahora» vale.
select is(public._ship_slot_ok('44444444-0000-0000-0000-000000000002', (select today + 9 from t_day),
          (((select today + 9 from t_day) - 1) + time '10:00') at time zone 'America/La_Paz'), 'ok',
  'antelación EXACTA: faltan justo 24 h para el inicio de la franja → ok (borde inclusivo)');
select is(public._ship_slot_ok('44444444-0000-0000-0000-000000000002', (select today + 9 from t_day),
          ((((select today + 9 from t_day) - 1) + time '10:00') at time zone 'America/La_Paz') + interval '1 second'), 'date_too_soon',
  'un segundo más tarde faltan 23 h 59 min 59 s → date_too_soon');
-- Medianoche y zona horaria: el lunes 9 de marzo de 2026 a las 23:50 en La Paz son las 03:50 UTC del martes 10.
-- Con antelación 0 y una franja de lunes a las 23:55: hoy sigue siendo lunes en La Paz (en UTC ya sería martes: «date_past»).
update public.store_settings set value = '0' where key = 'delivery_min_lead_hours';
insert into public.delivery_slots (id, method_id, weekday, start_time, end_time, capacity)
select x.id::uuid, m.id, 1, x.start_time::time, x.end_time::time, 5
  from public.shipping_methods m,
       (values ('44444444-0000-0000-0000-0000000000a1', '23:55', '23:59'),
               ('44444444-0000-0000-0000-0000000000a2', '23:40', '23:45')) as x(id, start_time, end_time)
 where m.code = 'delivery';
select is(public._ship_slot_ok('44444444-0000-0000-0000-0000000000a1', date '2026-03-09', timestamptz '2026-03-10 03:50:00+00'), 'ok',
  'lunes 23:50 en La Paz (03:50 UTC del martes): la franja de las 23:55 del lunes sigue disponible (el «hoy» es el de La Paz)');
select is(public._ship_slot_ok('44444444-0000-0000-0000-0000000000a2', date '2026-03-09', timestamptz '2026-03-10 03:50:00+00'), 'date_too_soon',
  '…y la de las 23:40 ya empezó (date_too_soon)');
select is(public._ship_slot_ok('44444444-0000-0000-0000-0000000000a1', date '2026-03-09', timestamptz '2026-03-10 03:59:59+00'), 'date_too_soon',
  'lunes 23:59:59 en La Paz: la franja de las 23:55 ya empezó (date_too_soon; el lunes todavía es «hoy»)');
select is(public._ship_slot_ok('44444444-0000-0000-0000-0000000000a1', date '2026-03-09', timestamptz '2026-03-10 04:00:00+00'), 'date_past',
  'a las 00:00 del martes en La Paz el lunes 9 ya es ayer → date_past');
delete from public.delivery_slots where id in ('44444444-0000-0000-0000-0000000000a1', '44444444-0000-0000-0000-0000000000a2');
update public.store_settings set value = '24' where key = 'delivery_min_lead_hours';

-- Con cobertura fallida no se gasta en listar franjas (cada cotización pública recorre días × franjas): lista vacía, aunque HAYA franjas
-- configuradas (aquí ya existen S1–S3: una cotización válida las trae).
select is((select count(*)::int from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots')) > 0, true, 'con franjas configuradas, una cotización válida las lista');
select is(public.quote_shipping('delivery', -21.53, -64.73, 'Tarija', 100) -> 'errors' -> 0 ->> 'code', 'out_of_coverage', 'Tarija no está en ninguna zona de esta prueba');
select is(jsonb_array_length(public.quote_shipping('delivery', -21.53, -64.73, 'Tarija', 100) -> 'slots'), 0, 'un destino fuera de cobertura NO lista franjas (aunque existan)');

-- ═══ G. Reservar y liberar cupo ═════════════════════════════════════════════════════════════
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000002', (select today + 2 from t_day), 'order', 'a0000000-0000-0000-0000-000000000001') ->> 'status'), 'reserved', 'primera reserva (cupo 2): reserved');
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000002', (select today + 2 from t_day), 'order', 'a0000000-0000-0000-0000-000000000001') ->> 'status'), 'already', 'el MISMO pedido repitiendo: already (idempotente, no gasta otro cupo)');
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000002', (select today + 2 from t_day), 'order', 'a0000000-0000-0000-0000-000000000002') ->> 'remaining')::int, 0, 'segunda reserva: quedan 0');
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000002', (select today + 2 from t_day), 'order', 'a0000000-0000-0000-0000-000000000003') ->> 'status'), 'full', 'la tercera: full');
select is((select count(*)::int from public.delivery_bookings where status = 'active'), 2, '…y no se creó una fila de más');
select is((select e ->> 'remaining' from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where e ->> 'slot_id' = '44444444-0000-0000-0000-000000000002' and (e ->> 'date')::date = (select today + 2 from t_day)), '0', 'la cotización ve el cupo restante 0');
select is((select (e ->> 'available')::boolean from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where e ->> 'slot_id' = '44444444-0000-0000-0000-000000000002' and (e ->> 'date')::date = (select today + 2 from t_day)), false, '…y la marca como no disponible');
select is((select (e ->> 'remaining')::int from jsonb_array_elements(public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) -> 'slots') e
            where e ->> 'slot_id' = '44444444-0000-0000-0000-000000000002' and (e ->> 'date')::date = (select today + 9 from t_day)), 2, 'otro día de la misma franja conserva su cupo (2)');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100, 'BOB', (select today + 2 from t_day), '44444444-0000-0000-0000-000000000002') -> 'errors' -> 0 ->> 'code'), 'slot_full', 'elegir una franja llena: slot_full');
select is((public.release_delivery_slot('order', 'a0000000-0000-0000-0000-000000000001')), 1, 'liberar el cupo de un pedido libera 1 reserva');
select is((public.release_delivery_slot('order', 'a0000000-0000-0000-0000-000000000001')), 0, '…y repetirlo no libera nada más');
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000002', (select today + 2 from t_day), 'order', 'a0000000-0000-0000-0000-000000000003') ->> 'status'), 'reserved', 'con el cupo liberado, otro pedido puede reservar');
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000002', (select today + 3 from t_day), 'order', 'a0000000-0000-0000-0000-000000000004') ->> 'reason'), 'slot_mismatch', 'reservar en un día que no corresponde: unavailable / slot_mismatch');
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000001', (select today + 1 from t_day), 'order', 'a0000000-0000-0000-0000-000000000004') ->> 'reason'), 'date_too_soon', 'reservar «demasiado pronto»: date_too_soon');
select is((public.reserve_delivery_slot('99999999-0000-0000-0000-000000000009', (select today + 2 from t_day), 'order', 'a0000000-0000-0000-0000-000000000004') ->> 'reason'), 'slot_not_found', 'reservar una franja inexistente: slot_not_found');
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000002', (select today + 2 from t_day), 'otra_cosa', 'a0000000-0000-0000-0000-000000000004') ->> 'status'), 'invalid', 'un tipo de dueño desconocido: invalid');
update public.delivery_slots set is_active = false where id = '44444444-0000-0000-0000-000000000003';
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000003', (select today + 3 from t_day), 'order', 'a0000000-0000-0000-0000-000000000004') ->> 'reason'), 'slot_not_found', 'una franja inactiva no se reserva');
update public.delivery_slots set is_active = true where id = '44444444-0000-0000-0000-000000000003';

select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000003', (select today + 3 from t_day), null, 'a0000000-0000-0000-0000-000000000004') ->> 'status'), 'invalid', 'un tipo de dueño NULO es «invalid», no una excepción (NULL not in (…) es NULL)');
select is((public.reserve_delivery_slot('44444444-0000-0000-0000-000000000003', (select today + 3 from t_day), 'manual', null) ->> 'status'), 'invalid', 'un dueño NULO es «invalid»');

-- ═══ H. Permisos y RLS ═════════════════════════════════════════════════════════════════════
select is(has_function_privilege('anon', 'public.quote_shipping(text,numeric,numeric,text,numeric,text,date,uuid,int)', 'execute'), true, 'anon PUEDE cotizar (lectura pública)');
select is(has_function_privilege('authenticated', 'public.quote_shipping(text,numeric,numeric,text,numeric,text,date,uuid,int)', 'execute'), true, 'un cliente puede cotizar');
select is(has_function_privilege('anon', 'public.reserve_delivery_slot(uuid,date,text,uuid)', 'execute'), false, 'anon NO reserva cupo');
select is(has_function_privilege('authenticated', 'public.reserve_delivery_slot(uuid,date,text,uuid)', 'execute'), false, 'un cliente NO reserva cupo (lo hace el servidor)');
select is(has_function_privilege('service_role', 'public.reserve_delivery_slot(uuid,date,text,uuid)', 'execute'), true, 'el servidor SÍ reserva');
select is(has_function_privilege('authenticated', 'public.release_delivery_slot(text,uuid)', 'execute'), false, 'un cliente NO libera cupo');
select is(has_function_privilege('service_role', 'public._ship_slots(uuid,date,int)', 'execute'), false, 'las funciones internas no las ejecuta ni service_role (_ship_slots)');
select is(has_function_privilege('service_role', 'public._ship_slot_ok(uuid,date,timestamptz)', 'execute'), false, '…(_ship_slot_ok)');
select is(has_function_privilege('anon', 'public._ship_slot_ok(uuid,date,timestamptz)', 'execute') or has_function_privilege('authenticated', 'public._ship_slot_ok(uuid,date,timestamptz)', 'execute'), false, '…ni anon ni authenticated ejecutan _ship_slot_ok (así nadie fija «ahora»)');
select is(has_function_privilege('anon', 'public.release_delivery_slot(text,uuid)', 'execute'), false, 'anon NO libera cupo');
select is(has_function_privilege('anon', 'public.haversine_km(numeric,numeric,numeric,numeric)', 'execute') or has_function_privilege('authenticated', 'public.haversine_km(numeric,numeric,numeric,numeric)', 'execute'), false, 'haversine_km no es ejecutable desde el navegador');
select is(has_function_privilege('anon', 'public._ship_norm(text)', 'execute') or has_function_privilege('authenticated', 'public._ship_norm(text)', 'execute'), false, '_ship_norm no es ejecutable desde el navegador');
select is(has_function_privilege('anon', 'public._ship_params_valid(text,jsonb)', 'execute'), false, '_ship_params_valid no es ejecutable por anon (solo quien inserta tarifas: authenticated y service_role)');
select is(has_function_privilege('service_role', 'public.store_settings_validate_s8()', 'execute'), false, '…(el validador de ajustes)');
select is(has_function_privilege('anon', 'public.admin_set_primary_location(uuid)', 'execute'), false, 'anon NO cambia el origen');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('store_locations', 'shipping_methods', 'shipping_zones', 'shipping_rate_rules',
                  'delivery_slots', 'blocked_dates', 'delivery_bookings') and c.relrowsecurity), 7, 'las 7 tablas tienen RLS activada');

set local role anon;
select throws_ok($$select * from public.shipping_zones$$, '42501', null, 'anon no lee las zonas');
select throws_ok($$select * from public.shipping_rate_rules$$, '42501', null, 'anon no lee las tarifas');
select throws_ok($$select * from public.delivery_bookings$$, '42501', null, 'anon no lee las reservas');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 15.00, 'anon cotiza y obtiene el costo');
reset role;

-- Vista pública de métodos (S8 §8): solo activos y no archivados; el recojo solo con su ubicación activa; sin coordenadas.
update public.store_locations set city = 'La Paz', pickup_hours = 'Lun a Vie 9:00-18:00' where id = '11111111-0000-0000-0000-000000000002';
insert into public.shipping_methods (code, name, kind, pickup_location_id, sort_order, eta_min_days, eta_max_days)
  values ('recojo_v', 'Recojo vista', 'pickup', '11111111-0000-0000-0000-000000000002', 5, 0, 1);
insert into public.shipping_methods (code, name, kind, is_active) values ('inactivo_v', 'Inactivo', 'delivery', false);
insert into public.shipping_methods (code, name, kind, archived_at) values ('archivado_v', 'Archivado', 'delivery', now());
set local role anon;
select is((select array_agg(code order by sort_order, name) from public.public_shipping_methods), array['delivery', 'moto', 'recojo_v'],
  'anon ve solo los métodos activos y no archivados, en orden (domicilio, moto y recojo; sin el inactivo ni el archivado)');
select is((select pickup_name || ' / ' || pickup_city || ' / ' || pickup_hours from public.public_shipping_methods where code = 'recojo_v'),
  'Depósito / La Paz / Lun a Vie 9:00-18:00', 'el recojo muestra el nombre, la ciudad y el horario de su ubicación');
select is((select pickup_name from public.public_shipping_methods where code = 'delivery'), null, 'un domicilio no trae ubicación de recojo');
select throws_ok($$select * from public.store_locations$$, '42501', null, 'anon no lee las ubicaciones directamente');
select throws_ok($$select * from public.shipping_methods$$, '42501', null, 'anon no lee la tabla de métodos directamente');
reset role;
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'public_shipping_methods' and column_name ~ '(lat|lng|coord|latitude|longitude)'),
          0, 'la vista pública NO expone coordenadas');
update public.store_locations set is_active = false where id = '11111111-0000-0000-0000-000000000002';
set local role anon;
select is((select array_agg(code order by sort_order, name) from public.public_shipping_methods), array['delivery', 'moto'],
  'un recojo cuya ubicación se desactiva deja de verse');
reset role;
update public.store_locations set is_active = true where id = '11111111-0000-0000-0000-000000000002';
delete from public.shipping_methods where code in ('recojo_v', 'inactivo_v', 'archivado_v');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.shipping_zones), 0, 'un cliente (no admin) ve 0 zonas');
select is((select count(*)::int from public.shipping_rate_rules), 0, 'un cliente ve 0 tarifas');
select throws_ok($$insert into public.shipping_zones (name, kind, cities) values ('Z', 'city', array['x'])$$, '42501', null, 'un cliente no crea zonas');
select throws_ok($$select public.admin_set_primary_location('11111111-0000-0000-0000-000000000001')$$, '42501', null, 'un cliente no cambia el origen');
select is((public.quote_shipping('delivery', -16.52, -68.15, 'La Paz', 100) ->> 'cost')::numeric, 15.00, 'un cliente cotiza');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from public.shipping_zones), 3, 'el admin ve las 3 zonas');
select is((select count(*)::int from public.delivery_bookings where status = 'active'), 2, 'el admin ve las reservas');
select lives_ok($$insert into public.shipping_zones (name, kind, cities) values ('Nueva', 'city', array['Sucre'])$$, 'el admin crea una zona');
select lives_ok($$update public.shipping_zones set name = 'Renombrada' where name = 'Nueva'$$, 'el admin renombra una zona');
select throws_ok($$update public.shipping_zones set kind = 'radius' where name = 'Renombrada'$$, '42501', null, 'el tipo de una zona no se cambia (sin permiso de columna)');
select throws_ok($$update public.store_locations set is_primary = true where id = '11111111-0000-0000-0000-000000000001'$$, '42501', null, 'el origen NO se marca directamente (solo con admin_set_primary_location)');
select throws_ok($$insert into public.delivery_bookings (slot_id, delivery_date, owner_type, owner_id) values ('44444444-0000-0000-0000-000000000002', current_date, 'manual', gen_random_uuid())$$, '42501', null, 'ni el admin inserta reservas a mano');
select throws_ok($$delete from public.shipping_zones$$, '42501', null, 'nadie borra zonas (se archivan)');
select lives_ok($$update public.shipping_zones set archived_at = now() where name = 'Renombrada'$$, 'el admin archiva una zona');
select lives_ok($$select public.admin_set_primary_location('11111111-0000-0000-0000-000000000002')$$, 'el admin cambia el origen principal');
select is((select name from public.store_locations where is_primary), 'Depósito', '…y el nuevo es el principal');
select is((select count(*)::int from public.store_locations where is_primary), 1, '…y sigue siendo UNO solo (se soltó el anterior)');
select throws_ok($$select public.admin_set_primary_location('99999999-0000-0000-0000-000000000009')$$, 'P0002', null, 'no se puede marcar un origen que no existe');
reset role;
select is((select count(*)::int from public.audit_log where table_name = 'shipping_zones' and action = 'INSERT') - (select n from t_audit0), 7, 'los cambios de zonas quedaron en la auditoría (5 de antes + las 2 zonas de borde que crea la prueba del radio)');

select * from finish();
rollback;

-- Sprint 14 · Fase D — Carga masiva: vista previa que NO escribe, la misma cuenta al confirmar, cada fila en su subtransacción, cada tipo
-- (categorías, productos con variantes, stock, precios), reimportar es idempotente, el lote queda registrado y se puede REVERTIR sin
-- pisar trabajo posterior. Los valores esperados se calcularon A MANO (la cuenta va en el comentario de cada bloque).
-- Todo ocurre en una transacción que se revierte (los movimientos de stock, que son inmutables, también).
--
-- Fixture: un administrador (ad) y una clienta (cu). Todo lo que se crea usa códigos «IMP-…» y categorías «imp-…»: la nube no tiene nada así.
begin;
select plan(116);

-- ── Ayudas ──────────────────────────────────────────────────────────────────────────────────
create function pg_temp.u(n int) returns uuid language sql as $$ select ('a2400000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create temp table t_r (k text primary key, v jsonb);
create function pg_temp.rec(p_k text, p_v jsonb) returns void language sql as $$ insert into t_r values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.g(p_k text) returns jsonb language sql as $$ select v from t_r where k = p_k $$;
create function pg_temp.as_(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uid), true) $$;
-- «acción por fila» y «código del primer error por fila», en orden de fila, de un resultado guardado.
create function pg_temp.acts(p_k text) returns jsonb language sql as
  $$ select jsonb_agg(x ->> 'action' order by (x ->> 'row')::int) from jsonb_array_elements(pg_temp.g(p_k) -> 'rows') x $$;
create function pg_temp.errs(p_k text) returns jsonb language sql as
  $$ select jsonb_agg(coalesce(x -> 'errors' -> 0 ->> 'code', '') || ':' || coalesce(x -> 'errors' -> 0 ->> 'field', '') order by (x ->> 'row')::int)
       from jsonb_array_elements(pg_temp.g(p_k) -> 'rows') x $$;
create function pg_temp.cnt(p_k text, p_a text) returns int language sql as $$ select (pg_temp.g(p_k) -> 'counts' ->> p_a)::int $$;
-- «foto» de lo que una vista previa NO debe tocar.
create function pg_temp.world() returns text language sql as $$
  select (select count(*) from public.categories) || '|' || (select count(*) from public.products) || '|' || (select count(*) from public.product_colors)
      || '|' || (select count(*) from public.product_sizes) || '|' || (select count(*) from public.product_variants)
      || '|' || (select count(*) from public.product_prices) || '|' || (select count(*) from public.product_categories)
      || '|' || (select count(*) from public.stock_movements) || '|' || (select count(*) from public.import_batches)
      || '|' || (select count(*) from public.import_batch_rows) $$;
create temp table t_w (k text primary key, v text);
-- Aplica un archivo: abre el lote, un bloque, lo cierra. Devuelve el lote cerrado con sus cuentas.
create function pg_temp.apply(p_kind text, p_file text, p_rows jsonb) returns jsonb language plpgsql as $$
declare
  v_id uuid;
begin
  v_id := public.admin_import_start(p_kind, p_file, jsonb_array_length(p_rows));
  perform public.admin_import_apply_chunk(v_id, p_rows);
  return public.admin_import_finish(v_id);
end $$;
create function pg_temp.pid(p_code text) returns uuid language sql as $$ select id from public.products where code = p_code $$;
create function pg_temp.vid(p_sku text) returns uuid language sql as $$ select id from public.product_variants where sku = p_sku $$;
create function pg_temp.stk(p_sku text) returns int language sql as $$ select stock_on_hand from public.product_variants where sku = p_sku $$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  (pg_temp.u(1), 'admin.imp@test.com', '{"full_name":"Admin Imp"}', 'authenticated', 'authenticated'),
  (pg_temp.u(2), 'cu.imp@test.com', '{"full_name":"Clienta Imp"}', 'authenticated', 'authenticated');
select public.set_user_role(pg_temp.u(1), 'admin');
select pg_temp.as_(pg_temp.u(1));

-- ═══ A. Estructura y permisos ══════════════════════════════════════════════════════════════
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_import_validate', 'admin_import_start', 'admin_import_apply_chunk', 'admin_import_finish',
              'admin_import_rollback', 'admin_import_batches', 'admin_import_batch_rows')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 7,
          'A1: las 7 funciones de importación las ejecuta authenticated (y adentro exigen ser admin), no anon ni service_role');
select is((select coalesce(string_agg(p.proname, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_import_rows', '_import_unique_slug', '_import_text', '_import_num')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('service_role', p.oid, 'execute'))), '', 'A2: el motor y sus ayudas no se llaman desde la API');
select is((select count(*)::int from pg_class c where c.relname in ('import_batches', 'import_batch_rows') and c.relrowsecurity), 2, 'A3: los lotes tienen RLS activa');
select is((select count(*)::int from information_schema.role_table_grants g
            where g.table_name in ('import_batches', 'import_batch_rows') and g.table_schema = 'public'
              and g.grantee in ('anon', 'authenticated', 'service_role')), 0, 'A4: ni anon, ni authenticated, ni service_role tocan las tablas del lote (solo las funciones)');

-- ═══ B. Solo administradores ═══════════════════════════════════════════════════════════════
select pg_temp.as_(pg_temp.u(2));
set local role authenticated;
select throws_ok($$select public.admin_import_validate('stock', '[]')$$, '42501', null, 'B1: una clienta no valida una importación');
select throws_ok($$select public.admin_import_start('stock', 'x.csv', 1)$$, '42501', null, 'B2: ni abre un lote');
select throws_ok($$select public.admin_import_apply_chunk('a2400000-0000-0000-0000-000000000099', '[]')$$, '42501', null, 'B3: ni aplica un bloque');
select throws_ok($$select public.admin_import_finish('a2400000-0000-0000-0000-000000000099')$$, '42501', null, 'B4: ni lo cierra');
select throws_ok($$select public.admin_import_rollback('a2400000-0000-0000-0000-000000000099')$$, '42501', null, 'B5: ni lo revierte');
select throws_ok($$select * from public.admin_import_batches()$$, '42501', null, 'B6: ni ve el historial');
select throws_ok($$select * from public.admin_import_batch_rows('a2400000-0000-0000-0000-000000000099')$$, '42501', null, 'B7: ni el detalle');
select throws_ok($$select * from public.import_batches$$, '42501', null, 'B8: y la tabla no se lee directo');
reset role;
select pg_temp.as_(pg_temp.u(1));

-- ═══ C. Parámetros inválidos ═══════════════════════════════════════════════════════════════
select throws_ok($$select public.admin_import_validate('colores', '[]')$$, '22023', 'invalid_kind', 'C1: solo los 4 tipos conocidos');
select throws_ok($$select public.admin_import_validate('stock', '{"a": 1}')$$, '22023', 'invalid_rows', 'C2: las filas son una lista');
select throws_ok($$select public.admin_import_validate('stock', (select jsonb_agg(jsonb_build_object('row', g, 'sku', 'X' || g, 'stock', 1)) from generate_series(1, 501) g))$$,
                 '22023', 'invalid_rows', 'C3: ni más de 500 filas por bloque (la base corta a los 8 s)');
select throws_ok($$select public.admin_import_start('stock', 'x.csv', -1)$$, '22023', 'invalid_parameters', 'C4: un lote no tiene filas negativas');
select throws_ok($$select public.admin_import_apply_chunk('a2400000-0000-0000-0000-000000000099', '[]')$$, 'P0002', 'batch_not_found', 'C5: un lote que no existe se dice así');
select lives_ok($$select public.admin_import_validate('stock', '[]')$$, 'C6: un bloque vacío no es un error');

-- ═══ D. Categorías ═════════════════════════════════════════════════════════════════════════
-- 1 «Blusas» crea · 2 «Camisas Manga Larga» con padre «Blusas» (que acaba de crear la fila 1) crea · 3 padre inexistente · 4 el mismo slug que
-- la fila 1 en el mismo bloque · 5 sin nombre · 6 «Ñ-ropa-interior» → slug «n-ropa-interior» crea
select pg_temp.rec('cat_rows', jsonb_build_array(
  jsonb_build_object('row', 1, 'name', 'Blusas'),
  jsonb_build_object('row', 2, 'name', 'Camisas Manga Larga', 'parent', 'Blusas'),
  jsonb_build_object('row', 3, 'name', 'Faldas', 'parent', 'No existe'),
  jsonb_build_object('row', 4, 'name', 'Blusas'),
  jsonb_build_object('row', 5, 'name', ''),
  jsonb_build_object('row', 6, 'name', 'Ñ-ropa-interior')));
insert into t_w values ('antes_cat', pg_temp.world());
select pg_temp.rec('cat_v', public.admin_import_validate('categories', pg_temp.g('cat_rows')));
select is(pg_temp.acts('cat_v'), '["create", "create", "error", "error", "error", "create"]'::jsonb, 'D1: la vista previa dice qué haría cada fila (una categoría hija puede colgar de otra del mismo archivo)');
select is(pg_temp.errs('cat_v'), '[":", ":", "parent_not_found:parent", "duplicate_in_file:slug", "required:name", ":"]'::jsonb, 'D2: y por qué falla cada una, con el campo');
select is(pg_temp.cnt('cat_v', 'create') || '/' || pg_temp.cnt('cat_v', 'error') || '/' || pg_temp.cnt('cat_v', 'skip'), '3/3/0', 'D3: 3 crean, 3 con error, ninguna igual');
select is(pg_temp.world(), (select v from t_w where k = 'antes_cat'), 'D4: la vista previa NO escribió nada (ni categorías, ni lotes, ni filas de detalle)');
select pg_temp.rec('cat_b', pg_temp.apply('categories', 'categorias.csv', pg_temp.g('cat_rows')));
select is((pg_temp.g('cat_b') ->> 'status') || '/' || (pg_temp.g('cat_b') ->> 'created_count') || '/' || (pg_temp.g('cat_b') ->> 'error_count') || '/' || (pg_temp.g('cat_b') ->> 'total_rows'),
          'done/3/3/6', 'D5: confirmar hace la misma cuenta: lote «done», 3 creadas, 3 errores, 6 filas');
select is((select count(*)::int from public.categories where slug in ('blusas', 'camisas-manga-larga', 'n-ropa-interior')), 3, 'D6: las 3 categorías existen');
select is((select p.slug from public.categories c join public.categories p on p.id = c.parent_id where c.slug = 'camisas-manga-larga'), 'blusas', 'D7: la hija cuelga de «Blusas»');
select is((select count(*)::int from public.categories where slug = 'faldas'), 0, 'D8: la fila con error no dejó nada a medias');
select is((select count(*)::int from public.import_batch_rows where batch_id = (pg_temp.g('cat_b') ->> 'id')::uuid and action = 'create' and entity = 'category'), 3, 'D9: el detalle del lote guarda lo creado');
select is((select error_codes -> 0 ->> 'code' from public.import_batch_rows where batch_id = (pg_temp.g('cat_b') ->> 'id')::uuid and row_no = 3), 'parent_not_found', 'D10: y los errores, con su código, para el informe');
-- Reimportar el MISMO archivo: nada cambia (idempotente)
select pg_temp.rec('cat_b2', pg_temp.apply('categories', 'categorias.csv', pg_temp.g('cat_rows')));
select is((pg_temp.g('cat_b2') ->> 'created_count') || '/' || (pg_temp.g('cat_b2') ->> 'updated_count') || '/' || (pg_temp.g('cat_b2') ->> 'skipped_count') || '/' || (pg_temp.g('cat_b2') ->> 'error_count'),
          '0/0/3/3', 'D11: reimportar el mismo archivo no crea ni cambia nada (3 iguales, los mismos 3 errores)');
select is((select count(*)::int from public.categories where slug in ('blusas', 'camisas-manga-larga', 'n-ropa-interior')), 3, 'D12: y no duplicó categorías');
-- Actualizar y revertir
select pg_temp.rec('cat_b3', pg_temp.apply('categories', 'cambio.csv', '[{"row": 1, "name": "Blusas y tops", "slug": "blusas"}]'));
select is((select name from public.categories where slug = 'blusas'), 'Blusas y tops', 'D13: una fila con un slug que ya existe actualiza esa categoría');
select is((pg_temp.g('cat_b3') ->> 'updated_count'), '1', 'D14: y cuenta como actualizada');
select pg_temp.rec('cat_r3', public.admin_import_rollback((pg_temp.g('cat_b3') ->> 'id')::uuid));
select is((select name from public.categories where slug = 'blusas'), 'Blusas', 'D15: revertir el lote devuelve el nombre de antes');
select is(pg_temp.g('cat_r3') ->> 'reverted', '1', 'D16: y dice cuántos cambios revirtió');
select is((select status from public.import_batches where id = (pg_temp.g('cat_b3') ->> 'id')::uuid), 'rolled_back', 'D17: el lote queda «revertido»');
select throws_ok(format($$select public.admin_import_rollback('%s')$$, pg_temp.g('cat_b3') ->> 'id'), '22023', 'already_rolled_back', 'D18: no se revierte dos veces');
-- Un ciclo se rechaza
select is((public.admin_import_validate('categories', '[{"row": 1, "name": "Blusas", "slug": "blusas", "parent": "Camisas Manga Larga"}]') -> 'rows' -> 0 -> 'errors' -> 0 ->> 'code'),
          'cycle', 'D19: una categoría no puede colgar de su propia hija (ciclo)');
select is((public.admin_import_validate('categories', '[{"row": 1, "name": "Blusas", "parent": "Blusas"}]') -> 'rows' -> 0 -> 'errors' -> 0 ->> 'code'),
          'cycle', 'D20: ni de sí misma');

-- ═══ E. Productos con variantes ════════════════════════════════════════════════════════════
-- 1 IMP-100 «Blusa Imp»: costo 30, precio 120, categoría Blusas, Rojo/S, stock 5 → crea todo · 2 IMP-100 Rojo/M stock 7 → crea talla y variante ·
-- 3 IMP-100 Azul/S sin stock → crea color y variante · 4 IMP-200 con una categoría que no existe → ERROR y NO queda ni el producto ·
-- 5 IMP-300 «Pantalón Imp» con 2 categorías, Gris sin talla, stock 2 → crea · 6 el SKU de la fila 1 en minúsculas → duplicado en el archivo ·
-- 7 IMP-300 Gris sin talla con otro SKU → ya existe esa combinación · 8 sin nombre (producto nuevo) · 9 código con espacio · 10 precio «abc» ·
-- 11 precio con 3 decimales en BOB · 12 el SKU de la fila 2 repetido en OTRO producto (duplicado en el archivo) · 13 moneda «XXX» · 14 stock «2.5» ·
-- 15 IMP-100 Verde/S con stock 6 → crea color y variante
select pg_temp.rec('prod_rows', jsonb_build_array(
  jsonb_build_object('row', 1, 'code', 'IMP-100', 'name', 'Blusa Imp', 'description', 'Linda', 'cost', '30', 'price', '120', 'categories', 'Blusas',
                     'color', 'Rojo', 'color_hex', '#FF0000', 'size', 'S', 'sku', 'IMP-100-R-S', 'stock', '5'),
  jsonb_build_object('row', 2, 'code', 'IMP-100', 'color', 'Rojo', 'size', 'M', 'sku', 'IMP-100-R-M', 'stock', '7'),
  jsonb_build_object('row', 3, 'code', 'IMP-100', 'color', 'Azul', 'size', 'S', 'sku', 'IMP-100-A-S'),
  jsonb_build_object('row', 4, 'code', 'IMP-200', 'name', 'Falda Imp', 'price', '89.9', 'categories', 'Faldas', 'color', 'Negro', 'sku', 'IMP-200-N', 'stock', '3'),
  jsonb_build_object('row', 5, 'code', 'IMP-300', 'name', 'Pantalón Imp', 'price', '150', 'categories', 'Blusas|Camisas Manga Larga', 'color', 'Gris', 'sku', 'IMP-300-G', 'stock', '2'),
  jsonb_build_object('row', 6, 'code', 'IMP-100', 'color', 'Rojo', 'size', 'S', 'sku', 'imp-100-r-s'),
  jsonb_build_object('row', 7, 'code', 'IMP-300', 'color', 'Gris', 'sku', 'IMP-300-G2'),
  jsonb_build_object('row', 8, 'code', 'IMP-400', 'color', 'Rojo', 'sku', 'IMP-400-R'),
  jsonb_build_object('row', 9, 'code', 'IMP 500', 'name', 'Z', 'color', 'Rojo', 'sku', 'IMP-500-R'),
  jsonb_build_object('row', 10, 'code', 'IMP-600', 'name', 'X', 'price', 'abc', 'color', 'Rojo', 'sku', 'IMP-600-R'),
  jsonb_build_object('row', 11, 'code', 'IMP-700', 'name', 'Y', 'price', '10.999', 'color', 'Rojo', 'sku', 'IMP-700-R'),
  jsonb_build_object('row', 12, 'code', 'IMP-300', 'color', 'Gris', 'size', 'L', 'sku', 'IMP-100-R-M'),
  jsonb_build_object('row', 13, 'code', 'IMP-800', 'name', 'W', 'price', '5', 'currency', 'XXX', 'color', 'Rojo', 'sku', 'IMP-800-R'),
  jsonb_build_object('row', 14, 'code', 'IMP-900', 'name', 'V', 'color', 'Rojo', 'sku', 'IMP-900-R', 'stock', '2.5'),
  jsonb_build_object('row', 15, 'code', 'IMP-100', 'color', 'Verde', 'size', 'S', 'sku', 'IMP-100-V-S', 'stock', '6')));
insert into t_w values ('antes_prod', pg_temp.world());
select pg_temp.rec('prod_v', public.admin_import_validate('products', pg_temp.g('prod_rows')));
select is(pg_temp.acts('prod_v'), '["create", "create", "create", "error", "create", "error", "error", "error", "error", "error", "error", "error", "error", "error", "create"]'::jsonb,
          'E1: la vista previa: 5 filas crean y 10 fallan');
select is(pg_temp.errs('prod_v'),
          '[":", ":", ":", "category_not_found:categories", ":", "duplicate_in_file:sku", "variant_exists_other_sku:sku", "required:name", "invalid_format:code", "invalid_format:price", "too_many_decimals:price", "duplicate_in_file:sku", "currency_unknown:currency", "too_many_decimals:stock", ":"]'::jsonb,
          'E2: cada error con su código y su campo');
select is(pg_temp.world(), (select v from t_w where k = 'antes_prod'), 'E3: la vista previa de productos NO escribió nada');
select pg_temp.rec('prod_b', pg_temp.apply('products', 'productos.csv', pg_temp.g('prod_rows')));
-- Un SKU que YA es de otro producto (no repetido en el archivo, sino de antes)
select is((public.admin_import_validate('products', '[{"row": 1, "code": "IMP-300", "color": "Gris", "size": "L", "sku": "IMP-100-R-M"}]') -> 'rows' -> 0 -> 'errors' -> 0 ->> 'code'),
          'sku_conflict', 'E3b: un SKU que ya pertenece a OTRO producto se rechaza (sku_conflict)');
select is((public.admin_import_validate('products', '[{"row": 1, "code": "IMP-100", "color": "Azul", "size": "S", "sku": "IMP-100-R-S"}]') -> 'rows' -> 0 -> 'errors' -> 0 ->> 'code'),
          'sku_conflict', 'E3c: y el SKU de una variante del mismo producto pero con otro color o talla también');
select is((pg_temp.g('prod_b') ->> 'created_count') || '/' || (pg_temp.g('prod_b') ->> 'updated_count') || '/' || (pg_temp.g('prod_b') ->> 'skipped_count') || '/' || (pg_temp.g('prod_b') ->> 'error_count'),
          '5/0/0/10', 'E4: confirmar hace la misma cuenta: 5 creadas y 10 errores');
select is((select status || '/' || slug || '/' || round(cost_base, 2) from public.products where code = 'IMP-100'), 'draft/blusa-imp/30.00', 'E5: el producto nace en BORRADOR, con su identificador legible y su costo');
select is((select amount from public.product_prices where product_id = pg_temp.pid('IMP-100') and currency = 'BOB' and country is null), 120::numeric, 'E6: y su precio en bolivianos');
select is((select count(*)::int from public.product_variants where product_id = pg_temp.pid('IMP-100')), 4, 'E7: IMP-100 tiene 4 variantes (Rojo S, Rojo M, Azul S, Verde S)');
select is((select count(*)::int from public.product_colors where product_id = pg_temp.pid('IMP-100')) || '/' || (select count(*)::int from public.product_sizes where product_id = pg_temp.pid('IMP-100')),
          '3/2', 'E8: con 3 colores y 2 tallas (la talla S y el color Rojo se reutilizan, no se duplican)');
select is((select hex from public.product_colors where product_id = pg_temp.pid('IMP-100') and name = 'Rojo'), '#FF0000', 'E9: el color Rojo trae el tono que se escribió');
select is(pg_temp.stk('IMP-100-R-S') || '/' || pg_temp.stk('IMP-100-R-M') || '/' || pg_temp.stk('IMP-100-A-S') || '/' || pg_temp.stk('IMP-100-V-S') || '/' || pg_temp.stk('IMP-300-G'), '5/7/0/6/2', 'E10: el stock inicial de las variantes nuevas (la que no trae stock, en 0)');
select is((select count(*)::int from public.stock_movements where variant_id in (pg_temp.vid('IMP-100-R-S'), pg_temp.vid('IMP-100-R-M'), pg_temp.vid('IMP-100-V-S'), pg_temp.vid('IMP-300-G'))
              and reason = 'import' and ref = 'import:' || (pg_temp.g('prod_b') ->> 'id')), 4, 'E11: cada stock inicial queda como un movimiento «import» que cita el lote');
select is((select count(*)::int from public.product_categories where product_id = pg_temp.pid('IMP-100')) || '/' || (select count(*)::int from public.product_categories where product_id = pg_temp.pid('IMP-300')),
          '1/2', 'E12: las categorías se enlazan (IMP-300 en dos)');
select is((select count(*)::int from public.products where code in ('IMP-200', 'IMP-400', 'IMP 500', 'IMP-600', 'IMP-700', 'IMP-800', 'IMP-900')), 0,
          'E13: ninguna fila con error dejó su producto a medias (cada fila se deshace entera)');
select is((select count(*)::int from public.product_variants where sku in ('IMP-200-N', 'IMP-400-R', 'IMP-500-R', 'IMP-600-R', 'IMP-700-R', 'IMP-800-R', 'IMP-900-R')), 0, 'E15: y ninguna de sus variantes');
select is((select count(*)::int from public.import_batch_rows where batch_id = (pg_temp.g('prod_b') ->> 'id')::uuid and action = 'error'), 10, 'E16: los 10 errores quedan en el detalle del lote para el informe');
-- Reimportar el MISMO archivo: lo que ya existe se salta; el stock de lo existente NO se toca
select pg_temp.rec('prod_b2', pg_temp.apply('products', 'productos.csv', pg_temp.g('prod_rows')));
select is((pg_temp.g('prod_b2') ->> 'created_count') || '/' || (pg_temp.g('prod_b2') ->> 'updated_count') || '/' || (pg_temp.g('prod_b2') ->> 'skipped_count') || '/' || (pg_temp.g('prod_b2') ->> 'error_count'),
          '0/0/5/10', 'E17: reimportar el mismo archivo no crea ni cambia nada (5 iguales, los mismos 10 errores)');
select is(pg_temp.stk('IMP-100-R-S') || '/' || pg_temp.stk('IMP-100-R-M') || '/' || pg_temp.stk('IMP-300-G'), '5/7/2', 'E18: y el stock de lo que ya existía no se duplicó (para cambiarlo está la importación de stock)');
select is((select count(*)::int from public.product_variants where product_id in (pg_temp.pid('IMP-100'), pg_temp.pid('IMP-300'))), 5, 'E19: ni se duplicaron las variantes');
-- Actualizar un producto: nombre y precio nuevos (los vacíos NO borran nada)
select pg_temp.rec('prod_b3', pg_temp.apply('products', 'cambio.csv', '[{"row": 1, "code": "IMP-100", "name": "Blusa Imp v2", "price": "130", "color": "Rojo", "size": "S", "sku": "IMP-100-R-S"}]'));
select is((select name || '/' || description || '/' || round(cost_base, 2) from public.products where code = 'IMP-100'), 'Blusa Imp v2/Linda/30.00', 'E20: se actualiza el nombre; la descripción y el costo vacíos se conservan');
select is((select amount from public.product_prices where product_id = pg_temp.pid('IMP-100') and currency = 'BOB' and country is null), 130::numeric, 'E21: y el precio');
select is((pg_temp.g('prod_b3') ->> 'updated_count') || '/' || (pg_temp.g('prod_b3') ->> 'created_count'), '1/0', 'E22: cuenta como UNA actualización');
-- Revertir la actualización
select pg_temp.rec('prod_r3', public.admin_import_rollback((pg_temp.g('prod_b3') ->> 'id')::uuid));
select is((select name from public.products where code = 'IMP-100') || '/' || (select round(amount, 2) from public.product_prices where product_id = pg_temp.pid('IMP-100') and currency = 'BOB' and country is null),
          'Blusa Imp/120.00', 'E23: revertir el lote devuelve el nombre y el precio de antes');
-- Revertir NO pisa el trabajo posterior: otra persona renombra el producto a mano y entonces se revierte
select pg_temp.rec('prod_b4', pg_temp.apply('products', 'cambio2.csv', '[{"row": 1, "code": "IMP-100", "name": "Blusa Imp v3", "color": "Rojo", "size": "S", "sku": "IMP-100-R-S"}]'));
update public.products set name = 'Cambiado a mano' where code = 'IMP-100';
select pg_temp.rec('prod_r4', public.admin_import_rollback((pg_temp.g('prod_b4') ->> 'id')::uuid));
select is((select name from public.products where code = 'IMP-100'), 'Cambiado a mano', 'E24: si alguien lo cambió después, revertir NO lo pisa');
select is(pg_temp.g('prod_r4') #>> '{conflicts,0,reason}', 'changed_since', 'E25: y lo informa como conflicto («cambió después»)');
select is((select status from public.import_batches where id = (pg_temp.g('prod_b4') ->> 'id')::uuid), 'partially_rolled_back', 'E26: el lote queda «revertido en parte»');

-- Un error de la BASE (no de nuestras validaciones): un costo de 10 dígitos pasa nuestro formato pero rompe la restricción del producto.
-- La respuesta dice «db_error» y NUNCA devuelve los datos de la fila (el detalle de Postgres trae «Failing row contains (…)»).
select pg_temp.rec('dbx', public.admin_import_validate('products', '[{"row": 1, "code": "IMP-DBX", "name": "Costo imposible", "cost": "1000000000", "color": "Rojo", "sku": "IMP-DBX-R"}]'));
select is(pg_temp.g('dbx') #>> '{rows,0,errors,0,code}', 'db_error', 'E27: una restricción de la base sale como «db_error» (no como un 500)');
select is(pg_temp.g('dbx') #>> '{rows,0,errors,0,field}', '', 'E28: y sin el nombre de un campo inventado ni los datos de la fila');
select ok(pg_temp.g('dbx')::text not like '%Failing row%' and pg_temp.g('dbx')::text not like '%Costo imposible%', 'E29: la respuesta no contiene los datos de la fila (el detalle de Postgres sí los traía)');

-- ═══ F. Stock (conteo absoluto por SKU) ════════════════════════════════════════════════════
-- Reservas: IMP-100-R-S tiene 3 reservadas e IMP-300-G tiene 2. Stock hoy: R-S 5 · R-M 7 · A-S 0 · IMP-300-G 2
-- 1 R-S → 10 (actualiza +5) · 2 R-M → 7 (igual: se salta) · 3 A-S → 4 (actualiza +4) · 4 SKU inexistente · 5 R-S otra vez en el archivo ·
-- 6 V-S con stock «-1» · 7 IMP-300-G (en minúsculas) → 1, por debajo de las 2 reservadas · 8 sin SKU · 9 sin stock
insert into public.stock_reservations (variant_id, qty, owner_type, owner_id, status) values
  (pg_temp.vid('IMP-100-R-S'), 3, 'order', 'a2400000-0000-0000-0000-0000000000e1', 'active'),
  (pg_temp.vid('IMP-300-G'), 2, 'order', 'a2400000-0000-0000-0000-0000000000e2', 'active');
select pg_temp.rec('stk_rows', jsonb_build_array(
  jsonb_build_object('row', 1, 'sku', 'IMP-100-R-S', 'stock', '10'),
  jsonb_build_object('row', 2, 'sku', 'IMP-100-R-M', 'stock', '7'),
  jsonb_build_object('row', 3, 'sku', 'IMP-100-A-S', 'stock', '4'),
  jsonb_build_object('row', 4, 'sku', 'NOPE-1', 'stock', '1'),
  jsonb_build_object('row', 5, 'sku', 'IMP-100-R-S', 'stock', '11'),
  jsonb_build_object('row', 6, 'sku', 'IMP-100-V-S', 'stock', '-1'),
  jsonb_build_object('row', 7, 'sku', 'imp-300-g', 'stock', '1'),
  jsonb_build_object('row', 8, 'stock', '3'),
  jsonb_build_object('row', 9, 'sku', 'NOPE-2')));
insert into t_w values ('antes_stk', pg_temp.world());
select pg_temp.rec('stk_v', public.admin_import_validate('stock', pg_temp.g('stk_rows')));
select is(pg_temp.acts('stk_v'), '["update", "skip", "update", "error", "error", "error", "error", "error", "error"]'::jsonb, 'F1: la vista previa del stock: 2 actualizan, 1 igual y 6 fallan');
select is(pg_temp.errs('stk_v'), '[":", ":", ":", "sku_not_found:sku", "duplicate_in_file:sku", "invalid_format:stock", "below_reserved:stock", "required:sku", "required:stock"]'::jsonb,
          'F2: con el motivo de cada error (7: por debajo de lo reservado)');
select is(pg_temp.world(), (select v from t_w where k = 'antes_stk'), 'F3: la vista previa no movió ni una unidad (ni dejó movimientos)');
select is(pg_temp.stk('IMP-100-R-S') || '/' || pg_temp.stk('IMP-100-A-S'), '5/0', 'F4: el stock sigue igual antes de confirmar');
select pg_temp.rec('stk_b', pg_temp.apply('stock', 'conteo.csv', pg_temp.g('stk_rows')));
select is(pg_temp.stk('IMP-100-R-S') || '/' || pg_temp.stk('IMP-100-R-M') || '/' || pg_temp.stk('IMP-100-A-S') || '/' || pg_temp.stk('IMP-300-G'), '10/7/4/2', 'F5: confirmar deja R-S en 10 y A-S en 4; lo demás, igual');
select is((select string_agg(delta::text, ',' order by delta) from public.stock_movements where ref = 'import:' || (pg_temp.g('stk_b') ->> 'id')), '4,5', 'F6: cada cambio es un movimiento «import» que cita el lote (+4 y +5, nada por el que quedó igual)');
select is((pg_temp.g('stk_b') ->> 'updated_count') || '/' || (pg_temp.g('stk_b') ->> 'skipped_count') || '/' || (pg_temp.g('stk_b') ->> 'error_count'), '2/1/6', 'F7: 2 actualizadas, 1 igual, 6 errores');
-- El límite: igual a lo reservado SÍ se puede (3 de 3); uno menos, no
select is((public.admin_import_validate('stock', '[{"row": 1, "sku": "IMP-100-R-S", "stock": "3"}]') -> 'rows' -> 0 ->> 'action'), 'update', 'F8: dejar el stock EXACTAMENTE en lo reservado (3) se permite');
select is((public.admin_import_validate('stock', '[{"row": 1, "sku": "IMP-100-R-S", "stock": "2"}]') -> 'rows' -> 0 -> 'errors' -> 0 ->> 'code'), 'below_reserved', 'F9: uno menos (2) ya compromete pedidos: se rechaza');
select pg_temp.rec('stk_b2', pg_temp.apply('stock', 'conteo2.csv', '[{"row": 1, "sku": "IMP-100-R-S", "stock": "3"}]'));
select is(pg_temp.stk('IMP-100-R-S'), 3, 'F10: y queda en 3');
-- Revertir: con el stock movido DESPUÉS (3 ≠ 10) el lote A no se revierte; primero se revierte el B (3 → 10) y luego el A (10 → 5)
select pg_temp.rec('stk_ra', public.admin_import_rollback((pg_temp.g('stk_b') ->> 'id')::uuid));
select is(pg_temp.stk('IMP-100-R-S') || '/' || pg_temp.stk('IMP-100-A-S'), '3/0', 'F11: del lote A, A-S vuelve a 0 pero R-S NO (el lote B lo movió después: no se pisa)');
select is(pg_temp.g('stk_ra') #>> '{conflicts,0,reason}', 'stock_changed', 'F12: y lo informa («el stock cambió después»)');
select pg_temp.rec('stk_rb', public.admin_import_rollback((pg_temp.g('stk_b2') ->> 'id')::uuid));
select is(pg_temp.stk('IMP-100-R-S'), 10, 'F13: revertir el lote B devuelve R-S a 10');
select pg_temp.rec('stk_ra2', public.admin_import_rollback((pg_temp.g('stk_b') ->> 'id')::uuid));
select is(pg_temp.stk('IMP-100-R-S') || '/' || (pg_temp.g('stk_ra2') ->> 'reverted') || '/' || jsonb_array_length(pg_temp.g('stk_ra2') -> 'conflicts'), '5/1/0', 'F14: y ahora sí el A: R-S vuelve a 5 y ya no hay conflictos');
select is((select status from public.import_batches where id = (pg_temp.g('stk_b') ->> 'id')::uuid), 'rolled_back', 'F15: el lote A queda «revertido»');

-- ═══ G. Precios por moneda ═════════════════════════════════════════════════════════════════
-- IMP-300 tiene 150 BOB. 1 USD 20 (crea) · 2 BOB 150 (igual: se salta) · 3 producto inexistente · 4 precio 0 · 5 moneda desconocida ·
-- 6 IMP-300|USD repetido · 7 3 decimales en EUR · 8 producto sin precio escrito
select pg_temp.rec('pri_rows', jsonb_build_array(
  jsonb_build_object('row', 1, 'code', 'IMP-300', 'currency', 'USD', 'price', '20'),
  jsonb_build_object('row', 2, 'code', 'IMP-300', 'currency', 'BOB', 'price', '150'),
  jsonb_build_object('row', 3, 'code', 'NOPE-1', 'price', '10'),
  jsonb_build_object('row', 4, 'code', 'IMP-100', 'price', '0'),
  jsonb_build_object('row', 5, 'code', 'IMP-100', 'currency', 'XXX', 'price', '10'),
  jsonb_build_object('row', 6, 'code', 'IMP-300', 'currency', 'usd', 'price', '25'),
  jsonb_build_object('row', 7, 'code', 'IMP-100', 'currency', 'EUR', 'price', '10.555'),
  jsonb_build_object('row', 8, 'code', 'IMP-100', 'currency', 'ARS')));
select pg_temp.rec('pri_v', public.admin_import_validate('prices', pg_temp.g('pri_rows')));
select is(pg_temp.acts('pri_v'), '["create", "skip", "error", "error", "error", "error", "error", "error"]'::jsonb, 'G1: la vista previa de precios: 1 crea, 1 igual, 6 fallan');
select is(pg_temp.errs('pri_v'), '[":", ":", "product_not_found:code", "price_invalid:price", "currency_unknown:currency", "duplicate_in_file:code", "too_many_decimals:price", "required:price"]'::jsonb, 'G2: con su motivo (la moneda en minúsculas cuenta como la misma: «usd» repetida)');
select is((select count(*)::int from public.product_prices where product_id = pg_temp.pid('IMP-300') and currency = 'USD'), 0, 'G3: la vista previa no creó el precio');
select pg_temp.rec('pri_b', pg_temp.apply('prices', 'precios.csv', pg_temp.g('pri_rows')));
select is((select amount from public.product_prices where product_id = pg_temp.pid('IMP-300') and currency = 'USD' and country is null), 20::numeric, 'G4: confirmar crea el precio en USD');
select is((select amount from public.product_prices where product_id = pg_temp.pid('IMP-300') and currency = 'BOB' and country is null), 150::numeric, 'G5: y el de BOB queda como estaba');
select pg_temp.rec('pri_b2', pg_temp.apply('prices', 'precios2.csv', '[{"row": 1, "code": "IMP-300", "currency": "USD", "price": "22.5"}]'));
select is((select amount from public.product_prices where product_id = pg_temp.pid('IMP-300') and currency = 'USD' and country is null), 22.5::numeric, 'G6: un precio que ya existe se actualiza');
select pg_temp.rec('pri_r2', public.admin_import_rollback((pg_temp.g('pri_b2') ->> 'id')::uuid));
select is((select amount from public.product_prices where product_id = pg_temp.pid('IMP-300') and currency = 'USD' and country is null), 20::numeric, 'G7: revertir lo devuelve a 20');
select pg_temp.rec('pri_r', public.admin_import_rollback((pg_temp.g('pri_b') ->> 'id')::uuid));
select is((select count(*)::int from public.product_prices where product_id = pg_temp.pid('IMP-300') and currency = 'USD'), 0, 'G8: y revertir el lote que lo creó lo quita');

-- ═══ H. Revertir una creación: se ARCHIVA, no se borra ═════════════════════════════════════════
select pg_temp.rec('prod_r', public.admin_import_rollback((pg_temp.g('prod_b') ->> 'id')::uuid));
select is((select count(*)::int from public.products where code in ('IMP-100', 'IMP-300') and archived_at is not null), 2, 'H1: los productos que creó el lote quedan ARCHIVADOS (no se borran: podrían tener pedidos)');
select is((select count(*)::int from public.product_variants where product_id in (pg_temp.pid('IMP-100'), pg_temp.pid('IMP-300')) and archived_at is null), 0, 'H2: y sus variantes también');
select is(pg_temp.stk('IMP-100-R-S') || '/' || pg_temp.stk('IMP-100-R-M') || '/' || pg_temp.stk('IMP-100-V-S') || '/' || pg_temp.stk('IMP-300-G'), '0/0/0/0', 'H3: el stock inicial se compensa con un movimiento (el libro de stock no se borra)');
select is((select count(*)::int from public.product_prices where product_id in (pg_temp.pid('IMP-100'), pg_temp.pid('IMP-300'))), 0, 'H4: los precios que puso el lote se quitan');
select is((select count(*)::int from public.product_categories where product_id in (pg_temp.pid('IMP-100'), pg_temp.pid('IMP-300'))), 0, 'H5: y los enlaces a categorías');
select is(pg_temp.g('prod_r') ->> 'reverted', pg_temp.g('prod_r') ->> 'total', 'H6: se revirtió todo lo que había (sin conflictos)');
select is((select status from public.import_batches where id = (pg_temp.g('prod_b') ->> 'id')::uuid), 'rolled_back', 'H7: el lote queda «revertido»');
select is((select count(*)::int from public.stock_movements where ref = 'import:revertido:' || (pg_temp.g('prod_b') ->> 'id')), 4, 'H8: con un movimiento de compensación por cada stock inicial');
-- Un producto archivado no se «resucita» por un archivo: se explica
select is((public.admin_import_validate('products', '[{"row": 1, "code": "IMP-100", "color": "Rojo", "sku": "IMP-100-R-S"}]') -> 'rows' -> 0 -> 'errors' -> 0 ->> 'code'), 'product_archived',
          'H9: reimportar el código de un producto archivado se rechaza con un motivo claro (se restaura desde el panel)');
select is((public.admin_import_validate('stock', '[{"row": 1, "sku": "IMP-100-R-S", "stock": "1"}]') -> 'rows' -> 0 -> 'errors' -> 0 ->> 'code'), 'variant_archived', 'H10: y el stock de una variante archivada también');

-- ═══ I. El lote: historial, detalle y ciclo de vida ═══════════════════════════════════════
select ok((select count(*) from public.admin_import_batches(200)) >= 11, 'I1: el historial lista los lotes');
select is((select count(*)::int from public.admin_import_batches(1)), 1, 'I2: el límite se respeta');
select is((select total_count from public.admin_import_batch_rows((pg_temp.g('prod_b') ->> 'id')::uuid, 0, 5) limit 1), (select count(*) from public.import_batch_rows where batch_id = (pg_temp.g('prod_b') ->> 'id')::uuid), 'I3: el detalle trae el total del lote con cada página');
select is((select count(*)::int from public.admin_import_batch_rows((pg_temp.g('prod_b') ->> 'id')::uuid, 0, 5)), 5, 'I4: y pagina');
select throws_ok(format($$select public.admin_import_apply_chunk('%s', '[]')$$, pg_temp.g('prod_b') ->> 'id'), '22023', 'batch_closed', 'I5: a un lote ya cerrado no se le agregan filas');
select is((select (public.admin_import_finish((pg_temp.g('prod_b') ->> 'id')::uuid)) ->> 'status'), 'rolled_back', 'I6: cerrar de nuevo un lote revertido no cambia su estado');
select is((select count(*)::int from public.import_batches where status = 'applying'), 0, 'I7: ninguno quedó «en curso» (la prueba los cerró todos)');
-- Un lote a medias (se cerró la pestaña): queda «en curso», lo aplicado queda aplicado y se puede revertir
select pg_temp.rec('mid_id', to_jsonb(public.admin_import_start('categories', 'a-medias.csv', 4)));
select pg_temp.rec('mid_c', public.admin_import_apply_chunk((pg_temp.g('mid_id') #>> '{}')::uuid, '[{"row": 1, "name": "Mitad uno"}, {"row": 2, "name": "Mitad dos"}]'));
select is((select status from public.import_batches where id = (pg_temp.g('mid_id') #>> '{}')::uuid), 'applying', 'I8: un lote interrumpido queda «en curso»');
select is((select count(*)::int from public.categories where slug in ('mitad-uno', 'mitad-dos')), 2, 'I9: y lo que ya se aplicó queda aplicado, consistente');
select is((select created_count from public.import_batches where id = (pg_temp.g('mid_id') #>> '{}')::uuid), 2, 'I10: con su cuenta al día');
select pg_temp.rec('mid_r', public.admin_import_rollback((pg_temp.g('mid_id') #>> '{}')::uuid));
select is((select count(*)::int from public.categories where slug in ('mitad-uno', 'mitad-dos') and archived_at is not null), 2, 'I11: se puede revertir un lote en curso (archiva lo que alcanzó a crear)');
select is((select status from public.import_batches where id = (pg_temp.g('mid_id') #>> '{}')::uuid), 'rolled_back', 'I12: y queda «revertido»');

-- ═══ J. Auditoría y datos personales ═══════════════════════════════════════════════════════
select ok((select count(*) from public.audit_log where table_name = 'import_batches' and action = 'INSERT' and actor_id = pg_temp.u(1)) >= 1, 'J1: abrir un lote queda en la auditoría con SU administrador');
select ok((select count(*) from public.audit_log where table_name = 'import_batches' and action = 'UPDATE' and diff ? 'status') >= 1, 'J2: y cerrarlo o revertirlo también');
select ok((select count(*) from public.audit_log where table_name = 'products' and action = 'INSERT' and actor_id = pg_temp.u(1)
             and record_id = pg_temp.pid('IMP-100')::text) >= 1, 'J3: lo que la importación crea en el catálogo queda en la auditoría de ese catálogo, con el administrador que importó');

select * from finish();
rollback;

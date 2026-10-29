-- Datos de DESARROLLO (solo se cargan con `supabase db reset` en local; jamás en staging/producción).
-- Catálogo de ejemplo inspirado en el diseño de Made In Chola: 30 productos con colores, tallas, stock variado
-- (incluye agotados, ocultos por agotarse, un borrador y un archivado), categorías, colecciones, relacionados,
-- banner y el home. TODO el texto de ejemplo es PROVISIONAL: se reemplaza desde el panel de administración.
-- El stock inicial entra por el libro mayor (apply_stock_change), como en producción.
-- Las imágenes de ejemplo las sube `npm run dev:seed` (necesita la API de Storage).

do $seed$
declare
  p record;
  c text;
  s text;
  v_pid uuid;
  v_cid uuid;
  v_sid uuid;
  v_vid uuid;
  v_ci int;
  v_si int;
  v_idx int := 0;
  v_stock int;
  v_hex text;
begin
  -- ── Categorías (con subcategorías de Ropa) y colecciones ────────────────────────────────
  insert into public.categories (name, slug, sort_order) values
    ('Ropa', 'ropa', 1), ('Sombreros', 'sombreros', 2), ('Carteras', 'carteras', 3), ('Objetos', 'objetos', 4);
  insert into public.categories (parent_id, name, slug, sort_order)
    select r.id, x.n, public.slugify(x.n), x.o
      from public.categories r, (values ('Chaquetas', 1), ('Camisas', 2), ('Pantalones', 3)) x(n, o)
     where r.slug = 'ropa';
  insert into public.collections (name, slug, description, sort_order) values
    ('Verano 2027', 'verano-2027', 'Texto provisional: descripción de la colección de verano.', 1),
    ('NADAS', 'nadas', 'Texto provisional: descripción de la colección NADAS.', 2);
  insert into public.collections (name, slug, ends_at, sort_order) values
    ('Edición limitada 2026', 'edicion-limitada-2026', now() - interval '30 days', 3);   -- vencida: no sale en la tienda

  -- ── Productos ────────────────────────────────────────────────────────────────────────────
  -- (código, nombre, modelo, categoría, precio Bs, colores, tallas, nuevo, si se agota, estado, stock, materiales, cuidado)
  for p in select * from (values
    ('CHQ-001', 'Chaqueta Japandi',           'Japandi',    'chaquetas',  560.00, array['Blanco','Negro','Terracota'], array['XS','S','M','L'], true,  'sold_out', 'active',   'mixed', 'Cuero vegano, forro de algodón', 'Limpieza en seco'),
    ('CHQ-002', 'Chaqueta Aymara',            'Aymara',     'chaquetas',  640.00, array['Negro','Verde oliva'],        array['S','M','L'],      false, 'sold_out', 'active',   'mixed', 'Lana de oveja', 'Lavar a mano en frío'),
    ('CHQ-003', 'Campera Altiplano',          'Altiplano',  'chaquetas',  720.00, array['Gris'],                       array['M','L','XL'],     false, 'hide',     'active',   'mixed', 'Alpaca y poliéster', 'Limpieza en seco'),
    ('CMS-001', 'Camisa Pliegues',            'Pliegues',   'camisas',    380.00, array['Celeste','Blanco'],           array['XS','S','M'],     false, 'sold_out', 'active',   'mixed', 'Algodón orgánico', 'Lavar a máquina en frío'),
    ('CMS-002', 'Camisa Lino Cochabamba',     'Cochabamba', 'camisas',    340.00, array['Crudo','Azul'],               array['S','M','L'],      false, 'sold_out', 'active',   'mixed', 'Lino', 'Lavar a mano'),
    ('CMS-003', 'Blusa Bordada',              'Bordada',    'camisas',    420.00, array['Blanco'],                     array['XS','S','M','L'], true,  'sold_out', 'active',   'mixed', 'Algodón con bordado a mano', 'Lavar a mano'),
    ('PNT-001', 'Pantalón Pliegue',           'Pliegue',    'pantalones', 450.00, array['Negro','Arena'],              array['34','36','38','40'], false, 'sold_out', 'active', 'mixed', 'Gabardina', 'Lavar a máquina en frío'),
    ('PNT-002', 'Pantalón Palazzo',           'Palazzo',    'pantalones', 480.00, array['Crudo'],                      array['S','M','L'],      false, 'sold_out', 'active',   'mixed', 'Crepé', 'Lavar a mano'),
    ('PNT-003', 'Short Lino',                 'Short',      'pantalones', 260.00, array['Blanco','Negro'],             array['S','M','L'],      false, 'sold_out', 'active',   'mixed', 'Lino', 'Lavar a mano'),
    ('VST-001', 'Vestido Mokete',             'Mokete',     'ropa',       690.00, array['Azul pastel'],                array['XS','S','M','L'], true,  'sold_out', 'active',   'mixed', 'Satén de algodón', 'Lavar a mano'),
    ('VST-002', 'Vestido Camisero',           'Camisero',   'ropa',       610.00, array['Negro'],                      array['S','M'],          false, 'sold_out', 'active',   'zero',  'Algodón', 'Lavar a máquina en frío'),
    ('PON-001', 'Poncho Reversible',          'Reversible', 'ropa',       520.00, array['Rojo','Gris'],                array['Única'],          false, 'sold_out', 'active',   'mixed', 'Lana de oveja', 'Lavar a mano en frío'),
    ('SMB-001', 'Chakra naranja',             'Chakra',     'sombreros',  450.50, array['Naranja'],                    null,                    true,  'sold_out', 'active',   'mixed', 'Fieltro de lana teñido a mano', 'Cepillar en seco'),
    ('SMB-002', 'Chakra amarillo',            'Chakra',     'sombreros',  450.50, array['Amarillo'],                   null,                    true,  'sold_out', 'active',   'mixed', 'Fieltro de lana teñido a mano', 'Cepillar en seco'),
    ('SMB-003', 'Chakra rosa',                'Chakra',     'sombreros',  450.50, array['Rosa'],                       null,                    false, 'sold_out', 'active',   'mixed', 'Fieltro de lana teñido a mano', 'Cepillar en seco'),
    ('SMB-004', 'Sombrero Cowboy azul',       'Cowboy',     'sombreros',  520.00, array['Azul'],                       array['54','56','58','60'], false, 'sold_out', 'active', 'mixed', 'Fieltro de lana', 'Cepillar en seco'),
    ('SMB-005', 'Sombrero Borsalino Chola',   'Borsalino',  'sombreros',  580.00, array['Marrón','Negro'],             array['56','58','60'],   false, 'sold_out', 'active',   'mixed', 'Fieltro de lana', 'Cepillar en seco'),
    ('SMB-006', 'Sombrero Paja Toquilla',     'Toquilla',   'sombreros',  390.00, array['Crudo'],                      null,                    false, 'sold_out', 'active',   'mixed', 'Paja toquilla', 'No mojar'),
    ('SMB-007', 'Gorro Alpaca',               'Alpaca',     'sombreros',  180.00, array['Gris','Negro'],               null,                    false, 'sold_out', 'active',   'mixed', 'Alpaca', 'Lavar a mano en frío'),
    ('CRT-001', 'Cartera Cordón Verde',       'Cordón',     'carteras',   300.00, array['Negro'],                      null,                    false, 'sold_out', 'active',   'zero',  'Fieltro y cordón de nylon', 'Limpiar con paño húmedo'),
    ('CRT-002', 'Bolso Tejido',               'Tejido',     'carteras',   340.00, array['Natural','Negro'],            null,                    false, 'sold_out', 'active',   'mixed', 'Fibra natural tejida', 'Limpiar con paño húmedo'),
    ('CRT-003', 'Mochila Awayo',              'Awayo',      'carteras',   410.00, array['Multicolor'],                 null,                    true,  'sold_out', 'active',   'mixed', 'Tejido andino (awayo)', 'Lavar a mano'),
    ('CRT-004', 'Cartera Mano Cuero',         'Mano',       'carteras',   480.00, array['Café'],                       null,                    false, 'sold_out', 'active',   'mixed', 'Cuero', 'Limpiar con paño húmedo'),
    ('CRT-005', 'Riñonera Bordada',           'Riñonera',   'carteras',   220.00, array['Negro','Rojo'],               null,                    false, 'hide',     'active',   'zero',  'Algodón con bordado', 'Lavar a mano'),
    ('OBJ-001', 'Cinturón Cuero',             'Cinturón',   'objetos',    160.00, array['Negro','Café'],               array['S','M','L'],      false, 'sold_out', 'active',   'mixed', 'Cuero', 'Limpiar con paño húmedo'),
    ('OBJ-002', 'Bufanda Alpaca',             'Bufanda',    'objetos',    210.00, array['Gris','Crudo'],               null,                    false, 'sold_out', 'active',   'mixed', 'Alpaca', 'Lavar a mano en frío'),
    ('OBJ-003', 'Aros Plata Chola',           'Aros',       'objetos',     95.00, array['Plata'],                      null,                    false, 'sold_out', 'active',   'mixed', 'Plata 925', 'Guardar en seco'),
    ('OBJ-004', 'Llavero Tejido',             'Llavero',    'objetos',     45.00, array['Multicolor'],                 null,                    false, 'sold_out', 'active',   'mixed', 'Hilo de algodón', 'Lavar a mano'),
    ('DRF-001', 'Colección Otoño (borrador)', 'Otoño',      'ropa',       500.00, array['Negro'],                      array['S','M'],          false, 'sold_out', 'draft',    'zero',  'Por definir', 'Por definir'),
    ('ARC-001', 'Chaqueta Descontinuada',     'Descont.',   'chaquetas',  400.00, array['Negro'],                      array['M'],              false, 'sold_out', 'archived', 'mixed', 'Cuero vegano', 'Limpieza en seco')
  ) as t(code, name, model, cat, price, colors, sizes, is_new, behavior, state, stockmode, materials, washcare)
  loop
    insert into public.products (code, slug, name, model, description, materials, washcare, cost_base, out_of_stock_behavior, is_new)
    values (p.code, public.slugify(p.name), p.name, p.model,
            'Prenda hecha a mano en Bolivia. Descripción provisional: se reemplaza desde el panel de administración.',
            p.materials, p.washcare, round(p.price * 0.38, 2), p.behavior, p.is_new)
    returning id into v_pid;

    v_ci := 0;
    foreach c in array p.colors loop
      v_ci := v_ci + 1;
      v_hex := case c
        when 'Blanco' then '#EAE9E1' when 'Negro' then '#303030' when 'Terracota' then '#C0553A'
        when 'Verde oliva' then '#6B7A3A' when 'Gris' then '#9A9A9A' when 'Celeste' then '#A9C4E8'
        when 'Crudo' then '#E6DCC8' when 'Azul' then '#2F55A4' when 'Azul pastel' then '#B7C9EC'
        when 'Arena' then '#D6C3A1' when 'Naranja' then '#E8702A' when 'Amarillo' then '#E5C32E'
        when 'Rosa' then '#E78FB6' when 'Marrón' then '#6B4A2F' when 'Natural' then '#D9C7A5'
        when 'Café' then '#5A3B22' when 'Rojo' then '#B22A2A' when 'Plata' then '#C0C0C0' else null end;
      insert into public.product_colors (product_id, name, hex, sort_order) values (v_pid, c, v_hex, v_ci)
      returning id into v_cid;

      if p.sizes is null then
        insert into public.product_variants (product_id, color_id) values (v_pid, v_cid) returning id into v_vid;
        v_idx := v_idx + 1;
        v_stock := case p.stockmode when 'zero' then 0 else (v_idx * 7 + 3) % 14 end;
        if v_stock > 0 then
          perform public.apply_stock_change(v_vid, v_stock, 'import', 'seed de desarrollo');
        end if;
      else
        v_si := 0;
        foreach s in array p.sizes loop
          v_si := v_si + 1;
          -- La talla se crea una sola vez por producto (con el primer color) y se reutiliza.
          select z.id into v_sid from public.product_sizes z where z.product_id = v_pid and z.label = s;
          if v_sid is null then
            insert into public.product_sizes (product_id, label, sort_order) values (v_pid, s, v_si) returning id into v_sid;
          end if;
          insert into public.product_variants (product_id, color_id, size_id) values (v_pid, v_cid, v_sid) returning id into v_vid;
          v_idx := v_idx + 1;
          v_stock := case p.stockmode when 'zero' then 0 else (v_idx * 7 + 3) % 14 end;
          if v_stock > 0 then
            perform public.apply_stock_change(v_vid, v_stock, 'import', 'seed de desarrollo');
          end if;
        end loop;
      end if;
    end loop;

    insert into public.product_prices (product_id, currency, amount) values (v_pid, 'BOB', p.price);
    insert into public.product_categories (product_id, category_id)
      select v_pid, k.id from public.categories k where k.slug = p.cat;

    if p.state in ('active', 'archived') then
      update public.products set status = 'active' where id = v_pid;
    end if;
    if p.state = 'archived' then
      update public.products set archived_at = now() where id = v_pid;
    end if;
  end loop;

  -- ── Colecciones y relacionados ───────────────────────────────────────────────────────────
  insert into public.product_collections (product_id, collection_id, sort_order)
    select pr.id, co.id, x.o
      from (values ('verano-2027', 'CHQ-001', 1), ('verano-2027', 'CMS-001', 2), ('verano-2027', 'VST-001', 3),
                   ('verano-2027', 'SMB-001', 4), ('verano-2027', 'SMB-002', 5), ('verano-2027', 'SMB-003', 6),
                   ('verano-2027', 'CRT-003', 7),
                   ('nadas', 'CHQ-001', 1), ('nadas', 'SMB-001', 2), ('nadas', 'CRT-001', 3), ('nadas', 'CMS-001', 4),
                   ('edicion-limitada-2026', 'CHQ-002', 1)) x(col, code, o)
      join public.collections co on co.slug = x.col
      join public.products pr on pr.code = x.code;
  insert into public.product_related (product_id, related_id, sort_order)
    select a.id, b.id, x.o
      from (values ('CHQ-001', 'SMB-001', 0), ('CHQ-001', 'CRT-001', 1), ('CHQ-001', 'CMS-001', 2), ('CHQ-001', 'PNT-001', 3),
                   ('SMB-001', 'SMB-002', 0), ('SMB-001', 'SMB-003', 1), ('SMB-001', 'CHQ-001', 2)) x(pa, pb, o)
      join public.products a on a.code = x.pa
      join public.products b on b.code = x.pb;

  -- ── Banner de noticias ──────────────────────────────────────────────────────────────────
  insert into public.news_banners (message, link_url) values
    ('Hecho a mano en Bolivia. Texto provisional del banner.', '/tienda');

  -- ── Home (estructura del diseño; textos provisionales, sin imágenes: la UI muestra placeholders) ─
  insert into public.home_sections (kind, sort_order, title, body, cta_label, cta_url) values
    ('hero', 1, 'Verano 2027', 'Texto provisional: descripción de la colección de verano.', 'Ver colección', '/coleccion/verano-2027');
  insert into public.home_sections (kind, sort_order, title, cta_label, cta_url, source_type, item_limit) values
    ('product_row', 2, 'Lo más popular', 'Ver todo', '/tienda', 'latest', 4);
  insert into public.home_sections (kind, sort_order, title, body, cta_label, cta_url, source_type, source_collection_id, item_limit)
    select 'collection_feature', 3, 'Colección NADAS', 'Texto provisional: descripción de la colección.', 'Ver toda la colección',
           '/coleccion/nadas', 'collection', co.id, 2 from public.collections co where co.slug = 'nadas';
  insert into public.home_sections (kind, sort_order, title, body) values
    ('about', 4, 'Sobre nosotros', 'Texto provisional: la historia de Made In Chola, hecha a mano.');
  insert into public.home_sections (kind, sort_order, title, cta_label, cta_url, source_type, source_category_id, item_limit)
    select 'product_row', 5, 'Sombreros', 'Ver todo', '/categoria/sombreros', 'category', k.id, 4
      from public.categories k where k.slug = 'sombreros';
  insert into public.home_sections (kind, sort_order) values ('banner', 6);
  insert into public.home_sections (kind, sort_order, title) values ('tagline', 7, 'El futuro está hecho a mano');
  insert into public.home_sections (kind, sort_order, title) values ('category_tiles', 8, null);
  insert into public.home_section_items (section_id, sort_order, label, link_url, category_id)
    select s.id, x.o, k.name, '/categoria/' || k.slug, k.id
      from public.home_sections s
      cross join (values ('carteras', 1), ('objetos', 2), ('ropa', 3)) x(slug, o)
      join public.categories k on k.slug = x.slug
     where s.kind = 'category_tiles';

  -- Textos de los acordeones del detalle (en producción quedan vacíos hasta que el admin los redacte).
  update public.store_settings set value = '"Texto provisional: política de envíos y devoluciones."' where key = 'pdp_shipping_return_text';
  update public.store_settings set value = '"Texto provisional: ¿necesitas ayuda? Escríbenos por WhatsApp."' where key = 'pdp_assistance_text';
end
$seed$;

# Sprint 2 — Modelo de catálogo, monedas e inventario

**Release:** R1 · **Estimación:** 3 días · **Depende de:** S0, S1 (`is_admin()`, `audit_changes()`)

## Objetivo
Construir toda la capa de datos del catálogo: productos con variantes, precios por país/moneda, imágenes, categorías/colecciones, tipo de cambio, configuración de tienda e inventario con reservas atómicas. Todo con RLS, auditoría y tests, **sin UI** todavía.

## Alcance
**Dentro:** migraciones, RLS, vistas públicas, RPC de stock, Storage de imágenes, servicios TypeScript tipados, seeds de prueba.
**Fuera:** pantallas (S3, S5), carrito (S7), pedidos (S10).

## Reglas de negocio cubiertas
BR-CAT-01..06, BR-INV-01..06, BR-PRC-01, BR-PRC-02, BR-PRC-06, BR-DAT-01, BR-DAT-02, S-03.

## Tareas

### Esquema (ver maestro §6)
- [ ] `countries`, `currencies` (BOB activa; ARS/EUR/USD creadas pero deshabilitadas), `exchange_rates` (modo `fixed|variable`, historial; la tasa vigente es la última por fecha).
- [ ] `categories` (jerárquica con `parent_id`, evitar ciclos), `collections`.
- [ ] `products`, `product_categories`, `product_collections`, `product_colors`, `product_sizes`, `product_variants`, `product_images`, `product_prices`, `product_delivery`, `product_related`.
- [ ] Restricciones: único `(product_id, color_id, size_id)` (tratando `size_id NULL` correctamente), `slug` y `código` únicos globales incluyendo archivados, precios `>= 0`, stock `>= 0`, un solo precio por `(producto, moneda, país)`.
- [ ] `store_settings` (clave/valor tipado) con claves iniciales: umbrales amarillo/rojo, TTL de reserva (10 min), moneda base, WhatsApp destino, banner.
- [ ] `news_banners`.
- [ ] `stock_movements` (inmutable: sin UPDATE/DELETE) y `stock_reservations`.
- [ ] Soft-delete: `archived_at` + **bloquear DELETE** físico por RLS/trigger en tablas de catálogo.
- [ ] Triggers `updated_at` y `audit_changes()` en todas las tablas de negocio.

### Lógica de BD
- [ ] Vista `variant_availability`: `stock_on_hand − reservas vigentes` (≥ 0).
- [ ] Estado de stock por producto/variante con **semáforo** (`ok|low|critical|out`) según umbrales (globales con override por variante).
- [ ] RPC `reserve_stock(variant_id, qty, owner_type, owner_id)`: atómica (`FOR UPDATE`), idempotente por owner, respeta TTL.
- [ ] RPC `release_stock(...)` y job `expire_reservations()` (pg_cron cada minuto).
- [ ] RPC `adjust_stock(variant_id, delta, motivo)` solo admin; genera `stock_movements`.
- [ ] Función `price_for(product_id, currency, country)`: precio explícito → o cálculo por tipo de cambio, redondeo a 2 decimales, reglas definidas en maestro §7.1.
- [ ] Vistas públicas `public_products`, `public_product_detail` que **excluyen** archivados y aplican `out_of_stock_behavior` (`hide` oculta, `sold_out` muestra agotado). Nunca exponen `costo`.
- [ ] Búsqueda: índice `pg_trgm` + `unaccent` sobre nombre/modelo/código.

### RLS
- [ ] Público (anon): solo `SELECT` a vistas públicas y tablas necesarias de lectura (categorías, colecciones activas, banner).
- [ ] Admin: CRUD (sin DELETE físico) en catálogo.
- [ ] `costo` y `stock_movements` **no** visibles a no-admin.

### Storage
- [ ] Bucket `product-images` público de lectura, escritura solo admin; límites de tipo (jpg/png/webp/avif) y tamaño; convención de rutas `products/{id}/{uuid}.ext`.

### Código cliente
- [ ] Tipos generados; servicios tipados `catalogService`, `stockService`, `priceService` + hooks TanStack Query con claves de caché consistentes.
- [ ] Seed de desarrollo: ~30 productos realistas con variantes, imágenes dummy y stock variado (incluye agotados y ocultos).

## Criterios de aceptación
1. Migraciones aplican y se revierten limpiamente desde cero.
2. Anon ve solo productos activos/permitidos y **nunca** el costo ni archivados.
3. `reserve_stock` jamás deja `available < 0` bajo 200 intentos concurrentes sobre 1 unidad (exactamente 1 gana).
4. `price_for` devuelve lo esperado en los casos explícito/calculado/redondeo.
5. DELETE físico en catálogo es imposible para cualquier rol de aplicación.
6. Cambios se registran en `audit_log`.

## Testing
- **SQL/RLS:** matriz de roles por tabla; vistas públicas; intento de leer `costo`; intento de DELETE; archivado oculta en listados pero no rompe FK de futuros pedidos.
- **Concurrencia:** script con N conexiones paralelas contra `reserve_stock` (1 unidad / 200 intentos; 10 unidades / 50 pedidos de 3); verifica invariantes y ausencia de deadlocks (orden de locks consistente por `variant_id`).
- **Unit:** `price_for` y cálculo de semáforo (límites exactos de umbrales), normalización de slug (acentos, ñ, espacios).
- **Integración:** expiración de reservas con `pg_cron` (adelantar reloj en test), idempotencia de `reserve_stock` con mismo owner.
- **Datos:** seeds cargan sin violar constraints; migración sobre datos existentes (no destructiva).

## Edge cases
- Producto sin tallas (talla opcional) vs. con tallas: unicidad con `size_id NULL`.
- Producto con 1 color y 0 imágenes; imagen asignada a un color que luego se elimina/archiva.
- Cambiar `out_of_stock_behavior` con reservas vigentes.
- Variante archivada con reservas activas → liberar y notificar, no romper carritos.
- Stock ajustado a un valor menor que lo reservado (queda "sobrecomprometido"): decidir regla (bloquear ajuste o permitir y marcar alerta). **Propuesta:** bloquear por debajo de lo comprometido.
- Precio 0, precios negativos, precios con >2 decimales en la entrada.
- Moneda deshabilitada con productos que aún tienen precios en ella.
- Tipo de cambio 0, negativo o ausente → fallar de forma controlada, no mostrar precios erróneos.
- Slug duplicado al renombrar; slug de producto archivado reutilizado.
- Categoría padre archivada con hijos; ciclo padre→hijo→padre.
- Producto en 0 categorías / en muchas.
- Zona horaria de vigencia de colecciones/banners.
- Reintentos del cliente (doble clic) en `reserve_stock` → idempotente.

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de índices (EXPLAIN) en listados y búsqueda.
- [ ] Revisión de `SECURITY DEFINER` en RPC de stock.
- [ ] Confirmar ausencia de N+1 en vistas públicas.
- [ ] Documentar el diccionario de datos actualizado.

## Riesgos
- Lógica de variantes con `NULL` en unique → usar índices parciales/`COALESCE`.
- Aclarar S-03 ("delivery (N)") antes de fijar `product_delivery`.

## Pendientes externos
Confirmación S-03; umbrales iniciales del semáforo (PENDIENTES_ADMIN §F).

## Entregables para sprints siguientes
Esquema completo de catálogo/inventario/moneda, RPC de stock, vistas públicas, buckets, servicios y hooks, seeds.

---

## Decisiones del admin que afectan a este sprint (2026-10-28)
Fuente: [../PENDIENTES_ADMIN.md](../PENDIENTES_ADMIN.md), sección "Datos del negocio confirmados".
- [ ] **Seed de `store_settings`** con `contact_email`, `contact_phone`, `whatsapp_orders`, `social_instagram`, `social_tiktok`, `social_facebook`, `social_youtube` (valores en PENDIENTES_ADMIN; teléfonos en E.164). Lectura pública (anon) de estas claves y escritura solo admin. Consumidores: Footer (S4), JSON-LD `Organization.sameAs` (S5), botón de WhatsApp (S10); S3 las edita en "Ajustes".
- [ ] Los precios **incluyen impuestos**; el envío se suma aparte (cuestionario 2.1; interpretación por confirmar).

---

## Estado real de entrega (2026-10-28)

**Entregado:** 5 migraciones (catálogo base, productos, inventario, precios y vistas públicas, Storage y home) con 20 tablas nuevas · libro mayor de stock inmutable y reservas atómicas (`reserve_stock`, `release_stock`, `expire_reservations` con `pg_cron` cada minuto, `adjust_stock`, semáforo) · precios por moneda/país con tipo de cambio (`price_for`, `public_price_for`) · 15 vistas públicas (la única puerta de lectura de `anon`) y 2 vistas de admin · búsqueda sin acentos (`pg_trgm` + `unaccent`) · 3 buckets de Storage con rutas validadas · **contenido del home editable** (secciones y elementos con imagen o video, pedido por el dueño) · `store_settings` con los datos del negocio confirmados (WhatsApp, contacto, redes) · RPC `admin_set_product_categories|collections|related` y `admin_delete_product_price` · plantilla reutilizable `_apply_admin_rls` · capa cliente `src/features/catalog` (servicios, mapeadores, hooks de TanStack Query, `slugify`) · seed de desarrollo de 30 productos con casos límite e imágenes de ejemplo provisionales.

**Desviaciones respecto al plan (y por qué):**
- **Escritura del admin = INSERT/UPDATE por columnas bajo RLS**, no un RPC por tabla (es lo que dice la sección RLS de este documento). La regla de S1 "authenticated no inserta en ninguna tabla" pasó a una **lista blanca por columnas**; el test estructural de S1 no veía privilegios de columna (`has_table_privilege` los ignora), así que se reescribió. **Nadie, ni `service_role`, puede `DELETE`/`TRUNCATE`**: se archiva (solo `REVOKE`, sin trigger de respaldo). Las asociaciones se reemplazan con RPC.
- **`anon` no tiene privilegios sobre ninguna tabla** (el plan permitía leer categorías y banner directo): todo es por vistas `public_*`.
- **`reserve_stock`/`release_stock`/`apply_stock_change` solo las ejecuta `service_role`** (las llamará una Edge Function en S7, con los topes de D-02). El navegador nunca reserva stock.
- **Precio > 0** (el plan decía ≥ 0) y **se rechazan más decimales de los que admite la moneda** en vez de redondear en silencio. El precio en BOB (moneda base) es siempre el general, sin país; un precio por país solo en la moneda de ese país.
- **No implementado, a propósito:** `product_delivery` (supuesto S-03 sin confirmar con el dueño) · "DESDE $X" del diseño (el modelo tiene un precio por producto, no por variante) · guía de tallas (S5) · nota del pedido (S7) · notificar al liberar reservas de una variante archivada (S13, outbox) · alertas de stock por correo, BR-INV-05 (S13).
- `default_out_of_stock_behavior` existe como ajuste, pero lo consumirá el formulario de producto de S3 (la columna tiene `sold_out` por defecto). `exchange_rates.mode` se guarda pero `price_for` lo ignora (lo "variable" será futuro).
- Archivar un **color o talla archiva sus variantes** (cascada) y no se puede archivar la **última variante de un producto publicado**. Archivar/despublicar libera las retenciones de **carrito**, jamás los compromisos firmes de **pedidos**.
- "Ocultar" un producto agotado depende del **stock físico** (que un carrito retenga las últimas unidades no lo hace desaparecer; se muestra como agotado).

**Verificación:** SQL 724 asserts pgTAP (11 archivos) · 410 unitarios/componentes · 15 Deno · 119 (71 nuevos de S2) de integración (HTTP real, Storage real, concurrencia real, `pg_cron` real) · 58 (sin cambios: S2 no añade pantallas) E2E. Valores esperados calculados a mano (precios con redondeo, semáforo en sus límites exactos, recuentos de visibilidad).
- **Pruebas de mutación: 47 bugs inyectados a propósito, 47 detectados** (31 sobre la primera versión, 15 sobre las correcciones de la revisión, y la eliminación del `FOR UPDATE` de `reserve_stock`). Dos "muertes" iniciales eran fallos intermitentes del `db reset`, no detecciones: se repitieron aisladas. **Ojo con un detector débil:** la prueba de "200 intentos por HTTP sobre 1 unidad" pasó incluso sin el bloqueo (el pool de PostgREST no provocó la carrera); quien de verdad lo detecta es la de **30 sesiones SQL independientes liberadas a la vez con una barrera** y la de 50 pedidos de 3 sobre 10.
- **Revisión independiente** (otro agente, sin conocer mis conclusiones): 15 hallazgos, todos corregidos o documentados. Los reales: archivar liberaba stock firme de pedidos · el precio del listado podía diferir del cobrado · la auditoría dejaba `record_id` nulo en tablas sin `id` · variantes "fantasma" tras archivar un color · "Ocultar" parpadeaba con reservas · un precio erróneo no se podía quitar · el home exponía ids de entidades no públicas.

**Bugs reales que encontraron los propios tests:** las vistas fallaban para `anon` porque PostgreSQL ejecuta las funciones de una vista con los permisos de **quien consulta** (los `count(*)` lo ocultaban al descartar columnas) · el SKU automático chocaba al recrear una variante archivada · el mensaje de `adjust_stock` al restar de más era engañoso · `slugify` en TypeScript difería del SQL en `þ`, `ð` y 17 caracteres más (hoy hay paridad exacta en U+00A0–U+017F; Latin Extendido-B no está cubierto, ahí el slug sigue siendo válido pero la vista previa puede diferir).

**Riesgos y notas para sprints siguientes:**
- **S10:** `create_order` debe reservar con `owner_type='order'` y crear el pedido en la **misma transacción** (esas reservas no vencen ni tienen FK al pedido: si se cae entre medias queda stock retenido sin barredor). `apply_stock_change` no consume la reserva del pedido: S10 debe hacerlo de forma atómica o el disponible se descuenta dos veces. Al convertir carrito → pedido hay que excluir la reserva de carrito del propio cliente.
- **S7:** llamar a `reserve_stock` desde una Edge Function con límites por sesión/variante (D-02) y token anónimo.
- **S3:** el panel debe pedir confirmación ante un tipo de cambio muy distinto del anterior o con fecha lejana (`exchange_rates` es inmutable: un error de tipeo no se corrige, solo se supera con otra fila) · el formulario usa `default_out_of_stock_behavior` · la vista previa del slug usa `slugify` (paridad hasta U+017F).
- **S5:** el listado filtrado por categoría/colección pasa los ids por la URL (tope 200; si el catálogo crece, mover el filtro a SQL) · las vistas hijas hacen `product_id in (select id from public_products)`: medir con `EXPLAIN` a escala real (S16).
- **Nube:** activar `pg_cron` en el proyecto de Supabase o las reservas vencidas no se marcarán `expired` (igual dejan de contar, porque la vista usa `expires_at`).
- **Aceptados:** el admin puede borrar de Storage un archivo aún referenciado (no hay FK posible) · una variante sin talla puede convivir con variantes del mismo color con talla.
- **Provisionales:** umbrales del semáforo 5/2 (a confirmar con el admin) · los precios incluyen impuestos y el envío se suma aparte (desglose fiscal pendiente).
- **Bundle:** sin cambios (S2 no añade pantallas ni dependencias de ejecución).

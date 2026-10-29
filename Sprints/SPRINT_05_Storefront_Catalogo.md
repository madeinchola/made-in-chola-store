# Sprint 5 — Storefront: home, listado, detalle y SEO base

**Release:** R1 (cierre del MVP) · **Estimación:** 5 días · **Depende de:** S2 (vistas públicas), S3 (productos cargados), S4 (componentes UI)

## Objetivo
La tienda pública navegable, rápida y bonita: el cliente descubre, filtra y consulta productos con precios en su moneda, y los buscadores/redes sociales pueden indexarlos y previsualizarlos.

## Alcance
**Dentro:** home (banner de noticias, colecciones, destacados), listado por categoría/colección, búsqueda, filtros y orden, detalle de producto con selección de variante, precios por moneda, estados agotado/oculto, productos relacionados (cross-sell), SEO base (meta, OG, JSON-LD, sitemap, robots, preview para bots), rendimiento, analytics preparado.
**Fuera:** carrito (S7), cuentas (S6), checkout (S10), píxeles reales (S15).

> **Opcional MVP vendible:** botón "Consultar por WhatsApp" en el detalle (`wa.me` con producto, color, talla y precio). Sin pedidos ni cuentas; no genera dependencias futuras.

## Reglas de negocio cubiertas
BR-CAT-02, BR-CAT-03, BR-CAT-04, BR-INV-05 (visual), BR-PRC-01, BR-PRC-02, BR-PRC-06, BR-ADM-04, BR-MKT-03, BR-MKT-04, D-01.

## Tareas

### Páginas
- [ ] **Home:** `AnnouncementBar` (banner admin), hero, colecciones, categorías, nuevos/destacados, bloque de confianza (envíos, pagos).
- [ ] **Listado** `/categoria/:slug` y `/coleccion/:slug`: grilla responsive, filtros (color, talla, precio, disponibilidad), orden (nuevos, precio ↑↓), paginación o "cargar más" con URL sincronizada.
- [ ] **Búsqueda** `/buscar?q=`: tolerante a acentos/errores (`pg_trgm`), sugerencias, sin resultados útil.
- [ ] **Detalle** `/producto/:slug`: galería (por color), selector de color y talla con disponibilidad por variante, precio final, descripción, materiales, cuidado (washcare), **delivery estimado** (S-03), modelo/código, productos relacionados.
- [ ] Estados: **Agotado** (visible, no comprable), **Ocultar** (404 amigable/redirección a categoría), "Pocas unidades" (según semáforo, sin exponer números exactos si no se desea).
- [ ] Selector de **país/moneda** (oculto mientras solo exista BOB, pero listo); formato por moneda.
- [ ] 404, error y página mantenimiento con la identidad visual.

### Datos y rendimiento
- [ ] Consumo exclusivo de **vistas públicas** (S2); caché con TanStack Query (`staleTime`), prefetch en hover.
- [ ] Imágenes: tamaños responsivos (`srcset`), `loading="lazy"` (excepto LCP), formatos modernos, `aspect-ratio`.
- [ ] Code-splitting por ruta; presupuesto de peso definido.
- [ ] Skeletons y estados de error con reintento.

### SEO (decisión D-01)
- [ ] Meta dinámicos (título/descripción) por página; canonical; paginación (`rel`) y filtros sin indexar variaciones infinitas.
- [ ] **Edge function en Vercel** que sirve HTML con meta/OG/JSON-LD `Product` (precio, disponibilidad, marca, imagen) a bots (Googlebot, Facebook, WhatsApp, Twitter/X…).
- [ ] `sitemap.xml` dinámico (solo activos), `robots.txt`; URLs con slug limpio; redirección de slugs antiguos (S3).
- [ ] Datos estructurados `Organization`, `BreadcrumbList`, `Product`/`Offer`.
- [ ] Evaluación D-01: medir indexación y previews; documentar decisión (mantener SPA+Edge o migrar storefront).

### Analytics preparado
- [ ] Capa `track(event, payload)` con eventos `view_item_list`, `view_item`, `search`; **sin proveedor** hasta tener IDs (S15).

## Criterios de aceptación
1. El cliente navega de home → categoría → producto en móvil con fluidez.
2. Un producto agotado/oculto se comporta como configuró el admin, y vuelve solo al reponer.
3. Compartir un link de producto en WhatsApp/Facebook muestra imagen, título y precio.
4. Lighthouse móvil: Performance ≥ 85, Accesibilidad ≥ 95, SEO ≥ 95 en home y producto.
5. Ninguna llamada pública expone costo, archivados ni datos de stock internos.
6. Filtros y orden persisten en la URL y funcionan con el botón atrás.

## Testing
- **Unit:** formateo de precios por moneda, selección de variante (combinaciones válidas/no disponibles), construcción de query de filtros, helpers de SEO (JSON-LD correcto).
- **Componentes:** selector de variante (deshabilita tallas sin stock según color), galería por color, estados agotado.
- **Integración:** consultas contra BD local con seeds (filtros combinados, búsqueda con acentos, orden, paginación).
- **E2E (Playwright):** navegación completa móvil y escritorio; búsqueda; producto agotado; producto oculto por URL directa; cambio de variante actualiza imagen/precio/stock; deep link con filtros.
- **SEO:** validar JSON-LD (Rich Results Test), previews con depurador de OG, `curl` con UA de bot, sitemap válido.
- **Rendimiento:** Lighthouse CI en PR; verificación de LCP/CLS con red 4G lenta.
- **Seguridad:** intento de leer columnas privadas vía API REST con `anon`.

## Edge cases
- Producto sin imágenes, con una sola imagen, o con imágenes de color sin stock.
- Producto con todas las variantes agotadas pero con `sold_out` vs. `hide`.
- Última unidad: la UI muestra disponible, pero otro cliente la reserva → manejar en S7 (aquí evitar prometer más de lo mostrado y refrescar datos al enfocar la pestaña).
- Talla única / sin tallas; color único.
- Descripción larga con saltos de línea/listas; texto con emojis.
- Slug inexistente, archivado, o con mayúsculas/trailing slash → 404 o redirección correcta, sin pantalla en blanco.
- Búsqueda: vacía, solo espacios, caracteres especiales, inyección (`%`, `'`), consulta muy larga; sin resultados.
- Filtros que dejan 0 resultados; combinaciones inválidas en la URL manipulada.
- Páginas con 1 000+ productos: paginación, memoria del grid.
- Cambio de moneda con precios calculados vs. explícitos; precio 0 inesperado.
- Cliente con JavaScript lento o desactivado: contenido mínimo para bots.
- Compartir link con parámetros de tracking (`utm`, `fbclid`) → canonical limpio.
- Cambios de precio/stock en el admin mientras el cliente navega → datos frescos al refetch.
- Banner con texto largo o vencido (no mostrarlo).

## Revisión
- [ ] Checklist universal.
- [ ] Revisión SEO técnica (canonicals, duplicados, estructurados, hreflang preparado).
- [ ] Revisión de privacidad: sin trackers antes del consentimiento (S15).
- [ ] Revisión de caché y costos de lectura a Supabase.
- [ ] **Demo de cierre de R1** con el dueño y la diseñadora; checklist de fidelidad visual firmado.
- [ ] Go/No-Go del MVP (ver índice).

## Riesgos
- SPA y SEO (D-01) → medición temprana y plan alterno documentado.
- Consultas lentas con catálogo grande → índices y vistas materializadas si hace falta.

## Pendientes externos
Fotos y datos reales de productos; textos de home; número de WhatsApp; decisión sobre botón "Consultar por WhatsApp" en MVP.

## Entregables para sprints siguientes
Layout y navegación de la tienda, páginas de catálogo, capa `track`, helpers de SEO, selector de variante reutilizable (S7), componentes de relacionados (S7).

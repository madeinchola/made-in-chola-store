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
- [x] **Home:** `AnnouncementBar` (banner admin), hero, colecciones, categorías, nuevos/destacados, bloque de confianza (envíos, pagos). — sin «bloque de confianza» de envíos y pagos: no está en el PDF de Inicio ni hay textos (se agrega con la diseñadora).
- [x] **Listado** `/categoria/:slug` y `/coleccion/:slug`: grilla responsive, filtros (color, talla, precio, disponibilidad), orden (nuevos, precio ↑↓), paginación o "cargar más" con URL sincronizada.
- [x] **Búsqueda** `/buscar?q=`: tolerante a acentos/errores (`pg_trgm`), sugerencias, sin resultados útil. — sin sugerencias en vivo mientras se escribe (solo resultados al enviar).
- [x] **Detalle** `/producto/:slug`: galería (por color), selector de color y talla con disponibilidad por variante, precio final, descripción, materiales, cuidado (washcare), **delivery estimado** (S-03), modelo/código, productos relacionados. — **sin «entrega estimada» (S-03)**: decisión del dueño pendiente.
- [x] Estados: **Agotado** (visible, no comprable), **Ocultar** (404 amigable/redirección a categoría), "Pocas unidades" (según semáforo, sin exponer números exactos si no se desea).
- [x] Selector de **país/moneda** (oculto mientras solo exista BOB, pero listo); formato por moneda. — el selector es el de S4; precios con `money()` por moneda (hoy solo BOB).
- [ ] 404, error y página mantenimiento con la identidad visual. — **hecho:** 404 y errores con reintento; **pendiente:** página de mantenimiento.

### Datos y rendimiento
- [x] Consumo exclusivo de **vistas públicas** (S2); caché con TanStack Query (`staleTime`), prefetch en hover.
- [ ] Imágenes: tamaños responsivos (`srcset`), `loading="lazy"` (excepto LCP), formatos modernos, `aspect-ratio`. — **hecho:** `loading="lazy"` salvo la del LCP (con `fetchpriority`), `aspect-ratio`/dimensiones; **pendiente:** `srcset` y formatos modernos (el almacenamiento actual sirve un solo tamaño; requiere transformación de imágenes de Supabase o del CDN).
- [x] Code-splitting por ruta; presupuesto de peso definido. — presupuesto: entrada pública ≤ 270 kB gzip (hoy 243,5).
- [x] Skeletons y estados de error con reintento.

### SEO (decisión D-01)
- [x] Meta dinámicos (título/descripción) por página; canonical; paginación (`rel`) y filtros sin indexar variaciones infinitas.
- [x] **Edge function en Vercel** que sirve HTML con meta/OG/JSON-LD `Product` (precio, disponibilidad, marca, imagen) a bots (Googlebot, Facebook, WhatsApp, Twitter/X…). — código probado con unitarias e integración; **el cableado de Vercel no se puede probar en local** (ver «Pendiente»).
- [x] `sitemap.xml` dinámico (solo activos), `robots.txt`; URLs con slug limpio; redirección de slugs antiguos (S3).
- [x] Datos estructurados `Organization`, `BreadcrumbList`, `Product`/`Offer`.
- [x] Evaluación D-01: medir indexación y previews; documentar decisión (mantener SPA+Edge o migrar storefront). — decisión documentada en `docs/tienda.md` (mantener SPA + borde; medir 4–6 semanas tras desplegar).

### Analytics preparado
- [x] Capa `track(event, payload)` con eventos `view_item_list`, `view_item`, `search`; **sin proveedor** hasta tener IDs (S15).

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

## Lo que entrega S3 y S5 debe respetar (añadido el 2026-10-30)
- **Redirecciones de slugs:** la vista pública `public_product_slug_redirects` (`old_slug` → `current_slug`) lista solo productos visibles **y solo slugs que eran públicos al renombrar** (`was_public`). Si `/producto/:slug` no encuentra el slug, S5 debe consultarla y redirigir (301/replace) al `current_slug`.
- **Descripción del producto = texto plano.** El panel guarda `description`, `materials` y `washcare` sin alterar el HTML (solo quita caracteres de control). S5 debe mostrarlos **siempre como texto** (React ya escapa; prohibido `dangerouslySetInnerHTML`) y respetar los saltos de línea (`white-space: pre-line`).
- **Estado "agotado/oculto":** `admin_product_list.display_state` aplica las mismas reglas que `public_products` ("Ocultar" depende del stock físico; "agotado", de lo disponible); no las dupliques con otra interpretación.
- **Imagen principal** = la primera por `sort_order` entre las no archivadas cuyo color (si lo tiene) sigue activo; el panel ya muestra esa misma.

## Riesgos
- SPA y SEO (D-01) → medición temprana y plan alterno documentado.
- Consultas lentas con catálogo grande → índices y vistas materializadas si hace falta.

## Pendientes externos
Fotos y datos reales de productos; textos de home; número de WhatsApp; decisión sobre botón "Consultar por WhatsApp" en MVP.

## Entregables para sprints siguientes
Layout y navegación de la tienda, páginas de catálogo, capa `track`, helpers de SEO, selector de variante reutilizable (S7), componentes de relacionados (S7).

---

## Estado real de entrega (2026-10-31)

**Entregado:** portada con las secciones que configura el admin (hero con foto o video, filas de productos, colección destacada, «Sobre nosotros», banner, lema, categorías) fiel al PDF de Inicio; `/tienda`, `/categoria/:slug`, `/coleccion/:slug` con filtros (color, talla, precio, disponibilidad), orden y paginación **en el servidor** y todo en la URL; `/buscar` (acentos, mayúsculas, código, una errata); ficha de producto con galería por color, selección de color y talla por variante, «Consultar por WhatsApp», acordeones, relacionados, 404 amable y redirección de slugs renombrados; SEO por pantalla (título, descripción, canónico limpio, Open Graph, JSON-LD) y para bots con funciones de borde de Vercel (`api/seo`, `api/sitemap`, `api/robots`); `track()` sin proveedor; migración `20261031000100_s5_listado_filtros.sql`. Documentación: `docs/tienda.md` (incluye la evaluación D-01), README «Tienda pública (Sprint 5)».

**Cómo se hizo:** base y servicios por mí; portada, listado/búsqueda y ficha por tres subagentes en paralelo; revisión independiente (agente sin contexto, solo lectura) sobre la parte cerrada y revisión propia del listado; los subagentes se cortaron por el límite de uso y se reanudaron (se comprobó que ninguna mutación quedó aplicada).

**Desviaciones respecto al plan (y por qué):**
- **El listado filtra en la base** (`public_list_products`) en vez de en el navegador: antes pasaba ids por la URL y se topaba en 200 productos.
- **Búsqueda difusa desde 5 letras** (umbral 0.52): con 0.55 una errata de una letra no entraba y con 4 letras traía ruido. Con varias palabras, las coincidencias exactas van primero y después las parciales (se actualizaron 2 pruebas de integración del catálogo que suponían solo coincidencia exacta).
- **La portada de bots no depende solo de la función de borde:** Vercel da prioridad a `index.html` sobre la reescritura de `/`, así que `index.html` lleva su propio título y Open Graph.
- **Listado, filtros y búsqueda son provisionales**: no existen en los PDF; se hicieron con el estilo de los PDF.
- **Imágenes de los PDF no usadas** (directriz del dueño): marcadores provisionales.

**Bugs reales encontrados por las pruebas, la revisión y las mediciones, y corregidos:** `<li>` dentro de `<li>` en las migas del listado (solo un aviso de consola; ahora las pruebas fallan ante `validateDOMNesting`) · el listado robaba el foco y desplazaba la página al montarse en desarrollo (StrictMode) · la galería móvil reordenaba por `sortOrder` y perdía «las fotos del color elegido primero» · colores con el mismo slug («Café»/«Cafe») o sin letras (emojis) no se podían elegir por enlace · `?type=constructor` en `/api/seo` devolvía una redirección con «function Object()…» · corte de descripciones en mitad de un emoji · `p_offset` cercano a 2^31 desbordaba el entero (500) y un valor de 2 MB costaba ~30× una llamada normal · las páginas de categoría y colección para bots tomaban un subconjunto arbitrario de productos · no había scroll al inicio al navegar (la ficha se abría a media página) · `VITE_SITE_URL` sin configurar dejaba canónicos a `localhost` en producción · el comodín de la SPA servía HTML con caché de un año para un chunk que ya no existe · 404 y pantallas provisionales sin `noindex` · video del hero ignoraba el ahorro de datos · un fallo de red al consultar slugs renombrados mostraba «no existe» · **CLS 0,15 en la ficha (el pie saltaba por esqueleto y fallback más cortos que la ficha real)** y salto de `h1` a `h3` en los acordeones · el patrón de User-Agent sin comodines podía no coincidir nunca si Vercel lo evalúa completo.

**Revisión independiente:** 23 hallazgos. **Corregidos (17):** la regla de `/` para bots (índice estático) y el patrón de User-Agent con comodines y más bots (Meta, Pinterest, FeedFetcher), scroll al navegar, orden de la galería móvil, recorte de entradas antes de procesarlas y desbordamiento de `p_offset`, páginas de bots con `public_list_products`, prototipo en `/api/seo`, noindex de 404/provisionales y comodín de la SPA sin capturar archivos, corte de emojis, slugs de color únicos, carga perezosa de la galería móvil, video con ahorro de datos, colores agotados marcados con raya (el borde perdía contraste), error con reintento en slugs renombrados y `VITE_SITE_URL` en producción. **Documentados sin arreglar (6, ver «Límites conocidos» de `docs/tienda.md`):** coste lineal de las funciones del listado (medido), `robots.txt` igual en todos los entornos, sitemap sin `lastmod` ni índice, JSON-LD sin `sku`/`priceValidUntil`, `alt` repetido en las tarjetas, GIN no usado con `word_similarity` en un `OR`. **No verificables sin desplegar:** el comportamiento real de Vercel (precedencia de `/`, anclaje del `value`, runtime de borde) y las vistas previas de WhatsApp/Facebook.

**Verificación (2026-10-31):**
- **Unitarias:** 2527 en 131 archivos (S4: 1742), con `npm run typecheck` (aplicación y nodo), lint `--max-warnings=0` y Prettier limpios. *(Nota: durante el desarrollo usé por error `tsc -p tsconfig.json`, que no revisa la aplicación; el E2E no arrancó por errores de tipos de mis pruebas nuevas y se corrigieron.)*
- **pgTAP:** 939 aserciones en 13 archivos (migración nueva: 75 en `12_s5_listado_filtros`). **Integración contra la base local:** 275 en 8 archivos (listado, facetas y búsqueda frente a un cálculo independiente sobre las semillas, filtros combinados, orden, paginación, acentos, entradas hostiles, columnas privadas con `anon`).
- **E2E Chromium móvil + escritorio: 308 pasan** (S4: 208) **y 2 omitidas a propósito** (pruebas del panel que solo valen en escritorio o en móvil), 0 fallos en la corrida final; con axe WCAG 2.1 A/AA en portada, listado, filtros abiertos, búsqueda y ficha, sin desbordes a 360 y 1366 px, redirecciones de slugs, XSS en descripciones, SEO en el navegador, CLS < 0,1 con red lenta y CPU 4× más lenta, y orden de encabezados. Los E2E comparten la base: `storefront.spec.ts` aparta a borrador los productos que dejan otros specs y los devuelve.
- **Mutación (errores inyectados a propósito):** SQL y SEO de servidor (rondas propias), portada 22/22, listado y búsqueda 36/36 (agentes), y los arreglos de la revisión 22/22 (offset, recorte de entradas —sobrevivió hasta añadir una prueba de coste relativa—, emojis, prototipo, `ScrollToTop`, galería, slugs de color, `siteUrl`, redirección y video). Supervivientes iniciales de los agentes (2 + 1) y míos (1), todos muertos con pruebas nuevas.
- **Lighthouse móvil** (build de producción con `vite preview`, red 4G lenta simulada): portada **89** de rendimiento y ficha **88** (antes de los arreglos 79), accesibilidad **100** en ambas, buenas prácticas 100, SEO 100 (92 con `vite preview` por servir HTML en `/robots.txt`), CLS **0,045**, LCP 3,4 y 3,6 s. Criterio 4 del sprint (≥85 / ≥95 / ≥95) cumplido **en local, con baldosas planas y sin CDN**; hay que repetirlo desplegado.
- **Peso:** entrada pública gzip **243,5 kB** (S4: 244; las pantallas de cuenta pasaron a carga diferida); listado ≈ 9 kB y ficha ≈ 11 kB en chunks propios.
- **Costo en la base** (3 000 productos sintéticos): listado sin filtros 85–125 ms, con color y talla ≈ 680 ms, facetas ≈ 710 ms (`anon` corta a los 3 s: margen ≈ 4× a 3 000 productos; ver `docs/tienda.md`).

**Criterios de aceptación:**
1. *Home → categoría → producto en móvil con fluidez:* **cumplido** (E2E en Pixel 7 emulado; la fluidez percibida en un teléfono real no se probó).
2. *Agotado/oculto como lo configuró el admin y vuelve solo al reponer:* **cumplido** (pgTAP, integración y E2E con producto agotado, borrador, archivado y reposición).
3. *Compartir un enlace en WhatsApp/Facebook muestra imagen, título y precio:* **sin verificar**: el HTML para bots está probado con unitarias e integración, pero la reescritura de Vercel y las vistas previas reales solo se pueden comprobar desplegado.
4. *Lighthouse móvil ≥ 85 / ≥ 95 / ≥ 95 en portada y ficha:* **cumplido en local** (ver arriba); repetir desplegado.
5. *Ninguna llamada pública expone costo, archivados ni stock interno:* **cumplido** (pgTAP, integración con `anon` y revisión independiente).
6. *Filtros y orden en la URL y con «atrás»:* **cumplido** (unitarias y E2E).

**Pendiente (no hecho):**
- ~~Subir a la nube las migraciones `20261031000100` y `20261029000100`~~: **hecho el 2026-11-02** con confirmación del dueño y verificado (ver `SPRINT_19`, sección J). La nube no tiene productos de ejemplo: el catálogo se carga desde el panel.
- **Verificar desplegado** (`docs/tienda.md`): `curl` con User-Agent de bot, depurador de Facebook, Prueba de resultados enriquecidos, Search Console con el mapa del sitio, qué regla gana en `/`, 404 de un chunk inexistente, y Lighthouse sobre el dominio real. **La evaluación D-01 real (indexación) llega 4–6 semanas después.**
- **Contenido y diseño:** fotos y video reales, textos de acordeones, número de WhatsApp real, imagen social por defecto, diseño de listado/búsqueda y de móvil, «entrega estimada» (S-03), decisión sobre los rastreadores de IA. Todo en `Sprints/SPRINT_19_Acciones_Manuales.md`, sección J.
- **Código:** `srcset` y formatos modernos de imagen; función única `public_get_product` (menos viajes y *preflights*); carga diferida de `MobileMenu`/`SearchSheet`; foco a `<main>` al navegar; página de mantenimiento; sugerencias de búsqueda; revisión con VoiceOver y en iPhone/Android reales; demo de cierre de R1 con el dueño y la diseñadora y firma del checklist de fidelidad.

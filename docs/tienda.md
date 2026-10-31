# Tienda pública (Sprint 5)

Portada, listados, búsqueda y ficha de producto, con SEO para buscadores y para la vista previa al compartir un enlace. Todo lo que ve el público sale de **vistas y funciones públicas** de la base (nunca de las tablas): no hay forma de leer costos, archivados ni stock interno desde aquí.

## Mapa de rutas

| Ruta | Pantalla | Carga |
| --- | --- | --- |
| `/` | Portada (secciones que configura el admin) | entrada (no se divide) |
| `/tienda` | Todo el catálogo | chunk `ListingPages` |
| `/categoria/:slug` | Categoría (incluye sus subcategorías) | chunk `ListingPages` |
| `/coleccion/:slug` | Colección vigente | chunk `ListingPages` |
| `/buscar?q=` | Búsqueda | chunk `ListingPages` |
| `/producto/:slug` | Ficha | chunk `ProductPage` |

Los slugs son siempre minúsculas: `/producto/Chaqueta-Roja` redirige a `/producto/chaqueta-roja` conservando los parámetros. Un slug que el admin renombró redirige al actual (vista `public_product_slug_redirects`). Un producto borrador, archivado u oculto por stock, una categoría inexistente o una colección vencida dan una **404 amable con `noindex`**, nunca una pantalla en blanco.

## Listado: la URL es la única fuente de verdad

Filtros, orden y página viven en la URL (se pueden compartir, recargar y deshacer con «atrás»). Cualquier valor raro o malintencionado se ignora; nunca rompe la página.

| Parámetro | Ejemplo | Significado |
| --- | --- | --- |
| `color` (repetible) | `?color=Azul&color=Rojo` | **O** dentro del mismo filtro |
| `talla` (repetible) | `?talla=M` | **O** dentro del mismo filtro |
| `min`, `max` | `?min=400&max=500` | Precio en Bs, ambos extremos incluidos; si `min > max` se intercambian |
| `disponibles` | `?disponibles=1` | Solo con stock |
| `orden` | `?orden=precio-asc` | `nuevos` (por defecto), `precio-asc`, `precio-desc`, `nombre` |
| `pagina` | `?pagina=2` | 24 productos por página; una página pasada del final salta a la última real |

Entre filtros distintos se combina con **Y**, y color + talla se evalúan sobre **la misma variante** (un producto azul que solo existe en M no aparece al pedir «Azul» y «L»). Cambiar un filtro u orden vuelve a la página 1. Cada cambio es una navegación nueva (el botón «atrás» deshace el filtro); solo los ajustes automáticos, como saltar a la última página real, reemplazan la entrada.

El filtrado y el orden los hace la base (RPC `public_list_products`, devuelve `{ total, items }`); las opciones de filtro con su contador salen de `public_listing_facets`. Ninguna de las dos acepta SQL ni pasa texto a una consulta dinámica: son parámetros tipados.

## Búsqueda

`public_search_products`: ignora mayúsculas y acentos (`PANTALON` encuentra «Pantalón Palazzo»), busca el texto dentro del nombre, del modelo y del código, y tolera **una errata** cuando la consulta tiene 5 letras o más (similitud de palabra ≥ 0.52 con `pg_trgm`). Con menos de 5 letras solo cuenta la coincidencia exacta del texto: con 4 el fuzzy traía más ruido que ayuda. Los comodines `%` y `_` que escriba la persona se tratan como texto. La consulta se limita a 80 caracteres y con 1 letra no busca (avisa).

## SEO

**Dentro de la aplicación (`usePageMeta`)**: título, descripción, canónico, Open Graph, `robots` y JSON-LD por pantalla, marcados con `data-seo` para reemplazarse sin duplicar.

| Pantalla | `robots` | Canónico |
| --- | --- | --- |
| Portada, tienda, categoría, colección, producto | `index,follow` | la URL **limpia** (sin `utm_*`, `fbclid`, filtros ni orden) |
| Listado con filtros u orden | `noindex,follow` | el listado limpio |
| Listado, página N ≥ 2 | `index,follow` | `…?pagina=N`, con `rel=prev/next` y título «· página N» |
| Búsqueda | `noindex,follow` | `/buscar` (sin la consulta) |
| 404 | `noindex,nofollow` | — |

Datos estructurados: `Organization` y `WebSite` en la portada, `BreadcrumbList` e `ItemList` en listados, `Product` con `Offer` (precio BOB, disponibilidad, imagen) y `BreadcrumbList` en la ficha. Se serializan escapando `< > &` y los separadores U+2028/2029, de modo que un nombre de producto malicioso no puede cerrar la etiqueta `<script>`.

**Para bots (decisión D-01)**: una SPA entrega un `index.html` vacío, y WhatsApp, Facebook y varios rastreadores no ejecutan JavaScript. Por eso `vercel.json` desvía **solo a bots conocidos** (por `User-Agent`) las rutas `/`, `/tienda`, `/categoria/:slug`, `/coleccion/:slug` y `/producto/:slug` a una función de borde (`api/seo.ts`) que consulta las vistas públicas y devuelve HTML con título, descripción, Open Graph, JSON-LD y un contenido mínimo legible. Las personas siguen recibiendo la SPA.

- **Patrón de User-Agent**: va como `.*(Googlebot|…).*` (con comodines a los lados) porque no se sabe si Vercel evalúa el `value` como coincidencia completa o parcial; así vale en ambos casos. La prueba (`src/vercel-config.test.ts`) lo evalúa anclado (`^…$`, el peor caso) contra agentes reales de bots y contra **navegadores integrados de apps** (Instagram, Facebook, Pinterest, TikTok: personas, no bots). No incluye a los rastreadores de IA (`GPTBot`, `ClaudeBot`…): es una decisión de negocio (ver `SPRINT_19`).
- **La portada (`/`) no depende solo de la función**: Vercel da prioridad a un archivo (`index.html`) sobre una `rewrite` cuyo `source` es ese mismo archivo, así que la regla de bots para `/` puede no aplicarse. Por eso el propio `index.html` lleva título, descripción y Open Graph de la marca (una prueba los mantiene iguales a los textos de la tienda) y `usePageMeta` los **reemplaza en su sitio** en cada pantalla (nunca hay dos `og:title`). Falta `og:image` de la portada: pendiente de una imagen social por defecto (ver `SPRINT_19`).
- **El comodín de la SPA** es `/((?!api/|assets/|fonts/).*)`: un archivo con hash que ya no existe (un *chunk* de antes del último despliegue) responde 404 y no HTML de la SPA, que por la cabecera `immutable` de `/assets/*` se guardaría un año en el navegador.
- Las páginas de categoría, colección y tienda para bots usan **`public_list_products`**, la misma función que el listado: una sola lógica (árbol de subcategorías, vigencia, ocultos) y los 24 más nuevos reales, no un subconjunto.

- Esa respuesta **no se guarda en el CDN** (`private, no-store` + `Vary: User-Agent`): la URL es la misma que ve una persona y un caché compartido podría servirle el HTML de los bots. El tráfico de bots es bajo y cada respuesta cuesta ≤ 5 lecturas pequeñas.
- `/sitemap.xml` (`api/sitemap.ts`) lista solo lo vigente y visible, y `/robots.txt` (`api/robots.ts`) lo enlaza y bloquea `/admin`, `/cuenta`, `/login`, `/registro`, `/recuperar`, `/restablecer`, `/carrito` y `/buscar`; ambos se guardan 1 h en el CDN.
- El código compartido es puro (`src/server/seo/**`, sin alias `@/` para que el borde lo resuelva) y está cubierto por pruebas unitarias y de integración. Lo que **no se puede ejercitar en local** es el cableado de Vercel (las rewrites con `has`/`user-agent` y el runtime de borde): `vite preview` las ignora. Ver «Verificación pendiente tras el despliegue».
- Variables: `VITE_SITE_URL` (dominio oficial, para canónicos, OG y sitemap), `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (las mismas del front; la función solo usa la clave anónima).

### Evaluación D-01: ¿SPA + borde o migrar la tienda?

**Decisión: mantener SPA + función de borde para bots, y reevaluar con datos reales.**

- A favor: el panel, las cuentas y el checkout son SPA ya construidas; migrar la tienda a SSR (Next/Remix) duplicaría la pila, el despliegue y las pruebas antes de tener un solo pedido. El borde resuelve lo que SPA no puede (vista previa al compartir, indexado sin JS) con código puro y probado (`src/server/seo/**`).
- En contra / riesgos: (1) Google ejecuta JavaScript, así que el borde para Googlebot es una red de seguridad, no un requisito; (2) los metadatos del HTML para bots y los de la SPA son dos implementaciones (se mantienen iguales con el mismo `src/server/seo/pages.ts` y pruebas de contrato, pero podrían divergir); (3) no se ha medido indexación real porque el sitio aún no está desplegado con su dominio.
- **Criterio de revisión** (medir 4–6 semanas tras el despliegue): páginas indexadas en Search Console vs. URLs del sitemap (objetivo ≥ 90 %), vistas previas correctas en el depurador de Facebook y WhatsApp, y «Cobertura» sin «Descubierta: sin indexar» masiva. Si se incumple, migrar **solo las páginas públicas de lectura** a SSR conservando el panel como SPA.

## Analítica preparada

`track()` (`src/features/storefront/analytics/track.ts`) emite `view_item_list`, `view_item` y `search` **sin proveedor**: no hace nada hasta que alguien llame a `subscribeToTracking(listener)` (S15 conectará Meta y GA4 con el consentimiento). Los eventos no llevan datos personales y un suscriptor que falla no rompe la pantalla ni a los demás. Las listas emiten un evento por cada resultado que llega, no con los datos de relleno de la página anterior.

## Rendimiento

**Costo en la base (medido con 3 000 productos sintéticos, 12 variantes cada uno = 36 000 variantes, en la base local dentro de una transacción revertida; la máquina de desarrollo es lenta, así que los números son pesimistas):**

| Llamada | Tiempo |
| --- | --- |
| `public_list_products()` sin filtros (total + 24 productos) | 85–125 ms |
| con color + talla (3 001 coincidencias) | ≈ 680 ms |
| con color + talla + «solo disponibles» | ≈ 180 ms |
| `public_listing_facets()` | ≈ 710 ms |
| `public_search_products` (exacta / con errata) | 95 ms / 70 ms |

`anon` tiene `statement_timeout = 3 s`. Cada llamada recorre todo el catálogo visible (el costo crece de forma lineal), así que **con ~3 000 productos hay margen (≈ 4×) y con ~10 000 las facetas y los filtros pesados se acercarían al límite**. Un catálogo de ropa artesanal queda muy por debajo, pero si crece: guardar las facetas por categoría (cambian poco), una vista materializada de variantes, y paginación por llave en vez de `row_number()`. Además `word_similarity(...) >= 0.52` dentro de un `OR` no usa los índices GIN de búsqueda (sí lo hace la subcadena): irrelevante a esta escala.

- `ScrollToTop` (en `PublicLayout`): al ir a **otra página** con un enlace la ventana vuelve arriba; no actúa si solo cambia la búsqueda de la URL (filtros, color de la ficha), con «atrás»/«adelante» ni con `#ancla`.
- Cada pantalla de la tienda va en su propio chunk; la portada (la entrada) no. Las pantallas de cuenta (inicio de sesión, registro, recuperar, restablecer, mi cuenta) también cargan bajo demanda: sacan react-hook-form y zod de la entrada. Entrada pública de producción: **243,5 kB gzip** (index 72 + App 171; S4: 244 kB; sin ese cambio habría subido a 260 kB). **Presupuesto definido: la entrada pública no debe pasar de 270 kB gzip** (se mide al cerrar cada sprint).
- TanStack Query con `staleTime`, datos de la página anterior mientras llega la siguiente (sin parpadeo) y **prefetch de la ficha al pasar el ratón o enfocar** una tarjeta.
- Imágenes con `width`/`height` y `aspect-ratio` (sin saltos), `loading="lazy"` salvo la del hero/LCP.
- Esqueletos con la altura final de cada bloque y estados de error con reintento. **Una pantalla que carga bajo demanda reserva toda la altura de la ventana (`min-h-[100svh]`)**: así el pie queda siempre bajo el pliegue y no «salta» fuera de la vista al llegar el contenido (con 70 vh el pie se veía y bajaba de golpe: CLS 0,107 solo por eso en la ficha en móvil). El esqueleto de la ficha mide lo mismo que la ficha real (imagen 3:4 con tira de miniaturas en móvil, 4:5 en escritorio).

**Lighthouse móvil** (Chrome headless sobre el build de producción servido con `vite preview` en local; red simulada 4G lenta y CPU 4× más lenta; las imágenes son baldosas planas de las semillas, así que **no** representa fotos reales ni CDN):

| | Rendimiento | Accesibilidad | Buenas prácticas | SEO | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Portada | 89 | 100 | 100 | 100\* | 3,4 s | 0,045 | 100 ms |
| Ficha | 88 | 100 | 100 | 100\* | 3,6 s | 0,045 | 70 ms |

\* `vite preview` sirve la aplicación (HTML) en `/robots.txt` y Lighthouse lo marca como inválido (92). Con un `robots.txt` idéntico al que genera `api/robots.ts` servido a mano sale 100. En Vercel ese archivo lo da la función; falta comprobarlo desplegado.

Antes de los arreglos de la revisión la ficha sacaba 79 de rendimiento y 98 de accesibilidad, con CLS 0,15 (el pie saltaba) y un salto de `h1` a `h3` en los acordeones. El resto del CLS (0,043) es la barra de anuncios, que empuja la página 36 px cuando llega su dato. El LCP es sobre todo **tiempo de descubrimiento**: la imagen principal no se conoce hasta que carga el JavaScript y llegan los datos (documento → entrada → chunk de la ficha → producto → colores, tallas, variantes, imágenes → imagen). Mejoras posibles, no hechas: una sola función `public_get_product(slug)` que devuelva todo en una petición (quita un viaje de ida y vuelta y 4 *preflights* de CORS), cargar bajo demanda `MobileMenu`/`SearchSheet` (≈ −20 kB) y, si se pasa a Vercel Pro, imágenes redimensionadas por el CDN.

## Verificación pendiente tras el despliegue

No se pueden comprobar sin un dominio público; están anotadas en `Sprints/SPRINT_19_Acciones_Manuales.md`:

1. `curl -A "facebookexternalhit/1.1" https://<dominio>/producto/<slug>` devuelve el HTML con `og:title`, `og:image` y JSON-LD; el mismo `curl` sin ese `User-Agent` devuelve la SPA. Probar también con `-A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"` (confirma que el patrón con `.*` coincide), con `/` (para saber si la regla de la portada se aplica o manda el `index.html` estático) y `curl -I https://<dominio>/assets/no-existe.js` (debe dar 404).
2. Depurador de Facebook y Prueba de resultados enriquecidos de Google sobre un producto real.
3. Search Console: enviar `/sitemap.xml` y revisar cobertura.
4. Lighthouse móvil sobre el sitio desplegado (los números locales de esta sección no incluyen el CDN ni HTTP/2).

## Límites conocidos (revisión independiente del Sprint 5)

Hallazgos reales que **no se arreglaron** por ser de bajo impacto hoy o por depender de una decisión; ninguno bloquea el MVP:

- **Mapa del sitio** (`api/sitemap.ts`): sin `lastmod` ni índice. Con más de 50 000 URLs se trunca en silencio (los productos del final se perderían). Irrelevante a esta escala.
- **`robots.txt`** abre todo en cualquier entorno: un *staging* en un dominio propio sería indexable (los *previews* de Vercel ya llevan `X-Robots-Tag: noindex`).
- **JSON-LD de `Product`**: faltan `sku`, `priceValidUntil` y la imagen cuando no hay fotos; la descripción de la versión para bots no se recorta a 500 caracteres como la de la SPA. Google lo trata como recomendado, no obligatorio.
- **Foco al navegar**: tras ir a otra página el foco no se mueve a `<main>` (el lector de pantalla no anuncia el cambio). Mejora de accesibilidad pendiente para la revisión con VoiceOver.
- **Tarjetas**: la imagen de portada repite el nombre del producto en su `alt` y el enlace estirado también lo dice, así que un lector de pantalla puede anunciarlo dos veces.
- **Rastreadores de IA** (`GPTBot`, `ClaudeBot`, `PerplexityBot`, `OAI-SearchBot`) no ejecutan JavaScript y hoy ven el `index.html` estático. Servirles la versión para bots es una decisión de negocio (visibilidad en buscadores con IA frente a control del contenido).
- **Mutaciones sin cobertura de pruebas**: el recorte de entrada de `public_search_products` (400 caracteres) solo lo cubre la prueba de integración de «consulta gigante» (límite de 5 s), no una prueba de coste relativa como la de `public_list_products`.

# Cookies, analítica, atribución y feeds (Sprint 15)

Qué hace, cómo está hecho y por qué. Los textos legales y los datos personales están en [legal.md](legal.md). **Hoy no se carga ninguna herramienta de terceros**: todo nace **inerte** y se activa solo cuando pones los IDs en Ajustes.

## Modo «sin IDs» (como está hoy)

Los ajustes `analytics_meta_pixel_id` y `analytics_ga4_id` nacen **vacíos**. Con los dos vacíos:

- la tienda **no muestra el aviso de cookies** (no hay nada opcional que preguntar) ni el enlace «Preferencias de cookies» del pie;
- **no se carga ningún script** de Meta ni de Google, **no se guarda ninguna atribución** y **no se envía ningún evento**;
- las pantallas siguen emitiendo sus eventos a la capa `track()` (`src/features/storefront/analytics/track.ts`), que sin proveedores no hace nada.

Se activan en **Ajustes → Analítica y publicidad** (sin desplegar nada): el ID del Pixel de Meta (solo números, 8 a 20 dígitos) y el ID de medición de GA4 (`G-` y 6 a 14 letras mayúsculas o números). La base y el panel rechazan lo que no cumple esos formatos, y la tienda **nunca inyecta en la página un ID que no los cumpla** (no se puede colar código por ahí).

## Consentimiento de cookies

- **Tres categorías.** *Necesarias* (sesión, bolsa y la propia elección): siempre activas, no se preguntan. *Analítica* (GA4 y la atribución de campañas) y *Marketing* (Pixel de Meta y la API de conversiones): solo con permiso. **Sin decidir = sin consentimiento.**
- **El aviso** aparece solo si hay un ID configurado y la persona todavía no decidió. No es un modal (no bloquea ni roba el foco) y no desplaza el contenido (va fijo abajo, sin CLS medido en el E2E). **«Aceptar todas» y «Solo las necesarias» pesan igual**; «Personalizar» abre las preferencias con cada categoría. Se puede cambiar de idea cuando se quiera desde «Preferencias de cookies» en el pie.
- **Nada se pide antes del permiso** (verificado en el navegador: ni el script de Meta ni el de Google, ni `fbq`, ni `dataLayer`).
- **Retirar el consentimiento** detiene el proveedor, revoca su permiso (`fbq('consent','revoke')`, `ga-disable-<ID>`), **borra sus cookies** (`_fbp`, `_fbc`, `_ga`, `_ga_*`, `_gid`) y la **atribución guardada**, y los eventos dejan de salir de inmediato (`track()` ni siquiera se los entrega). Si la persona lo retira en **otra pestaña**, esta se entera. El script ya cargado queda en memoria hasta la próxima visita, pero **inerte** (límite técnico: no se puede «descargar» un script).
- La elección se guarda en el **navegador** (`localStorage`, con respaldo en memoria si el navegador no deja). Un cambio de `CONSENT_VERSION` (si algún día se agrega una categoría) vuelve a preguntar.

## Qué se envía y a quién

| Evento de la tienda | Meta (con «marketing») | GA4 (con «analítica») |
| --- | --- | --- |
| Ver un producto | `ViewContent` | `view_item` |
| Lista de productos | — | `view_item_list` |
| Buscar | `Search` | `search` |
| Agregar a la bolsa | `AddToCart` | `add_to_cart` |
| Quitar de la bolsa | — | `remove_from_cart` |
| Ver la bolsa | — | `view_cart` |
| Empezar el pago | `InitiateCheckout` | `begin_checkout` |
| Elegir cómo pagar | `AddPaymentInfo` | `add_payment_info` |
| Pedido creado | `Purchase` (con `event_id`) | `purchase` (con `transaction_id`) |

Los eventos **no llevan datos personales**; los productos van con el identificador de nuestro catálogo (`content_type: product_group`, que coincide con el `item_group_id` del feed). Los importes son los del servidor, redondeados a 2 decimales. GA4 se configura **sin vista de página automática** (la mandamos nosotros en cada ruta), **sin señales de Google ni personalización de anuncios**.

### `Purchase`: una sola vez, en el navegador y en el servidor

- **Una vez por pedido**: reintentar el pago con la misma llave (resultado «existing»), recargar o volver atrás no repite el evento (se recuerda por pestaña). Además Meta deduplica por `event_id` y GA4 por `transaction_id`.
- **API de conversiones de Meta** (`meta-capi`, Edge Function): reenvía la compra **desde el servidor con los datos reales del pedido** (el navegador no manda valores: solo el número de pedido y el `event_id`). Va **solo con consentimiento de marketing**, solo para **pedidos de la propia persona**, creados en las **últimas 24 h** y **una vez por pedido**; el `event_id` debe ser exactamente `purchase.<número del pedido>` (el mismo del Pixel, así Meta cuenta UNA). **Correo, teléfono y la cuenta van con SHA-256** (normalizados: correo en minúsculas, teléfono solo dígitos con país); solo la IP y el navegador van en claro, porque Meta los exige así para emparejar. El **token** (`META_CAPI_ACCESS_TOKEN`) es un **secreto del servidor**, nunca un ajuste ni algo del navegador; viaja en el cuerpo de la petición, no en la dirección, y no se escribe en ningún registro.
- **Sin token o sin Pixel no hace nada y no llama a nadie.**
- **Decisión sobre «cuándo es una compra»**: `Purchase` se envía **al crear el pedido** (pedido recibido), como ya hacía el evento del navegador; **no** al confirmarse el pago. Si prefieres contar la compra al confirmar el pago (pedidos por WhatsApp o contra entrega), es un cambio en el servidor (S16 o después).
- **Pedidos manuales** (los que crea el administrador) **no** se envían: no hay navegación web ni consentimiento de la persona.

## Atribución de campañas

Con consentimiento de **analítica**, la tienda recuerda **de dónde llegó** la persona (30 días): `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, de qué **tipo** fue el clic de anuncio (`fbclid` o `gclid`; **nunca se guarda el identificador**), la página de entrada y el sitio de procedencia. El último origen con campaña gana; una visita que solo viene de otro sitio no pisa una campaña ya guardada. Al crear el pedido se anota **una vez** junto a él (`order_attribution`; la dueña del pedido, en sus primeras 24 h; la base vuelve a limpiar, pasar a minúsculas y acotar cada texto). Sin permiso, no se guarda ni se anota nada. Retirarlo borra lo guardado.

`admin_attribution_summary(desde, hasta)` da las **ventas por origen** con la misma definición de «venta» del resto del panel (una moneda a la vez, neto de reembolsos; lo sin origen va aparte). **Todavía no hay una pantalla** que lo muestre (ver límites).

## Feeds de catálogo (Google Merchant Center y Meta)

- `/feeds/google.xml` y `/feeds/meta.xml` (función de Vercel `api/feed.ts`): RSS 2.0 con el espacio de nombres `g:`. **Un `<item>` por variante** (color y talla): `g:id` = identificador de la variante, `g:item_group_id` = el del producto, precio en **bolivianos** (`560.00 BOB`), `g:availability` (**«pocas unidades» sigue siendo «in stock»**: no se revelan cantidades), `g:condition` nuevo, marca, color, talla, categoría, la imagen del color de la variante (o la general o la portada) y el enlace a la ficha. Google lleva además `g:identifier_exists = no` (artesanal: no hay código de barras).
- **Solo lee las vistas públicas con la clave anónima**: nada oculto, archivado, con costo ni con cantidades. Un producto **sin imagen o sin precio no entra** (Merchant y Meta rechazan el feed entero por un item incompleto). Se cachea 15 minutos en el CDN.
- Se probó contra la **base real** (campos obligatorios, ids únicos, cantidad igual a las variantes públicas con imagen y precio). **No se probó** que Merchant Center o Meta lo acepten (requiere tus cuentas): registra la URL en cada uno y revisa sus diagnósticos.

## SEO

- **Lo privado no se indexa por dos vías**: `X-Robots-Tag: noindex, nofollow` desde el servidor (los rastreadores no ejecutan JavaScript) y `<meta name="robots">` en cada pantalla, para el carrito, el pago, el pedido, la cuenta, el acceso, el registro, la recuperación y las búsquedas internas; `robots.txt` además las cierra, y una prueba comprueba que cada ruta cerrada tenga su cabecera. El panel (`/admin`) también.
- El **mapa del sitio** incluye los textos legales **solo si están publicados**.
- Ya existían (S5): canónicos sin parámetros de seguimiento, datos estructurados, redirecciones 301 de slugs y la versión para bots con metadatos.
- La **CSP** ya permitía Meta y se amplió para los dominios de GA4 (`*.google-analytics.com`, `*.analytics.google.com`, `*.googletagmanager.com`), sin `unsafe-inline` ni comodines.

## Migraciones y pruebas

- `20261118000200_s15_analytics.sql` (ajustes públicos con su validación, `order_attribution`, `record_order_attribution`, `admin_attribution_summary`); pgTAP `24_s15_analytics`.
- Unitarias (consentimiento, `track()` por categoría, mapeo de eventos, proveedores, atribución, compra única, gestor y aviso), Deno (`meta-capi`: vectores SHA-256, el pedido ajeno, el cancelado, el `event_id`, el token fuera de la dirección), integración (ajustes, función desplegada sin token, atribución), E2E con los scripts de Meta y Google **simulados** (`page.route`) para comprobar **qué se pide y cuándo**.

## Límites conocidos (nada de esto está escondido)

1. **No se probó el envío real a Meta ni a Google** (no hay IDs ni token reales): solo que, con IDs, se pide lo correcto, en el momento correcto y a nadie más; y que el servidor arma y firma el evento bien (con un `fetch` simulado). Pruébalo con **Test Events** de Meta y **DebugView** de GA4 al activarlo.
2. **La versión de la API de Meta** es `v24.0` por omisión (`META_GRAPH_VERSION`): **revísala al activar** (Meta retira versiones con el tiempo).
3. **El consentimiento no se guarda en el servidor**: la API de conversiones confía en que el navegador solo la llama con permiso de marketing.
4. **Sin IDs no hay atribución** (sin aviso no hay permiso que pedir).
5. **Falta la pantalla de «ventas por origen»** (la función existe y está probada).
6. **No se midió Lighthouse ni Web Vitals** (el sprint pedía SEO ≥ 95 y un presupuesto en CI): el aviso de cookies no causa CLS (medido en el E2E), pero la auditoría completa queda para S16.
7. **No se verificó con Search Console** ni se envió el mapa del sitio (requiere tu dominio y tu cuenta).
8. **TikTok y otros píxeles** no se agregaron: la capa `track()` está lista para sumarlos como un proveedor más con su categoría.

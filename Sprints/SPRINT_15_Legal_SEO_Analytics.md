# Sprint 15 — Legal, SEO avanzado y analytics

**Release:** R3 (cierre) · **Estimación:** 4 días · **Depende de:** S5 (storefront, SEO base, capa `track`), S10 (checkout y eventos de compra)

## Objetivo
Dejar la tienda lista para operar legalmente y para crecer: páginas legales redactadas, consentimiento de cookies, canal de reclamos, SEO avanzado con feeds de catálogo y analytics (Meta Pixel + Conversions API + GA4) conectado a los eventos ya emitidos.

## Alcance
**Dentro:** T&C, privacidad, cookies, políticas (envíos/devoluciones con el texto del admin), canal de reclamos, banner de consentimiento, Pixel/CAPI/GA4 (cuando existan los IDs), feeds Google Merchant/Meta, SEO técnico avanzado, upsell/cross-sell en checkout.
**Fuera:** campañas publicitarias, newsletter masivo, facturación electrónica (S17).

## Reglas de negocio cubiertas
BR-LEG-01, BR-MKT-02, BR-MKT-03, BR-MKT-04, BR-ACC-06 (consentimiento).

## Tareas

### Legal
- [ ] Redactar **Términos y Condiciones**, **Política de Privacidad**, **Política de Cookies** (adaptadas a Bolivia; **revisión por abogado antes de publicar**).
- [ ] Páginas de **Envíos** y **Devoluciones/Cambios** que cargan el texto escrito por el admin desde el panel (editor simple, versionado, fecha de vigencia).
- [ ] **Canal de reclamos** (formulario + registro + número de seguimiento + correo al admin); validar si aplica un "libro de reclamaciones" equivalente en Bolivia.
- [ ] Aceptación de T&C/privacidad en registro y checkout, con **registro de consentimiento** (versión, fecha, IP hash).
- [ ] **Banner de cookies** con categorías (necesarias, analíticas, marketing); nada se dispara antes del consentimiento; preferencia editable luego.
- [ ] Flujos de datos personales: exportar/eliminar-anonimizar datos a solicitud (coherente con BR-ACC-07).

### Analytics (cuando el admin entregue los IDs)
- [ ] **Meta Pixel** + **Conversions API** (server-side) con **deduplicación por `event_id`**; reutilizar `metaPixel.ts` y `product-track-event` de Acrosoft tras revisión.
- [ ] **GA4** (e-commerce events) y soporte opcional para TikTok/otros píxeles vía capa `track`.
- [ ] Mapeo de eventos: `ViewContent`, `Search`, `AddToCart`, `InitiateCheckout`, `AddPaymentInfo`, `Purchase` (valor, moneda, ids de contenido).
- [ ] Atribución de campaña (utm/fbclid) guardada en el pedido (patrón `checkoutAttribution`).
- [ ] CSP actualizada para dominios de analytics; carga diferida; sin afectar Web Vitals.
- [ ] **Modo "sin IDs"**: el código existe pero queda inerte hasta configurar variables.

### SEO avanzado
- [ ] Feeds **Google Merchant Center** y **catálogo de Meta** (XML/CSV generados y actualizados), con disponibilidad, precio, GTIN/ID, imágenes.
- [ ] Auditoría técnica: canonicals, hreflang preparado (multi-país, S18), paginación, enlaces internos, breadcrumbs, redirecciones 301 de slugs, páginas `noindex` (carrito, checkout, cuenta).
- [ ] Optimización de contenido: plantillas de título/descripción por categoría/colección, textos únicos.
- [ ] Verificación en Search Console y mapa del sitio enviado.
- [ ] Rendimiento: presupuesto de Web Vitals (LCP, CLS, INP) en CI.

### Upsell / cross-sell
- [ ] Productos relacionados y "completa tu look" en carrito y confirmación; *order bump* simple en checkout (un producto sugerido añadible con un clic, sujeto a stock y descuentos de S9).

## Criterios de aceptación
1. Textos legales publicados, enlazados en footer, registro y checkout, y aprobados por el dueño (y por abogado).
2. Sin consentimiento no se carga ningún script de marketing/analytics (verificado en red).
3. Con IDs configurados, un `Purchase` llega a Meta por Pixel **y** CAPI y se deduplica.
4. Feeds válidos en Merchant Center y Meta sin errores bloqueantes.
5. Lighthouse SEO ≥ 95 y Web Vitals "buenos" en home, categoría y producto.

## Testing
- **Unit:** mapeo de eventos, generación de `event_id`, hash de datos de usuario (email/teléfono SHA-256 normalizados), generación de feeds.
- **Integración:** `product-track-event` con la API de pruebas de Meta (Test Events); GA4 DebugView.
- **E2E:** flujo con consentimiento denegado/aceptado/parcial; verificar peticiones de red; registro de consentimiento guardado.
- **SEO:** validadores de datos estructurados, rastreo con crawler (Screaming Frog/similar), pruebas de redirecciones, `robots`/`noindex` correctos.
- **Rendimiento:** CI con presupuesto; comparación antes/después de analytics.
- **Legal/QA manual:** lectura completa de textos, enlaces correctos, fechas de vigencia.

## Edge cases
- Cliente retira el consentimiento tras haberlo dado → detener y limpiar cookies/identificadores.
- Bloqueadores de anuncios: la compra no debe depender de analytics; CAPI cubre el hueco.
- Compra duplicada en el pixel por recarga de la página de confirmación → evento una sola vez (`event_id` y bandera de pedido).
- Pedidos manuales/WhatsApp sin navegación web: ¿se envían a CAPI? (definir; solo con consentimiento/dato de origen).
- Moneda y valor correctos en `Purchase` con descuentos y envío.
- Producto agotado/oculto en el feed; precio cambiado entre feed y sitio (discrepancias que rechaza Merchant).
- Productos sin GTIN → uso de `identifier_exists=false`/ID propio.
- Cambios de slug y 301 encadenados; canonical con parámetros de tracking.
- Textos legales cambian: reaceptación al versionar; cuentas viejas.
- Menores de edad y datos sensibles: advertencia en privacidad.
- Navegación con JS lento: banner de cookies no bloquea la interacción ni causa CLS.
- Tráfico desde otros países (futuro) con otro régimen de consentimiento (GDPR) → estructura preparada.
- Reclamo duplicado/spam en el formulario → rate limit + captcha ligero.

## Revisión
- [ ] Checklist universal.
- [ ] **Revisión legal** de textos por abogado.
- [ ] Revisión de privacidad de punta a punta (qué dato va a quién).
- [ ] Revisión de políticas de Meta/Google para comercio (productos permitidos).
- [ ] Verificación de dominio y propiedad en Meta/Google/Search Console.

## Riesgos
- IDs de píxel pendientes → código inerte y listo para activar.
- Textos legales sin revisar → bloquear el go-live (S16) hasta aprobación.
- Penalización por feeds con datos incorrectos → validación previa y monitoreo.

## Pendientes externos
IDs de Pixel/CAPI/GA4, políticas escritas por el admin (envíos/devoluciones), revisión del abogado, cuentas de Merchant/Meta Catalog.

## Estado real de entrega (2026-11-17)

**Hecho y verificado contra la nube.** Cuatro migraciones (`20261118000100_s15_legal.sql`, `…0200_s15_analytics.sql`, `…0300_s15_reclamos.sql` y `…0400_s15_mis_datos.sql`) aplicadas y tres funciones de Edge desplegadas (`legal-accept`, `meta-capi`, `complaint`). Textos legales versionados e inmutables con aceptación registrada (registro, pago y «aceptó de nuevo»), aviso de cookies con tres categorías, analítica inerte hasta que haya IDs y permiso (Meta Pixel, GA4 y la API de conversiones con un solo `event_id`), atribución por pedido, feeds de catálogo para Google y Meta, canal de reclamos con alerta al administrador, «Descargar mis datos» y «Suma a tu pedido» en el pago. Explicación y límites en `docs/legal.md`, `docs/analytics.md` y `docs/reclamos.md`; tareas y decisiones del dueño en SPRINT_19 §T.

**Cifras:** pgTAP **27 suites en verde**, con `23_s15_legal` **122**, `24_s15_analytics` **55**, `25_s15_reclamos` **80** y `26_s15_mis_datos` **33** aserciones (la lista blanca de `05`, el catálogo de `06` —47 ajustes— y las plantillas de `20` —37— ampliados a propósito); **Deno 309 pruebas**; unitarias **6 455 pruebas en 304 archivos**; tipos, ESLint y Prettier limpios; búsqueda de secretos en el código y en el build publicado: ninguno. **Integración contra la nube:** los archivos de S15 (ajustes, funciones sin token, atribución, feed contra la base real, descarga de datos) pasan; la pasada completa dio 500 en verde y **22 fallos que no son de S15** (ver abajo).

**E2E (build de producción servido en local, contra la nube; 1,4 h):** la pasada completa dio **462 casos en verde, 5 saltados a propósito y 32 fallidos**. Al repetir los 32: **22 volvieron a pasar** (admin, carrito, direcciones, analítica del panel, humo: no se investigó cada uno; todos son de pantallas que S15 no tocó y el patrón es el de S14, con el inicio de sesión de la nube lento a ratos) y los otros **10** se investigaron uno por uno: `cookies` 7/7 en los dos proyectos (el fallo era un contraste que axe midió a medio cambio de color y la dependencia entre casos; ver abajo), `auth` 46/46 (incluido el registro solo con teléfono, que había fallado una vez, sin causa encontrada) más el test del bundle 2/2 (fallaba porque la herramienta resolvía `localhost` al servidor de desarrollo del dueño, no al build), `account` 42/42 (el cambio de contraseña, que había fallado una vez, pasó), `storefront` 70/70 (tras arreglar su preparación, ver abajo) y `layout` 20/24, con **4 fallos que ya existían** (los dos casos de cabecera, ver abajo). Lo que cubren los nuevos: textos legales en pantalla y en el pago/registro con axe AA; el aviso de cookies sin mover la página y sin pedir nada a terceros antes del permiso; «solo las necesarias» no carga nada y se recuerda; «personalizar» (solo marketing → Meta y no Google); «aceptar todas» y **retirar** (borra `_fbp`/`_ga` y detiene todo); una **compra completa** con y sin permiso (con permiso: origen guardado junto al pedido y UN `Purchase`; sin permiso, nada); reclamos (envío, honeypot, límites, panel); «Suma a tu pedido».

**Mutación:** **83 cambios deliberados en el SQL** (legal, analítica, reclamos, mis datos): **81 detectados y 2 equivalentes** (N04 y R11); **69 en el código TypeScript: 68 detectados y 1 equivalente** (T62: quitar la guarda `useRef` del «bump» no cambia nada observable porque el botón se deshabilita en el primer clic; la guarda es el cinturón de seguridad). Los sobrevivientes de la primera pasada fueron **huecos reales de mis pruebas** y ya tienen su caso: una versión de borrador que cambia de documento o de número (L03), publicar con vigencia en el pasado dentro de la tolerancia (L18), un texto de 60 001 caracteres (L21), las estadísticas que contaban filas y no cuentas ni pedidos distintos (L26/L27), el Pixel que aceptaba letras y el GA4 con cualquier prefijo en la validación de ajustes (N01/N03) y el resumen por origen con el bruto en lugar del neto (N16), el plazo de los reclamos tomado del ajuste (R03), los caracteres de control VT/FF/SO/US/DEL (R07), cerrar un reclamo respondido sin cambiar su fecha de respuesta (R15), el orden de las líneas y las preferencias en la descarga de datos (M09/M12), y en TypeScript el doble envío del formulario de reclamos (T56), los importes sin redondear en el mapeo de eventos (T12), el GA4 en minúsculas (T17) y la aceptación que solo comparaba los términos y no la privacidad (T43).

**Lo que la verificación atrapó (arreglado):**
- Las suites 01–04 (que vacían pedidos) fallaban porque `order_attribution` impedía borrar un pedido: ahora la clave es `on delete cascade` (con su prueba).
- La reaceptación pedía **todas** las versiones: ahora acepta **exactamente un subconjunto** y solo anota lo que la persona vio; el aviso de «actualizamos nuestros textos» **se esconde en el pago** (tapaba el formulario).
- Un doble clic en «Agregar» del bump y un doble Enter en el formulario de reclamos enviaban dos veces: guardas síncronas con `useRef`.
- Dos fallos del panel con axe: un `<div>` suelto dentro de una `<dl>` y la medición durante el desvanecimiento del diálogo.
- Pruebas obsoletas de sprints anteriores que esperaban «disponible pronto» en los textos legales y un detector de secretos que confundía el prefijo `sb_secret_` de la librería con una clave (ahora exige una clave completa).
- **Pruebas que dependían del orden:** en el E2E de cookies cada caso asumía los IDs que dejaba el anterior; tras un fallo el siguiente quedaba sin aviso y esperaba 2 minutos. Ahora cada caso pone y restaura lo suyo. Además, axe medía un contraste falso en un botón del diálogo de preferencias (a medio cambiar de color por el puntero, la transición dura 150 ms): ahora espera a que terminen las animaciones antes de medir (el estilo final, `hover:text-primary-foreground` sobre `bg-primary`, es correcto). En `storefront.spec.ts` apartar los productos de prueba de las otras suites mandaba **~1 000 identificadores en una sola dirección** (400, y 71 casos «no se ejecutaron»): ahora lo hace en tandas de 100, lee por páginas y da tiempo suficiente a los ganchos.

**Lo que NO se pudo verificar:**
- **Ningún envío real a Meta ni a Google** (sin IDs ni token): solo que, con IDs, se pide lo correcto, en el momento correcto y a nadie más, y que el servidor arma y firma el evento (con un `fetch` simulado). Falta **Test Events** de Meta y **DebugView** de GA4.
- **Ninguna aceptación real de los feeds** en Merchant Center ni en el catálogo de Meta (se probaron contra la base real: campos obligatorios, ids únicos, cantidades).
- **Revisión por un abogado** de los textos legales: los textos de partida llevan marcadores `[COMPLETAR…]` que **bloquean** su publicación.
- **Lighthouse (SEO ≥ 95) y Web Vitals** en portada, categoría y ficha, ni el presupuesto en CI; **Search Console** ni el mapa del sitio enviado.
- **Un teléfono real** y un lector de pantalla (solo axe).
- La **pantalla de «ventas por origen»** no existe (la función `admin_attribution_summary` sí, probada).

**Abiertos que NO son de S15 (todos reproducidos en una copia anterior o sin tocar esas pantallas):**
- `layout.spec.ts:19` y `:86` (cabecera de interiores y portada, 2 casos × 2 proyectos): ya fallaban en el commit de S9 (verificado en S10).
- La base de la nube acumula **más de 1 100 productos de prueba activos** que dejan otras suites: los casos de integración que asumen una base pequeña (listados, auditoría de 600 000 filas, carrito de 50 líneas por latencia) fallan o se agotan; son los 22 fallos de la pasada completa. El vaciado de entrega (`db reset --linked --no-seed`) los elimina; **no se hizo** sin tu autorización.
- Los de siempre: `checkout` con 100 intentos simultáneos, el enlace «saltar al contenido» del panel (`admin.spec.ts`) y `update-contact` simultáneo.

**Decisiones y desvíos del spec:**
- **Sin correo automático a quien reclama** (evita usar la tienda como relé de correo); la respuesta se registra y la envía el equipo.
- **El consentimiento de cookies vive en el navegador**; la aceptación de términos y privacidad vive en el servidor, con una **huella HMAC de la red, nunca la IP**.
- **`Purchase` por la API de conversiones solo con datos reales del pedido**, con SHA-256 y el mismo `event_id` que el Pixel (`purchase.<número>`), una sola vez por pedido.
- **Sin atribución cuando no hay IDs** (sin aviso no hay permiso que pedir) y **nunca se guarda el identificador del clic**, solo el origen.
- **«Suma a tu pedido»** ofrece solo productos con **una sola variante** con stock (si no, habría que elegir color y talla en el pago).
- **No se agregó TikTok** (la capa `track()` está lista) ni **hreflang** (S18) ni un presupuesto de Web Vitals en CI (S16).
- **De paso:** `track()` filtra por categoría de consentimiento y los scripts de terceros solo se cargan con IDs válidos y permiso.

**Criterios de aceptación:**
1. *Textos legales publicados, enlazados en pie, registro y pago, y aprobados por el dueño y el abogado:* **cumplido en lo técnico** (publicación versionada, enlaces, casilla con las versiones vistas); **no hay textos finales ni aprobación** (marcadores bloqueantes hasta tu revisión y la del abogado).
2. *Sin consentimiento no se carga ningún script de marketing/analítica (verificado en red):* **cumplido** (E2E que espía cada petición, con IDs y sin permiso; también tras retirarlo).
3. *Con IDs, un `Purchase` llega a Meta por Pixel y por la API de conversiones y se deduplica:* **cumplido en lo técnico con simulaciones** (mismo `event_id` en ambos, una sola vez por pedido); **no verificado contra Meta real**.
4. *Feeds válidos en Merchant Center y Meta sin errores bloqueantes:* **no verificado** (formato y datos probados contra la base real; falta que las cuentas lo acepten).
5. *Lighthouse SEO ≥ 95 y Web Vitals «buenos»:* **no medido** (queda para S16 con el dominio real).

## Entregables para sprints siguientes
Cumplimiento legal y de privacidad listo, analytics activable, feeds y SEO auditados (insumos del checklist de S16).

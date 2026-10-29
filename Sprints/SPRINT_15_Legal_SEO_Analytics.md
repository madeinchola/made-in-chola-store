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

## Entregables para sprints siguientes
Cumplimiento legal y de privacidad listo, analytics activable, feeds y SEO auditados (insumos del checklist de S16).

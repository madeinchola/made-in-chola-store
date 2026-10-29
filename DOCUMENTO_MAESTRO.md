# Made In Chola — Documento Maestro
> Versión 1.0 · Documento vivo · Estado: **planificación (sin código)**
> Fuentes: respuestas de negocio del dueño + stack de referencia del proyecto Acrosoft Labs (`~/AcroSoft/acrosoft-launchpad`)
> Complementos: [PENDIENTES_ADMIN.md](PENDIENTES_ADMIN.md) · [Sprints/00_INDICE_Y_DEPENDENCIAS.md](Sprints/00_INDICE_Y_DEPENDENCIAS.md)

---

## 1. Visión y alcance

Ecommerce **B2C de ropa**, tienda única y propia. Inicia en **Bolivia (BOB, Bs)** y debe quedar escalable a otros países y monedas (**ARS, EUR, USD**) sin reescribir el núcleo.

**Principios de diseño**
1. **Configurable desde el panel** lo que el admin decide después (envíos, políticas, cupones, tipos de cambio). Nada de reglas de negocio "quemadas" en código.
2. **Nada se borra**: todo se archiva. Los pedidos guardan *snapshots* de lo vendido.
3. **Extensible por interfaces**: pagos, envíos y notificaciones se implementan detrás de una abstracción (hoy: QR/WhatsApp/contra entrega; mañana: Stripe, Mercado Pago, PayPal).
4. **Integridad primero**: stock, precios y pagos se resuelven en la base de datos (transacciones atómicas), nunca confiando en el cliente.
5. **UI pensada para admins de nivel técnico bajo** (2 admins).

**Fuera de alcance (decidido)**: productos personalizados, kits/bundles, lista de deseos, reseñas, preventas/backorders, pagos fraccionados, suscripciones, referidos/afiliados, chat de soporte integrado, recuperación de carritos abandonados, límite por cliente, restricciones de edad, mezcla con productos digitales, notas/regalo, pedido mínimo/máximo, múltiples almacenes, verificación obligatoria de email.

---

## 2. Stack tecnológico

Se replica el stack de Acrosoft Labs para reutilizar patrones, componentes y conocimiento.

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | **Vite 5 + React 18 + TypeScript 5** (SPA) | Igual que Acrosoft |
| Estilos / UI | **Tailwind 3 + shadcn/ui (Radix) + lucide-react + tailwindcss-animate** | Tokens de diseño vendrán de la diseñadora |
| Routing | `react-router-dom` v6 | |
| Datos cliente | **TanStack Query v5** + `@supabase/supabase-js` | |
| Formularios | `react-hook-form` + `zod` + `@hookform/resolvers` | |
| Gráficas | `recharts` | Dashboard admin |
| Utilidades | `date-fns`, `papaparse` (CSV), `sonner` (toasts), `@dnd-kit` (reordenar imágenes), `embla-carousel-react` | |
| Backend / BD | **Supabase**: Postgres + Auth + Storage + RLS + Realtime + `pg_cron` | |
| Lógica servidor | **Supabase Edge Functions (Deno)** + funciones SQL/RPC | Carpeta `_shared` para código común |
| Hosting front | **Vercel** (`vercel.json` con headers de seguridad, CSP y rewrite SPA) | |
| Tests | **Vitest** + Testing Library (unit/componentes) · **Playwright** (E2E) · tests SQL (pgTAP o scripts) | |
| Lint | ESLint 9 + typescript-eslint | |
| Gestor de paquetes | npm/bun (mantener un solo lockfile) | Decidir uno en Sprint 0 |

**Módulos de Acrosoft a revisar para reutilizar** (verificar al implementar, no copiar a ciegas): `lib/password-security.ts` (HIBP), `lib/countries.ts`, `lib/currencies.ts`, `i18n/phone-countries.ts`, `lib/validators.ts`, `lib/uuid.ts`, `lib/metaPixel.ts`, `lib/checkoutAttribution.ts`, `components/ErrorBoundary.tsx`, patrones de Edge Functions (`stripe-webhook`, `notify-stock-alert`, `send-*`), `vercel.json` y convención de migraciones `YYYYMMDD_nombre.sql`.

### 2.1 Diferencia crítica a gestionar: SEO en una SPA
Acrosoft es un SPA (sin SSR) porque es un CRM. Un ecommerce **necesita SEO** (decisión 12.5 = sí) y vista previa al compartir en WhatsApp/Meta. Estrategia aprobada para mantener el stack:
- **Vercel Edge Function / middleware** que, para bots y crawlers (`/producto/:slug`, `/categoria/:slug`, `/coleccion/:slug`), devuelve HTML con `<title>`, meta, Open Graph y JSON-LD `Product` leídos de Supabase.
- `sitemap.xml` y `robots.txt` dinámicos; feed de catálogo para Meta/Google Merchant.
- Lazy-loading, imágenes optimizadas (transformaciones de Supabase Storage o CDN), buen LCP.
- Si en la validación (Sprint 5) el resultado no es suficiente, la salida documentada es migrar solo el storefront a Next.js/Astro conservando Supabase y el admin. **Decisión abierta D-01.**

---

## 3. Arquitectura

```
┌────────────┐   HTTPS    ┌───────────────────────────┐
│  Cliente   │ ─────────► │  Vercel (SPA + Edge SEO)  │
│ (browser)  │            └─────────────┬─────────────┘
└─────┬──────┘                          │ supabase-js (anon + JWT)
      │                                 ▼
      │                 ┌────────────────────────────────────┐
      │                 │ Supabase                           │
      │                 │  • Auth (cliente/admin)            │
      │                 │  • Postgres + RLS + RPC atómicas   │
      │                 │  • Storage (imágenes, comprobantes)│
      │                 │  • Edge Functions (pagos, webhooks,│
      │                 │    notificaciones, SEO data)       │
      │                 │  • pg_cron (expirar reservas, etc.)│
      │                 └───────┬────────────┬───────────────┘
      │                         │            │
      ▼                         ▼            ▼
 WhatsApp (wa.me)       Pasarelas QR/MP/    Email / WhatsApp API
 pedido manual          Stripe/PayPal       (proveedor por definir)
```

**Entornos**: `local` (Supabase CLI) → `staging` (proyecto Supabase + preview Vercel) → `production`. Variables en `.env` locales y en Vercel/Supabase secrets; **nunca** claves secretas en el front.

**Estructura de repo propuesta**
```
/src
  /app            rutas, providers, layouts
  /features       catalog, cart, checkout, account, orders, admin/*, shipping, discounts, payments
  /components/ui  shadcn + sistema de diseño
  /lib            supabase, money, pricing, validators, analytics
  /hooks  /i18n  /test
/supabase
  /migrations     YYYYMMDD_nombre.sql
  /functions      + _shared
  /tests          tests SQL / RLS
/e2e              Playwright
/docs
```

---

## 4. Roles y permisos

| Rol | Alcance |
|---|---|
| **Visitante** | Navega catálogo, usa carrito local (sin login). |
| **Cliente** (`customer`) | Cuenta propia: perfil, direcciones, datos fiscales, carrito persistente, pedidos propios. |
| **Admin** (`admin`) | Todo el panel. Habrá **2 admins** con los mismos permisos. |

RLS por defecto: **denegar todo**; políticas explícitas por tabla. El rol admin se asigna solo por función segura (nunca desde el cliente). Estructura preparada para añadir roles futuros (almacén, soporte) sin migración destructiva.

---

## 5. Reglas de negocio (con ID para trazabilidad en los sprints)

### Catálogo
- **BR-CAT-01** Un producto tiene variantes por **color** (N, obligatorio ≥1) y **talla** (N, opcional). Cada variante (color×talla) tiene su stock propio.
- **BR-CAT-02** Un producto puede estar en **varias categorías** y **varias colecciones**.
- **BR-CAT-03** Nada se elimina: se **archiva**. Un archivado no aparece en tienda ni en búsquedas, sí en pedidos históricos.
- **BR-CAT-04** Producto sin stock: el admin elige **por producto** entre **"Agotado"** (visible, no comprable) y **"Ocultar"**. Reaparece/vuelve a comprable automáticamente al reponer stock.
- **BR-CAT-05** Campos del producto: nombre, descripción, **precio (N, por país/moneda)**, stock con alerta de colores, tallas (N, opcional), colores (N), fotos, categorías, **modelo**, **código**, materiales, cuidado (*washcare*), **delivery (N)** *(ver supuesto S-03)*, costo (para margen).
- **BR-CAT-06** `slug` y `código` únicos entre todos (incluidos archivados).

### Inventario
- **BR-INV-01** Un solo almacén.
- **BR-INV-02** Reserva de stock de **10 minutos** (ver §7.2 para el modelo de dos capas).
- **BR-INV-03** La reserva se libera sola si vence, el pago falla o se abandona.
- **BR-INV-04** **Sin overselling**: nunca se vende más de lo disponible.
- **BR-INV-05** Alertas de stock con **semáforo de colores** (umbrales configurables) en el panel y **correo** al/los admin.
- **BR-INV-06** Sin límite de unidades por cliente.

### Precios, descuentos, impuestos
- **BR-PRC-01** El precio mostrado es **final** (impuestos incluidos). Desglose fiscal: pendiente del admin (recordatorio).
- **BR-PRC-02** Cada producto puede tener **precio distinto por país/moneda**. Inicialmente solo BOB.
- **BR-PRC-03** **Un solo cupón por pedido.**
- **BR-PRC-04** Reembolso = **monto efectivamente pagado**.
- **BR-PRC-05** Se respeta el precio con el que el producto entró al carrito; si el precio vigente cambió, se **notifica antes de pagar** (ver supuesto S-04).
- **BR-PRC-06** Multimoneda: tipo de cambio **fijo o variable**, ajustable por el admin; redondeo a **2 decimales**.
- **BR-PRC-07** Tipos de descuento soportados (configurables por el admin): cupón % y monto fijo, envío gratis sobre un monto, 2x1, descuento por volumen, precio por tipo de cliente, oferta flash con fecha, primera compra.

### Cuentas
- **BR-ACC-01** **Toda compra requiere cuenta.** Se puede agregar al carrito sin login; el login/registro se pide al pagar.
- **BR-ACC-02** Login con **email o teléfono + contraseña**.
- **BR-ACC-03** Sin verificación obligatoria de email/teléfono.
- **BR-ACC-04** Libreta de **múltiples direcciones**; envío y facturación pueden diferir.
- **BR-ACC-05** **Carrito persistente** entre dispositivos; **sin lista de deseos**.
- **BR-ACC-06** Datos fiscales (NIT/CI, razón social) opcionales, se piden **en el checkout**.
- **BR-ACC-07** Nada se borra: la "eliminación" de cuenta es **desactivación/anonimización**, conservando pedidos para contabilidad.
- **BR-ACC-08** Roles: `admin` y `customer`.

### Checkout y pagos
- **BR-CHK-01** **Un solo formulario, sin pasos**: nombre, correo, teléfono (+ dirección/entrega según configuración).
- **BR-CHK-02** Bolivia: botón **"Enviar pedido por WhatsApp"**; arquitectura lista para pasarelas (Stripe, Mercado Pago, PayPal) por país.
- **BR-CHK-03** Sin recuperación de carritos abandonados.
- **BR-CHK-04** Antes de pagar se **revalidan stock y precio** y se notifica cualquier cambio.
- **BR-CHK-05** Sin pedido mínimo/máximo, sin notas ni regalo; sin mezcla de productos digitales.
- **BR-PAY-01** Métodos iniciales: **efectivo contra entrega**, **QR boliviano** (manual o vía API, p. ej. CobraFácil) y **pedido por WhatsApp**.
- **BR-PAY-02** Capa de pagos con **proveedores intercambiables** (interfaz común).
- **BR-PAY-03** Ventana de pago de **10 minutos** para métodos asíncronos (QR); vencida, el pedido se cancela y libera stock.
- **BR-PAY-04** **Verificación manual de comprobantes** de transferencia (el cliente sube foto, el admin aprueba/rechaza).
- **BR-PAY-05** Pago duplicado / monto incorrecto / contracargo: ver supuesto S-06.
- **BR-PAY-06** Solo pago al contado.
- **BR-PAY-07** Contra entrega rechazado: la **tienda asume** el envío de vuelta; existe **lista negra** de clientes (criterios: pendiente del admin).

### Envíos
- **BR-SHP-01** El costo lo define el admin; **por distancia** al inicio, con modelo extensible a otras variables (peso, zona, monto…).
- **BR-SHP-02** **Entregas programadas** (fecha/franja) soportadas.
- **BR-SHP-03** Transportistas, zonas, recojo, internacionales, parciales e incidencias: **configuración del admin posterior** (ver PENDIENTES_ADMIN).
- **BR-SHP-04** Notificaciones por **email y/o WhatsApp** en: confirmado, empacado, enviado, entregado.

### Pedidos
- **BR-ORD-01** Estados: `pending_payment → paid → preparing → shipped → delivered → completed`; salidas: `cancelled`, `refunded`.
- **BR-ORD-02** El cliente puede **cancelar hasta antes de "preparing"**; después solo el admin. Dirección/productos no se modifican tras pagar salvo por el admin.
- **BR-ORD-03** El admin puede **editar pedidos** y **crear pedidos manuales** (ventas por WhatsApp).
- **BR-ORD-04** Numeración **secuencial sin huecos con prefijo** (`MIC-000123`).
- **BR-ORD-05** Sin suscripciones/pedidos recurrentes.
- **BR-ORD-06** Cada pedido guarda **snapshot** (nombre, variante, precio, imagen, impuestos, moneda, tipo de cambio).

### Admin, legal, marketing, datos
- **BR-ADM-01** Dashboard: ventas, productos, más vendidos, stock bajo, **margen y utilidad**.
- **BR-ADM-02** **Carga masiva** (CSV/Excel) y **exportación** de pedidos/reportes.
- **BR-ADM-03** **Registro de auditoría** (quién cambió qué y cuándo).
- **BR-ADM-04** **Banner de noticias** del home editable.
- **BR-ADM-05** Etiquetas de envío / guías / packing list (formato pendiente del admin).
- **BR-LEG-01** T&C, privacidad, cookies y canal de reclamos: **los redacto yo** y se validan con abogado.
- **BR-MKT-01** Emails transaccionales con marca propia (remitente por definir).
- **BR-MKT-02** Meta Pixel + Conversions API + GA4: se implementan **cuando haya los IDs**.
- **BR-MKT-03** Upsell/cross-sell: productos relacionados (manuales) y sugerencias en carrito.
- **BR-MKT-04** SEO fuerte + feed para Google Merchant / catálogo de Meta.
- **BR-DAT-01** Archivar en vez de borrar; snapshots en pedidos.
- **BR-DAT-02** Concurrencia resuelta **atómicamente en la BD** (la última unidad la gana quien confirme primero; el otro recibe aviso claro).
- **BR-DAT-03** Pagos con confirmación tardía o webhook fallido → **reconciliación automática** + confirmación manual del admin.

---

## 6. Modelo de datos (resumen)

> Convenciones: `id uuid`, `created_at/updated_at`, `archived_at` (soft-delete) donde aplique, dinero en `numeric(14,2)`, siempre con `currency`. Todas las tablas con **RLS activa**.

**Identidad**
- `profiles` (id = auth.users.id, nombre, email, phone_e164 único, role `customer|admin`, is_active, blacklisted…)
- `addresses` (profile_id, etiqueta, línea, ciudad, país, lat, lng, es_envio/es_facturación, default)
- `tax_profiles` (profile_id, documento, razón social)

**Catálogo**
- `categories` (jerárquica, slug) · `collections` (slug, vigencia opcional)
- `products` (nombre, slug, descripción, modelo, código, materiales, washcare, costo_base, out_of_stock_behavior `sold_out|hide`, status, archived_at)
- `product_categories`, `product_collections` (N:M)
- `product_colors` (product_id, nombre, hex, orden) · `product_sizes` (product_id, etiqueta, orden)
- `product_variants` (product_id, color_id, size_id nullable, sku, stock_on_hand, low/critical thresholds opcionales, archived_at) — único (producto, color, talla)
- `product_images` (product_id, color_id opcional, path, orden, alt)
- `product_prices` (product_id, currency, country nullable, amount) — única por (producto, moneda, país)
- `product_delivery` (product_id, country, días_estimados, fee_override nullable) *(supuesto S-03)*
- `product_related` (product_id, related_id, orden)

**Monedas y configuración**
- `countries` (code, nombre, currency, enabled) · `currencies` (code, símbolo, decimales)
- `exchange_rates` (from `BOB`, to, rate, mode `fixed|variable`, updated_by, vigente_desde)
- `store_settings` (clave/valor tipado: umbrales de stock, ventana de pago, TTL de reserva, banner, datos legales, contacto, WhatsApp destino…)
- `news_banners` (texto, enlace, activo, vigencia)

**Inventario**
- `stock_reservations` (variant_id, qty, owner_type `cart|order`, owner_id, expires_at, status)
- `stock_movements` (variant_id, delta, motivo `sale|return|adjust|import|cancel`, ref, user) — libro mayor inmutable

**Carrito**
- `carts` (profile_id nullable, anon_token, status) · `cart_items` (cart_id, variant_id, qty, **unit_price_at_add**, currency, added_at)

**Envíos**
- `shipping_zones`, `shipping_rate_rules` (tipo `distance|weight|flat|zone`, parámetros jsonb, prioridad, activo), `store_locations` (origen/almacén lat-lng), `delivery_slots` (días, franjas, cupo), `blocked_dates`

**Descuentos**
- `discounts` (tipo, valor, reglas jsonb, vigencia, usos_máx, usos_por_cliente, activo) · `coupons` (code, discount_id) · `discount_redemptions` (order_id, profile_id)

**Pedidos y pagos**
- `orders` (number, profile_id, status, currency, fx_rate_used, subtotal, discount_total, shipping_total, total, payment_method, shipping_address snapshot, billing snapshot, delivery_slot, expires_at, channel `web|whatsapp|manual`)
- `order_items` (order_id, variant_id, **snapshot** nombre/color/talla/sku/imagen, unit_price, qty, cost_snapshot)
- `order_status_history` (order_id, from, to, by, nota)
- `order_counters` (prefix, last_value) — numeración sin huecos
- `payments` (order_id, provider, method, amount, currency, status, external_id, raw jsonb, idempotency_key) · `payment_proofs` (payment_id, file_path, estado `pending|approved|rejected`, revisado_por)
- `refunds` (order_id, payment_id, amount, motivo, estado)
- `blacklist_entries` (profile_id/phone/email, motivo, creado_por, activo)

**Sistema**
- `notification_outbox` (tipo, canal `email|whatsapp`, destinatario, payload, estado, intentos, next_retry_at) — patrón *outbox*
- `audit_log` (actor, tabla, registro, acción, diff jsonb, ts, ip opcional)
- `webhook_events` (provider, event_id único, payload, procesado) — idempotencia

**Funciones RPC / SQL críticas**: `reserve_stock`, `release_stock`, `commit_stock_for_order`, `create_order` (valida y fija precios, descuentos, envío; asigna número; todo en 1 transacción), `apply_discount`, `quote_shipping`, `transition_order_status`, `cancel_order`, `expire_reservations_and_orders` (cron), `reconcile_payments` (cron), `merge_guest_cart`, `get_dashboard_metrics`.

---

## 7. Flujos clave

### 7.1 Moneda y precio mostrado
País del cliente → moneda → `product_prices` explícito; si no existe, se calcula `precio_BOB × tipo_de_cambio` redondeado a 2 decimales (si el admin lo permite para ese producto). El cliente siempre ve **un precio final**. El pedido congela moneda y tipo de cambio.

### 7.2 Stock: modelo de dos capas
1. **Retención blanda (10 min)**: al agregar al carrito se crea/renueva una `stock_reservation` (visitantes con token anónimo). Muestra cuenta regresiva en el carrito. Al vencer, **el carrito no se vacía**; solo se pierde la garantía.
2. **Compromiso firme**: `create_order` bloquea filas (`SELECT … FOR UPDATE`) de las variantes y descuenta `available = stock_on_hand − reservas vigentes de otros`. Si falta stock, aborta con detalle por línea. El stock firme se libera si el pedido se cancela/expira.

`available` nunca es negativo (CHECK + lock). Mitigaciones antiabuso de retención por *add-to-cart* (límite de cantidad por variante y de reservas por sesión, rate limit): ver **D-02**.

### 7.3 Máquina de estados del pedido
```
pending_payment ──(pago confirmado / admin confirma)──► paid ─► preparing ─► shipped ─► delivered ─► completed
   │  └─(expira ventana de pago / cancela)──► cancelled
   └─ paid|preparing ──(cancelación admin)──► cancelled ──(reembolso)──► refunded
```
Solo `transition_order_status` puede cambiar el estado (valida transición, escribe historial, dispara outbox). Pedidos de **contra entrega/WhatsApp** nacen en `pending_payment` con stock comprometido hasta que el admin los confirme o cancele.

### 7.4 Checkout (formulario único)
Carrito → [Pagar] → (login/registro si no hay sesión; el carrito se fusiona) → formulario (datos, dirección, entrega programada, datos fiscales, cupón) → cotización (`quote_shipping`, `apply_discount`) → **revalidación** de stock/precio con diff visible → método de pago → `create_order` → según método: WhatsApp (mensaje pre-armado con # de pedido), QR (pantalla con QR y cuenta regresiva de 10 min) o contra entrega.

### 7.5 Pagos y webhooks
Interfaz `PaymentProvider { createCharge, handleWebhook, refund, getStatus }`. Implementaciones: `manual_qr`, `cobrafacil`, `cash_on_delivery`, `whatsapp`; futuras: `stripe`, `mercadopago`, `paypal`. Webhooks **idempotentes** (`webhook_events`), firma verificada, y `reconcile_payments` por cron para webhooks perdidos.

### 7.6 Envío por distancia
Origen = `store_locations`. Destino = pin/dirección del cliente (lat/lng). Distancia por Haversine × factor configurable (fase 1) o ruteo (OSRM/Directions, fase posterior). Costo = reglas ordenadas del admin (tramos, tarifa base, por km, mínimos/máximos, gratis sobre X). Diseñado como **pipeline de reglas** para sumar peso/zona sin migrar.

### 7.7 Notificaciones (outbox)
Los cambios de estado y alertas escriben en `notification_outbox`; un worker (Edge Function + cron) entrega por email/WhatsApp con reintentos y backoff. Si el canal falla, no bloquea el pedido.

---

## 8. Seguridad (transversal)

- RLS deny-by-default; tests automáticos de RLS por rol.
- Precios, totales, descuentos y envío **siempre** recalculados en servidor.
- Rate limiting en login, creación de pedidos y reserva de stock.
- Contraseñas: política mínima + chequeo de filtraciones (patrón HIBP de Acrosoft).
- Headers en `vercel.json`: CSP estricta, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'` en `/admin` y `/login`.
- Uploads (fotos, comprobantes): validación de tipo/tamaño, buckets privados para comprobantes, URLs firmadas.
- Secretos solo en Supabase/Vercel; webhooks con verificación de firma.
- Enumeración de cuentas: mensajes de error uniformes en login/registro.
- Auditoría de acciones admin; backups y restauración probada.
- Cumplimiento de datos personales: consentimiento de cookies/marketing, política de privacidad, anonimización en desactivación de cuenta.

---

## 9. UI/UX

- Diseño y marca (logo, paleta, tipografías, componentes) **los entrega la diseñadora**. Hasta entonces: tokens provisionales en un solo archivo para que el cambio sea de un commit.
- **Mobile-first** (el tráfico de ropa en LatAm es mayoritariamente móvil), accesibilidad **WCAG AA**, estados vacío/carga/error en todo.
- Panel admin: lenguaje simple, confirmaciones claras, acciones masivas y *undo* donde sea posible, semáforos de stock visibles, formularios con ayudas.
- i18n desde el inicio (`es` primero; estructura lista para `en`).

---

## 10. Estrategia de calidad (aplica a todos los sprints)

Cada sprint incluye: **Testing · Revisión · Edge cases · Riesgos**. Definición de *Hecho* (DoD) global:
1. Criterios de aceptación cumplidos y demostrados.
2. Tests unitarios/integración verdes; E2E del flujo crítico del sprint.
3. Tests de RLS/SQL para cada tabla/RPC nueva.
4. `lint` + `tsc --noEmit` + `build` sin errores.
5. Revisión de seguridad (checklist) y de accesibilidad básica.
6. Migraciones reversibles/idempotentes, probadas desde cero (`supabase db reset`).
7. Documentación y variables de entorno actualizadas.
8. Sin datos sensibles en logs; errores con ID de correlación.

Pirámide objetivo: muchos unit (lógica de precios, dinero, reglas), integración sobre BD real local (RLS, RPC, concurrencia), pocos pero robustos E2E (compra completa, admin CRUD, concurrencia de la última unidad).

---

## 11. Roadmap

| Release | Sprints | Resultado |
|---|---|---|
| **R1 — MVP (objetivo 2 semanas)** | S0–S5 | Admin con CRUD de productos + tienda pública con buena UI, catálogo navegable y SEO base |
| **R2 — Compra** | S6–S10 | Cuentas, carrito, envíos, cupones, pedidos y checkout (WhatsApp / contra entrega) |
| **R3 — Operación** | S11–S15 | QR/pagos, gestión de pedidos, notificaciones, dashboard y carga masiva, legal/SEO/analytics |
| **R4 — Lanzamiento v1.0** | S16 | Hardening, carga, seguridad, go-live |
| **R5 — Expansión** | S17–S18 | Facturación electrónica (si aplica), multi-país y pasarelas internacionales |

Detalle y matriz de dependencias: [Sprints/00_INDICE_Y_DEPENDENCIAS.md](Sprints/00_INDICE_Y_DEPENDENCIAS.md).

> **Realismo del plazo**: las 2 semanas cubren de forma razonable el R1 **solo si** el diseño llega a tiempo para S4–S5 y las cuentas (Supabase, Vercel, repo) están listas desde el día 1. Todo el alcance de R2–R4 excede 2 semanas; el plan lo reparte para no comprometer la calidad del MVP.

---

## 12. Supuestos y decisiones abiertas

**Supuestos tomados (confirmar):**
- **S-01** Admin = 2 usuarios con permisos idénticos.
- **S-02** Login con teléfono sin SMS: se normaliza a E.164 y se resuelve el identificador en servidor (Edge Function `resolve-login`); usuarios solo-teléfono usan un email interno sintético. Riesgo asumido: sin verificación no hay prueba de propiedad del contacto (BR-ACC-03).
- **S-03** "delivery (N)" por producto = **tiempo estimado (y opcionalmente costo extra) de entrega por país**. Confirmar con el dueño.
- **S-04** Precio del carrito respetado hasta **7 días** (configurable); luego se revalida y se avisa. Si el precio bajó, se cobra el menor.
- **S-05** Pedidos por WhatsApp/contra entrega comprometen stock hasta que el admin confirme o cancele (sin expiración automática; el admin recibe recordatorio de pedidos pendientes antiguos).
- **S-06** Pago duplicado → reembolso/crédito del excedente + alerta al admin; monto incorrecto → pedido queda `pending_payment` y alerta; contracargo → marca el pedido, alerta y bloquea reenvío.
- **S-07** Lista negra bloquea **contra entrega** y pedidos manuales del cliente; el resto de su cuenta permanece (criterios finales los da el admin).
- **S-08** Dirección de entrega con pin en mapa (Leaflet/OpenStreetMap, sin costo por consulta) como alternativa económica a Google Maps.

**Decisiones abiertas:**
- **D-01** ¿SPA + Edge SEO es suficiente o migramos el storefront a un framework con SSR? (se decide con medición en S5).
- **D-02** Reserva de 10 min *al agregar al carrito* facilita el acaparamiento de stock (bots/curiosos). Recomendación: reservar al **iniciar checkout**; se implementa como pidió el dueño pero con topes y *feature flag* para cambiar.
- **D-03** Proveedor de email transaccional (Resend/Postmark/…) y de WhatsApp (API oficial vs. manual).
- **D-04** Mapas/ruteo: OSM + Haversine (fase 1) vs. Google Maps.
- **D-05** Facturación electrónica (SIN Bolivia): depende de la respuesta del admin.

---

## 13. Glosario
**Variante**: combinación color×talla con stock propio. **Snapshot**: copia congelada de datos al momento del pedido. **Outbox**: tabla de mensajes pendientes de enviar para garantizar entrega con reintentos. **RLS**: Row Level Security de Postgres. **Retención blanda**: reserva temporal de stock de 10 min. **Compromiso firme**: descuento de stock al crear el pedido.

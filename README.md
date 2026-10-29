# Made In Chola

Ecommerce B2C de ropa (Bolivia primero; multi-país/moneda después). Plan completo en [DOCUMENTO_MAESTRO.md](DOCUMENTO_MAESTRO.md) y [Sprints/](Sprints/00_INDICE_Y_DEPENDENCIAS.md).

## Requisitos
- Node ≥ 20 (`.nvmrc` fija 24) y **npm** (único gestor; lockfile: `package-lock.json`).
- Para Supabase local: **Docker** y Supabase CLI (probado con 2.117.0). En macOS sin Docker Desktop: `brew install colima docker && colima start --cpu 4 --memory 6`. Para tests de Edge Functions: **Deno** (`brew install deno`).

## Primeros pasos
```bash
npm install
cp .env.example .env.local   # completa VITE_SUPABASE_ANON_KEY con la que imprime `supabase start`
npm run dev                  # Supabase local (si hay Docker) + Vite en http://localhost:5173
```
`npm run dev` avisa claramente y arranca solo el front si Docker no está disponible. `npm run dev:web` arranca solo Vite.

## Scripts
| Script | Qué hace |
|---|---|
| `npm run dev` / `dev:web` | Desarrollo (con / sin Supabase local) |
| `npm run build` / `preview` | Typecheck + build de producción / servirlo |
| `npm run lint` · `format:check` · `typecheck` | Calidad estática |
| `npm test` | Unit + componentes (Vitest) |
| `npm run e2e` | Playwright contra el **build** de producción (móvil y escritorio) |
| `npm run test:integration` | Tests contra Supabase local real (requiere `supabase start`) |
| `npm run test:edge` | Tests Deno de `supabase/functions/_shared` |
| `npm run db:reset` · `db:test` | `supabase db reset` · tests SQL (pgTAP) — requieren Docker |
| `npm run types` | Regenera `src/lib/database.types.ts` desde la BD local |

## Backend local (Supabase)
```bash
colima start --cpu 4 --memory 6                 # (macOS sin Docker Desktop)
supabase start -x logflare,vector               # BD, Auth, Studio (http://127.0.0.1:54323), Mailpit (http://127.0.0.1:54324)
supabase functions serve                        # Edge Functions: login, register, set-password, deactivate-account
npm run dev:seed                                # usuarios de desarrollo + imágenes de ejemplo (solo funciona contra Supabase LOCAL)
```
> **Los cambios en `supabase/config.toml` solo se aplican tras `supabase stop && supabase start`** (y reiniciar `functions serve`).

**Usuarios de desarrollo** (contraseña `Chola-Dev-2026!`): `admin@madeinchola.test` (admin) · `cliente@madeinchola.test` · teléfono `71111111`.
Promover un admin real: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run admin:promote -- correo@dominio.com` (solo con la service key; el rol admin jamás se asigna desde el navegador).

### Autenticación (Sprint 1)
- **Login por email o teléfono** vía la Edge Function `login` (todo en servidor): normaliza el identificador, resuelve la cuenta, devuelve la sesión. Nunca revela si una cuenta existe ni el email asociado a un teléfono; mismo mensaje y tiempo de respuesta parecido ante cualquier fallo.
- **Solo-teléfono (S-02)**: Auth recibe un email sintético `<e164 sin +>@phone.madeinchola.invalid` (dominio `.invalid` reservado: no se puede registrar a mano). `profiles.phone_e164` es el identificador real.
- **Registro público de GoTrue DESACTIVADO** (`enable_signup=false`): solo `register` crea cuentas (política de contraseña + HIBP + normalización). `[auth.email] enable_signup` **no** significa "registro público": apagarlo desactiva el login por contraseña.
- **Roles**: `profiles.role` (`customer|admin`). `is_admin()` se evalúa en servidor en cada consulta (degradar o desactivar a un admin surte efecto inmediato). El rol nunca se lee de `user_metadata`.
- **Deny-by-default**: los privilegios por defecto de `public` están revocados; cada tabla/función nueva debe conceder permisos de forma explícita. `supabase/tests/05_estructura_seguridad.test.sql` falla si alguien lo olvida (RLS desactivada, anon con privilegios, `SECURITY DEFINER` sin `search_path`, funciones expuestas fuera de la lista blanca).
- **Rate limit**: tabla `rate_limits` + `check_rate_limit()` atómico. Login: 5 intentos/15 min por identificador y 30 por IP. Registro: 5/h por IP.
- **Auditoría**: `audit_log` inmutable + trigger genérico `audit_changes('col_pii',…)` (las columnas con PII se registran como "cambió", nunca su valor).
- **Variables de las Edge Functions**: `ALLOWED_ORIGINS` (lista separada por comas; en staging/producción es OBLIGATORIA, por defecto solo orígenes de desarrollo local). `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las inyecta Supabase.

### Catálogo, monedas e inventario (Sprint 2)
- **Lectura pública solo por vistas `public_*`** (productos visibles, variantes con estado `in_stock|low|out`, imágenes, categorías, colecciones vigentes, banner, ajustes públicos y secciones del home). `anon` no tiene privilegios sobre ninguna tabla; las vistas llevan el filtro de visibilidad dentro y nunca exponen costo, stock exacto, SKU ni código. **Ojo:** en PostgreSQL las funciones que aparecen dentro de una vista se ejecutan con los permisos de _quien consulta_, no del dueño de la vista; por eso las vistas no llaman a funciones restringidas (y los tests consultan cada vista con `select *` como `anon` y como cliente).
- **Escritura**: el admin inserta/actualiza **por columnas** bajo RLS (`is_admin()`). **Nadie, ni `service_role`, puede `DELETE`/`TRUNCATE`** tablas de catálogo: se archiva (`archived_at`). Las asociaciones (categorías, colecciones, relacionados) se reemplazan con `admin_set_product_categories|collections|related`. Plantilla reutilizable: `public._apply_admin_rls(tabla, columnas_insert, columnas_update)`.
- **Stock**: `stock_on_hand` solo cambia por funciones y cada cambio queda en `stock_movements` (inmutable), así que `sum(delta) = stock_on_hand` siempre. `adjust_stock` (admin) no deja bajar de lo ya comprometido en pedidos. `reserve_stock`, `release_stock` y `apply_stock_change` **solo las ejecuta `service_role`**: las llamará la Edge Function del carrito (S7), nunca el navegador. La reserva de carrito dura 10 min (`reservation_ttl_minutes`); `expire_reservations()` corre cada minuto con `pg_cron`, y una reserva vencida deja de contar aunque el cron no haya corrido.
- **Precios**: `price_for` (interno) y `public_price_for` (público). Orden: precio explícito (moneda, país) → general de la moneda → conversión BOB × tipo de cambio si el producto lo permite. Redondeo: mitades alejándose de cero. Devuelve `NULL` antes que un precio dudoso (moneda/país deshabilitados, sin tasa). Un precio con más decimales de los que admite su moneda **se rechaza**, no se redondea en silencio. Los precios incluyen impuestos; el envío se suma aparte.
- **Home editable**: `home_sections` + `home_section_items` (hero, product_row, collection_feature, about, banner, tagline, category_tiles) con imagen o video; el admin las crea, ordena, activa y archiva.
- **Storage**: buckets de lectura pública `product-images` (5 MiB), `site-media` (8 MiB) y `site-videos` (50 MiB). Escritura solo del admin y solo en rutas `products/{id}/{uuid}.ext` y `home/{uuid}.ext`; sin SVG. El borrado directo por SQL sobre `storage.objects` lo bloquea Supabase (se borra con su API).
- **Ajustes de la tienda** (`store_settings`): contacto, WhatsApp de pedidos, redes sociales, umbrales del semáforo y TTL. Las claves las define el código; el admin solo cambia el valor, que se valida según su tipo.
- **Front**: `src/features/catalog` → `catalogService` (lectura pública), `priceService`, `stockService` y hooks de TanStack Query con claves `catalogKeys`. `slugify` existe en SQL y en TypeScript y un test de integración verifica que dan lo mismo.
- **Datos de ejemplo**: `supabase/seed.sql` carga 30 productos con casos límite (agotados, ocultos, borrador, archivado) en cada `db reset`; `npm run dev:seed` sube además imágenes de ejemplo **provisionales** a 8 productos. Las imágenes oficiales las sube el admin desde el panel.

## Pruebas
| Comando | Qué prueba | Requiere |
|---|---|---|
| `npm test` | Unit y componentes (reglas de identidad, contraseñas, guards, AuthProvider, pantallas) | — |
| `npm run test:edge` | Código compartido de Edge Functions (Deno) | Deno |
| `npm run db:test` | pgTAP: RLS por rol, escalada de privilegios, auditoría, rate limit, estructura | Supabase local |
| `npm run test:integration` | HTTP real contra Edge Functions + Auth + BD (registro, login, bloqueo, recuperación con correo real, desactivación) | Supabase + `functions serve` |
| `npm run e2e` | Navegador real (móvil y escritorio), axe WCAG, flujos completos | Supabase + `functions serve` |
| `npm run verify` | Todo lo anterior en orden | todo |

`test:integration` y `e2e` **restauran la BD** (`db reset` + `dev:seed`) al terminar, pase o falle: nada de datos de prueba en tu base de desarrollo.

## Estructura
```
src/app          rutas, layouts, páginas       src/lib       money, env, logger, errors, supabase…
src/features     (vacío: lo llenan los sprints)  src/i18n      es.ts + t()
src/components   ui/ (shadcn) y compartidos      src/styles    tokens.css (tokens provisionales)
supabase/        migrations · functions/_shared · tests (pgTAP) · seed.sql
e2e/             Playwright                       scripts/      dev.mjs
```

## Convenciones
- **Dinero**: nunca floats. `lib/money` opera con enteros en la unidad menor y decimales como string (`fromDecimal("0.1")`). Redondeo: mitades alejándose de cero. Reparto con `allocate` (no pierde centavos).
- **Fechas**: UTC en BD; `lib/datetime` convierte a `America/La_Paz` solo para mostrar.
- **Textos** en `src/i18n/es.ts`, nunca quemados. **Logs** solo vía `lib/logger` (redacta PII, lleva correlación); `console.*` está prohibido por ESLint.
- **Migraciones**: `YYYYMMDDHHMMSS_nombre.sql` (14 dígitos desde S1: puede haber varias el mismo día; la de S0 conserva `YYYYMMDD`), idempotentes, con rollback documentado al final.
- **Env**: solo `VITE_*` públicas, validadas con zod al arrancar (falla con pantalla explicativa; rechaza claves `service_role`). Secretos solo en Supabase/Vercel.
- **Ramas**: `main` protegida; trabajo en `feature/*` con PR (CI debe pasar).
- **Tokens de diseño provisionales**: todo el look está en `src/styles/tokens.css`; cambiarlo es un solo archivo.

## Diferencias respecto a Acrosoft (a propósito)
TypeScript `strict` + `noUncheckedIndexedAccess` (Acrosoft: `strict: false`); `no-console` e `unused-vars` como error; CSP sin `'unsafe-inline'` en scripts y con `frame-ancestors 'none'` global; E2E contra el build; imports de i18n tipados.

## Línea base del bundle
S0: JS 365 kB (gzip ≈ 111 kB) · CSS 10.6 kB. Se mide de nuevo al cerrar cada sprint (ver tabla en el documento de cada sprint).
# Made In Chola

Ecommerce B2C de ropa (Bolivia primero; multi-país/moneda después). Plan completo en [DOCUMENTO_MAESTRO.md](DOCUMENTO_MAESTRO.md) y [Sprints/](Sprints/00_INDICE_Y_DEPENDENCIAS.md).

## Requisitos
- Node ≥ 20 (`.nvmrc` fija 24) y **npm** (único gestor; lockfile: `package-lock.json`).
- Para Supabase local: **Docker**. El CLI de Supabase **no se instala aparte**: viene fijado en `package.json` (2.121.0, versión exacta) y se usa con `npm run db:*` o `npx supabase …`; no uses uno global (ver «Backend local»). En macOS sin Docker Desktop: `brew install colima docker && colima start --cpu 4 --memory 6`. Para tests de Edge Functions: **Deno** (`brew install deno`).

## Primeros pasos
```bash
npm install
cp .env.example .env.local   # completa VITE_SUPABASE_ANON_KEY con la que imprime `npm run db:start`
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
| `npm run test:integration` | Tests contra Supabase local real (requiere `npm run db:start` y `functions:serve`) |
| `npm run test:edge` | Tests Deno de `supabase/functions/_shared` |
| `npm run db:start` · `db:stop` · `functions:serve` | Arranca / detiene el Supabase local · sirve las Edge Functions |
| `npm run db:reset` · `db:test` | Reinicia la BD local desde cero · tests SQL (pgTAP) — requieren Docker |
| `npm run types` | Regenera `src/lib/database.types.ts` desde la BD local |

## Backend local (Supabase)
```bash
colima start --cpu 4 --memory 6                 # (macOS sin Docker Desktop)
npm run db:start                                # BD, Auth, Studio (http://127.0.0.1:54323), Mailpit (http://127.0.0.1:54324)
npm run functions:serve                         # Edge Functions: login, register, set-password, deactivate-account
npm run dev:seed                                # usuarios de desarrollo + imágenes de ejemplo (solo funciona contra Supabase LOCAL)
```
> **Los cambios en `supabase/config.toml` solo se aplican tras `npm run db:stop && npm run db:start`** (y reiniciar `functions:serve`).

> **Una sola versión del CLI.** Usa siempre `npm run db:*` / `npx supabase`, nunca un `supabase` global (otra versión): cada CLI fija una imagen distinta de Storage y, si se mezclan, `db reset` deja el esquema interno de Storage más nuevo que el servidor que corre. Síntoma: **toda subida de imagen responde 500 `42P10`** y fallan los tests de Storage y «imágenes de ejemplo». Diagnóstico: `docker ps` (imagen de `storage-api`) y `select max(id) from storage.migrations` (74 con `storage-api:v1.72.1` = roto; con `v1.82.1` = correcto). Cura: `npm run db:stop && npm run db:start`. `scripts/toolchain.test.mjs` vigila la versión fijada y este README.

**Usuarios de desarrollo** (contraseña `Chola-Dev-2026!`): `admin@madeinchola.test` (admin) · `cliente@madeinchola.test` · teléfono `71111111`.
Promover un admin real: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run admin:promote -- correo@dominio.com` (solo con la service key; el rol admin jamás se asigna desde el navegador).

### Backend en la nube (Supabase de Made In Chola)
- **Un solo Supabase para la app; Docker solo para las pruebas.** `npm run dev` y los despliegues apuntan al proyecto de la nube (`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, la clave _publicable_, en `.env.local` o en las variables de Vercel). Las pruebas destructivas (`db reset`, pgTAP, mutaciones, concurrencia, integración, E2E) **solo** corren en el contenedor local desechable, nunca contra la nube.
- **Subir migraciones**: `npx supabase db push --db-url "postgresql://postgres:$SUPABASE_DB_PASSWORD@db.<ref>.supabase.co:5432/postgres" --dry-run` (primero el ensayo) y luego sin `--dry-run`. La contraseña va SOLO en una variable de entorno: nunca en un archivo ni en el repo (es público). `db push` no ejecuta `seed.sql`: los datos de ejemplo no llegan a la nube.
- **No empujar `supabase/config.toml` completo** (`supabase config push`): trae valores de desarrollo (límite de inicios de sesión subido a 1000, `site_url` local). Los ajustes de Auth de la nube se hacen en el panel o con la API de gestión, campo por campo.
- **Edge Functions**: `SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy --project-ref <ref>` y `npx supabase secrets set ALLOWED_ORIGINS=…` (obligatoria: el dominio de Vercel y, si se desarrolla en local contra la nube, `http://localhost:5173`).
- Activar `pg_cron` en el proyecto (Database → Extensions) si no lo está: sin él las reservas vencidas igual dejan de contar, pero no se marcan `expired`.
- **Proyecto nuevo = registro público ACTIVADO por defecto.** Hay que desactivarlo (Authentication → Sign In / Providers → "Allow new users to sign up"): solo la función `register` debe crear cuentas.

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

### Panel de administración (Sprint 3)
- **Rutas** (`/admin/*`, todas tras `RequireAdmin`; la autorización real es la RLS de la base): resumen, productos (listado, nuevo, edición), categorías, colecciones, monedas, ajustes (con banner de noticias) y auditoría. Cada pantalla se carga bajo demanda (`React.lazy`): la tienda pública no descarga código del panel.
- **Edición concurrente**: toda actualización de una fila existente pasa por `src/features/admin/lib/versioned.ts` → `updateVersioned(tabla, id, updated_at, parche)`. Solo actualiza si el `updated_at` sigue siendo el que se leyó; si no, lanza `StaleVersionError` y la pantalla avisa sin pisar a nadie. **El `updated_at` viaja como TEXTO tal cual lo devolvió la base** (pasarlo por `Date` pierde los microsegundos y todo guardado parecería un conflicto).
- **Listado de productos**: una sola consulta a la vista `admin_product_list` (filtros, orden, paginación y conteo exacto en el servidor, con el mismo cálculo de estado "agotado/oculto" que la tienda). El estado de la pantalla vive en la URL (`?q=&estado=&categoria=&coleccion=&stock=&orden=&pagina=`). Una página más allá del final salta a la última válida.
- **Producto**: se crea como borrador (precio, colores y tallas → todas las variantes con stock 0). La edición tiene secciones que se guardan por separado: datos, precios, colores/tallas (re-sincroniza variantes sin perder stock: `variantPlan`), stock (cada cambio es un movimiento del libro mayor, con motivo), imágenes (se reducen en el navegador a ≤ 2000 px antes de subir; orden por arrastre o botones), categorías/colecciones/relacionados, vista previa. Publicar muestra qué falta: sin precio en BOB o sin variantes **bloquea** (la base lo exige); sin imágenes o sin stock solo **avisa**.
- **Stock exacto**: la matriz edita "nuevo stock = N" y usa `admin_set_stock(variante, esperado, nuevo, motivo)`: bloquea la variante y **rechaza si el stock ya no es el que se vio** (una venta o un compañero lo cambió), diciendo cuánto hay ahora. Nunca se aplica un delta a ciegas.
- **Alertas de stock**: un trigger sobre `stock_movements` encola un `stock_alert` en `notification_outbox` solo al **cruzar** un umbral hacia peor (y solo de variantes activas de productos publicados); no repite mientras haya una pendiente del mismo nivel. La campana y el resumen se calculan en la base (`admin_product_stock`). El envío real del correo llega en S13.
- **Slugs**: renombrar un producto guarda el slug anterior en `product_slug_history`; la vista pública `public_product_slug_redirects` lo resuelve (la tienda, S5, redirige). **Solo redirige lo que era público al renombrar** (producto publicado y no archivado, columna `was_public`): los nombres de trabajo de un borrador no se filtran al publicarlo. Limitación conocida: si un producto publicado se pasa a borrador, se renombra y se vuelve a publicar, el slug público anterior no redirige.
- **Diálogos**: usa `components/ui/dialog.tsx`, que devuelve el foco a quien abrió el diálogo (Radix solo lo hace con un `DialogTrigger`). Los diálogos de confirmación bloquean el doble clic y se quedan abiertos si la acción falla.
- **Textos del producto**: la descripción se guarda como texto plano (se quitan caracteres de control; el HTML no se altera). **La tienda debe mostrarla siempre como texto, nunca con `dangerouslySetInnerHTML`.**
- **Tipos de cambio**: `exchange_rates` es un libro inmutable; un error de tipeo se supera con otra fila. La pantalla pide confirmación si la tasa cambia más de 25 % o la fecha está a más de 7 días. "Vigente" se calcula con el reloj del navegador (la base usa el suyo).

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

**CI de GitHub** (`.github/workflows/ci.yml`): en cada push y PR corre solo `quality` (lint, formato, tipos, `npm test` y build). Todo lo que necesita Supabase local (pgTAP, Edge Functions, integración y E2E) se ejecuta en local con `npm run verify`, por ejemplo antes de cada release. El job `backend` se quitó el 2026-10-30; la versión anterior está en el commit `9d886df`.

## Estructura
```
src/app          rutas, layouts, páginas       src/lib       money, env, logger, errors, supabase…
src/features     auth · catalog · admin (panel)  src/i18n      es.ts + t()
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
- **Ramas**: `main` es la rama de producción (Vercel despliega cada push) y por decisión del dueño no está protegida; el único colaborador es quien desarrolla. El CI (`quality`) corre en cada push y PR.
- **Tokens de diseño provisionales**: todo el look está en `src/styles/tokens.css`; cambiarlo es un solo archivo.

## Diferencias respecto a Acrosoft (a propósito)
TypeScript `strict` + `noUncheckedIndexedAccess` (Acrosoft: `strict: false`); `no-console` e `unused-vars` como error; CSP sin `'unsafe-inline'` en scripts y con `frame-ancestors 'none'` global; E2E contra el build; imports de i18n tipados.

## Línea base del bundle
S0: JS 365 kB (gzip ≈ 111 kB) · CSS 10.6 kB. S1: gzip ≈ 202 kB. **S3: entrada pública gzip ≈ 214 kB** (`index` 71 + `App` 143) · CSS 5.3 kB gzip; el panel son ~38 chunks de carga diferida (≈ 100 kB gzip en total) que solo descarga un admin. Se mide de nuevo al cerrar cada sprint.
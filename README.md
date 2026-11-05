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
- **Subir migraciones**: `npx supabase db push --db-url "postgresql://postgres:$SUPABASE_DB_PASSWORD@db.<ref>.supabase.co:5432/postgres" --dry-run` (primero el ensayo) y luego sin `--dry-run`. La contraseña va SOLO en una variable de entorno: nunca en un archivo ni en el repo (es público). `db push` no ejecuta `seed.sql`; el catálogo de ejemplo se cargó en la nube a mano el 2026-11-05 (sin usuarios) y hay que borrarlo antes del lanzamiento (ver `SPRINT_19`, sección L).
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

### Sistema de UI (Sprint 4)
- **Guía de componentes**: `npm run dev:web` → `/_ui` (tokens con contraste calculado en vivo, tipografía y cada componente en sus estados). **Solo existe en desarrollo y en el build del E2E** (`VITE_UI_GUIDE=true`); el build de producción no la incluye. Documentación completa del sistema en [`docs/sistema-ui.md`](docs/sistema-ui.md).
- **Tokens**: todo el aspecto (color, tipografía, radios, sombras, movimiento, medidas) sale de `src/styles/tokens.css` y se nombra en `tailwind.config.ts`; cambiar un valor cambia tienda **y** panel. Paleta muestreada de los PDF de diseño; los contrastes WCAG AA los vigila `src/styles/tokens.test.ts` leyendo el CSS real. **Prohibido** usar colores crudos de Tailwind (`amber-300`) o hex en componentes.
- **Fuentes provisionales y autoalojadas** (`public/fonts/`, Baskervville + Jost, licencia OFL) hasta confirmar la licencia web de Baskerville/Intelo; el cambio es de un solo sitio (receta en `docs/sistema-ui.md`).
- **Componentes**: primitivas (`components/ui`), producto (`components/store`) y layouts de la tienda (`components/layout`: cabecera y pie **fieles al PDF de Inicio**, medidos a 1366 px: cabecera transparente sobre el hero en la portada y sólida en las demás páginas, logotipo disperso, «Tienda ⌄ · Nosotros» / «Bolivia ⌄ · bolsa (0) · usuario · lupa»; pie con símbolo y 4 columnas). El pie **no** lleva boletín ni cupón (decisión del dueño). La búsqueda lleva a `/buscar` (Sprint 5) y la bolsa enlaza a una pantalla provisional hasta S7.
- **Accesibilidad**: foco visible global, teclado completo, `prefers-reduced-motion`, zonas seguras iOS. Un botón que se desactiva mientras tiene el foco lo pierde: los extremos de paginación, carrusel, stepper y galería usan `aria-disabled`.
- **Formularios**: mensajes de zod en español (`lib/zodEs.ts`, instalado al arrancar; un mensaje escrito en el esquema siempre gana) y máscara de teléfono en vivo (`lib/phoneMask.ts`, `7123 4567`, conserva el cursor; es solo presentación porque `normalizePhone` acepta espacios).
- **Si ves «The `tracking-eyebrow` class does not exist» (o un error de importación de Radix) en el servidor de desarrollo**: es un `vite` que arrancó antes de estos cambios y no recargó `tailwind.config.ts` ni las dependencias nuevas. Reinícialo (`Ctrl+C` y `npm run dev:web`); tras tocar `tailwind.config.ts` o `package.json` conviene reiniciarlo siempre.
- **Sin modo oscuro** (opcional en el sprint; no hay diseño): decisión pendiente con la diseñadora.

### Tienda pública (Sprint 5)
- **Pantallas**: portada (secciones que configura el admin), `/tienda`, `/categoria/:slug`, `/coleccion/:slug`, `/buscar?q=` y `/producto/:slug`. Cada una va en su propio *chunk* (la portada, que es la entrada, no). Documentación completa, con parámetros de URL, política SEO y la **evaluación D-01** en [`docs/tienda.md`](docs/tienda.md).
- **Listado en la base**: `public_list_products` (filtros color/talla sobre **la misma variante**, precio, disponibilidad, orden con desempate estable, paginación de 24) y `public_listing_facets` (opciones con contador). El estado vive **en la URL** (`?color=&talla=&min=&max=&disponibles=1&orden=&pagina=`), así que se comparte, se recarga y «atrás» lo deshace.
- **Búsqueda**: ignora acentos y mayúsculas, busca en nombre, modelo y código y tolera una errata desde 5 letras (`pg_trgm`). Con consultas de varias palabras, las coincidencias exactas van primero y después las parciales por similitud.
- **SEO**: título/descripción/canónico/Open Graph/JSON-LD por pantalla (`usePageMeta`); filtros y orden **no se indexan** (canónico al listado limpio), las páginas sí con `prev/next`. Para bots (Google, WhatsApp, Facebook…) `vercel.json` desvía por `User-Agent` a funciones de borde (`api/seo.ts`) que devuelven HTML con metadatos y JSON-LD; también `api/sitemap.ts` y `api/robots.ts`. Variables: `VITE_SITE_URL` además de las de Supabase. **Lo que no se puede probar en local** (las *rewrites* de Vercel) está en «Verificación pendiente tras el despliegue» de `docs/tienda.md`.
- **Ficha de producto**: galería por color, selector de color y talla con disponibilidad por variante (sin exponer números de stock), «Consultar por WhatsApp» (`wa.me` con producto, color, talla y precio; el número sale de Ajustes → contacto), acordeones, relacionados, 404 amable, redirección de slugs renombrados y descripción siempre como **texto plano**.
- **Analítica preparada**: `track()` emite `view_item_list`, `view_item` y `search` sin proveedor hasta S15.
- **Migración nueva** `20261031000100_s5_listado_filtros.sql`: aplicada a la nube el 2026-11-02 junto con la de S3 (`db push` con `--dry-run` primero; ver `Sprints/SPRINT_19_Acciones_Manuales.md`).
- **Las pruebas fallan ante HTML inválido**: `src/test/setup.ts` convierte los avisos de React `validateDOMNesting` (p. ej. `<li>` dentro de `<li>`) y de claves repetidas en errores; jsdom no los haría fallar solo.

### Cuenta del cliente (Sprint 6)
- **Rutas** (todas bajo `RequireAuth`): `/cuenta` (perfil), `/cuenta/direcciones`, `/cuenta/datos-fiscales`, `/cuenta/pedidos` (+ `/:orderId`) y `/cuenta/seguridad`. Cada sección es un *chunk* aparte; el mapa (Leaflet, ≈ 49 kB gzip) solo carga al abrir el formulario de una dirección. Documentación completa (modelo de datos, concurrencia, funciones, mapa, contrato de `merge_guest_cart`) en [`docs/cuenta.md`](docs/cuenta.md).
- **Base** (`20261102000100_s6_cuenta_cliente.sql`): `addresses` (con `lat`/`lng`), `tax_profiles`, preferencias en `profiles` y las vistas públicas `public_countries`/`public_currencies`. **Una sola predeterminada, tope de 20 direcciones y 10 datos fiscales, nada se borra** (archivar/anonimizar) y cada cliente solo ve lo suyo (RLS; el admin solo lee). Dos peticiones simultáneas del mismo cliente terminan siempre con una predeterminada y sin errores (candado por sentencia; lo encontró la prueba de integración con concurrencia real).
- **Edge Functions nuevas**: `update-contact` (email/teléfono con la contraseña) y `change-password`; `deactivate-account` ahora también anonimiza direcciones y datos fiscales. Todas piden la contraseña actual y limitan los intentos.
- **Mapa y búsqueda** (S-08/D-04): OpenStreetMap + Nominatim detrás de una interfaz `Geocoder`, con la política de uso respetada (atribución, sin autocompletado, ≤ 1 petición/s) y el pin siempre opcional (coordenadas escritas a mano como alternativa accesible). La CSP permite `nominatim.openstreetmap.org`.
- **Datos fiscales**: el rigor del formato NIT/CI es un ajuste del panel (Ajustes → «Clientes y cuentas»): *estricto* (supuestos hasta confirmar las reglas oficiales) o *flexible*.
- **Indicador de fortaleza** de contraseña (`PasswordStrength`) en registro, restablecer y cambiar contraseña; **ganchos tras iniciar sesión** (`registerPostSignInHook`) para la fusión del carrito de invitado de S7.
- Las pruebas de **integración** recorren la cuenta con peticiones HTTP reales (IDOR entre clientes, concurrencia, topes, permisos por columna, cambio de contacto y de contraseña, desactivación con y sin anonimización).

### Carrito y retención de stock (Sprint 7)
- **Qué hace:** un invitado llena su bolsa sin cuenta; al iniciar sesión se **fusiona** con la de su cuenta (sin duplicar, con el precio más favorable); el stock se **retiene 10 minutos** al agregar; el precio con el que entró se respeta **7 días** (S-04); y **el servidor decide** precios, estados de cada línea (`ok`, `price_changed`, `low_stock`, `out_of_stock`, `unavailable`) y totales. Detalle, reglas y decisiones en `docs/carrito.md`.
- **Una sola puerta:** la Edge Function `cart` (acciones `get`, `set_item`, `remove_item`, `clear`, `refresh`, `accept_prices`, `merge`). Las funciones SQL del carrito solo las ejecuta `service_role` (como `reserve_stock`) y las tablas `carts`/`cart_items` solo las lee el admin. El invitado se identifica con un **token opaco** que emite el servidor; la base guarda solo su sha256.
- **Antiacaparamiento (D-02):** topes por bolsa (10 por variante, 30 líneas, 30 unidades), **tope de unidades retenidas por red** (150; las IPv6 se agrupan por /64 y la base guarda solo una huella HMAC, nunca la IP), 30 carritos nuevos por red y hora, límites de tasa, cuerpo ≤ 2 kB y **ninguna lista** en la validación (el aviso de `zod` no aplica). Repetir peticiones renueva la retención; lo que lo acota es el tope por red. No acota a quien use muchas redes (ver `docs/carrito.md`). Todo se ajusta en Ajustes → «Carrito y reservas»; un interruptor mueve la reserva de «al agregar» a «al pagar».
- **Cliente:** `src/features/cart/` — un almacén sin React (`cartStore.ts`, una petición a la vez, cantidades absolutas, reintento sin conexión, otras pestañas) y el proveedor que lo ata a la sesión. Solo los invitados guardan algo en el navegador (su token y la última foto del carrito); un usuario con sesión no guarda nada.
- **Migración** `20261103000100_s7_carrito.sql`; pgTAP `14_s7_carrito`; integración con peticiones HTTP reales y **concurrencia real** (8 invitados contra las últimas 3 unidades, fusiones simultáneas, 10 cambios a la vez de una misma bolsa). «Deshacer» conserva el precio y la garantía (S-04) porque el servidor recuerda 15 minutos lo que se quitó.

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
src/components   ui/ (shadcn) y compartidos      src/styles    tokens.css · fonts.css (sistema de UI)
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
- **Tokens de diseño**: todo el look está en `src/styles/tokens.css`; cambiarlo es un solo archivo (ver «Sistema de UI»).

## Diferencias respecto a Acrosoft (a propósito)
TypeScript `strict` + `noUncheckedIndexedAccess` (Acrosoft: `strict: false`); `no-console` e `unused-vars` como error; CSP sin `'unsafe-inline'` en scripts y con `frame-ancestors 'none'` global; E2E contra el build; imports de i18n tipados.

## Línea base del bundle
S0: JS 365 kB (gzip ≈ 111 kB) · CSS 10.6 kB. S1: gzip ≈ 202 kB. **S3: entrada pública gzip ≈ 214 kB** (`index` 71 + `App` 143) · CSS 5.3 kB gzip; el panel son ~38 chunks de carga diferida (≈ 100 kB gzip en total) que solo descarga un admin. **S4: entrada pública gzip ≈ 244 kB** (`index` 73 + `App` 171; +30 kB por Radix Dialog/Accordion, lucide y los layouts de la tienda) · CSS ≈ 9 kB gzip · fuentes 57 kB (4 `.woff2` latinos, se descargan según se usan). Mejora posible, no hecha: cargar bajo demanda `MobileMenu` y `SearchSheet` (≈ −20 kB gzip), junto con la partición por rutas de S5. Se mide de nuevo al cerrar cada sprint. **S5: entrada pública gzip ≈ 243,5 kB** (`index` 72 + `App` 171; la portada, la ficha, el listado, la búsqueda y el SEO suman ≈ +16 kB que se compensan sacando las pantallas de cuenta a carga diferida; presupuesto: ≤ 270 kB) · listado y ficha en chunks propios (≈ 9 y 11 kB). Lighthouse móvil local: portada 89 / ficha 88 de rendimiento, accesibilidad 100 en ambas, CLS 0,045. **S6: entrada pública gzip ≈ 256,2 kB** (`index` 79,8 + `App` 176,4; presupuesto ≤ 270) · CSS 11,4 kB; las pantallas de cuenta van en chunks propios (direcciones ≈ 13 kB, perfil ≈ 4,5, fiscales ≈ 4,6, seguridad ≈ 2,6) y Leaflet (≈ 50 kB + 6 kB de CSS) solo se descarga al abrir el selector de ubicación. Lighthouse no se repitió en S6. **S7: entrada pública gzip ≈ 263,1 kB** (`index` 81,6 + `App` 181,5; presupuesto ≤ 270) · CSS 11,5 kB; la página de la bolsa (≈ 1,8 kB) y el contenido del cajón (≈ 1,0 kB) cargan bajo demanda. Lighthouse no se repitió en S7.
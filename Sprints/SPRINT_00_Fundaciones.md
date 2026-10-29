# Sprint 0 — Fundaciones y entorno

**Release:** R1 · **Estimación:** 2 días · **Depende de:** — (cuentas de Supabase, Vercel y GitHub idealmente listas)

## Objetivo
Dejar un proyecto ejecutable, reproducible y con calidad automatizada, sobre el que todos los sprints posteriores puedan construir sin fricción.

## Alcance
**Dentro:** scaffolding, configuración, convenciones, CI, Supabase local, Vercel preview, utilidades base (dinero, i18n, errores), tests de humo.
**Fuera:** cualquier lógica de negocio, tablas de dominio, UI final.

## Reglas de negocio cubiertas
Ninguna directamente; habilita BR-DAT-01 (convenciones de migración/archivado) y la seguridad transversal (§8 del maestro).

## Tareas

### Repo y herramientas
- [ ] Inicializar repo Git, `.gitignore`, rama `main` protegida y flujo de ramas (`feature/*`, PR obligatorio).
- [ ] Scaffolding **Vite + React 18 + TypeScript (strict)** con Tailwind 3, shadcn/ui, `tailwindcss-animate`, alias `@/`.
- [ ] Instalar dependencias del stack (ver maestro §2). Elegir **un** gestor de paquetes y un lockfile.
- [ ] ESLint 9 + typescript-eslint + reglas de hooks; Prettier; `lint-staged` + hook pre-commit.
- [ ] Vitest + Testing Library + jsdom; Playwright configurado (`e2e/`).
- [ ] Estructura de carpetas (`features/`, `components/ui`, `lib/`, `hooks/`, `i18n/`, `test/`).

### Supabase
- [ ] `supabase init`, `config.toml`, Supabase CLI local (`supabase start`).
- [ ] Convención de migraciones `YYYYMMDD_nombre.sql` (como Acrosoft) y regla: **idempotentes y con rollback documentado**.
- [ ] Extensiones: `pgcrypto`, `pg_cron`, `pg_trgm` (búsqueda), `unaccent`.
- [ ] Proyecto de **staging** y **producción** (cuando existan las cuentas); secrets organizados.
- [ ] Carpeta `supabase/functions/_shared` (cliente, CORS, errores, logger, validación zod).
- [ ] Carpeta `supabase/tests` con runner (pgTAP o scripts SQL) y un test de humo.

### Vercel y seguridad
- [ ] `vercel.json`: rewrite SPA + headers (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, `frame-ancestors`) adaptados desde Acrosoft; CSP preparada para Supabase, Storage y futuros dominios (mapas, píxeles).
- [ ] Previews por PR; variables de entorno por entorno.
- [ ] `.env.example` documentado; validación de env al arrancar (zod) que falle ruidosamente.

### Base de código
- [ ] Cliente Supabase tipado (tipos generados de la BD en un script `npm run types`).
- [ ] Utilidad **`money`**: tipo `Money {amount, currency}`, formateo por moneda/locale, suma/resta/redondeo a 2 decimales **sin floats flotantes imprecisos** (usar enteros en centavos o decimal lib), con tests.
- [ ] `i18n` mínimo (`es`), helper `t()`; mapa de países/monedas (reutilizar patrón de `lib/countries.ts` / `currencies.ts` de Acrosoft).
- [ ] `ErrorBoundary`, manejo global de errores, `sonner` para toasts, logger con correlación.
- [ ] Router con layouts vacíos: `PublicLayout`, `AdminLayout`, `NotFound`.
- [ ] **CI (GitHub Actions)**: install → lint → typecheck → unit → `supabase db reset` + tests SQL → build. E2E de humo en PR.

## Criterios de aceptación
1. `npm run dev` levanta la app y Supabase local con un solo comando documentado en README.
2. CI verde en un PR de prueba; PR bloqueado si falla.
3. Preview de Vercel publica la SPA con los headers de seguridad verificados.
4. `money` pasa su suite (incluye casos de redondeo).
5. README con setup, scripts, convenciones y estructura.

## Testing
- **Unit:** `money` (suma/resta/redondeo, formatos BOB/USD/EUR/ARS, valores negativos, grandes, 0.1+0.2), validación de env.
- **Integración:** `supabase db reset` limpio; función de humo SQL.
- **E2E humo:** home carga, 404 funciona, rutas admin redirigen (stub).
- **Infra:** el pipeline falla cuando se rompe un test/lint (probar con un commit deliberadamente roto).

## Edge cases
- Env faltante o mal formada → error claro, no pantalla en blanco.
- Refresh en ruta profunda (`/producto/x`) en Vercel → rewrite SPA correcto, no 404.
- Dos lockfiles distintos o versión de Node diferente → fijar `.nvmrc`/`engines`.
- CSP bloquea recursos legítimos (fuentes, imágenes de Storage) → verificar en preview.
- Migración que depende de extensión no habilitada en producción.
- Timezone: fijar `UTC` en BD y convertir a `America/La_Paz` solo al mostrar.
- Fallo del CLI de Supabase en Windows/Mac distintos → documentar versión.

## Revisión
- [ ] Checklist universal del índice.
- [ ] Revisión de `vercel.json` y CSP por segunda persona.
- [ ] Confirmar que `.env` no está en git (probar `git ls-files`).
- [ ] Licencias de dependencias aceptables.
- [ ] Peso inicial del bundle registrado como línea base.

## Riesgos
- Cuentas aún no disponibles → trabajar solo en local y dejar staging/prod como tarea final del sprint (no bloquea el resto).
- Deriva respecto al stack de Acrosoft → documentar toda diferencia en el README.

## Pendientes externos
Cuentas Supabase, Vercel, GitHub y dominio (ver PENDIENTES_ADMIN).

## Entregables para sprints siguientes
Repo ejecutable, CI, Supabase local, utilidades `money`/i18n/errores, estructura y convenciones, `vercel.json` base.

---

## Estado real de entrega (2026-10-22)

**Hecho y verificado:** scaffolding Vite+React18+TS strict+Tailwind3+shadcn (Button), ESLint 9/Prettier/lint-staged/husky, Vitest+Testing Library, Playwright (móvil+escritorio, contra el build), estructura de carpetas, `money` (BigInt, con 5 mutaciones deliberadas detectadas), `env` (zod, rechaza `service_role`), `logger` con redacción de PII, `errors`, `datetime` (La Paz), `i18n`, catálogo de monedas/países, ErrorBoundary + handlers globales, router con `PublicLayout`/`AdminLayout` (stub)/404, `vercel.json` (testeado), `.env.example`, README, workflow de CI, `supabase/` (config, migración de extensiones + `healthcheck`, `_shared` de funciones, test pgTAP).
**Resultados:** 105 unit/componentes + 10 E2E en verde; `tsc`, ESLint, Prettier y build limpios.

**Actualización 2026-10-23 (tras instalar Colima+Docker, Deno y migrar a React Router v7):**
- Verificado en local: `supabase start`, `db reset` (2 veces, idempotente), `supabase test db` (7/7 pgTAP; con un bug inyectado a propósito falla), RPC `healthcheck` por la API, tests Deno de `_shared` (10/10), tests de integración contra Supabase local (4/4).
- React Router **v7** (cierra el aviso de `npm audit`; ya no hay avisos en dependencias de ejecución).
- Hallazgo: Supabase trata una petición sin `apikey` como `anon` (no 401); la barrera es GRANT/RLS. Un JWT falso sí da 401. Documentado en el test de integración.

**Pendiente (diferido por decisión del usuario: todo en local, sin cuentas aún):**
- GitHub (repo remoto, rama protegida, probar que CI bloquea un PR roto; el workflow de CI nunca se ha ejecutado), Vercel (headers verificados en preview real; revisión de `vercel.json` por 2ª persona), Supabase staging/prod. Repo Git local sin commits ni remoto.
- Cadena `tailwindcss→braces/micromatch` (alto en `npm audit`) es solo de build, no llega al bundle.

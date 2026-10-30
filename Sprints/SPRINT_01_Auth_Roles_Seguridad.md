# Sprint 1 — Auth, roles y seguridad base

**Release:** R1 · **Estimación:** 3 días · **Depende de:** S0

## Objetivo
Tener identidad y autorización sólidas: registro/login con **email o teléfono + contraseña**, roles `customer`/`admin`, RLS deny-by-default, auditoría y rate limiting, antes de crear cualquier dato de negocio.

## Alcance
**Dentro:** backend de auth, tabla `profiles`, helpers de RLS (`is_admin()`), asignación segura de admin, `audit_log` + trigger genérico, rate limit, rutas protegidas (guards), hook `useAuth`.
**Fuera:** pantallas de cuenta del cliente (S6) y login de admin con UI final (se hace una pantalla funcional mínima aquí; el diseño final en S4/S6).

## Reglas de negocio cubiertas
BR-ACC-01 (base), BR-ACC-02, BR-ACC-03, BR-ACC-07, BR-ACC-08, BR-ADM-03 (base), S-01, S-02.

## Tareas

### BD
- [ ] `profiles`: `id` = `auth.users.id`, nombre, email (nullable), `phone_e164` (nullable, único), `role` (`customer|admin`), `is_active`, `blacklisted` (flag; lógica en S12), timestamps.
- [ ] CHECK: al menos uno entre email y phone.
- [ ] Trigger `on auth.users insert` → crea `profiles` con rol `customer` por defecto.
- [ ] Función `is_admin()` (`SECURITY DEFINER`, `search_path` fijo) y `current_role()`.
- [ ] Impedir que un cliente cambie su propio `role`, `is_active` o `blacklisted` (policy + trigger de columnas protegidas).
- [ ] `audit_log` + función trigger genérica `audit_changes()` reutilizable (se aplicará en tablas futuras).
- [ ] Tabla/mecanismo de **rate limit** (contador por IP/identificador y ventana) o uso del rate limit nativo de Auth + Edge Function.
- [ ] Seed: función/script para promover **2 admins** (solo por SQL/CLI de servicio, nunca desde el front).

### Backend (Edge Functions)
- [ ] `resolve-login` (S-02): recibe `identifier` (email o teléfono), normaliza (E.164 con país por defecto Bolivia `+591`), resuelve el email de Auth (real o sintético) y devuelve un **resultado uniforme** para evitar enumeración.
- [ ] `register`: crea usuario con email o teléfono, valida teléfono, chequea contraseña contra filtraciones (patrón `password-security` de Acrosoft), crea perfil.
- [ ] Política de contraseña (longitud mínima, no comunes) y bloqueo progresivo tras N intentos.
- [ ] Desactivación de cuenta: marca `is_active=false` y **anonimiza** PII opcionalmente; conserva pedidos (BR-ACC-07).

### Frontend
- [ ] `AuthProvider` + `useAuth` (sesión, perfil, rol, `isAdmin`), refresco de token, logout global.
- [ ] Guards de ruta: `RequireAuth`, `RequireAdmin`; redirección post-login a la ruta original.
- [ ] Pantallas funcionales mínimas: login (campo único "email o teléfono"), registro, recuperación de contraseña (por email; para solo-teléfono ver edge cases).
- [ ] Normalizador de teléfono con selector de país (reutilizar `phone-countries`).

## Criterios de aceptación
1. Un usuario se registra con email **o** con teléfono, e inicia sesión con cualquiera de los dos.
2. Un `customer` no puede leer perfiles ajenos ni modificar su rol (probado por test SQL).
3. Un `admin` accede a `/admin`; un `customer` y un visitante son redirigidos.
4. Todo cambio relevante genera fila en `audit_log` (probado sobre una tabla de ejemplo).
5. Mensajes de login idénticos para "usuario no existe" y "contraseña incorrecta".
6. Rate limit efectivo: el intento N+1 en la ventana es rechazado.

## Testing
- **Unit:** normalización de teléfonos (`+591 7xxxxxxx`, `7xxxxxxx`, con espacios/guiones/paréntesis, ceros iniciales, otros países), validación de contraseña, utilidades de guard.
- **SQL/RLS:** matriz (anon, customer A, customer B, admin) × (select/insert/update/delete) sobre `profiles`/`audit_log`; intento de escalada de privilegios (`update profiles set role='admin'`); `SECURITY DEFINER` sin inyección por `search_path`.
- **Integración:** registro → login → perfil creado; teléfono duplicado; email duplicado en distinto case.
- **E2E (Playwright):** registro/login/logout, acceso a `/admin` por rol, sesión expirada.
- **Seguridad:** intentos de fuerza bruta; respuesta de tiempos similar para usuario inexistente.

## Edge cases
- Mismo email con mayúsculas/espacios; email con `+alias`.
- Teléfono sin código de país, con formatos mixtos; mismo número en distintos formatos → misma cuenta.
- Usuario solo-teléfono pide recuperar contraseña (sin email): flujo alterno vía WhatsApp/soporte o cambio autenticado; documentar y decidir (D-03).
- Un usuario añade luego email/teléfono que ya pertenece a otra cuenta → bloquear con mensaje seguro.
- Cuenta desactivada intenta loguearse; sesión activa de cuenta desactivada → se invalida.
- Registro simultáneo con el mismo identificador (carrera) → una sola cuenta (restricción única).
- Token expirado a mitad de una acción; múltiples pestañas con logout.
- Admin degradado a customer mientras tiene sesión abierta → permisos se reevalúan en servidor, no solo en el front.
- Cuenta sin verificación: riesgo de *squatting* (alguien registra el teléfono/email de otra persona) → mitigación: aviso en recuperación y revisión manual; registrado como riesgo aceptado (BR-ACC-03).

## Revisión
> Revisión de cierre del 2026-10-29 (ver S0 para la corrida completa).
- [x] Checklist universal.
- [x] Funciones `SECURITY DEFINER`: hay 33 en `public` y las 33 fijan `search_path` (consulta directa a la BD + test `05_estructura_seguridad`, que falla si una no lo hace).
- [x] Ninguna clave de servicio llega al bundle: en `dist/` solo aparece la cadena de nuestro validador (`env.ts`, que *rechaza* `service_role`) y el prefijo `sb_secret_` que `supabase-js` detecta; el único JWT incrustado tiene `role=anon`.
- [x] Mensajes de error sin fuga de información: cubierto por los tests de integración de enumeración y tiempos.
- [x] Recuperación de contraseña de punta a punta: automatizada con correo real (Mailpit) en integración. **No** se repitió un recorrido manual en navegador.

## Riesgos
- Auth por teléfono sin SMS depende de nuestro mapeo → pruebas exhaustivas y documentación del esquema sintético.
- Supabase Auth hace email por defecto con límites → configurar SMTP propio antes de producción (S13/S16).

## Pendientes externos
Los 2 correos de admin; decisión D-03 (proveedor de correo).

## Entregables para sprints siguientes
`profiles`, `is_admin()`, `audit_changes()`, `AuthProvider/useAuth`, guards, rate limit, `resolve-login`/`register`.

---

## Estado real de entrega (2026-10-23)

**Entregado:** `profiles` + trigger de alta, `is_admin()`/`current_app_role()`, permisos por columna (cliente solo edita `full_name`), `audit_log` inmutable + `audit_changes()` con redacción de PII, `rate_limits` + `check_rate_limit()`, `set_user_role`/`promote_admin`/`resolve_login_email`/`deactivate_profile` (solo `service_role`), Edge Functions `login`, `register`, `set-password`, `deactivate-account`, `AuthProvider`/`useAuth`, guards `RequireAuth`/`RequireAdmin`, pantallas de login/registro/recuperar/restablecer/cuenta mínima, normalizador de teléfonos y política de contraseñas compartidos navegador↔servidor, scripts `dev:seed` y `admin:promote`.

**Desviaciones respecto al plan (y por qué):**
- `resolve-login` + `signIn` del cliente → una sola función `login` en servidor: devolver el email resuelto al navegador permitiría enumerar emails por teléfono.
- `set-password` (no estaba en el plan): sin ella, el cambio de contraseña tras la recuperación se saltaría la política y el chequeo HIBP.
- Registro público de GoTrue cerrado: si no, la anon key permite crear cuentas sin pasar por `register`.
- Migraciones con timestamp de 14 dígitos.

**Verificación:** 132 asserts pgTAP · 263 unit/componentes · 15 Deno · 48 integración · 58 E2E (móvil+escritorio, axe WCAG A/AA), todo en verde con `npm run verify`. Pruebas de mutación: 9 bugs de SQL, 7 de Edge Functions y 11 de frontend inyectados a propósito → todos detectados (un mutante equivalente documentado: la doble capa anti `//` en `safeRedirectPath`; se verificó que mutando ambas capas sí se detecta).

**Bugs reales encontrados y corregidos durante el sprint** (por los propios tests): admin no podía iniciar sesión (`maybeSingle` sin filtro con RLS de admin) · estado `anonymous` con sesión presente → rebote a /login · política de contraseña no detectaba el email con punto · `[auth.email] enable_signup=false` apagaba el login · `promote-admin` rechazaba emails con espacios · logs de funciones sin redacción en campos extra · hueco de test: admin desactivado seguía siendo admin (test añadido) · tests SQL no herméticos: abortaban si la BD tenía datos del seed (ahora cada archivo parte de una BD vacía dentro de su transacción).

**Riesgos / decisiones abiertas (anotar):**
- **R-AUTH-1 · límite de GoTrue por IP**: `login` llama a GoTrue desde la IP de la Edge Function, así que `[auth.rate_limit] sign_in_sign_ups` (por defecto 30/5 min por IP) se comparte entre TODOS los usuarios. En local se subió a 1000; **en producción hay que subirlo en el dashboard** (o reenviar la IP real) antes del lanzamiento (S16).
- **R-AUTH-2 · bloqueo por identificador = posible DoS dirigido**: cualquiera puede bloquear 15 min el login de un email/teléfono conocido enviando 5 intentos. Es el costo de un bloqueo que no revela existencia; mitigado por el límite por IP y la expiración de ventana.
- **R-AUTH-3 · política de contraseña vía GoTrue directo**: un usuario técnico aún puede hacer `PUT /auth/v1/user {password}` con una clave débil para SÍ MISMO (solo se perjudica a sí). `minimum_password_length=8` sigue activo en GoTrue.
- **R-AUTH-4 · sin verificación de email/teléfono (BR-ACC-03)**: riesgo de *squatting* aceptado. Un cambio de email por GoTrue queda pendiente de confirmación (verificado).
- **D-03 (correo)**: las recuperaciones usan Mailpit en local. Hace falta SMTP propio antes de producción (S13/S16).
- **Solo-teléfono sin recuperación por correo**: hoy la pantalla indica contactar por WhatsApp; el número real vendrá de `store_settings` (S2). Pendiente decidir el flujo definitivo.
- **UI de desactivar cuenta**: el backend (`deactivate-account`) está probado, la pantalla llega con S6.
- **Pendiente externo**: los 2 correos de admin (`npm run admin:promote`).

**Bundle (medición al cerrar S1):** JS 687 kB (gzip ≈ 202 kB: `index` 62 + `App` 141) · CSS 12.5 kB (gzip 3.3 kB). Subió desde S0 (gzip ≈ 111 kB) por `supabase-js`, `react-hook-form`, `zod` y las pantallas de auth. **Deuda para S4/S5:** partir por rutas (`React.lazy`: admin, auth y storefront en chunks separados) para que el catálogo público no cargue el código de auth/admin, porque R1 exige tienda rápida (LCP).

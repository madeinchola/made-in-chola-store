# Auditoría de seguridad (Sprint 16)

Qué se revisó, qué se encontró, qué se arregló y qué queda abierto. Se hizo el 2026-11-18 contra la base de la nube, el código del repositorio y la configuración real del proyecto de Supabase. **No** incluyó pruebas de carga ni de caos contra la nube (decisión del dueño) ni una prueba de intrusión externa (ver «Lo que NO se verificó»).

## Resumen

- **Ningún hallazgo crítico.** Sí hay **dos hallazgos altos abiertos y un bloqueante de lanzamiento** que no se pueden cerrar solo con código: viven en la configuración de Auth del proyecto y necesitan una decisión y una cuenta del dueño (H-01, H-02, H-03). Mientras estén abiertos **no se cumple** el «cero hallazgos altos» de la lista de lanzamiento.
- Se corrigieron cinco cosas (H-04 a H-06, H-09 y la dependencia de secretos del historial), todas con prueba y con la prueba demostrada capaz de detectar el defecto (mutación).
- Lo estructural quedó convertido en **contratos ejecutables**: si un sprint futuro abre una tabla, una función, una vista, un bucket o una columna al navegador sin decidirlo, una prueba falla (`27_s16_auditoria_seguridad`, `scripts/edge-security.test.mjs`, `src/db/security-matrix.integration.test.ts`).

## Inventario (lo que hay hoy en la nube)

| Qué | Cuánto | Estado |
| --- | --- | --- |
| Tablas de `public` | 69 | **todas con RLS**; 61 con políticas y 8 cerradas al navegador (legales, reclamos, importaciones, atribución, límites) |
| Políticas | 128 en `public` + 10 en `storage.objects` | ninguna `true`, ninguna para `anon` ni `public`, todas atadas a `is_admin()` o a `auth.uid()` |
| Vistas | 24 | las 19 públicas son `public_*`; las de administración filtran con `is_admin()`; ninguna lee `auth` |
| Funciones | 251, de ellas 203 con permisos del dueño | **todas con `search_path` vacío**; el navegador ejecuta 97 y un visitante sin sesión solo 14 |
| Disparadores | 163 | guardas de inmutabilidad, auditoría, validación |
| Buckets | 5 | 4 públicos (catálogo y QR) y `payment-proofs` privado; todos con tope de tamaño y lista cerrada de tipos (sin SVG, HTML ni JS) |
| Funciones de Edge | 16 | 12 sin JWT del gateway (se autentican solas, ver abajo) y 4 con JWT |
| Trabajos de cron | 10 | vigilados por `system_health()` |

## Hallazgos

| ID | Gravedad | Qué | Estado |
| --- | --- | --- | --- |
| **H-01** | **Alta** (administradores) · media (clientas) | El **bloqueo por intentos** de `login` (5 por identificador y 30 por red cada 15 min) **se salta llamando a Auth directamente**: con la clave pública (anon) se puede pedir `POST /auth/v1/token?grant_type=password` sin pasar por la función. Comprobado: 12 contraseñas incorrectas seguidas contra Auth dieron 12 respuestas 400 y después la correcta entró (200); por la función, a la sexta ya es 429. | **ABIERTO** (decisión del dueño) |
| **H-02** | **Media** (alta si se roba una sesión de administrador) | **Cambiar la contraseña con solo la sesión** (`PUT /auth/v1/user`) no pide la actual ni aplica la política de la tienda. Comprobado: se aceptaron `12345678` y `password123` (esta última filtrada en Have I Been Pwned). El piso de Auth es 8 caracteres y no tiene el chequeo de filtradas (que, según la documentación de Supabase, es de los planes de pago). | **ABIERTO** (configuración del proyecto) |
| **H-03** | **Bloqueante de lanzamiento** | Auth **no tiene SMTP propio**: usa el correo de pruebas de Supabase (**2 envíos por hora en todo el proyecto**). Comprobado: tras 2 intentos, `over_email_send_rate_limit` (429). La recuperación de contraseña dejaría de funcionar para las clientas. | **ABIERTO** (cuenta del dueño; ya estaba pendiente con Resend) |
| H-04 | Baja | Tres columnas internas eran legibles por la propia clienta: `profiles.blacklisted` (si el negocio la marcó en la lista negra), `orders.request_hash` y `payments.collected_by` (quién cobró). Ninguna pantalla las usa. | **Corregido** (`20261118000500_s16_endurecimiento.sql`) |
| H-05 | Media-baja (de diseño) | `profiles`, `orders` y `payments` se leían **por tabla entera**: una columna nueva con datos internos habría nacido legible (S17 añade columnas a `orders`). `order_items` y `order_status_history` ya concedían por columnas. | **Corregido**: ahora por columnas; la prueba 27 fija la lista exacta de lo que la clienta lee y falla si crece |
| H-06 | Baja-media | `login`, `register`, `change-password`, `set-password`, `deactivate-account` y `update-contact` leían el cuerpo **sin tope de tamaño** (las dos primeras se llaman sin sesión). | **Corregido**: `parseBody` tiene tope de 16 KiB por omisión (`parseBodyLimited` con topes menores en el resto) |
| H-07 | Informativa | `npm audit`: 24 avisos (23 tras aplicar las correcciones que no rompen versiones). Ninguno llega al navegador salvo `zod`. Ver «Dependencias». | Aceptado con motivos y plan |
| H-08 | Informativa | **Secretos**: ninguna clave real en el árbol ni en TODO el historial de git (se compararon los valores reales de `.env.e2e`). Solo 3 valores de ejemplo falsos en pruebas. | Escáner nuevo (`npm run security:secrets`) y en el CI |
| H-09 | Informativa | `cron.job_run_details` crece sin límite (≈ 150 MB al año; el plan gratuito es de 500 MB). | **Corregido**: trabajo `purge-cron-history` (guarda 14 días) |
| H-10 | Informativa | La extensión `pgtap` está instalada en la nube (la usan las pruebas). | Quitarla en el vaciado de entrega (SPRINT_19) |
| H-11 | Informativa | CSP con `img-src https:` (cualquier imagen por HTTPS), `style-src 'unsafe-inline'` y HSTS con `preload`. | Aceptado, ver «Cabeceras» |
| H-12 | Informativa | `notify-admin` y `notify-worker` leen `req.json()` sin tope, pero **después** de autenticar (administrador / clave de servicio en tiempo constante). | Aceptado: solo llega ahí quien ya está autenticado |
| H-13 | Informativa | La huella de red de los consentimientos y reclamos usa la **clave de servicio como llave del HMAC**: al rotar esa clave, las huellas anteriores dejan de ser comparables. | Anotado en el runbook de rotación |
| H-14 | Para el lanzamiento | `site_url` es `*.vercel.app` y `uri_allow_list` incluye `http://localhost:5173`. | `npm run security:auth-config -- --launch` lo exige |

> **Costo de tener las columnas cerradas (H-04/H-05):** en `profiles`, `orders` y `payments`, un `PATCH` o un `.update().select()` **sin lista de columnas** pide `RETURNING *` y recibe 403, aunque el `UPDATE` sea legítimo. La aplicación no se ve afectada (siempre pide columnas concretas), pero el código nuevo contra esas tablas debe listarlas (`select=id,full_name`). Dos pruebas de integración de S16 lo delataron y se corrigieron así.

### H-01 · el bloqueo por intentos no protege Auth directo

Todo el acceso legítimo pasa por la función `login`, que cuenta intentos. Pero la clave anónima es pública por diseño y el endpoint de Auth también, así que un atacante no necesita la función. El freno que sí existe es el de Supabase por dirección de red, que no distingue cuentas ni se ve desde la tienda.

Qué hacer (en orden de eficacia, **decide el dueño**):

1. **Captcha en Auth** (hCaptcha o Cloudflare Turnstile; ambos tienen plan gratuito): se activa en el panel de Supabase (Authentication → Attack Protection) y exige además integrar el widget en el inicio de sesión y en «Olvidé mi contraseña», pasando el token a la función `login`. Cierra la brecha para clientas y administradores.
2. **MFA con TOTP para los administradores** (Auth ya lo permite: `mfa_totp_enroll_enabled`): exige además que `is_admin()` pida nivel `aal2`. Es lo que más protege el panel, pero es una función nueva (pantalla de alta del segundo factor).
3. **Contraseñas largas para los administradores** (la política de la tienda ya rechaza las comunes, repetitivas y secuenciales, pero solo se aplica en las funciones).
4. Plan Pro: el *hook* de verificación de contraseña de Auth permitiría contar fallos aquí también.

### H-02 · cambiar la contraseña por Auth

El cambio de contraseña de la tienda (`change-password`) pide la contraseña actual y aplica la política completa. Pero `PUT /auth/v1/user` cambia la contraseña con solo el token de sesión. Arreglo de configuración: **`security_update_password_require_reauthentication = true`** (Auth exige haber iniciado sesión hace poco o confirmar de nuevo) y, con plan Pro, `password_hibp_enabled = true`. Antes de activarlo hay que repetir los E2E de recuperación y cambio de contraseña (el enlace de recuperación inicia una sesión nueva, así que no debería estorbar, pero no se probó). `npm run security:auth-config` lo vigila.

### H-03 · el correo de Auth

La recuperación de contraseña usa el servicio de correo de Auth, **distinto** del proveedor de avisos de pedidos (Resend, S13). Hay que configurar el SMTP de Auth con el mismo proveedor (Resend ofrece SMTP) y subir `rate_limit_email_sent`. Sin esto, desde la tercera clienta de la hora nadie puede recuperar su contraseña.

## Qué se verificó, y con qué prueba

### Base de datos (RLS, funciones, vistas, Storage)

Las pruebas **leen el catálogo de la nube** y comparan contra listas escritas a mano; cualquier cambio obliga a decidirlo:

- `supabase/tests/05_estructura_seguridad` (S1–S15): RLS en toda tabla, `anon` sin privilegios, `authenticated` sin `INSERT/DELETE/TRUNCATE` por tabla, lista blanca de funciones del navegador, nadie borra el catálogo, el libro de stock no se forja.
- `supabase/tests/27_s16_auditoria_seguridad` (34 aserciones): ninguna política `true`/`anon`/`public`; toda política menciona `is_admin()` o `auth.uid()`; las 8 tablas sin política; las 8 tablas donde una clienta ve filas; toda función con permisos del dueño se autoriza por dentro (salvo 8 públicas); las funciones `invoker`, las de un visitante y las de `PUBLIC`; `search_path` vacío en todas; vistas que se saltan la RLS filtran con `is_admin()`; buckets (públicos, tope, tipos sin SVG/HTML/JS, políticas, comprobantes privados); sin `CREATE` ni secuencias para el navegador; **las columnas exactas que lee la clienta** de cada tabla suya; sin columnas de costo/huella/clave legibles; sin acceso a `auth`, `vault` ni `cron`.
- **Mutación**: se reprodujeron **45 violaciones** (una política `true`, una función sin control, un bucket público, una columna de más…) dentro de una transacción que se revierte; **las 45 hacen fallar** la aserción que les toca.

### HTTP real (`src/db/security-matrix.integration.test.ts`, 19 casos contra la nube)

- **Visitante**: cada tabla y vista de `public` (sacadas del catálogo) responde 401/403, salvo las vistas públicas (200); ninguna función cerrada responde algo distinto de 401/403/404.
- **Dos clientas**: A (con dirección y un pedido) y B (recién llegada): B **no ve ninguna fila ajena** en ninguna tabla que puede leer; A ve solo las suyas; B no puede leer, cambiar ni borrar nada de A (direcciones, pedido, líneas, cobro, historial, perfil) y no puede crear una dirección a nombre de A.
- Nadie se asciende a administrador ni sale de la lista negra: `role`, `is_active`, `blacklisted` y `email` dan permiso denegado.
- **Columnas internas** (`blacklisted`, `request_hash`, `collected_by`, `cost_unit`, `actor_id`) y `select=*` sobre `orders`/`payments`/`profiles`: 403.
- **Funciones de administración** (43 que solo exigen `is_admin()`): ninguna responde con éxito a una clienta; las que reciben un pedido no se lo muestran a otra persona.
- **Comprobantes de pago**: B no puede subir a la carpeta de A; A sube el suyo y B, un visitante y la URL pública no lo leen; un SVG con script se rechaza.
- **Mutación en la nube** (se rompe una defensa real, se corre la matriz y se restituye siempre): se detectan la columna interna expuesta (3 casos), `select *` por tabla, una política abierta, una función de administración sin control, el acceso de un visitante a `profiles`, el bucket público y el borrado ajeno. Un cambio ajeno por una política `update` abierta **no** se detecta porque la lectura (RLS de `SELECT`) lo frena antes: es una segunda capa, no un hueco.

### Funciones de Edge (`scripts/edge-security.test.mjs`, 58 pruebas)

Cada función tiene escrito su contrato: si lleva JWT del gateway, cómo se autentica sola si no, y qué defensas tiene.

| Función | JWT | Cómo se autentica / protege |
| --- | --- | --- |
| `login`, `register` | no | públicas: límite de frecuencia (login: 5 por identificador y 30 por red / 15 min, se reinicia al entrar) y cuerpo con tope de 16 KiB |
| `cart`, `checkout`, `payments` | no | invitada o con sesión; límites de frecuencia; cuerpo ≤ 1–2 KiB; solo valores escalares |
| `complaint`, `legal-accept`, `meta-capi` | no | públicas o con sesión; límites propios; cuerpo ≤ 0,5–4 KiB; trampa anti-spam en `complaint` |
| `deactivate-account`, `set-password`, `update-contact`, `change-password` | **sí** | el gateway valida el JWT y el código vuelve a leer al usuario (`getUser`); límite de frecuencia; cuerpo ≤ 16 KiB |
| `payment-webhook` | no | firma del proveedor con un secreto por proveedor (`PAYMENT_WEBHOOK_SECRET_*`); límite |
| `payment-reconcile`, `notify-admin` | no | `is_admin()` con el JWT de quien llama, **antes** de leer el cuerpo; límite |
| `notify-worker` | no | solo la clave de servicio, comparada en **tiempo constante**, antes de leer el cuerpo |

Además, por construcción: los errores salen siempre por `errorResponse` (nunca un error crudo, con un identificador de correlación), el CORS es una **lista blanca** de orígenes (`ALLOWED_ORIGINS`; nunca `*`; la prueba lo comprueba), nadie escribe en consola a mano (el registro redacta correos, teléfonos y JWT), ninguna función arma SQL con texto del usuario y la clave de servicio solo se lee en cinco archivos conocidos. Se mutaron **17 defensas** (quitar un límite, un `getUser`, el tope, un `is_admin`, abrir CORS, leer el cuerpo antes de autenticar…) y **las 17 se detectan**.

### Cabeceras y navegador (`vercel.json`, comprobado en el sitio publicado)

`Content-Security-Policy` (sin `unsafe-eval`, sin scripts en línea, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), `Strict-Transport-Security` de dos años, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (cámara, micrófono, pagos y USB cerrados) y `X-Robots-Tag: noindex` en lo privado. `npm run smoke -- <dirección>` lo comprueba contra el sitio desplegado (25 comprobaciones, todas bien hoy sobre `made-in-chola-store.vercel.app`).

Aceptado a propósito: **`img-src https:`** (las imágenes del catálogo y las fichas vienen de Supabase y de OpenStreetMap, y los píxeles de Meta y Google se piden como imagen; acotarlo a una lista habría que repetirlo con cada proveedor), **`style-src 'unsafe-inline'`** (Radix y los estilos de React lo necesitan; no ejecuta código) y **HSTS con `preload`** (solo tiene efecto cuando el dominio se inscribe en la lista de precarga de los navegadores; **no lo inscribas** hasta estar seguro de que todo el dominio y sus subdominios serán siempre HTTPS: quitarlo después tarda meses).

### Autenticación y contraseñas

- **Política** (`password-policy.ts`, compartida por el navegador y las funciones): 8 a 72 bytes, rechaza las contraseñas comunes (con y sin dígitos finales), repetitivas, secuenciales y que contienen el correo o el teléfono; además **Have I Been Pwned** por k-anonimato (solo se envían 5 caracteres del hash) en el servidor.
- **Auth del proyecto** (`npm run security:auth-config`, solo lectura): altas directas cerradas (`disable_signup`), sin sesiones anónimas, correo sin confirmación automática, rotación de tokens de renovación, sesión de 1 hora. Lo que falla está en H-01 a H-03.
- **Recuperación y cambio**: el cambio por la función pide la contraseña actual (y Auth revoca las demás sesiones al cambiarla); el enlace de recuperación vence a la hora (`mailer_otp_exp`).

### XSS, redirecciones y subidas

- No existe `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `document.write` en `src/`. Los textos legales se arman como elementos de React a partir de un formato mínimo (la base rechaza etiquetas al guardar). El JSON-LD escapa `<`, `>` y `&`; el HTML para buscadores y los feeds escapan siempre.
- La vuelta tras iniciar sesión pasa por `safeRedirectPath` (solo rutas internas); `window.open` solo para WhatsApp, con `noopener,noreferrer`.
- Subidas: tipo y tamaño cerrados por bucket (en la base, no solo en el navegador), la ruta del comprobante exige la carpeta de la dueña y un pedido suyo pendiente, y el SVG está prohibido en todos.
- **SSRF**: ninguna función hace una petición a una dirección dada por una persona (la importación es CSV subido; Meta recibe solo la dirección fija de su API).

### Dependencias

`npm audit`: **24 avisos → 23** tras `npm audit fix` (solo subió `typescript-eslint` 8.72→8.73 y `lint-staged` 17.6.1). Los 23 restantes exigen subir de versión mayor (vite 5→8, vitest 3→5, tailwind 3→4, zod 3→4):

- **Herramientas de compilación y pruebas** (vite, vitest/tinypool, esbuild, tailwind y sus ayudantes de rutas `picomatch`/`micromatch`/`chokidar`…): corren en la computadora de quien programa y en el CI, **no se envían al navegador ni a la nube**. Los avisos son de rutas de archivo en el servidor de desarrollo, de la ejecución de pruebas con configuración maliciosa y de ReDoS al expandir patrones de archivos.
- **`zod`** (aviso: puede agotar memoria al validar colecciones enormes): está en el navegador y en las funciones de Edge (versión fijada 3.25.76). Está mitigado porque **ninguna función acepta cuerpos grandes** (tope de 16 KiB o menos) y los esquemas públicos solo admiten valores escalares.
- **Plan**: una pasada dedicada **después del lanzamiento** para subir las versiones mayores con toda la regresión (cambia la API de zod 4 y de tailwind 4). No se hizo ahora porque el sprint congela el alcance y el riesgo de regresión supera al de los avisos.
- Las versiones están bloqueadas por `package-lock.json` y `deno.lock`.

### Secretos

`npm run security:secrets` (archivos) y `npm run security:secrets:history` (cada línea añadida en cualquier commit de cualquier rama) buscan los **valores reales** de tus `.env*` y las formas conocidas de claves (token de Supabase, `sb_secret_`, JWT de servicio, clave privada, token de Meta, GitHub, AWS, Stripe, Resend, URL de Postgres con contraseña). Hoy: **0 hallazgos**; el historial solo tiene 3 valores de ejemplo falsos, anotados en `scripts/secret-scan.allow.json` con su motivo. Corre en cada subida (CI). Nunca imprime el valor. **Siguen pendientes de revocar/rotar** las claves que se pegaron en el chat en sprints anteriores (SPRINT_19).

## OWASP Top 10 (2021)

| Categoría | Cómo está cubierta |
| --- | --- |
| A01 Control de acceso roto | RLS en las 69 tablas, políticas por dueña/administrador, columnas por lista, funciones autorizadas por dentro; matriz HTTP con dos clientas (IDOR); comprobantes por carpeta de dueña |
| A02 Fallos criptográficos | HTTPS con HSTS; contraseñas en Auth (bcrypt); huellas de red por HMAC (nunca la IP); secretos solo en variables de entorno; comparaciones en tiempo constante; SHA-256 para Meta |
| A03 Inyección | Sin SQL armado con texto del usuario; funciones con parámetros; escape en HTML, XML y JSON-LD; sin `innerHTML`; CSP estricta |
| A04 Diseño inseguro | Idempotencia en pedidos y reembolsos, reservas con vencimiento, límites por red/cuenta/global, guardas de inmutabilidad, antiacaparamiento |
| A05 Configuración incorrecta | Cabeceras, CORS en lista blanca, buckets cerrados, `search_path` fijo; **abierto**: SMTP, captcha y reautenticación de Auth (H-01 a H-03) |
| A06 Componentes vulnerables | `npm audit` revisado, versiones bloqueadas; plan de subida mayor (H-07) |
| A07 Fallos de identificación | Política de contraseñas, HIBP, bloqueo por intentos **solo por la función** (H-01), recuperación; **abierto**: captcha/MFA |
| A08 Integridad de software y datos | Firma de webhooks, CI con lint/tipos/pruebas/compilación y escaneo de secretos, importación validada y reversible |
| A09 Registro y monitoreo | Registro estructurado con redacción de datos personales, auditoría de la base, alertas internas (S13) y `system_health()` |
| A10 SSRF | Ninguna petición a direcciones dadas por personas |

## Lo que NO se verificó

- **Prueba de intrusión externa** ni escaneo DAST con una herramienta (ZAP, Burp). La matriz propia cubre lo que cubre; un tercero encuentra otras cosas.
- **Las cabeceras con una herramienta externa en el dominio de producción** (securityheaders.com, Mozilla Observatory): hoy se comprobaron en `vercel.app`, que no es el dominio final.
- **MFA**, **captcha** y **reautenticación**: están descritos, no implementados ni probados (H-01, H-02).
- **El comportamiento de los límites de Auth por red** bajo ataque real (solo se hicieron 12 intentos).
- **Los avisos de seguridad del panel de Supabase** («Security Advisor»): requieren tu sesión en el panel.
- **El pedido de una clienta en otro país o con otra moneda** (S18).

## Cómo repetir la auditoría

```
npm run security:secrets && npm run security:secrets:history   # secretos
npm run security:auth-config [-- --launch]                       # configuración de Auth (solo lectura)
npm run smoke -- https://tu-dominio                              # humo de producción (solo lectura)
npm run test:integration -- src/db                               # pgTAP (05 y 27 incluidas) + matriz HTTP, contra la nube
npm test                                                         # incluye la auditoría estática de las funciones de Edge
```

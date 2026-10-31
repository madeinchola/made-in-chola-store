# Sprint 19 — Acciones manuales y configuración pendiente (parte del dueño)

**Release:** transversal (corre **en paralelo** a R1–R4; varios puntos **bloquean S16/lanzamiento**) · **Estimación:** acciones del dueño, no de desarrollo (cada bloque ≈ 15–60 min) · **Depende de:** — (cada tarea indica qué sprint desbloquea)

> Este documento NO tiene código. Reúne todo lo que **solo puede hacer el dueño** (cuentas, paneles externos, decisiones, contenido, pruebas en dispositivos) y que el desarrollo no puede hacer por él. Está escrito como un sprint para poder marcarlo igual que los demás. Los datos privados del negocio (nombres, teléfonos, cuestionarios) viven en `PENDIENTES_ADMIN.md`, que **no se versiona** porque el repo es público: aquí solo se referencian.

## Objetivo
Dejar resueltas las configuraciones y decisiones externas para que cada sprint técnico no se frene esperando una cuenta, un texto o una respuesta, y para que el lanzamiento (S16) no tenga sorpresas.

## Cómo leerlo
Cada tarea lleva una etiqueta: **[S5]**, **[S7]**… = bloquea ese sprint; **[LANZAMIENTO]** = hay que tenerla antes de vender; **[CUANDO PUEDAS]** = no bloquea nada pero conviene. «Pídeselo a Claude» = lo hace el asistente en cuanto lo autorices en ese momento (nada se sube a la nube sin tu confirmación).

---

## A. Subir lo desarrollado a la nube (Supabase de Made In Chola)
- [ ] **[S5]** Autorizar la subida de la migración de S3 (`supabase/migrations/20261029000100_s3_outbox_slugs_duplicar.sql`) al proyecto de la nube. Sin ella el panel de administración **no funciona en la nube** (faltan las vistas y funciones de productos, stock, alertas y slugs). *Pídeselo a Claude: «sube la migración de S3»; necesita un token personal temporal de la cuenta de Made In Chola.*
- [ ] **[LANZAMIENTO]** Después de cada subida, **revocar el token personal** de Supabase que se usó (Account → Access Tokens).
- [ ] **[LANZAMIENTO]** **Rotar la contraseña de la base de datos** (Settings → Database): se compartió en una conversación y debe considerarse expuesta.
- [ ] **[CUANDO PUEDAS]** Si se cambia código de las Edge Functions (`login`, `register`, `set-password`, `deactivate-account`), volver a desplegarlas (S3 y S4 no las tocaron).

## B. Vercel
- [ ] **[S5]** En Settings → Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (la clave *publishable*, nunca la `service_role`), `VITE_APP_ENV=production` y `VITE_SITE_URL`; **re-desplegar** (Vite las incrusta al compilar).
- [ ] **[LANZAMIENTO]** **No definir `VITE_UI_GUIDE`** en Vercel: haría que la guía interna `/_ui` aparezca en producción.
- [ ] **[LANZAMIENTO]** Verificar en un despliegue real los encabezados de seguridad y la CSP (`vercel.json`), que `/fonts/*` se sirve con caché de un año, y pedir a **una segunda persona** que revise `vercel.json`.
- [ ] **[LANZAMIENTO]** El plan **Hobby es solo para uso personal no comercial**: pasar a Pro (≈ US$ 20/mes por asiento) o cambiar de hosting antes de vender. En Pro, el autor de cada commit debe ser miembro del equipo.
- [ ] **[LANZAMIENTO]** Al tener el **dominio oficial**: actualizar `ALLOWED_ORIGINS` (Edge Functions → Secrets), `site_url` y la lista de redirecciones de Auth, y `VITE_SITE_URL`.

## C. Supabase: Auth y correo
- [ ] **[LANZAMIENTO]** **Subir el límite de inicios de sesión por IP** (R-AUTH-1): el valor por defecto (30 cada 5 min) lo comparten **todos** los usuarios porque el login pasa por una Edge Function. Decidirlo y aplicarlo en Authentication → Rate Limits (el asistente no puede cambiarlo solo: se considera un ajuste de seguridad).
- [ ] **[S6]** Comprobar en Authentication → Providers/Policies que la **longitud mínima de contraseña sea 8** (un proyecto nuevo trae 6) y que el **registro público de Auth siga cerrado** (el alta pasa por la función `register`).
- [ ] **[S6]** **Correo propio (D-03, Resend):** verificar que controlas el dominio (`madeinchola.com`) y quién gestiona su DNS; crear la cuenta de Resend y los registros SPF/DKIM/DMARC; configurar el SMTP en Authentication → SMTP **tú mismo** (la clave API no pasa por el chat). Sin esto, la recuperación de contraseña **no llega a las clientas** (el correo integrado solo envía 2 por hora y solo a miembros del equipo).
- [ ] **[LANZAMIENTO]** Plantillas de correo de Auth (confirmación, recuperación) en español y con la marca (cuando la diseñadora entregue las plantillas).
- [ ] **[CUANDO PUEDAS]** Activar **2FA** en las cuentas de Made In Chola: GitHub, Supabase, Vercel, el proveedor del dominio y el correo.

## D. GitHub
- [ ] **[LANZAMIENTO]** **Proteger `main`** exigiendo el check `quality`. `madeinchola` es una cuenta de usuario, no una organización, así que solo ella puede hacerlo (o se crea una organización y se transfiere el repo). Tras proteger, el trabajo pasa a ir por Pull Request.
- [ ] **[CUANDO PUEDAS]** Decidir si el E2E y la prueba en WebKit (Safari) deben correr en CI: hoy solo corren en local; el CI ejecuta lint, formato, tipos, pruebas unitarias y build.
- [ ] **[CUANDO PUEDAS]** Al subir de versión de Playwright, ejecutar `npx playwright install` para descargar los navegadores nuevos.

## E. Personas y accesos
- [ ] **[S6]** **Correos reales de las administradoras:** deben registrarse primero en la tienda y luego se promueven con `npm run admin:promote -- correo@dominio.com` (necesita la service key; el rol admin **jamás** se asigna desde el navegador). Pídeselo a Claude o hazlo tú.
- [ ] **[S6]** **Número de WhatsApp de soporte** para quien se registró solo con teléfono y olvidó su contraseña (hoy el texto dice «escríbenos por WhatsApp» sin número; el de pedidos ya está en los ajustes: decidir si es el mismo).
- [ ] **[LANZAMIENTO]** **Prueba de usabilidad con una administradora real** (guion sugerido, 30 min): crear un producto con colores, tallas e imágenes; ajustar stock; ver una alerta de stock; archivar y restaurar; crear categoría y colección; cambiar el banner; cambiar el tipo de cambio. Anotar dónde se traba.

## F. Diseño y contenido (Sprint 4)
- [ ] **[S5]** **Revisión pixel-fina con la diseñadora** a 360, 768 y 1280 px y **firma del checklist de fidelidad** (criterio 1 del Sprint 4). Hoy cabecera y pie están medidos contra el PDF de Inicio; el resto de pantallas con diseño es provisional.
- [ ] **[S5]** Pedir a la diseñadora: **logotipo en SVG** y **símbolo del pie en SVG** (hoy son aproximaciones provisionales: `Wordmark` y `BrandMark`), **diseño móvil** (no existe), y diseño de listado, búsqueda, login/registro, cuenta, pedidos, 404, páginas legales y plantillas de correo.
- [ ] **[LANZAMIENTO]** **Licencia web de Baskerville e Intelo Regular**, o aceptar definitivamente las fuentes abiertas actuales (Baskervville y Jost). Si llegan las originales, el cambio es de un solo lugar (receta en `docs/sistema-ui.md`).
- [ ] **[CUANDO PUEDAS]** Decidir si habrá **modo oscuro** (el diseño solo existe en claro).
- [ ] **[S5]** **Contenido real:** foto o video del hero de la portada, imágenes oficiales de los productos (se suben desde el panel; las de `dev:seed` son solo locales), texto real del **banner de noticias** (hoy hay un texto de ejemplo), y los textos de **Nosotros** y **Contacto**.
- [ ] **[CUANDO PUEDAS]** Decidir si quieres incluir en el pie el crédito «Developed by VNS» que trae el PDF (se omitió porque es de la agencia del diseño) y si el pie debe llevar un **lema** (el diseño no trae ninguno).
- [ ] **[S5]** Revisar en **Ajustes → contacto y redes** del panel que los datos sean los reales (los de ejemplo de la base local no deben llegar a producción).

## G. Dispositivos y accesibilidad reales (lo que la emulación no prueba)
- [ ] **[LANZAMIENTO]** Probar en un **iPhone (Safari)** y en un **Android (Chrome)**: menú móvil, buscador, cajones, formulario de registro con máscara de teléfono, galería.
- [ ] **[LANZAMIENTO]** Decidir y probar `viewport-fit=cover` (notch y barra de inicio de iOS): hoy las zonas seguras están en el código pero son inertes. Activarlo exige dar margen lateral al contenedor y verlo en un iPhone real.
- [ ] **[LANZAMIENTO]** Recorrer con **VoiceOver** (Mac/iPhone) o **TalkBack** (Android): cabecera, menú de cuenta, registro, panel de administración.
- [ ] **[CUANDO PUEDAS]** Probar en **Firefox** de escritorio (no se probó).

## H. Decisiones técnicas y de producto que solo tú puedes tomar
- [ ] **[S7]** **Aviso de seguridad de `zod`** (versión < 4.6.6, severidad alta): decidir entre actualizar a zod 4 (cambio mayor) o seguir sin usar listas en los esquemas. Hoy no hay ningún esquema afectado; hay que decidirlo antes del carrito y el checkout.
- [ ] **[CUANDO PUEDAS]** `npm audit` marca 18 avisos, **todos en herramientas de desarrollo** (vite, vitest, esbuild, eslint) más el de `zod`: decidir si se aprueba actualizar esas herramientas (cambios mayores). No afectan al sitio publicado.
- [ ] **[S5]** Supuesto **S-03** sin confirmar: el *delivery* por producto (`product_delivery`) se omitió en S3. Confirmar si la ficha de producto debe mostrar «entrega estimada».
- [ ] **[S8–S12]** Responder los bloques pendientes de `PENDIENTES_ADMIN.md` (local): impuestos (A), envíos y entregas (B), pagos (C), devoluciones (D), facturación y datos legales (E), operación del panel (F), comunicación (G), marketing (H). Cada sprint indica cuál necesita.
- [ ] **[S15]** **Revisión de los textos legales por un abogado** (términos, privacidad, cookies, reclamos) antes de publicarlos. Hoy las rutas `/legal/*`, `/nosotros` y `/contacto` son pantallas provisionales «disponible pronto».

## I. Tu máquina de desarrollo
- [ ] **[CUANDO PUEDAS]** Tras cada `git pull` que cambie `package.json` o `tailwind.config.ts`: `npm install` y **reiniciar** `npm run dev:web` (un servidor ya abierto no recarga esos cambios y muestra un error de Vite).
- [ ] **[CUANDO PUEDAS]** Para ver todo en local: `colima start`, `npm run db:start`, `npm run functions:serve` y `npm run dev:web`; cuentas de desarrollo con `npm run dev:seed`. Usar siempre `npx supabase` (no el `supabase` global): mezclar versiones rompió el almacenamiento de imágenes una vez.

---

## Criterios de aceptación
1. Cada tarea **[S5]** marcada antes de empezar el Sprint 5 (o acordado explícitamente que se avanza sin ella).
2. Todas las **[LANZAMIENTO]** marcadas antes de S16.
3. Ninguna clave secreta, contraseña ni dato personal se escribe en este documento ni en el repo (es público).

## Riesgos
- Dejar el **plan Hobby de Vercel** para vender: incumple sus condiciones y puede suspenderse el sitio.
- **Correo sin dominio propio**: las clientas no recuperarán su contraseña y los pedidos no se confirmarán por correo.
- **Textos legales sin revisión**: riesgo legal en Bolivia.
- Seguir con el **límite de login por IP por defecto**: con tráfico real, un grupo de clientes podría quedar bloqueado a la vez.

## Entregables para sprints siguientes
Nube alineada con el código (migraciones, funciones, variables, dominio, correo), cuentas protegidas, contenido y diseño real para S5, y las decisiones que desbloquean S7–S16.

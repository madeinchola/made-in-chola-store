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

## J. Tienda pública (Sprint 5)
- [x] **[NUBE]** Migraciones `20261029000100` (S3) y `20261031000100` (S5) **aplicadas a la base de la nube el 2026-11-02** (12 migraciones en total; verificado: las 3 funciones públicas son `SECURITY DEFINER` con `search_path` fijo, `anon` puede ejecutarlas y no puede leer `products`). **Pendiente tuyo: rotar la contraseña de la base** (Settings → Database → Reset database password), porque se pegó en el chat; después de rotarla no hace falta decírmela hasta el próximo `db push`.
- [ ] **[LANZAMIENTO]** En Vercel (Project → Settings → Environment Variables, entornos *Production* y *Preview*): `VITE_SITE_URL` = el dominio oficial con `https://` y sin barra final (canónicos, Open Graph y sitemap salen de ahí; si queda el valor por defecto `http://localhost:5173`, **los buscadores indexarían localhost**), y comprobar que `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` están disponibles también en tiempo de ejecución (las funciones de borde las leen).
- [ ] **[LANZAMIENTO]** **Verificar lo que solo se puede probar desplegado** (receta en `docs/tienda.md`): `curl -A "facebookexternalhit/1.1" https://<dominio>/producto/<slug>` debe devolver HTML con `og:title`, `og:image` y JSON-LD, y el mismo `curl` sin ese `User-Agent` la aplicación normal; después el **Depurador de Facebook**, la **Prueba de resultados enriquecidos de Google** y compartir un producto por **WhatsApp** de verdad.
- [ ] **[LANZAMIENTO]** **Search Console**: crear la propiedad del dominio (registro DNS TXT), enviar `https://<dominio>/sitemap.xml` y revisar a las 2–4 semanas cuántas páginas se indexaron (criterio de la evaluación D-01 en `docs/tienda.md`).
- [ ] **[S5]** **Número de WhatsApp real** en Panel → Ajustes → contacto (formato `+591…`): de ahí sale el botón «Consultar por WhatsApp» de la ficha. Sin número válido, el botón principal queda bloqueado con «Próximamente: agregar a la bolsa». Decide si ese botón se queda en el MVP o se retira cuando exista el carrito (S7).
- [ ] **[S5]** **Textos de los acordeones de la ficha** (materiales, cuidados, envíos y devoluciones, asistencia): los de `dev:seed` son de ejemplo. Los de materiales y cuidados se escriben por producto en el panel; los de envíos y devoluciones y de ayuda son del sitio y se editan en Panel → Ajustes (campos «Envíos y devoluciones» y «Texto de ayuda»; revisar que sean los reales, sobre todo plazos).
- [ ] **[S5]** **Portada real**: el contenido se edita desde el panel (secciones, orden, enlaces). Hoy hay marcadores gris donde irán las fotos y el video del hero; no se usaron las imágenes de los PDF.
- [ ] **[CUANDO PUEDAS]** Pedir a la diseñadora el **diseño de listado, filtros y búsqueda** (no existe en los PDF; se hizo provisional con el mismo estilo) y la **versión móvil de la portada y la ficha**.
- [ ] **[CUANDO PUEDAS]** Decidir si la ficha mostrará **«entrega estimada»** (supuesto S-03, ver sección H): hoy no se muestra.
- [ ] **[LANZAMIENTO]** **Imagen social por defecto** (1200×630 px, el logotipo o una foto de la marca) para que compartir la portada o una página sin foto muestre imagen: hoy `index.html` no lleva `og:image`. Pásamela y la agrego; los productos y listados ya usan la foto de su primer producto.
- [ ] **[CUANDO PUEDAS]** Decidir si los **rastreadores de IA** (`GPTBot`, `ClaudeBot`, `PerplexityBot`, `OAI-SearchBot`) deben ver la versión completa de cada producto (visibilidad en buscadores con IA) o solo la portada estática. Hoy no están en la lista de bots.
- [ ] **[LANZAMIENTO]** Tras el primer despliegue, comprobar **cuál de las dos reglas gana en `/`** (la de bots o el `index.html` estático) con el `curl` de `docs/tienda.md`, y que el patrón de User-Agent reconoce a `Googlebot` (`curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; …)"`). Son los dos puntos que ninguna prueba local puede confirmar.
- [ ] **[LANZAMIENTO]** **Lighthouse real** sobre el dominio desplegado (móvil): los números locales (en el informe de cierre del Sprint 5) no incluyen CDN, HTTP/2 ni las imágenes reales, que son lo que más pesa.

## K. Cuenta del cliente (Sprint 6)
- [x] **[NUBE]** Migración `20261102000100_s6_cuenta_cliente.sql` **aplicada a la base de la nube el 2026-11-03** con tu OK (13 migraciones en total; ensayo primero y verificación después: RLS activa en `addresses` y `tax_profiles`, `anon` sin acceso a ellas, nadie puede borrar filas, ajuste `tax_id_validation` presente, funciones `SECURITY DEFINER` con `search_path` vacío).
- [x] **[NUBE]** **Anonimización verificada en la nube (2026-11-03)**: una transacción con `ROLLBACK` en la base de Made In Chola creó un usuario de prueba con nombre y teléfono en `raw_user_meta_data` y un evento en `auth.audit_log_entries` con su email, ejecutó `deactivate_profile(…, true)` y comprobó que el perfil quedó «Cliente anonimizado» sin email, los metadatos quedaron vacíos y el evento de GoTrue desapareció; luego se deshizo todo (0 filas de prueba restantes). Así que el rol `postgres` del Supabase hospedado SÍ puede limpiar el esquema `auth`. Lo que sigue sin probarse en la nube es el flujo completo por la Edge Function (necesita las funciones desplegadas).
- [x] **[NUBE]** Edge Functions `update-contact`, `change-password`, `set-password` y `deactivate-account` **desplegadas el 2026-11-03** (`--use-api`, ref `kymleecfbmugdwfzrxee`; verificado: 401 sin token y CORS 204 en las cuatro, `login` intacta) y **después** empujado el código (commits `a78dc02` y `d5dc755`; CI verde y Vercel sirviendo la CSP nueva). El primer intento de despliegue lo denegó el clasificador del modo automático de Claude Code; pasó al repetirlo tras tu petición directa. Orden seguido: migración → funciones → push. **Pendiente:** probar a mano en producción (con una cuenta tuya real) cambiar contacto y contraseña y desactivar una cuenta de prueba, porque el recorrido completo por las funciones en la nube solo está probado hasta el 401/CORS.
- [ ] **[S6]** **Reglas oficiales de NIT y CI de Bolivia.** Los rangos de «estricto» son supuestos (CI de 4 a 10 dígitos con complemento opcional, NIT de 7 a 13 dígitos). Confírmalos o dime los reales; mientras tanto puedes poner «Flexible» en Panel → Ajustes → «Clientes y cuentas» para no frenar ninguna compra.
- [ ] **[S6 → D-03]** **Recuperar contraseña de quien se registró solo con teléfono.** Hoy la pantalla le indica contactar por WhatsApp. Decide el flujo definitivo: (a) que el admin restablezca desde el panel, (b) pedir un correo al registrarse, o (c) enviar un código por WhatsApp/SMS (cuesta dinero y exige un proveedor).
- [ ] **[S6]** **Reactivar una cuenta desactivada.** Hoy una cuenta desactivada *sin anonimizar* sigue ocupando su email/teléfono (registrarse otra vez da el aviso genérico) y una *anonimizada* los libera. No existe «reactivar». Decide si hace falta (por el admin o por la clienta) y con qué verificación.
- [ ] **[LANZAMIENTO]** **Mapas y búsqueda de direcciones (D-04).** OpenStreetMap y Nominatim son gratuitos pero con límites de uso (la política prohíbe el uso intensivo y exige atribución). Para el lanzamiento decide: seguir con ellos (poco tráfico), o pasar a un proveedor con clave (Google Maps, Mapbox) o a servidores propios. El cambio es de un solo lugar (`src/components/map/geocoder.ts`).
- [ ] **[LANZAMIENTO]** Probar el mapa, «Usar mi ubicación» y el teclado en un **iPhone (Safari)** y un **Android (Chrome)** reales: solo se probó con el navegador de escritorio y emulación.
- [ ] **[CUANDO PUEDAS]** Pedir a la diseñadora el **diseño de la cuenta** (perfil, direcciones con mapa, datos fiscales, pedidos): hoy es provisional con los tokens del sistema. Y **revisar los textos** de la cuenta (los escribí yo, sin guion de copy).
- [ ] **[S15]** Texto legal del **consentimiento** para guardar direcciones, ubicación y datos fiscales (política de privacidad).

---

## L. Carrito y retención de stock (Sprint 7)

- [ ] **[S7 · decisión]** **Confirmar S-04:** el precio con el que un producto entró a la bolsa se respeta **7 días** (si baja, se cobra el menor; si sube, se respeta hasta que venza la garantía). Se cambia en Ajustes → «Carrito y reservas» → «Días que se respeta el precio de la bolsa».
- [ ] **[S7 · decisión]** **D-02, reservar al agregar o al pagar:** hoy el stock se aparta 10 minutos **al agregar a la bolsa** (como pediste). Es lo más cómodo, pero facilita que alguien (o un robot) acapare productos. Se puede pasar a «reservar al empezar el pago» con un solo interruptor (Ajustes → «Reservar el stock al agregar a la bolsa»). Cuando haya clientes reales, decidir con datos: ¿hubo bolsas abandonadas reteniendo stock?
- [ ] **[S7 · decisión]** **Acaparamiento: el tope por red.** Las unidades que pueden tener retenidas a la vez los carritos de una misma red (IPv4 o /64) están en 150 (Ajustes → «Carrito y reservas»). Protege contra alguien que repita peticiones para tener stock apartado sin fin. Si muchas clientas comparten la misma IP (redes móviles de operadora) y ves que se quedan sin «reserva», súbelo. **No protege** contra alguien que use muchas redes distintas: para eso está el interruptor de arriba.
- [ ] **[S7 · decisión]** **Topes por bolsa:** hoy 10 unidades de una misma variante, 30 productos distintos y 30 unidades en total. BR-INV-06 dice «sin límite de unidades por cliente»; estos topes son solo **antiacaparamiento** y se suben en Ajustes → «Carrito y reservas» (máximo 1000). Dime si prefieres otros números.
- [ ] **[S7 · decisión]** Qué pasa con una bolsa llena si el cliente **cambia de moneda**: hoy solo hay BOB, así que no se presenta. Decidir (conservar el precio de la moneda original o recotizar) **antes de habilitar una segunda moneda**.
- [ ] **[S7 · NUBE — necesita tu OK]** Subir a la nube, en este orden: (1) la migración `20261103000100_s7_carrito.sql`, (2) la Edge Function **`cart`** (sin verificación de JWT: la usan los invitados; `supabase/config.toml` ya lo indica), (3) el código de la tienda. Antes: confirmar que **`pg_cron` está activo** en el proyecto de Supabase (Database → Extensions); sin él, las retenciones vencidas igualmente dejan de contar, pero los carritos de invitado antiguos no se abandonan solos.
- [ ] **[S7 · prueba real]** Probar en tu teléfono (y en uno de la clienta si puedes): agregar desde la ficha, ver el cajón y la bolsa, cambiar cantidades, quitar y **deshacer**, ver la cuenta regresiva de 10 minutos, **iniciar sesión con la bolsa llena** (debe quedar la misma, sin duplicar), y probar con el **modo avión** (los cambios deben sincronizarse al volver la red).
- [ ] **[S7 · NUBE — verificar al desplegar]** Los límites por red del carrito y del login dependen de la IP que informa el proxy de Supabase (`cf-connecting-ip`). **No pude comprobarlo localmente** (aquí se usa el primer valor de `x-forwarded-for`, que el cliente sí puede escribir). Tras desplegar: (1) hacer dos peticiones al carrito con una cabecera `cf-connecting-ip` inventada y ver en la tabla `rate_limits` qué IP se registró; si es la inventada, **el límite por IP se puede evadir** y hay que avisarme antes del lanzamiento; (2) comprobar que 31 carritos nuevos desde una misma conexión dan 429 en el 31.º (`docs/carrito.md`).

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

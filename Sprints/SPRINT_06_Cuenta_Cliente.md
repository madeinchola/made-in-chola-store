# Sprint 6 — Cuenta del cliente

**Release:** R2 · **Estimación:** 4 días · **Depende de:** S1 (auth backend), S4 (UI), S5 (layout storefront)

## Objetivo
Pantallas y datos de la cuenta del cliente: registro/login con identificador único, perfil, libreta de direcciones y datos fiscales, listos para ser usados en el carrito y el checkout.

## Alcance
**Dentro:** UI de login/registro/recuperación, perfil, direcciones (con ubicación en mapa), datos fiscales, desactivación de cuenta, sección "Mis pedidos" (estructura y vacío; se llena en S10).
**Fuera:** carrito (S7), cálculo de envío (S8), pedidos reales (S10).

## Reglas de negocio cubiertas
BR-ACC-01..08, BR-SHP-01 (captura de ubicación), S-02, S-08.

## Tareas

### BD
- [x] `addresses` (profile_id, etiqueta, destinatario, teléfono, línea 1/2, ciudad, departamento, país, referencia, `lat`, `lng`, `is_default`, flags envío/facturación, `archived_at`).
- [x] `tax_profiles` (profile_id, tipo de documento, número, razón social, `is_default`, `archived_at`).
- [x] RLS: cada cliente solo ve/edita lo suyo; admin lectura (para atender pedidos); sin DELETE físico (BR-ACC-07).
- [x] Constraint: **una sola dirección por defecto** por cliente (índice parcial único).
- [x] Auditoría en cambios de perfil sensibles (email/teléfono).

### Frontend
- [x] Pantalla **Entrar/Crear cuenta** con campo único "Email o teléfono", selector de país para teléfono, mostrar/ocultar contraseña, indicador de fortaleza, mensajes uniformes. *(La pantalla venía de S1; S6 añadió el indicador de fortaleza —también al restablecer y al cambiar contraseña—.)*
- [x] **Recuperar contraseña** (flujo por email; alterno para solo-teléfono definido en S1). *(Solo por email: la recuperación para quien tiene solo teléfono sigue esperando la decisión D-03.)*
- [x] **Perfil:** nombre, email, teléfono (cambiar con reautenticación), contraseña, idioma/moneda preferida.
- [x] **Direcciones:** listar, crear, editar, archivar, marcar predeterminada; **selector de ubicación en mapa** (Leaflet + OSM, S-08) con búsqueda por texto y pin arrastrable; permiso de geolocalización opcional y con explicación.
- [x] **Datos fiscales:** CRUD simple, uno por defecto, validación de formato NIT/CI (Bolivia) con tolerancia configurable.
- [x] **Mis pedidos** (shell): lista vacía + estructura de detalle para S10.
- [x] **Desactivar cuenta:** flujo con confirmación, explica qué se conserva (pedidos) y qué se anonimiza.
- [x] Integración con carrito invitado: al iniciar sesión se dispara `merge_guest_cart` (se implementa en S7; aquí se deja el *hook* y el contrato).
- [x] CSP actualizada para tiles de mapa y geocodificación.

## Criterios de aceptación
1. Registro, login y recuperación funcionan con email y con teléfono.
2. El cliente administra varias direcciones y datos fiscales; solo una por defecto.
3. La ubicación (lat/lng) queda guardada y es utilizable por S8.
4. Desactivar cuenta cierra sesión y conserva los pedidos asociados.
5. Un cliente nunca ve datos de otro (probado a nivel SQL y E2E).

## Testing
- **Unit:** validadores de NIT/CI, teléfono, contraseña; helper de dirección por defecto.
- **SQL/RLS:** matriz de roles sobre `addresses` y `tax_profiles`; unicidad de dirección por defecto bajo concurrencia.
- **Componentes:** formulario de dirección (campos obligatorios por país), mapa (mock de tiles), estados de error.
- **E2E:** crear cuenta → agregar dirección con pin → editar → archivar → marcar default; recuperar contraseña; cambiar teléfono; desactivar cuenta.
- **Accesibilidad:** formularios largos con teclado; mapa con alternativa textual.
- **Seguridad:** intento de leer/editar direcciones ajenas por ID (IDOR); XSS en campos de texto.

## Edge cases
- Mismo teléfono en distintos formatos; email con mayúsculas; intento de usar un identificador ya registrado.
- Cambiar el teléfono/email a uno existente; cambio de identificador principal en usuario solo-teléfono.
- Marcar como default la dirección que se archiva; archivar la única dirección.
- Geolocalización denegada o impreciso; pin fuera de zona de cobertura (S8); dirección sin lat/lng guardada de antes.
- Mapa sin conexión / tiles bloqueados / geocodificador caído → permitir ingreso manual de coordenadas o referencia textual.
- Direcciones muy largas, caracteres especiales, emoji.
- NIT inválido/duplicado entre clientes (permitido) pero formato correcto.
- Sesión expira mientras se edita un formulario → no perder datos.
- Cuenta desactivada intenta re-registrarse con el mismo identificador (política de reactivación).
- Doble envío del formulario, múltiples pestañas, cambios simultáneos desde dos dispositivos.
- Menores de edad / datos de terceros: solo política de privacidad (S15).

## Revisión
- [ ] Checklist universal.
- [x] Revisión de privacidad: mínimo de PII, anonimización al desactivar.
- [ ] Revisión de límites de tasa en recuperación de contraseña (abuso de envío de emails).
- [ ] Revisión UX móvil de formularios (teclado numérico para teléfono, autocompletado correcto). *(Hecha en emulación a 360 px con axe; falta probarla en teléfonos reales: `SPRINT_19`, sección K.)*
- [ ] Validar licencia/uso de OSM y política de tiles/geocodificación (rate limits, atribución). *(Implementado: atribución visible, búsqueda solo por acción de la persona —sin autocompletado—, ≥ 1,1 s entre consultas y detrás de una interfaz `Geocoder` intercambiable. Falta que el dueño decida el proveedor para producción: `SPRINT_19`, sección K.)*

## Riesgos
- Dependencia de servicios gratuitos de mapas/geocodificación (límites) → capa de abstracción para cambiar a Google/Mapbox (D-04).
- Calidad de direcciones en Bolivia (sin estandarización) → priorizar el pin + referencia textual.

## Pendientes externos
Reglas de verificación de NIT/CI; decisión D-03 para recuperación de contraseña de solo-teléfono; textos legales de consentimiento (S15).

## Entregables para sprints siguientes
Cuenta completa, `addresses` con lat/lng, `tax_profiles`, contrato `merge_guest_cart`, componente de mapa/selector de ubicación (S8, S10).

---

## Estado real de entrega (2026-11-02)

**Entregado:** `/cuenta` con perfil (nombre, email y teléfono con contraseña de confirmación, idioma y moneda), libreta de direcciones (hasta 20 activas, una predeterminada, archivar/restaurar) con selector de ubicación en mapa (Leaflet + OpenStreetMap, pin opcional, coordenadas escritas como alternativa, búsqueda de lugares solo al pulsar «Buscar»), datos fiscales NIT/CI con validación configurable desde el panel (`tax_id_validation`), seguridad (cambiar contraseña con indicador de fortaleza, desactivar o anonimizar la cuenta), «Mis pedidos» (lista vacía y detalle para S10), el gancho `postSignIn` para `merge_guest_cart` (S7), limpieza de la caché al cambiar de usuario (`SessionCacheGuard`) y CSP para teselas y buscador. Migración `20261102000100_s6_cuenta_cliente.sql`; Edge Functions `update-contact`, `change-password` (nuevas), `set-password` y `deactivate-account` (endurecidas). Documentación: `docs/cuenta.md` (incluye «Límites conocidos») y README «Cuenta del cliente (Sprint 6)».

**Cómo se hizo:** base de datos, funciones, sesión y pruebas de integración por mí; pantallas de cuenta y mapa con dos subagentes; revisión independiente (agente sin contexto, solo lectura) y corrección de sus hallazgos; mutaciones sobre SQL y front.

**Bugs reales encontrados por las pruebas y la revisión, y corregidos:**
- **Interbloqueo (HTTP 500) con peticiones simultáneas reales**: el candado de «una predeterminada» se tomaba dentro de un disparador por fila, cuando la fila ya estaba bloqueada. Ahora es un candado por sentencia. Lo encontró la integración con `Promise.all`, no pgTAP.
- **`deactivate_profile` y un alta del cliente formaban un ciclo de bloqueos**: ahora toman los candados en el mismo orden.
- **La auditoría guardaba en claro datos personales** (etiqueta tipo «Casa de María», ciudad, departamento): ahora se redactan, y una prueba recorre toda la auditoría.
- **Anonimizar no tocaba lo que guarda GoTrue** (`raw_user_meta_data` y `auth.audit_log_entries` con email y nombre). `updateUserById` *fusiona* los metadatos: hay que poner las claves en `null`.
- **`set-password` aceptaba cualquier sesión**: quien robara un token de acceso fijaba una contraseña sin conocer la actual. Ahora exige la sesión del enlace de recuperación (`amr = otp`, ≤ 15 min).
- **Cambiar la contraseña cerraba todas las sesiones, también la propia**, y dejaba al cliente a medias: ahora la función devuelve una sesión nueva que el navegador adopta.
- **Cambiar email/teléfono podía pisar un cambio simultáneo** y, si Auth fallaba, deshacerse sin comprobarlo: ahora es comparar-y-cambiar, con deshacer verificado.
- Marcar «sin predeterminada» a mano dejaba la libreta sin ninguna; un alta que esperaba el candado mientras la cuenta se desactivaba la veía aún activa; verificar la contraseña dejaba sesiones fantasma en GoTrue; un fallo transitorio de red al leer el perfil cerraba la sesión; el mapa enviaba datos a un tercero sin avisar y sus controles salían en inglés; un alta masiva por PostgREST exige las mismas claves en todos los objetos (`PGRST102`).

**Revisión independiente:** los hallazgos graves y medios se corrigieron (lista arriba). **Documentados sin arreglar** (`docs/cuenta.md`, «Límites conocidos»): el mapa captura el desplazamiento táctil dentro del cajón, el pin se pierde si la sesión expira mientras se escribe, solo se listan las 100 archivadas más recientes, la política de contraseñas del servidor es más laxa que el indicador, el límite de verificaciones por IP de GoTrue (R-AUTH-1) tiene más consumidores, y las reglas de NIT/CI son supuestos.

**Verificación (2026-11-02):**
- **Unitarias:** 3461 en 167 archivos (S5: 2527 en 131), con `npm run typecheck` (aplicación y nodo), lint `--max-warnings=0` y Prettier limpios. **Deno (Edge Functions):** 36.
- **pgTAP:** 1104 aserciones en 14 archivos (S5: 939 en 13; la migración nueva: 165 en `13_s6_cuenta_cliente`). **Integración contra la base y GoTrue locales:** 317 en 9 archivos (S5: 275 en 8; `account.integration.test.ts`: 42, con sesiones realmente cerradas, dos cambios simultáneos y cero datos personales en el esquema `auth` tras anonimizar).
- **E2E Chromium móvil + escritorio: 380 pasan y 2 omitidas a propósito, 0 fallos** (S5: 308), con axe WCAG 2.1 A/AA en lista, formulario con mapa y confirmaciones, sin desbordes a 360 px, IDOR entre clientes, teselas y buscador sustituidos por respuestas locales.
- **Mutación (errores inyectados a propósito):** SQL 54 de 56 mutantes muertos (los 2 supervivientes son defensa en profundidad equivalente); `AuthProvider`, `SessionCacheGuard`, `PasswordStrength`, mapa y `adoptSession` con todos los mutantes muertos.
- **Peso:** entrada pública gzip **256,2 kB** (`index` 79,8 + `App` 176,4; S5: 243,5; presupuesto ≤ 270) · CSS 11,4 kB. Cuenta en chunks propios (direcciones 12,9 kB, perfil 4,5, fiscales 4,6, seguridad 2,6) y el mapa (Leaflet) aparte, 50,2 kB + 6,4 kB de CSS, solo al abrir el selector. Lighthouse no se repitió en este sprint.

**Dos incidencias de la corrida E2E, ninguna del producto:** (1) dos pruebas mías quedaron desactualizadas por cambios legítimos —`/cuenta` ahora muestra el teléfono con formato y la nota de privacidad del mapa también nombra a OpenStreetMap— y se corrigieron; (2) el Mac entraba en «Maintenance Sleep» (~15 min) en mitad de la corrida y las pruebas que lo cruzaban aparecían caídas por tiempo (4, 15 y 17 minutos con límite de 30 s). Con `caffeinate -ims` la suite corre en 6,4 min sin fallos. Quien lance el E2E largo en esta máquina debería usarlo (`caffeinate -ims npm run e2e`).

**Criterios de aceptación:**
1. *Registro, login y recuperación con email y con teléfono:* **parcial**. Registro y login con ambos: cumplido (E2E). Recuperación: solo con email; para quien tiene solo teléfono falta la decisión D-03.
2. *Varias direcciones y datos fiscales, solo una por defecto:* **cumplido** (pgTAP, integración con peticiones simultáneas reales y E2E).
3. *Lat/lng guardada y utilizable por S8:* **cumplido** (rangos validados en la base; el pin es opcional y la referencia textual basta).
4. *Desactivar cuenta cierra sesión y conserva los pedidos:* **la sesión se cierra: cumplido**; los datos se anonimizan o se conservan archivados según elija la persona. «Conserva los pedidos» **sin verificar con pedidos reales**: todavía no existen (S10).
5. *Un cliente nunca ve datos de otro:* **cumplido** (matriz de roles en pgTAP, IDOR en integración y E2E).

**Pendiente (no hecho):**
- **Nube (2026-11-03): hecho.** Migración `20261102000100` aplicada (13 en total, verificada), anonimización del esquema `auth` probada con una transacción deshecha, Edge Functions `update-contact`, `change-password`, `set-password` y `deactivate-account` desplegadas (401 sin token y CORS 204) y código empujado (CI verde, Vercel sirve la CSP nueva). **Sin probar:** el recorrido completo por las funciones con una cuenta real en producción (el registro público está cerrado en la nube, así que hay que crear la cuenta de prueba desde el panel).
- **Decisiones del dueño:** reglas oficiales de NIT/CI, D-03 (recuperación solo-teléfono), política de reactivación de cuentas, proveedor de mapas en producción, texto legal de consentimiento (S15).
- **Pruebas en dispositivos reales:** formularios y mapa en iPhone y Android (el arrastre táctil del mapa dentro del cajón es el punto a mirar).
- **Código:** borrador del formulario si expira la sesión, paginar las archivadas, endurecer la política de contraseñas del servidor (S16).

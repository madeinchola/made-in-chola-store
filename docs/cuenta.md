# Cuenta del cliente (Sprint 6)

Perfil, direcciones con ubicación en mapa, datos fiscales, seguridad (contraseña y desactivar cuenta) y la estructura de «Mis pedidos». Todo vive bajo `/cuenta` y exige sesión (`RequireAuth`); la autorización real la aplica la base de datos (RLS) en cada consulta.

## Mapa de rutas

| Ruta | Pantalla |
| --- | --- |
| `/cuenta` | Perfil: nombre, email y teléfono (cambiar con contraseña), idioma y moneda preferidos |
| `/cuenta/direcciones` | Libreta de direcciones con pin en el mapa |
| `/cuenta/datos-fiscales` | NIT/CI y razón social para facturar |
| `/cuenta/pedidos` · `/cuenta/pedidos/:orderId` | Estructura de «Mis pedidos» (el contenido real llega en S10) |
| `/cuenta/seguridad` | Cambiar contraseña y desactivar la cuenta |

Cada sección es un *chunk* aparte (nada de esto se descarga para ver la tienda); el mapa (Leaflet) es otro *chunk* que solo carga al abrir el formulario de una dirección.

## Modelo de datos (`20261102000100_s6_cuenta_cliente.sql`)

**`addresses`** (BR-ACC-04): etiqueta, destinatario, teléfono E.164, línea 1 y 2, ciudad, departamento, país (solo países **habilitados**, hoy Bolivia), referencia, `lat`/`lng` (todo o nada, dentro de rango), *para envío* / *para facturación* (al menos uno), predeterminada y `archived_at`. **`tax_profiles`** (BR-ACC-06): tipo (`ci`, `nit`, `ce`, `pas`, `otro`), documento, razón social, predeterminado y `archived_at`. **`profiles`** gana `preferred_locale` y `preferred_currency` (una moneda habilitada, o NULL = la de la tienda).

Reglas que impone **la base** (la pantalla las refleja, pero no depende de ellas):

- **Una sola predeterminada por cliente** (índice parcial único + guardia). La primera activa queda predeterminada sola; marcar otra desmarca la anterior; **archivar la predeterminada** promueve a la más reciente de las que quedan; restaurar una archivada con una predeterminada vigente no se la quita.
- **Tope**: 20 direcciones activas y 10 datos fiscales activos por cliente (las archivadas no cuentan; restaurar sí). Un alta masiva que se pasa del tope no deja entrar ninguna.
- **Nada se borra** (BR-ACC-07): no hay permiso de `DELETE` ni para el `service_role`; «eliminar» es archivar. El mismo documento no se repite entre los activos de un cliente (entre clientes distintos sí).
- **Aislamiento**: cada cliente solo ve y edita lo suyo (el `INSERT` exige `profile_id = auth.uid()`; `profile_id` no se puede cambiar); el admin solo **lee**; una cuenta desactivada deja de ver y editar todo. Una sesión anónima no tiene acceso.
- **Predeterminada**: no se «quita» a mano (`is_default = false` sobre la única dejaría al cliente sin ninguna aunque tenga otras activas): se cambia marcando OTRA (la guardia distingue su propio desmarcado por la profundidad del disparador).
- **Cuenta activa**: el disparador comprueba, con una foto nueva, que la cuenta siga activa al crear o restaurar un registro (la RLS evalúa con la foto del inicio de la sentencia: un INSERT que esperaba el candado mientras la cuenta se desactivaba la vería aún activa).
- **Texto plano**: espacios sobrantes recortados, opcionales en blanco → `NULL`, el documento fiscal pasa a mayúsculas. Se guardan tal cual (emoji, tildes, `<b>`): la interfaz los muestra como texto, nunca como HTML.
- **Auditoría** (BR-ADM-03): cada alta/cambio de dirección o dato fiscal queda registrado con **todo texto que escribe la persona redactado**: etiqueta («Casa de María Quispe»), destinatario, teléfono, calles, ciudad, departamento, referencia, pin, documento y razón social. Solo queda legible lo que no identifica (país, uso envío/facturación, fechas). Una prueba pgTAP recorre TODA la auditoría de direcciones y falla si algún valor personal aparece en claro, también tras anonimizar.

### Concurrencia

Dos peticiones del mismo cliente a la vez (doble clic, dos pestañas, dos dispositivos) terminan siempre con **una sola predeterminada y sin errores**. Cada sentencia toma, **antes de tocar ninguna fila**, un candado de asesoría por (tabla, cliente) que se libera al terminar la transacción (`account_statement_lock`, disparador `BEFORE … FOR EACH STATEMENT`). Un primer diseño lo tomaba dentro del disparador por fila y producía **interbloqueos (HTTP 500)** al archivar la predeterminada mientras se marcaba otra: lo encontró la prueba de integración con peticiones simultáneas reales, y quedó fijado con 5 pruebas de concurrencia (que fallan si se quita el candado) y comprobaciones estructurales en pgTAP. `deactivate_profile` toma las mismas claves **antes** de bloquear la fila del perfil y en el mismo orden que el cliente (candado → fila): al revés, un INSERT del cliente y la desactivación formaban un ciclo (interbloqueo). Una prueba pgTAP fija ese orden.

### Vistas públicas nuevas

`public_countries` y `public_currencies` (solo lo habilitado y solo columnas públicas) para que el formulario de direcciones y las preferencias sepan qué países y monedas ofrecer; las tablas de origen siguen siendo solo del admin.

## Cambiar contacto, contraseña y desactivar (Edge Functions)

Las tres piden la **contraseña actual** y tienen límite de intentos por cliente (→ `429`). Comprobar la contraseña (`verifyPassword`) abre una sesión real en GoTrue; **se cierra en el acto** para no dejar una sesión fantasma viva por cada confirmación.

| Función | Cuerpo | Notas |
| --- | --- | --- |
| `update-contact` | `{ password, email?, phone?, phone_country? }` | `undefined` = no tocar; `null`/vacío = quitar. Sin verificación por enlace ni SMS (BR-ACC-03). **Comparar y cambiar**: la escritura solo se aplica si el perfil sigue como se leyó (si otro cambio se coló → 409 `contact_update_conflict`, no se pisa nada). Actualiza el perfil primero (los índices únicos deciden) y luego Auth; si Auth falla, **deshace solo su propio cambio y comprueba que el deshacer funcionó**: si no, lo registra con el identificador de correlación y responde 500 `contact_update_inconsistent` (en vez de fingir un 409). Solo «ya está en uso» se explica como tal (`contact_update_failed`, mensaje único); un fallo de Auth que no es eso da 503 `contact_update_unavailable`. Una cuenta conserva siempre un identificador. Se audita a nombre del cliente, sin el número en claro. |
| `change-password` | `{ current_password, new_password }` | Misma política que el registro (longitud, comunes, relación con el contacto, filtraciones públicas) más «distinta de la actual». Cierra **todas** las sesiones de la cuenta (también una robada) y **entrega una sesión nueva** que el navegador adopta (`adoptSession`); si no llega, cierra la local y pide entrar de nuevo. |
| `set-password` | `{ password }` | Restablecer desde el enlace del correo. **Solo acepta la sesión del enlace de recuperación** (reclamo `amr` = `otp`, de hace ≤ 15 min): con una sesión de inicio de sesión normal responde 403 `recovery_required`, porque quien robara un token de acceso fijaría una contraseña sin conocer la actual. Mismo cierre de sesiones y sesión nueva que arriba. |
| `deactivate-account` | `{ password, anonymize }` | Desactiva y banea en Auth. Con `anonymize`: nombre, email, teléfono, **direcciones (también etiqueta, ciudad y pin)** y **datos fiscales** quedan sin datos personales (los registros se conservan archivados), **y también lo que guarda GoTrue**: `raw_user_meta_data` (nombre y teléfono; `updateUserById` *fusiona* los metadatos: `{}` no borra, hay que poner las claves en `null`) y los eventos de `auth.audit_log_entries` que llevan el email y el nombre. Sin `anonymize` se conserva todo, invisible para la cuenta. |

**Límites de intentos de `update-contact`**: 5 cada 15 min y 10 al día por cliente, **sin reiniciarse con un éxito**. Motivo: un 409 con un valor bien formado significa «ya está en uso», así que quien tenga una cuenta puede sondear si un email o teléfono ajeno existe; es el costo de no verificar el contacto (BR-ACC-03, riesgo aceptado como R-AUTH-4) y por eso el ritmo está acotado. No se puede eliminar sin pedir verificación por enlace/SMS.

La lógica pura de `update-contact` (qué cambia, qué se escribe en Auth) vive en `supabase/functions/_shared/contact.ts`, y la de sesiones (`bearerToken`, `jwtClaims`, `isRecentRecoverySession`) en `_shared/auth.ts`; ambas se prueban con Deno. Las pruebas de integración recorren el flujo completo contra GoTrue real (entrar con el teléfono nuevo, el email viejo deja de servir, cuentas solo-teléfono, límites, auditoría, **sesiones realmente cerradas** —se comprueban los refresh tokens y `auth.sessions`—, **dos cambios simultáneos** sin errores 500 ni desalineación, y que tras anonimizar no queda ningún dato personal en el esquema `auth`).

**Lo que no se pudo verificar en la nube**: la limpieza del esquema `auth` en `deactivate_profile` está protegida (si el rol no tuviera permiso solo avisa y la anonimización de nuestros datos sigue), pero **no sé si en el Supabase hospedado el rol `postgres` puede borrar en `auth.audit_log_entries`**. Tras subir la migración hay que probarlo con una cuenta de prueba (ver `SPRINT_19`).

## Mapa y geocodificación (S-08, D-04)

Leaflet + OpenStreetMap, sin costo por consulta. Detrás de una interfaz `Geocoder` (D-04) para poder cambiar a Google o Mapbox sin tocar la pantalla. **Política de uso de OSM/Nominatim** que el código respeta: atribución visible «© OpenStreetMap contributors», **sin autocompletado al teclear** (solo al enviar la búsqueda), como máximo 1 petición por segundo, y el pin siempre **opcional** (la referencia textual y los campos de latitud/longitud son la alternativa si el mapa o el buscador fallan, y la alternativa accesible por teclado). La CSP permite `nominatim.openstreetmap.org` en `connect-src`; las teselas son imágenes (`img-src https:`).

**Riesgo**: dependemos de servicios gratuitos con límites; con tráfico real hay que pasar a un proveedor con clave (Google/Mapbox) o a una instancia propia de Nominatim y teselas (decisión D-04).

## Datos fiscales

Rigor configurable desde Panel → Ajustes → «Clientes y cuentas» (`tax_id_validation`): **strict** exige el formato de cada tipo y **lenient** acepta cualquier documento alfanumérico (para no frenar una compra por un formato que cambie). Los rangos de *strict* son **supuestos** hasta que el dueño confirme las reglas oficiales de NIT/CI (ver `SPRINT_19`).

## Gancho de «acabo de iniciar sesión» y contrato de `merge_guest_cart` (S7)

`src/features/auth/postSignIn.ts`: `registerPostSignInHook(fn)` y `runPostSignInHooks({ userId })`. Los ganchos se ejecutan **una vez** tras un inicio de sesión o registro exitoso (no al restaurar una sesión guardada), en paralelo, son de **mejor esfuerzo** (un fallo se registra sin datos personales y nunca bloquea el login) y el login los espera como máximo 3 s. **Contrato para S7**: registrar un gancho que llame a la función SQL `merge_guest_cart` con el identificador del carrito de invitado; debe ser **idempotente** (un reintento no duplica líneas), sumar cantidades respetando el stock y devolver cuántas líneas se fusionaron y cuántas quedaron en conflicto.

## Privacidad

Mínimo de datos personales: el teléfono y la referencia de una dirección se piden solo para entregar; la auditoría los redacta; desactivar con anonimización los borra de todas partes (la tienda de pedidos de S10 guardará su propia copia de la dirección de entrega de cada pedido, por eso aquí se pueden limpiar sin romper la contabilidad). El texto legal del consentimiento llega con S15.

## Límites conocidos (revisión independiente del Sprint 6)

Hallazgos reales que **no se arreglaron** por ser de bajo impacto o por depender de una decisión:

- **El mapa captura el desplazamiento táctil** dentro del cajón del formulario (un dedo sobre el mapa lo arrastra en vez de desplazar el formulario). Es el compromiso habitual de un mapa embebido; la alternativa (gestos de dos dedos) exige un complemento. La rueda del ratón sí se desactivó. A revisar en un móvil real.
- **El pin se pierde** si la sesión expira mientras se escribe la dirección y `RequireAuth` redirige a `/login` (el formulario se desmonta). Guardar un borrador en `sessionStorage` implicaría guardar datos personales en el navegador; no se hizo. (El caso del fallo transitorio de red ya no cierra la sesión: se arregló.)
- **Solo se ven las 100 direcciones archivadas más recientes.** Un cliente tendría que crear y archivar más de 100; no hay forma de listar el resto.
- **La política de contraseñas del servidor es menos estricta que el indicador de fortaleza**: acepta `Abcdefghijklmnopqrst1` o `Aaaaaaaaaaaaaaaaaaaa1`. El indicador las marca «Débil» (descuenta secuencias y repeticiones: *longitud efectiva*), pero el servidor no las rechaza; endurecerla afecta a S1 (registro) y se deja para S16.
- **Límite de GoTrue por IP (R-AUTH-1)**: `login`, `update-contact`, `change-password` y `deactivate-account` salen todos de la IP del Edge Runtime, así que comparten el techo de verificaciones por IP de Auth. S6 añade consumidores; subirlo es una acción del dueño antes del lanzamiento.
- **La búsqueda de lugares y el mapa envían datos a un tercero** (OpenStreetMap: lo que se escribe, el área y la IP). Ahora el formulario lo avisa junto al buscador; falta el texto legal (S15).

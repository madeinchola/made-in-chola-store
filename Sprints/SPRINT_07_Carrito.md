# Sprint 7 — Carrito y retención de stock

**Release:** R2 · **Estimación:** 4 días · **Depende de:** S2 (variantes, `reserve_stock`), S5 (tarjetas/detalle), S6 (sesión y contrato de fusión)

## Objetivo
Un carrito robusto que funciona sin login, persiste entre dispositivos al iniciar sesión, retiene stock 10 minutos, respeta el precio con el que se agregó y avisa de cualquier cambio.

## Alcance
**Dentro:** carrito invitado (local + token anónimo), carrito persistente de usuario, fusión al iniciar sesión, retención blanda de stock con cuenta regresiva, revalidación continua, notificación de cambios, mini-carrito y página de carrito, sugerencias (cross-sell).
**Fuera:** envío y cupones dentro del total (se integran en S8/S9 vía puntos de extensión ya definidos), checkout (S10).

## Reglas de negocio cubiertas
BR-ACC-01, BR-ACC-05, BR-INV-02, BR-INV-03, BR-INV-04, BR-PRC-05, BR-CHK-03, BR-CHK-04, BR-MKT-03, S-04, D-02.

## Tareas

### BD
- [x] `carts` (profile_id nullable, `anon_token`, status `active|merged|converted|abandoned`), `cart_items` (cart_id, variant_id, qty, `unit_price_at_add`, currency, `added_at`, `price_locked_until`).
- [x] Único `(cart_id, variant_id)`; qty `>= 1` y tope por variante (configurable).
- [x] RPC `cart_upsert_item`, `cart_remove_item`, `cart_get` (devuelve líneas con estado: `ok | price_changed | low_stock | out_of_stock | unavailable`). *(Hecho como `cart_set_item`: cantidad ABSOLUTA e idempotente, no «sumar». Todo el acceso pasa por la Edge Function `cart`: `reserve_stock` solo lo ejecuta `service_role`.)*
- [x] RPC `merge_guest_cart(anon_token)` al iniciar sesión: suma cantidades respetando stock y el **precio más favorable/más antiguo** según regla S-04; idempotente.
- [x] Integra `reserve_stock` (S2): cada alta/modificación crea/renueva retención de **10 min** con `owner_type='cart'`; `release_stock` al quitar/vaciar.
- [x] **Antiabuso (D-02):** tope de unidades por variante por carrito, tope de reservas totales por sesión/IP, rate limit; *feature flag* `reserve_on_add_to_cart` para poder moverlo a "al iniciar checkout".
- [x] Anonimato: token opaco firmado (cookie/localStorage); sin PII para invitados; limpieza de carritos invitados antiguos (cron). *(Token opaco emitido por el servidor; la base guarda solo su sha256. No va en cookie: `localStorage`, solo para invitados.)*
- [x] Caducidad de garantía de precio (S-04: 7 días configurable) → al vencer se revalida y se avisa.

### Frontend
- [x] `CartProvider` con estado optimista y sincronización con servidor; funciona offline-first para invitado (localStorage) y se reconcilia al volver la red. *(Sin conexión: se conserva lo pendiente mientras la pestaña siga abierta y se reintenta; recargar sin red pierde lo no confirmado. El invitado conserva su última bolsa.)*
- [x] Mini-carrito (drawer) y página `/carrito`; stepper de cantidad con límites; eliminar con *undo*.
- [x] **Cuenta regresiva** de retención con mensaje claro cuando expira ("ya no reservamos tu producto, aún puedes comprarlo si hay stock").
- [x] **Aviso de cambios**: precio cambió, stock insuficiente, producto agotado/ocultado/archivado → banners por línea con acciones (actualizar/quitar).
- [x] Botón **Pagar**: si no hay sesión → login/registro y regreso al carrito con fusión; si hay sesión → ruta de checkout (S10).
- [x] Sugerencias "completa tu look" (relacionados de S5) y resumen de totales con **puntos de extensión** para envío y descuento (S8/S9 los llenan).
- [x] Persistencia entre pestañas (BroadcastChannel/`storage` event).
- [x] Eventos `add_to_cart`, `remove_from_cart`, `view_cart` en la capa `track`.

## Criterios de aceptación
1. Un invitado agrega productos, inicia sesión y su carrito se conserva y fusiona sin duplicados.
2. Dos clientes no pueden retener más unidades de las existentes (invariante de S2 se mantiene).
3. Al expirar los 10 min, el carrito permanece pero la UI informa y re-intenta reservar si hay stock.
4. Si cambia un precio o se agota algo, el cliente lo ve **antes** de poder pagar.
5. El carrito del mismo usuario es idéntico en móvil y escritorio.
6. Los totales coinciden entre cliente y servidor (el servidor manda).

## Testing
- **Unit:** reductor del carrito (add/remove/merge), cálculo de subtotal con redondeo, evaluación de estados de línea, caducidad de precio.
- **SQL/RLS:** invitado solo accede a su token; usuario solo a su carrito; admin lectura; IDOR sobre `cart_id`.
- **Concurrencia:** N clientes agregando la última unidad; fusión simultánea desde dos dispositivos; renovación de reserva vs. expiración en el mismo instante.
- **Integración:** `merge_guest_cart` (carrito vacío, con ítems repetidos, con ítems sin stock, idempotencia ante doble llamada).
- **E2E:** invitado → agrega → login → fusión; expiración de reserva (reloj acelerado); cambio de precio desde admin mientras el cliente está en el carrito; producto agotado por otro cliente.
- **Rendimiento:** carrito con 50 líneas; latencia de actualización.
- **Resiliencia:** red intermitente, peticiones fuera de orden, reintentos idempotentes.

## Edge cases
- Cantidad pedida > disponible: ajustar automáticamente con aviso, no fallar en silencio.
- Variante archivada/oculta/sin stock estando en carrito; color o talla eliminados.
- Precio sube/baja entre agregado y pago (S-04: respetar precio del carrito + notificar; si bajó, cobrar el menor).
- Mismo producto agregado desde dos pestañas/dispositivos al mismo tiempo.
- Moneda/país cambia con carrito lleno → recalcular con aviso (política: se conserva el precio de la moneda original o se re-cotiza; documentar).
- Carrito invitado de hace semanas con productos que ya no existen.
- Token anónimo borrado (cookies limpiadas) → carrito perdido; mensaje claro.
- Merge: ítems duplicados con precios distintos; suma excede stock; carrito de usuario ya tiene reservas propias.
- Doble clic en "+" y reintentos de red → operación idempotente.
- Bots llenando carritos para acaparar stock → topes y rate limit; monitoreo.
- Reloj del dispositivo adelantado/atrasado → la cuenta regresiva usa hora del servidor.
- Usuario cierra sesión: el carrito persistido sigue en su cuenta; el dispositivo queda limpio (sin fuga a otro usuario del mismo equipo).
- Cantidad 0, negativa, decimal o enorme por manipulación de la petición.

## Revisión
- [x] Checklist universal.
- [x] Revisión de abuso: simular bot que reserva todo el catálogo; validar topes. *(Hecha: ver «Estado real de entrega». El acaparamiento queda acotado por red, no contra una botnet.)*
- [ ] Revisión de privacidad en localStorage/cookies (consentimiento si aplica).
- [x] Revisión de consistencia de dinero (sin floats, redondeo único).
- [ ] Validar con el dueño D-02 (reservar al agregar vs. al iniciar checkout) con datos de las pruebas.

## Riesgos
- Acaparamiento de stock (D-02) → flag + topes; decisión final con datos reales.
- Complejidad de sincronización offline → alcance limitado: invitado local, usuario servidor.
- **`zod` < 4.6.6 tiene un aviso alto** (GHSA-mrhx-c7xc-m3w5: puede agotar memoria validando colecciones enormes con restricciones). Hoy no afecta (no hay `z.array` en el código), pero **este sprint introduce la primera lista validada** (líneas del carrito) en una Edge Function pública. **Antes de escribirla**, decidir: (a) migrar a zod 4.x (cambio mayor; revisar `@hookform/resolvers`) o (b) limitar el tamaño del cuerpo y validar el largo de la lista **antes** de parsear sus elementos, con test de cuerpo gigante. Lo mismo vale para S10.

## Pendientes externos
Confirmación S-04 (7 días de garantía de precio) y D-02.

## Entregables para sprints siguientes
Carrito completo, `merge_guest_cart`, estados de línea y avisos, retención de stock, totales con puntos de extensión para S8 (envío) y S9 (descuento).

---

## Estado real de entrega (2026-11-05)

**Entregado:** carrito de invitado (token opaco) y de usuario, **fusión** al iniciar sesión, retención blanda de **10 min** por línea (`reserve_stock`), **precio respetado 7 días** (S-04, con «Deshacer» que no lo pierde), estados de línea y avisos calculados **por el servidor** (`ok`, `price_changed`, `low_stock`, `out_of_stock`, `unavailable`), totales con puntos de extensión para envío y descuento, `/carrito`, cajón, cuenta regresiva con la hora del servidor, botón «Agregar a la bolsa», sugerencias «Completa tu look», eventos `add_to_cart`/`remove_from_cart`/`view_cart`, ajustes del carrito en el panel (incluido un booleano), y `/checkout` provisional. Migración `20261103000100_s7_carrito.sql`; Edge Function `cart`. Documentación: `docs/carrito.md`, README «Carrito y retención de stock (Sprint 7)» y la sección L de `SPRINT_19`.

**Cómo se hizo:** base, función y almacén del cliente por mí; la prueba pgTAP y la interfaz por dos subagentes; **tres revisiones independientes** (la pgTAP, el backend y la interfaz, cada una por un agente sin contexto y de solo lectura); mutaciones en SQL y en el cliente. Los subagentes se cortaron una vez por el límite de uso y se reanudaron con su contexto.

**Desviaciones respecto al plan (y por qué):**
- **Todo pasa por la Edge Function `cart`** (el plan decía RPC): las funciones de reserva solo las ejecuta `service_role` (decisión de S2), y ahí viven los topes de D-02.
- **Cantidades absolutas** (`set_item`), no «sumar»: un reintento o un doble clic no duplica nada.
- **«Agregar a la bolsa» espera a leer la bolsa** si no se leyó (antes adivinaba 0).
- **Tope de unidades retenidas por red** (`cart_max_units_per_ip`, 150) y huella de red HMAC: no estaba en el plan; es lo único que acota el acaparamiento cuando se renueva sin fin.
- **`cart_removed_items`** (15 min) para que «Deshacer» conserve el precio y la garantía.
- **«Deshacer» en línea** en vez de un toast (alcanzable con teclado y dentro del cajón).
- **No se hizo** la política de «moneda cambia con la bolsa llena» (hoy solo hay BOB) ni E2E de la expiración de la reserva con reloj acelerado, del cambio de precio desde el panel ni del producto agotado por otro cliente (cubiertos con pgTAP, integración HTTP real y componentes con temporizadores falsos).

**Bugs reales encontrados por las pruebas y las revisiones, y corregidos:**
- *Mi migración:* `blocking` y `can_checkout` salían `null` (`false OR NULL`); un invitado podía **inventar tokens** y saltarse el tope de carritos nuevos; `cart_abandon_stale` podía cruzarse con otras operaciones (orden de bloqueo); la retención **parcial** se informaba como completa y `refresh` no la completaba; una cuenta desactivada podía reabrir carrito y retener stock; las funciones internas eran ejecutables por `service_role` (`pg_default_acl`); la fusión **recortaba cantidades en silencio**.
- *Revisión del backend (13 hallazgos, 0 críticos):* **acaparamiento sin tope** (renovar retenía para siempre) → cupo por red; límites por IP **evadibles con IPv6** → se agrupa por /64; **«Deshacer» perdía la garantía de precio**; `accept_prices` aceptaba líneas con garantía vigente (y el precio visto no viajaba); la fusión acortaba la garantía y re-estrenaba precios vencidos sin aviso; el carrito **revelaba el stock exacto**; fusionar con una cuenta desactivada fallaba; el estado del carrito no se revalidaba tras tomar el candado; un 5xx pasajero descartaba el cambio del cliente; el espejo local se validaba poco; la fusión y el archivado de una variante podían cruzar bloqueos; pedir una variante inexistente dejaba un carrito vacío; y varias frases de `docs/carrito.md` exageraban.
- *Revisión de la interfaz (19 hallazgos):* **«Agregar» con la bolsa sin cargar dejaba en 1 una bolsa de 3** (alto); con sesión y sin red se decía «Tu bolsa está vacía»; «Pagar» bloqueado seguía siendo un enlace abrible con el clic del medio; el fragmento del cajón sin red de seguridad podía tumbar todo el sitio; el resumen no se atenuaba al quitar una línea; el foco, tras quitar, iba a un botón destructivo; «Deshacer» era un toast inalcanzable con teclado; los controles no decían de qué producto eran; con `StrictMode` (desarrollo) quien tiene sesión no cargaba su bolsa.
- *Descubiertos por las pruebas de integración/E2E:* `refresh` volvía a sumar lo retenido al cupo por red (reabría el acaparamiento); el inicio de sesión se retrasaba hasta 3 s esperando una fusión inexistente.

**Revisión independiente — lo que NO se corrigió** (documentado en `docs/carrito.md`, «Límites conocidos»): acaparamiento con **muchas redes** (botnet), redes compartidas por operadoras que comparten el cupo, y 6 hallazgos bajos de accesibilidad/analítica/textos de la interfaz. **No verificable sin desplegar:** que `cf-connecting-ip` llegue y no sea falseable en el Supabase real (aquí se usa `x-forwarded-for`).

**Verificación (2026-11-05):**
- **Unitarias:** 3751 en 183 archivos (S6: 3461 en 167), con `npm run typecheck`, lint `--max-warnings=0` y Prettier limpios. **Deno:** 57 (S6: 36).
- **pgTAP:** 1577 aserciones en 15 archivos (S6: 1104 en 14; `14_s7_carrito`: 473). **Integración contra la base y la función locales:** 351 en 10 archivos (S6: 317; `cart.integration`: 34, con peticiones HTTP reales y **concurrencia real**: 8 invitados contra las últimas 3 unidades, fusiones simultáneas, 10 cambios a la vez de una bolsa, 31 carritos nuevos desde una red IPv6).
- **Mutación (errores inyectados a propósito):** SQL, ~86 mutantes, 81 detectados y los 5 supervivientes son equivalentes (defensa en profundidad inalcanzable: redondeo con precios de 2 decimales, guarda redundante de bolsa vacía, `PUBLIC` ya sin `EXECUTE`, moneda base única, estado del carrito en el cálculo del cupo). Cliente (almacén, selectores, espejo, proveedor y componentes), 56 mutantes, 54 detectados y 2 equivalentes. **Las mutaciones destaparon pruebas mías demasiado débiles** (contar peticiones en una cola de una en una no distingue «se evitó» de «aún no salió»; no había prueba de los selectores, del proveedor ni de la respuesta vacía de la fusión) y se reforzaron.
- **E2E Chromium móvil + escritorio:** 22 pruebas nuevas en `e2e/cart.spec.ts` (agregar desde la ficha, cajón, bolsa, cambiar cantidad, quitar y deshacer, «Pagar» con y sin sesión y regreso con la bolsa fusionada, sin conexión y recuperación, sin desbordes a 360 px, objetivos táctiles ≥ 44 px, axe WCAG 2.1 A/AA en bolsa vacía, con productos y con el cajón abierto, encabezados sin saltos). **Última corrida completa: 399 pasan, 3 omitidas a propósito y 2 fallos por tiempo** (`account.spec` «cambiar la contraseña» y `account-addresses.spec` «buscador caído», ambas de S6, al principio de la corrida con las funciones en frío): repetidas en aislado **pasan**. Historia honesta de las corridas sobre este código: la primera (400 pasan, 1 falla) **encontró un defecto real** (el inicio de sesión esperaba una fusión inexistente, hasta 3 s) que se corrigió; dos corridas posteriores con la máquina en swap (13 de 14 GB, 28 min en vez de 13) dieron 14 y 11 fallos DISTINTOS cada vez, todos por tiempo y todos pasan al repetirlos; el E2E del carrito lo corrió por primera vez yo y destapó dos errores del propio spec (probaba una compilación vieja por un `vite preview` huérfano; las retenciones de las pruebas anteriores agotaban la variante de la semilla). **No hay todavía una corrida completa sin ningún fallo sobre el código final**; en esta máquina el E2E es sensible a la carga y conviene lanzarlo con `caffeinate -ims` y sin otras aplicaciones pesadas.
- **Peso:** entrada pública gzip **263,1 kB** (`index` 81,6 + `App` 181,5; S6: 256,2; techo 270). La página de la bolsa (1,8 kB) y el contenido del cajón (1,0 kB) cargan bajo demanda. Lighthouse no se repitió en este sprint.

**Criterios de aceptación:**
1. *Un invitado agrega, inicia sesión y su carrito se fusiona sin duplicados:* **cumplido** (pgTAP, integración incluida la doble fusión simultánea y E2E).
2. *Dos clientes no retienen más de lo que existe:* **cumplido** (pgTAP; integración con concurrencia real).
3. *Al expirar los 10 min el carrito permanece, la UI informa y reintenta si hay stock:* **cumplido** en pgTAP, integración y componentes; **sin E2E** con el reloj acelerado.
4. *Si cambia un precio o se agota algo, el cliente lo ve antes de poder pagar:* **cumplido** (pgTAP, integración, componentes); sin E2E con el cambio hecho desde el panel.
5. *El carrito del mismo usuario es idéntico en móvil y escritorio:* **cumplido** (integración con dos sesiones del mismo usuario); sin prueba en dos dispositivos reales.
6. *Los totales coinciden entre cliente y servidor:* **cumplido por diseño**: el cliente no calcula ningún importe, solo les da formato.

**Pendiente (no hecho):**
- **Nube:** la migración, la función `cart` y el código **no están subidos**; necesita tu OK. Antes: activar `pg_cron`, y verificar `cf-connecting-ip` (ver `SPRINT_19`, sección L).
- **Decisiones del dueño:** S-04 (7 días), D-02 (reservar al agregar o al pagar), topes por bolsa frente a BR-INV-06, cupo por red, moneda con la bolsa llena. Todo en `SPRINT_19`, sección L.
- **Pruebas en teléfonos reales** (agregar, cajón, cuenta regresiva, iniciar sesión con la bolsa llena, modo avión) y con VoiceOver/TalkBack (los 3 puntos de accesibilidad menor sin cerrar).
- **Código:** E2E de expiración/cambio de precio/agotado por otro cliente; persistir lo pendiente sin conexión entre recargas; mensaje propio para la cuenta desactivada; `CartProvider` solo donde se necesita; Lighthouse; la prueba de abuso con datos reales (D-02).


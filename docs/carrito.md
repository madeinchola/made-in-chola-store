# Carrito y retención de stock (Sprint 7)

Qué hace, cómo está hecho y por qué. Cubre BR-ACC-01/05, BR-INV-02..04, BR-PRC-05, BR-CHK-03/04 y los supuestos S-04 y D-02.

## En una frase

Un invitado puede llenar su bolsa sin cuenta; al iniciar sesión se **fusiona** con la de su cuenta; el stock se **retiene 10 minutos** al agregar; el **precio** con el que entró se respeta 7 días; y **el servidor decide** precios, estados y totales: el navegador solo los muestra.

## Arquitectura

```
Navegador ──(JSON, sesión o token)──▶ Edge Function `cart` ──(service_role)──▶ funciones SQL ──▶ carts / cart_items
                                         │                                        │
                                         │ topes de tasa (IP, identidad)          └─▶ reserve_stock / release_stock (S2)
                                         └ verifica el JWT con Auth
```

- **Una sola puerta.** `reserve_stock` solo lo ejecuta `service_role` (decisión de S2: el navegador nunca reserva stock). Por eso el carrito entero pasa por la función `cart`, que además es donde viven los **topes antiabuso de D-02**. Las funciones SQL `cart_*` y `merge_guest_cart` tampoco las ejecuta `anon` ni `authenticated`, y las tablas `carts` y `cart_items` solo las **lee** el admin (RLS); nadie escribe directo, ni siquiera `service_role`.
- **Invitado** = un **token opaco** (`ct_` + 32 bytes aleatorios en base64url) que el servidor **emite una vez** y que solo conoce su navegador. En la base se guarda únicamente su **sha256**: aunque se filtrara la tabla, nadie podría reconstruir un token. Sin datos personales.
- **Usuario** = su carrito va por su id (el JWT se verifica con Auth en cada petición). Un usuario con sesión ignora cualquier token de invitado, salvo en `merge`.
- **El servidor emite los tokens.** Un invitado solo puede **estrenar** carrito con un token que la función acaba de emitir en esa misma petición. Con un token que trae el cliente y la base no conoce, el servidor emite otro. Sin esto bastaría inventar tokens para abrir carritos sin límite y saltarse el tope de carritos nuevos por red. (Una prueba de integración lo fija.)
- **La red del invitado, sin guardar su IP.** Al estrenar su carrito se guarda una **huella de su red** (`carts.ip_hash`: HMAC-SHA256 con una clave del servidor, nunca la IP). Sirve para una sola cosa: acotar cuántas unidades pueden retener a la vez los carritos de una misma red (ver «Antiacaparamiento»). Solo la llevan los carritos de invitado, y se **borra** al fusionar o abandonar el carrito. Las IPv6 se agrupan por su prefijo /64 (una persona recibe un /64 entero: si cada dirección contara como una red, cualquier límite por IP se saltaría rotando de dirección).

## Modelo de datos

| Tabla | Para qué |
| --- | --- |
| `carts` | `profile_id` (usuario) **o** `token_hash` (invitado), nunca ambos ni ninguno (constraint). `status`: `active` · `merged` · `converted` (S10) · `abandoned`. Un usuario tiene como mucho **un** carrito activo (índice único parcial); un `token_hash` es único. |
| `cart_items` | `(cart_id, variant_id)` único; `qty` 1–1000; `unit_price_at_add`, `currency`, `added_at`, `price_locked_until` (la garantía de precio). |
| `cart_removed_items` | Lo que se acaba de **quitar** (15 min): precio de entrada, garantía y antigüedad. Es lo que hace que «Deshacer» no pierda el precio asegurado (S-04). Solo lo escribe el servidor; se limpia cada hora. |

Los importes son `numeric` (nunca coma flotante) y se redondean una sola vez, a los decimales de la moneda (`currencies.decimals`).

## Reglas

**Cantidades absolutas.** `set_item(variante, qty)` **fija** la cantidad (0 quita); no suma. Un reintento, un doble clic o dos pestañas con el mismo valor no duplican nada. `qty` negativa, decimal o > 1000 se rechaza.

**Límites (ajustes del admin, D-02).** Se leen de `store_settings`:

| Ajuste | Por defecto | Qué hace |
| --- | --- | --- |
| `reserve_on_add_to_cart` | `true` | Retiene el stock al agregar. En `false` solo se ajusta a lo disponible y no se retiene nada (para pasar a «reservar al iniciar el pago», S10). |
| `cart_max_qty_per_variant` | 10 | Tope de unidades de una variante por carrito. |
| `cart_max_lines` | 30 | Productos distintos por carrito. |
| `cart_max_reserved_units` | 30 | Unidades totales por carrito (= lo máximo que un carrito puede retener). |
| `price_guarantee_days` | 7 | S-04. `0` = sin garantía. |
| `guest_cart_retention_days` | 30 | Un carrito de invitado sin actividad se da por abandonado. |
| `cart_max_units_per_ip` | 150 | Unidades que los carritos de invitado de una misma **red** pueden tener retenidas a la vez (antiacaparamiento, D-02). Más allá, la línea se agrega pero **sin retención**. Los usuarios con sesión no lo tienen: los acota su cuenta. |

> **A confirmar con el dueño.** BR-INV-06 dice «sin límite de unidades por cliente»; el tope de 10 por variante es **antiacaparamiento** (D-02) y es configurable. Si el dueño prefiere ningún tope, se sube a 1000.

**Retención de 10 minutos.** Cada alta o cambio crea o renueva la retención de **esa línea** (`reserve_stock`, dueño `cart`, TTL de `reservation_ttl_minutes`). Es **blanda**: al vencer, el carrito permanece; la interfaz lo dice y reintenta retener **si hay stock** (`refresh`). `refresh` solo **sube** lo retenido: completa una retención parcial (se logró 1 de 3 y luego hubo más stock) o recupera la vencida, pero **no alarga** una completa (si no, quien lo llamara en bucle retendría para siempre). Una retención parcial cuenta como incompleta (`reservation.state = expired`) para que la interfaz ofrezca reintentar. Mientras vence, esas unidades vuelven a estar libres para otros (la vista usa `expires_at`, no depende del cron).

**Antiacaparamiento (D-02), lo que SÍ acota y lo que NO.** Repetir `set_item` con la misma cantidad **renueva** el vencimiento (lo hace `reserve_stock`), así que los 10 minutos solos no impiden que alguien que lo repita mantenga algo retenido. Lo que lo acota es el **tope de unidades retenidas por red** (`cart_max_units_per_ip`, 150 por defecto): lo comprueban `set_item` y `refresh`, cuenta lo que ya retienen los carritos activos de esa red (sin contar lo que esa línea ya retenía) y, si no hay cupo, la línea se agrega igual **sin retención** (la interfaz muestra «ya no reservamos…» y deja reintentar). Alternar cantidades, repetir o llamar a `refresh` en bucle no pasa de ese tope. **Lo que NO acota:** alguien con muchas redes distintas (una botnet, muchos /64) puede retener 150 por cada una; para eso quedan el tope por bolsa, el límite de carritos nuevos por red y el interruptor `reserve_on_add_to_cart` (mover la reserva a «al pagar»), y la decisión final de D-02 con datos reales. El tope es «blando»: dos peticiones simultáneas de la misma red pueden pasarlo por unas pocas unidades.

**Sin overselling.** `reserve_stock` bloquea la fila de la variante: dos carritos nunca retienen más de lo que existe. Probado con 8 invitados pidiendo a la vez 2 de las últimas 3 unidades: se reparten exactamente 3.

**Estados de una línea** (los calcula el servidor): `unavailable` > `out_of_stock` > `low_stock` > `price_changed` > `ok`.

| Estado | Cuándo | ¿Bloquea el pago? |
| --- | --- | --- |
| `unavailable` | variante o producto archivado, producto en borrador o sin precio | sí |
| `out_of_stock` | no queda ninguna unidad libre para este carrito | sí |
| `low_stock` | pide más de lo libre (`billable_qty` = lo libre) | sí |
| `price_changed` | el precio vigente difiere del de entrada (ver abajo) | solo `expired_raised` |
| `ok` | — | no |

**Precio (S-04, BR-PRC-05).** Al crear la línea se guarda el precio vigente y una garantía hasta `now() + 7 días`. **Cambiar la cantidad no renueva ni precio ni garantía.**

| Situación | Precio que se cobra | Aviso |
| --- | --- | --- |
| Dentro de la garantía, el precio sube | el de entrada | `guaranteed` (informativo) |
| Dentro de la garantía, el precio baja | el vigente (el menor) | `dropped` (informativo) |
| Garantía vencida, sube | el vigente | `expired_raised` (**bloquea** hasta aceptar) |
| Garantía vencida, baja | el vigente | `expired_dropped` (informativo) |

«Aceptar nuevo precio» (`accept_prices`) fija el precio vigente como el de entrada y renueva la garantía, pero **solo en líneas cuya garantía ya venció**: aceptar el precio vigente de una con garantía vigente le haría perder el precio asegurado. Con una sola línea, el cliente manda **el precio que está viendo** (`expected_price`); si el vigente ya es otro, no se acepta nada y la persona vuelve a ver el aviso con el precio nuevo (así no acepta uno distinto del que leyó).

**«Deshacer» y volver a agregar.** Al quitar una línea el servidor recuerda 15 minutos su precio, garantía y antigüedad. Si se vuelve a agregar en ese plazo **y su garantía seguía vigente**, recupera esos datos (no se alargan); si la garantía ya había vencido o pasaron más de 15 minutos, es una línea nueva al precio vigente. El cliente nunca manda un precio: lo guarda y lo devuelve el servidor.

**Stock visible.** `available` en cada línea no pasa del máximo por variante (`cart_max_qty_per_variant`): el carrito no revela el stock exacto a un invitado (las vistas públicas tampoco lo hacen) y la interfaz nunca necesita más.

**Totales.** `subtotal = Σ round(precio_efectivo × unidades_cobrables, decimales)`. Las líneas agotadas o no disponibles suman 0. `shipping` y `discount` son **puntos de extensión** (`null`): S8 y S9 los llenan; mientras tanto `total = subtotal`. `can_checkout` = hay líneas, ninguna bloquea y se puede cobrar algo. Lo decide **el servidor**.

**Fusión al iniciar sesión (`merge_guest_cart`).**
- Suma cantidades respetando el tope por variante, líneas, unidades y el stock. **Todo recorte se avisa**: una línea que entra con menos de lo que sumaba (tope por variante, por unidades o por stock) cuenta en `adjusted_lines`; una que no entra del todo (tope de líneas o de unidades), en `skipped_lines`. Nada se pierde en silencio.
- **Precio (S-04):** sin línea previa del usuario, la del invitado pasa **tal cual** (con su garantía, vigente o vencida). Con las dos: si ambas tienen garantía vigente gana el **menor precio** con la **garantía más larga** de las dos (nadie pierde lo que tenía asegurado; es algo más generoso que cualquiera de las dos por separado, a propósito); si solo una la tiene vigente, la suya; si ninguna, la línea **más antigua**, también vencida (así el aviso «el precio cambió» no desaparece al fusionar). Se conserva el `added_at` más antiguo.
- Una **cuenta desactivada** no fusiona nada: la respuesta es «nada que fusionar» y el carrito de invitado queda intacto.
- Una línea que no se puede retener (agotada, no disponible) **se conserva sin retención**: la persona la ve y decide.
- **Idempotente:** el carrito de invitado queda `merged`; una segunda llamada (doble clic, otra pestaña, dos dispositivos) devuelve `already: true` y no cambia nada. Se toman los dos carritos por orden de id y luego las variantes por orden de id (antes de tocar sus reservas, igual que `reserve_stock` y el trigger de archivado), que evita los ciclos de bloqueo que se conocen; no se afirma más que eso.
- Tras fusionar, el navegador **borra el token y el espejo local**: el equipo queda limpio.

**Limpieza.** `cart_abandon_stale()` (cada hora) pasa a `abandoned` los carritos de invitado sin actividad > 30 días y libera su stock. `purge_old_carts()` (diaria) borra los de invitado ya cerrados con más de 60 días (no tienen datos personales). Desactivar una cuenta **abandona** su carrito y libera lo retenido, y una cuenta desactivada **no ve ni crea** carrito (defensa en la base, aunque su sesión siguiera siendo válida unos minutos).

## La función `cart`

`POST /functions/v1/cart`, JSON, **sin `verify_jwt`** (la usan invitados); identifica ella misma al usuario o al invitado.

| `action` | Campos | Qué hace |
| --- | --- | --- |
| `get` | `cart_token?` | Lee el carrito. Sin token ni sesión: vacío, sin crear nada (sí pasa antes por el límite de tasa, que consulta la base). |
| `set_item` | `variant_id`, `qty`, `cart_token?` | Fija la cantidad. Pedir algo inexistente o que no se vende no crea carrito. El primer alta de un invitado emite el token (`cart_token`, `token_minted: true`). |
| `remove_item` | `variant_id`, `cart_token?` | = `set_item` con 0. |
| `clear` | `cart_token?` | Vacía y libera lo retenido. |
| `refresh` | `cart_token?` | Reintenta retener las líneas cuya retención venció. |
| `accept_prices` | `variant_id?`, `expected_price?`, `cart_token?` | Acepta el precio vigente de una línea (con `expected_price`, solo si sigue siendo ese) o de todas las de garantía vencida. |
| `merge` | `cart_token` | Requiere sesión. Fusiona el carrito de invitado en el del usuario. |

Respuesta: `{ token_state, server_time, cart, outcome?, requested?, applied?, cart_token?, … }` (ver `src/features/cart/types.ts`). `outcome` de `set_item`: `ok` · `adjusted` (se pidió más de lo que hay) · `capped_variant` / `capped_units` · `removed` · `out_of_stock` · `unavailable` · `limit_lines` / `limit_units`. `token_state`: `ok` · `none` · `retired` (token ya fusionado o abandonado) · `merged`.

**Errores:** 400 (`validation`, `invalid_json`, `invalid_cart_token`, `invalid_request`) · 401 (`invalid_session`, `login_required`) · 405 · 413 (`payload_too_large`) · 429 (`rate_limited`, con `Retry-After`) · 500.

**Topes de tasa** (D-02): 600 peticiones/min por red; escrituras 60/min por identidad y 300/min por red; **30 carritos de invitado nuevos por red y hora**; 20 fusiones cada 10 min por usuario. «Red» = la IPv4 o el /64 de una IPv6. Los topes por red son generosos porque las redes de operadora móvil comparten una IP entre mucha gente; lo que de verdad acota el acaparamiento es el cupo de unidades retenidas por red (arriba). **La IP** se toma de `cf-connecting-ip`, que en teoría fija el proxy de Supabase y el cliente no controla; si falta, del primer valor de `x-forwarded-for`, **que un cliente sí puede escribir**. Localmente se usa esta segunda vía. **Verificado en la nube el 2026-11-05:** una `cf-connecting-ip` forjada la rechaza el proxy (403, código 1000 de Cloudflare) y varias `x-forwarded-for` distintas se contaron todas bajo la IP real, de modo que el cliente no puede sustituirla. Falta la prueba de los 31 carritos nuevos contra la nube (ver `SPRINT_19`, sección L).

**Aviso de `zod` (GHSA-mrhx-c7xc-m3w5), decisión (b) del sprint.** La función no valida ninguna lista: cada petición es **una operación** con valores sueltos, el esquema es `.strict()` (sin campos de más) y el cuerpo se corta en **2 kB antes de parsear** (`readLimitedText`: también si llega por trozos y sin `Content-Length`). Con eso el aviso no aplica; no hizo falta migrar a zod 4.

## Interfaz y estado del cliente

`src/features/cart/`: `cartStore.ts` (estado sin React, probado entero), `CartProvider.tsx` (lo ata a la sesión), `selectors.ts`, `cartApi.ts`, `storage.ts`, `types.ts`.

- **El servidor manda.** Cada respuesta reemplaza la foto. El cliente solo ve de inmediato sus **cantidades pendientes** (`pending`), y el contador de la cabecera las incluye.
- **Una petición a la vez** (cola): ninguna respuesta puede llegar fuera de orden. Diez clics en «+» son **una** petición con la cantidad final.
- **Sin conexión:** se conserva lo pendiente, se avisa y se reintenta (2, 4, 8, 16 s, tope 30 s) y de inmediato al volver la red (`online`). Un 429 espera lo que diga el servidor; un 401 conserva lo pendiente y lo reintenta **cuando la sesión se renueva** (no en bucle); un **error del servidor (5xx, 408) se reintenta** con espera creciente hasta 5 veces seguidas y, si insiste, deja de reintentar solo pero **no descarta nada**: lo pendiente espera a que la persona pulse «Reintentar», que sí lo reenvía; un error sin remedio (400, 413…) descarta **solo ese** cambio (y si la persona ya pidió otra cantidad mientras tanto, esa se conserva). Una respuesta con un cuerpo que no es del carrito se trata como error del servidor.
- **Deshacer:** es un aviso **en línea** («Quitaste X · Deshacer»), en la página de la bolsa y dentro del cajón, alcanzable con el orden normal de tabulación (un toast va al final del documento y, dentro de un diálogo modal, queda fuera). **Caduca a los 8 s y lo decide el almacén**, no un componente: si la página se cierra no queda un «Deshacer» viejo vivo para aparecer después en otro sitio. Sobrevive a tocar OTRAS líneas; solo se invalida si se cambia la misma o se quita otra (un solo nivel). El foco, tras quitar, va al **enlace con el nombre** de la línea vecina (nunca a su botón «Quitar»: un segundo Intro o un doble toque la quitaría también).
- **La bolsa que no se pudo leer no es una bolsa vacía.** Si la primera lectura falla (sin red, error del servidor) la bolsa **no se marca como cargada** y la página y el cajón dicen «No pudimos cargar tu bolsa» con «Reintentar»; antes decían «Tu bolsa está vacía» y quien tenía productos los veía desaparecer. (Un invitado con copia local sigue viendo su última bolsa.)
- **«Agregar a la bolsa» suma a lo que realmente hay.** Las cantidades son absolutas, así que el almacén (`addOne`) **espera a leer la bolsa** si aún no se leyó en vez de adivinar 0: adivinar mandaba «1» y dejaba en 1 una bolsa que tenía 3, en silencio. Si no se puede leer, no envía nada. Con la bolsa cargada es inmediato (dos clics seguidos suman 2).
- **«Pagar» bloqueado es un botón sin enlace** (`aria-disabled`, enfocable, con la razón asociada), no un `<a href>`: un enlace deshabilitado se abre igual con el clic del medio o «abrir en una pestaña nueva». Habilitado es un enlace.
- **El resumen sigue «actualizando»** mientras haya CUALQUIER cambio sin confirmar (también al quitar una línea, que ya no está en la lista).
- **Ciclo de vida reversible.** El proveedor se engancha y se suelta con `connect()`/`disconnect()`: React en desarrollo (`StrictMode`) monta, desmonta y vuelve a montar, y un fin definitivo dejaba a quien tiene sesión sin cargar su bolsa hasta entrar a /carrito. Las lecturas pedidas seguidas se funden en una.
- **Nombres accesibles con el producto.** El selector de cantidad, sus botones y los botones de los avisos («Quitar», «Ajustar a n», «Aceptar nuevo precio») dicen de qué producto son; con cinco líneas no se oye cinco veces «Disminuir cantidad».
- **Si el fragmento del cajón no se descarga** (despliegue nuevo con hash viejo, red a medias) falla SOLO el cajón: una red de seguridad lo explica y ofrece «Ver bolsa» o recargar; antes el error subía a la ruta y sustituía todo el sitio.
- **El espejo local se valida entero** al leerlo (cada línea, totales, retención, límites): uno manipulado o de una versión vieja del contrato se descarta en vez de tumbar la tienda al pintar.
- **Cambio de identidad** (login, logout, otro usuario en el mismo equipo): se descarta todo, y una respuesta que vuelve tarde no contamina la identidad nueva.
- **Privacidad en el navegador.** Solo los **invitados** guardan algo (`localStorage`, clave `mic.cart.guest.v1`): su token y la última foto del carrito. Un usuario con sesión **no guarda nada**; al cerrar sesión el equipo queda limpio. Lo guardado se valida al leerlo (algo manipulado se descarta).
- **Otras pestañas:** `BroadcastChannel` avisa tras cada escritura y las demás releen.
- **Cuenta regresiva** con la hora del **servidor** (`server_time`), no la del dispositivo.
- **Gancho de login (S6):** `registerPostSignInHook` fusiona el carrito antes de pasar a la pantalla siguiente (espera hasta 3 s). Si falla (sin red) el token se conserva y se reintenta al volver a cargar.

## Límites conocidos

- **Acaparamiento con muchas redes distintas.** El cupo de unidades retenidas (150 por red) acota a un atacante con una red, no a uno con muchas (botnet, muchos /64). Y el cupo es blando bajo concurrencia. Ver «Antiacaparamiento». Medirlo con datos reales es la revisión pendiente de D-02.
- **Redes compartidas (NAT de operadora móvil).** Las clientas detrás de una misma IP comparten el cupo de 150 unidades retenidas: si muchas retienen a la vez, las últimas agregan sin retención (verán «ya no reservamos…» y podrán reintentar). Es el costo de no poder distinguirlas; el cupo es ajustable.
- **Cuenta desactivada con una sesión aún válida:** `/carrito` se ve vacío y agregar responde «no disponible» sin un mensaje propio (la desactivación cierra sus sesiones, así que dura segundos).

- **Sin conexión solo se conserva lo pendiente mientras la pestaña siga abierta.** Recargar sin red pierde los cambios aún no confirmados (el carrito del servidor y, para invitados, la última foto, sí se conservan).
- **Dos pestañas de un invitado sin carrito** que agreguen a la vez crean dos carritos (cada una emite su token; gana el último guardado). El otro queda sin dueño y se abandona a los 30 días, y **lo que agregó esa pestaña deja de verse** (el navegador pasa a usar el token ganador). Es un caso raro (dos pestañas, bolsa vacía, el mismo segundo); la retención de ese carrito huérfano vence sola a los 10 minutos.
- **Cambiar de moneda con la bolsa llena:** hoy solo existe BOB; el carrito guarda su moneda y no re-cotiza. La política (conservar o re-cotizar) se decide cuando se habilite una segunda moneda.
- **«Agotado» depende del stock físico**, no de lo retenido por carritos (decisión de S2): que un carrito retenga las últimas unidades no oculta el producto.
- **Carritos de invitado con un token perdido** (cookies limpiadas) no se pueden recuperar: el carrito queda sin dueño y se abandona solo.
- **Accesibilidad menor sin cerrar (revisión de la interfaz):** (a) las regiones «Actualizando…» / «Agregando a tu bolsa…» están dentro de un contenedor `aria-busy`, y algunos lectores de pantalla no anuncian lo que está dentro de uno ocupado; (b) los avisos «Ya no reservamos…» y el vacío del cajón nacen ya con su texto dentro de un `role="status"`, que varios lectores no anuncian al insertarse (lo fiable es una región viva que ya existía y cambia de contenido); (c) al cerrar un aviso o pulsar «Reintentar» en la página, el botón enfocado desaparece y el foco cae al `<body>` (en el cajón lo recupera Radix). Ninguno impide usar la bolsa; hay que revisarlos con VoiceOver y TalkBack.
- **Parpadeo al vencer la retención:** al llegar a 0 se pide la reserva automáticamente y, mientras vuela, se ve un segundo «Ya no reservamos tus productos» que desaparece si había stock.
- **Analítica:** `add_to_cart` se emite al pulsar, antes de que el servidor confirme (también si lo rechaza por tope o agotado); `remove_from_cart` usa «BOB» fijo; `view_cart` puede salir con la última foto del espejo antes de la relectura. No llevan datos personales. Se afinan al conectar un proveedor (S15).
- **Textos:** «Te respetamos el precio con el que lo agregaste» no dice hasta cuándo (la fecha viene en la línea y no se muestra), y «Subtotal (n productos)» cuenta también las unidades agotadas, mientras el importe las deja en 0 (coincide con el contador de la cabecera).
- **`CartProvider` envuelve todo el sitio**, también `/admin` y `/cuenta`: con sesión, cada carga del panel hace una lectura de la bolsa (ruido, no daño) y cuenta contra los 600/min por red.
- **Falta E2E** de: expiración de la reserva con el reloj acelerado, cambio de precio desde el panel de administración mientras el cliente mira la bolsa, y producto agotado por otro cliente. Están cubiertos con pgTAP, integración HTTP real y pruebas de componentes con temporizadores falsos, pero no recorridos en un navegador.


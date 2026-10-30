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
- [ ] `carts` (profile_id nullable, `anon_token`, status `active|merged|converted|abandoned`), `cart_items` (cart_id, variant_id, qty, `unit_price_at_add`, currency, `added_at`, `price_locked_until`).
- [ ] Único `(cart_id, variant_id)`; qty `>= 1` y tope por variante (configurable).
- [ ] RPC `cart_upsert_item`, `cart_remove_item`, `cart_get` (devuelve líneas con estado: `ok | price_changed | low_stock | out_of_stock | unavailable`).
- [ ] RPC `merge_guest_cart(anon_token)` al iniciar sesión: suma cantidades respetando stock y el **precio más favorable/más antiguo** según regla S-04; idempotente.
- [ ] Integra `reserve_stock` (S2): cada alta/modificación crea/renueva retención de **10 min** con `owner_type='cart'`; `release_stock` al quitar/vaciar.
- [ ] **Antiabuso (D-02):** tope de unidades por variante por carrito, tope de reservas totales por sesión/IP, rate limit; *feature flag* `reserve_on_add_to_cart` para poder moverlo a "al iniciar checkout".
- [ ] Anonimato: token opaco firmado (cookie/localStorage); sin PII para invitados; limpieza de carritos invitados antiguos (cron).
- [ ] Caducidad de garantía de precio (S-04: 7 días configurable) → al vencer se revalida y se avisa.

### Frontend
- [ ] `CartProvider` con estado optimista y sincronización con servidor; funciona offline-first para invitado (localStorage) y se reconcilia al volver la red.
- [ ] Mini-carrito (drawer) y página `/carrito`; stepper de cantidad con límites; eliminar con *undo*.
- [ ] **Cuenta regresiva** de retención con mensaje claro cuando expira ("ya no reservamos tu producto, aún puedes comprarlo si hay stock").
- [ ] **Aviso de cambios**: precio cambió, stock insuficiente, producto agotado/ocultado/archivado → banners por línea con acciones (actualizar/quitar).
- [ ] Botón **Pagar**: si no hay sesión → login/registro y regreso al carrito con fusión; si hay sesión → ruta de checkout (S10).
- [ ] Sugerencias "completa tu look" (relacionados de S5) y resumen de totales con **puntos de extensión** para envío y descuento (S8/S9 los llenan).
- [ ] Persistencia entre pestañas (BroadcastChannel/`storage` event).
- [ ] Eventos `add_to_cart`, `remove_from_cart`, `view_cart` en la capa `track`.

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
- [ ] Checklist universal.
- [ ] Revisión de abuso: simular bot que reserva todo el catálogo; validar topes.
- [ ] Revisión de privacidad en localStorage/cookies (consentimiento si aplica).
- [ ] Revisión de consistencia de dinero (sin floats, redondeo único).
- [ ] Validar con el dueño D-02 (reservar al agregar vs. al iniciar checkout) con datos de las pruebas.

## Riesgos
- Acaparamiento de stock (D-02) → flag + topes; decisión final con datos reales.
- Complejidad de sincronización offline → alcance limitado: invitado local, usuario servidor.
- **`zod` < 4.6.6 tiene un aviso alto** (GHSA-mrhx-c7xc-m3w5: puede agotar memoria validando colecciones enormes con restricciones). Hoy no afecta (no hay `z.array` en el código), pero **este sprint introduce la primera lista validada** (líneas del carrito) en una Edge Function pública. **Antes de escribirla**, decidir: (a) migrar a zod 4.x (cambio mayor; revisar `@hookform/resolvers`) o (b) limitar el tamaño del cuerpo y validar el largo de la lista **antes** de parsear sus elementos, con test de cuerpo gigante. Lo mismo vale para S10.

## Pendientes externos
Confirmación S-04 (7 días de garantía de precio) y D-02.

## Entregables para sprints siguientes
Carrito completo, `merge_guest_cart`, estados de línea y avisos, retención de stock, totales con puntos de extensión para S8 (envío) y S9 (descuento).

# Envíos y entregas programadas (Sprint 8)

Qué hace, cómo está hecho y por qué. Cubre BR-SHP-01/02/03, BR-PRC-07 (como condición de una regla), D-04 y S-08.

> **Todos los valores de ejemplo son PROVISIONALES.** El dueño todavía no respondió las preguntas de `PENDIENTES_ADMIN §B` (origen, tarifas, ciudades, franjas, recojo). El bloque «Envíos (S8)» de `supabase/seed.sql` carga unos de ejemplo para poder probar de punta a punta; el dueño los reemplaza desde `/admin/envios`. Nada de esto está fijado en el código.

## En una frase

El costo de envío lo calcula **el servidor** (`quote_shipping`) con un modelo de **reglas** que el admin configura sin tocar código: distancia en línea recta × un factor de ruta, tramos por kilómetro, zonas permitidas/bloqueadas, franjas de entrega con cupo, fechas bloqueadas y recojo. La pantalla solo muestra lo que el servidor contesta.

## Arquitectura

```
Navegador ──rpc──▶ quote_shipping (anon puede ejecutarla; SOLO LEE) ──▶ shipping_* / store_locations / delivery_*
   │                      └─ devuelve costo, regla aplicada, desglose, franjas con cupo y errores con código estable
   └─ /admin/envios ──(RLS: solo admin)──▶ las mismas tablas

S10 (checkout) ──(servidor, service_role)──▶ reserve_delivery_slot / release_delivery_slot   (cupo atómico)
```

- **Una sola fuente de verdad.** El costo no se calcula en el navegador. El estimador de la bolsa y el simulador del panel llaman a la misma función, así que el simulador coincide con lo que verá el cliente. En S10 el servidor la **recalcula** al crear el pedido.
- **Determinista y auditable.** Con las mismas entradas y la misma configuración devuelve lo mismo, y dice **qué regla aplicó** y cómo llegó al número (`breakdown`: distancia recta, factor, distancia de ruta, tramo, km adicionales, si se aplicó mínimo o máximo).
- **Nunca un costo «0» por omisión.** Sin origen, sin cobertura o sin tarifa devuelve `ok: false`, `cost: null` y un código; el cliente (`parseQuote`) rechaza cualquier respuesta con `ok` y errores a la vez o sin `ok` y con costo.
- **Nada se borra:** se archiva (`archived_at`). Todo cambio queda en `audit_log` (BR-ADM-03). Una regla vieja no cambia pedidos ya creados (S10 guardará el snapshot del costo).

## Modelo de datos (migración `20261106000100_s8_envios.sql`)

| Tabla | Para qué |
| --- | --- |
| `store_locations` | Ubicaciones del negocio. **Una sola** es el origen (`is_primary`, índice único parcial; debe estar activa y no archivada). Se cambia con `admin_set_primary_location`. |
| `shipping_methods` | `delivery` (domicilio) o `pickup` (recojo, apunta a una ubicación). Código en minúsculas y guion bajo. ETA mínima/máxima en días. La migración crea solo `delivery`: sin él no habría dónde colgar tarifas. |
| `shipping_zones` | `city` (lista de ciudades, sin tildes ni mayúsculas) o `radius` (centro + radio en km). `allowed = false` **bloquea** siempre, aunque otra zona permitida cubra el punto. |
| `shipping_rate_rules` | `distance` (`{"tiers":[{"up_to_km","cost"}…],"extra_per_km","min_cost","max_cost"}`) o `flat` (`{"cost"}`). Cada regla puede limitarse a una zona, a un rango de monto del pedido y a una vigencia. Los parámetros se validan con un `CHECK` (`_ship_params_valid`, nunca lanza). |
| `delivery_slots` | Franja por método y día ISO de la semana (1 = lunes … 7 = domingo), hora de inicio y fin, cupo (1–1000). |
| `blocked_dates` | Feriados y cierres: ese día no se entrega. |
| `delivery_bookings` | Cupos tomados (`order`/`cart`/`manual`). Solo las funciones del servidor escriben aquí; el admin las lee. |

La vista **`public_shipping_methods`** es lo único que ve un visitante de las TABLAS de configuración (métodos activos; el recojo solo con su ubicación activa; nombre, dirección en texto, ciudad y horario, **sin coordenadas**). Las tablas siguen cerradas para `anon`. Ojo: la cotización pública sí revela **distancias** (ver «Límites conocidos», punto 3).

### Ajustes (en `/admin/configuracion`)

`shipping_route_factor_pct` (130 = +30 % sobre la línea recta, D-04), `delivery_min_lead_hours` (24), `delivery_max_days_ahead` (30). La misma pantalla corrige un hueco de S7: faltaba `cart_max_units_per_ip`.

## Cómo se calcula el costo

1. **Entradas:** método (`delivery` por defecto), latitud/longitud, ciudad, monto del pedido, moneda, y opcionalmente fecha y franja.
2. **Validaciones** con códigos estables (`method_not_found`, `no_origin`, `location_required`, `invalid_coordinates`, `currency_unsupported`, `invalid_order_amount`…). Los mismos 20 códigos están en `src/features/shipping/types.ts` y en los textos `shipping.errors.*`; una prueba lee la migración y falla si el SQL y el TS se desfasan.
3. **Distancia:** Haversine con R = 6371,0088 km entre el origen y el punto, × `shipping_route_factor_pct / 100` = distancia de ruta. (La interfaz para un ruteo real queda para después.)
4. **Cobertura:** si alguna zona **no permitida** cubre el punto → `blocked_zone`. Si no hay ninguna zona permitida configurada → `coverage_not_configured` (para no vender a todo el país por omisión). Si ninguna permitida lo cubre → `out_of_coverage`. El borde del radio es **inclusivo**.
5. **Regla:** entre las reglas activas del método, vigentes, que aplican a la zona del punto y al monto del pedido (rango **inclusivo** en ambos extremos), gana la de mayor `priority`; a igualdad, la que tiene zona; a igualdad, la de menor `id`. Sin ninguna → `no_rate`.
6. **Tramos:** el borde superior es **inclusivo** (3,00 km pertenece a «hasta 3 km»). Pasado el último tramo se cobra el costo del último más `extra_per_km` por cada km adicional (proporcional). Luego el mínimo y el máximo, y el redondeo a los decimales de la moneda.
7. **Recojo:** costo 0 explícito (es una decisión del tipo de método, no un valor por omisión) y devuelve la ubicación; si esa ubicación está inactiva → `no_origin`.
8. **Fecha y franja (opcional):** valida calendario, fecha bloqueada, antelación mínima y tope de días, y cupo. Zona horaria `America/La_Paz` (UTC−4, sin horario de verano). La respuesta trae hasta 31 días de franjas con su cupo restante (las llenas salen con `available: false`).

**Envío gratis sobre un monto (BR-PRC-07):** no es un campo aparte sino una regla `flat` de costo 0 con monto mínimo y mayor prioridad. **No hay ninguna cargada**: es decisión del dueño.

## Cupos y concurrencia

`reserve_delivery_slot(slot, día, tipo_dueño, id_dueño)` toma el **candado de la fila de la franja**, cuenta lo reservado y recién entonces inserta: nadie cuenta a la vez que otro inserta. Responde `reserved`, `already` (el mismo dueño, idempotente), `full` o `unavailable`. `release_delivery_slot` libera por dueño. Solo `service_role` las ejecuta: la llamará el checkout (S10); `quote_shipping` solo **lee** y avisa que la franja «todavía no queda reservada».

## Panel `/admin/envios`

Cinco pestañas: **Tienda y métodos** (ubicaciones con mapa, origen principal, métodos y recojo), **Zonas** (ciudades o radio, permitida/bloqueada), **Tarifas** (editor de tramos con vista previa de los bordes, tarifa plana, límites por monto y vigencia, prioridad), **Entregas** (franjas por día, cupos, fechas bloqueadas, antelación) y **Simulador** (pin o dirección + monto → costo, regla aplicada, desglose y franjas, con la misma función que el cliente). Cada edición lleva la versión de la fila (`updated_at`) para no pisar cambios ajenos.

## En la bolsa (`/carrito`)

El estimador pide la ubicación (direcciones guardadas con pin si hay sesión; si no, ciudad + pin en el mapa o coordenadas escritas), muestra el costo, el plazo estimado y, si el cliente quiere, fecha y franja. **Con una estimación de envío, el resumen muestra UN solo total, rotulado «Total estimado»** (subtotal + envío; el «Total» de la bolsa, que no incluye envío, no se muestra junto a la fila «Envío» porque parecería un error; el servidor sigue calculando ese total, y el checkout de S10 lo llenará con el envío real). Mientras se recalcula (cambio de cantidad, de destino o de franja) **no se muestra el costo anterior**. La ubicación se recuerda **solo en la memoria de la página** (al recargar se pierde): no se guarda en el navegador ni en la cuenta, porque es un dato personal. Todo el estimador carga bajo demanda.

## Qué NO está hecho

- El checkout que **usa** el costo y reserva el cupo es S10; el pedido guardará el snapshot.
- Integración con transportistas y tracking, envíos internacionales (S18), etiquetas (S14).
- Ruteo real (por calles): hoy es línea recta × factor, ajustable.

## Límites conocidos y decisiones abiertas

Salen de la revisión independiente del sprint (agente sin contexto, solo lectura) y de las pruebas. Lo corregido está en `Sprints/SPRINT_08_Envios.md`; esto es lo que **no** se corrigió y por qué.

1. **La cobertura «por ciudad» se decide con un texto que escribe la clienta.** Una zona de ciudades permitida solo cuenta si la ciudad coincide; una zona **bloqueada por ciudad** se evade escribiendo otra ciudad o ninguna (`p_city` es opcional en la función pública). Y una ciudad válida con un pin absurdo (otro continente) pasa la cobertura. **Mitigación hoy:** las tarifas se **atan a una zona de radio** (así el pin tiene que caer en ella; el seed de ejemplo ya lo hace: fuera de 25 km da `no_rate`), y **para bloquear una zona se usa el radio**, que sí mira el pin. Una cobertura por ciudad verdaderamente confiable exigiría derivar la ciudad del pin (geocodificación inversa) o validar la dirección al crear el pedido (S10).
2. **La ciudad y el pin no se cruzan** (misma causa). El caso «pin en el mar o lugar absurdo» del sprint queda cubierto solo si la tarifa va atada a una zona de radio.
3. **Privacidad del origen.** `quote_shipping` es pública y devuelve distancias (`distance_km`, `breakdown.straight_km`, factor de ruta): con tres cotizaciones desde puntos conocidos se puede **deducir dónde está el origen** (≈ 10 m). Si el recojo apunta a la ubicación principal, además se publican sus coordenadas (`pickup.lat/lng`, a propósito: la clienta tiene que llegar). Si el origen fuese un **domicilio**, usa para el recojo otra ubicación pública, o decide quitar el desglose de la respuesta a visitantes (**no está hecho**: el simulador del panel necesita seguir viéndolo como administrador, así que habría que distinguir el rol dentro de la función). *Decisión del dueño: ¿el origen es un domicilio?*
4. **El monto del pedido lo manda el cliente** (`p_order_amount`): quien llame directo a la función elige regla poniendo el monto que quiera (p. ej. uno enorme para una regla «gratis desde X»). **Contrato para S10:** el servidor **recalcula** con el subtotal del carrito del servidor y nunca confía en este monto ni en el costo que muestre la pantalla.
5. **Ajustes que se contradicen.** El servidor valida cada ajuste por separado: se puede guardar una antelación de 720 h con un tope de 5 días y entonces ninguna franja se ofrece. El panel de Entregas ya **avisa** (la antelación llega más allá del último día permitido); la base no lo impide (cambiarlos de a uno obligaría a un orden de guardado).
6. **Reservas (deberes de S10).** `delivery_bookings` no caduca: una reserva de tipo `cart` de una bolsa abandonada retiene cupo hasta que alguien la libere. Un mismo dueño puede tener reservas activas en varias franjas, y `release_delivery_slot` libera **todas** las del dueño, así que «cambiar de franja» (liberar y reservar) no es atómico y puede dejar sin cupo; hace falta una función «mover» o liberar una sola. El panel tampoco avisa de pedidos ya reservados al archivar o cambiar una franja, y la reserva no guarda el horario (snapshot).
7. **Distancia mostrada y distancia cobrada.** La ruta se redondea a 2 decimales para mostrarla, pero el tramo se decide con la ruta sin redondear: una ruta de 3,004 km se ve «3,00 km» y cobra el tramo siguiente. Es solo presentación, en el borde.
8. **Bolsa:** el estimador solo cotiza el método `delivery` (elegir entre domicilio y recojo es del checkout, S10; `public_shipping_methods` aún no tiene consumidor en la tienda); con destino elegido pero una bolsa sin nada cobrable la fila dice «Se calcula al elegir tu dirección».
9. **Panel:** el editor de tramos acepta tarifas absurdas pero válidas (costos decrecientes, un máximo menor que todos los tramos, un mínimo mayor que el primero) sin avisar; los errores de CHECK de la base llegan con el texto genérico «Algún dato no cumple las reglas permitidas».
10. **Mapas (licencias):** el buscador envía lo que escribe la clienta, también invitada, a Nominatim (OpenStreetMap) y las teselas se piden a `tile.openstreetmap.org`. Es de S6 pero ahora es alcanzable sin cuenta; el uso público de Nominatim tiene una política restrictiva. **«Validar costos y licencias de proveedores de mapas» sigue abierto** (SPRINT_08, Revisión).
11. **Rendimiento:** cada cotización lista hasta 31 días de franjas (hasta ≈ 1 200 consultas con 10 franjas por día) y la función es pública sin límite de tasa propio; ya no se listan cuando el destino o la tarifa fallan. No hay prueba de rendimiento con muchas reglas o zonas.
12. **Pruebas:** no hay casos de Haversine para El Alto ni Santa Cruz (el sprint los pide), de reglas por moneda (una cotización en otra moneda habilitada da `no_rate` con un mensaje que habla de cobertura), de fechas infinitas ni de carreras entre dos `admin_set_primary_location`. La prueba de integración exige un origen principal cargado y deja filas archivadas (nada se borra); si el dueño pone una zona sin servicio de radio alrededor de su origen la rompe.

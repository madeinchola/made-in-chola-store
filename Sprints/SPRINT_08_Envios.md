# Sprint 8 — Envíos y entregas programadas

**Release:** R2 · **Estimación:** 4 días · **Depende de:** S3 (panel/ajustes), S6 (direcciones con lat/lng, mapa), S7 (carrito con punto de extensión de envío)

## Objetivo
Cotizar el costo de envío **por distancia** con un modelo de reglas extensible, permitir **entregas programadas** y dejar todo configurable por el admin, pues varias decisiones (transportistas, zonas, recojo) llegan después.

## Alcance
**Dentro:** ubicación de la tienda, motor de reglas de envío, `quote_shipping`, zonas de cobertura/bloqueo, franjas de entrega y fechas bloqueadas, UI admin de configuración y simulador, integración al carrito (totales).
**Fuera:** integración con APIs de transportistas y tracking (post-lanzamiento, cuando el admin elija), envíos internacionales y aduanas (S18), etiquetas/guías (S14).

## Reglas de negocio cubiertas
BR-SHP-01, BR-SHP-02, BR-SHP-03 (configurable), BR-PRC-07 (envío gratis sobre monto), D-04, S-08.

## Tareas

### BD
- [ ] `store_locations` (nombre, dirección, lat/lng, activo); origen principal único.
- [ ] `shipping_zones` (nombre, tipo `polygon|radius|city|list`, geometría/parámetros, `allowed bool`, país) — soporta **zonas sin cobertura**.
- [ ] `shipping_rate_rules` (tipo `distance|weight|flat|zone|order_amount`, parámetros jsonb, prioridad, moneda, activo, vigencia).
- [ ] `delivery_slots` (día de semana, franjas, cupo, antelación mínima/máxima) y `blocked_dates` (feriados/cierres).
- [ ] `shipping_methods` (id, nombre, tipo `delivery|pickup`, activo, ETA) — preparado para varios métodos/transportistas.
- [ ] RPC `quote_shipping(cart_id|items, address_id|lat/lng, method, delivery_date)` → `{cost, currency, eta, breakdown, available_slots, errors[]}`; **determinista y auditable** (devuelve qué regla aplicó).
- [ ] RPC `reserve_delivery_slot` con cupo atómico (o validación al crear pedido en S10).
- [ ] Distancia: Haversine × factor de ruta configurable (fase 1); interfaz `DistanceProvider` para ruteo real luego.

### Admin (reutilizando componentes de S3)
- [ ] Configurar ubicación de tienda (mapa).
- [ ] Editor de **tramos por distancia** (0–3 km: X, 3–6 km: Y…) + tarifa base + costo por km adicional + mínimo/máximo + **envío gratis sobre monto**.
- [ ] Editor de zonas permitidas/bloqueadas (dibujo en mapa o lista de zonas).
- [ ] Franjas horarias, cupos, antelación, feriados/cierres.
- [ ] **Simulador:** ingresar dirección/pin y carrito de ejemplo → ver costo, regla aplicada y ETA.
- [ ] Marcar método "Recojo en tienda" (si el admin lo decide) con horarios.

### Cliente
- [ ] En carrito/checkout: cotización en vivo al elegir dirección o pin; selector de **fecha y franja** con disponibilidad; mensajes de "no cubrimos tu zona".
- [ ] Estados de error claros (fuera de cobertura, sin franjas disponibles, distancia no calculable).

### Integración
- [ ] Rellenar el punto de extensión de envío en los totales del carrito (S7) usando `quote_shipping`.
- [ ] Contrato estable de `quote_shipping` para S10 (se **recalcula en servidor** al crear el pedido).

## Criterios de aceptación
1. El admin configura tarifas por distancia sin ayuda y el simulador coincide con lo que verá el cliente.
2. Una dirección en zona bloqueada o fuera de cobertura no permite continuar, con mensaje claro.
3. El costo mostrado en el carrito = costo recalculado en el servidor.
4. Las franjas llenas o en fecha bloqueada no son seleccionables.
5. Cambiar reglas no afecta pedidos ya creados (snapshot en S10).

## Testing
- **Unit:** Haversine con coordenadas conocidas (La Paz/El Alto/Cochabamba/Santa Cruz), tramos en los **límites exactos** (3.00 km ¿pertenece a qué tramo?), mínimo/máximo, gratis sobre monto, prioridad de reglas, redondeo a 2 decimales.
- **SQL/RLS:** lectura pública solo de lo necesario (cobertura/ETA), escritura solo admin.
- **Integración:** `quote_shipping` con múltiples reglas superpuestas; slots con cupo bajo concurrencia.
- **E2E:** cotizar en distintas ubicaciones, zona bloqueada, cambiar fecha/franja, regla modificada por admin y cotización actualizada.
- **Propiedad/fuzz:** coordenadas aleatorias (incluyendo extremos/NaN) nunca devuelven costo negativo ni excepción.
- **Rendimiento:** tiempo de cotización con muchas reglas/zonas.

## Edge cases
- Dirección sin lat/lng (de S6, anterior) → pedir ubicar en mapa.
- Pin en el mar/lugar absurdo; coordenadas inválidas; distancia 0.
- Punto dentro de varias zonas con reglas contradictorias → prioridad determinista y documentada.
- Reglas inactivas o vencidas; ninguna regla coincide → error controlado (no costo 0 silencioso).
- Envío gratis sobre monto con **cupón** que baja el total por debajo del umbral (orden de cálculo definido junto con S9).
- Carrito cambia después de cotizar → recotizar.
- Cupo de franja se llena mientras el cliente completa el formulario.
- Fecha seleccionada pasa a ser feriado; zona horaria `America/La_Paz` vs UTC; cambio de día a medianoche.
- Entrega programada con antelación mínima (hoy a las 23:50).
- Cambio de moneda: tarifas en BOB vs. otras monedas (conversión o reglas por moneda).
- Pedido grande/pesado cuando exista regla por peso (extensible).
- Servicio de ruteo caído → fallback a Haversine con aviso interno.
- Recojo en tienda: costo 0 y sin dirección; horarios de la tienda.
- Cliente cambia de dirección tras elegir franja.

## Revisión
- [ ] Checklist universal.
- [ ] Revisión del orden de cálculo (subtotal → descuentos → envío → total) con S9/S10.
- [ ] Revisión del admin con la persona real: ¿entiende los tramos y el simulador?
- [ ] Revisión de consultas geoespaciales (índices; considerar PostGIS si hay polígonos).
- [ ] Validar costos/licencias de proveedores de mapas.

## Riesgos
- Distancia en línea recta ≠ ruta real → factor configurable y ruta real como mejora.
- Muchos parámetros pendientes del admin → defaults razonables y todo editable.

## Pendientes externos
Origen del cálculo, tarifas, zonas sin cobertura, franjas y feriados, recojo en tienda (PENDIENTES_ADMIN §B).

## Entregables para sprints siguientes
`quote_shipping` estable, `delivery_slots`, configuración admin de envíos, totales con envío, contrato para snapshot de envío en pedidos.

---

## Decisiones del admin que afectan a este sprint (2026-10-28)
Fuente: `docs/admin/Cuestionario_Admin_RESPONDIDO.pdf` y [../PENDIENTES_ADMIN.md](../PENDIENTES_ADMIN.md).
- Entrega con **delivery propio y courier** (DHL internacional; messenger/courier de Bolivia; "a convenir": encomienda o moto): transportistas y métodos configurables.
- **Sin envío gratis por monto** (3.3). El "Free Shipping" del checkout del diseño es de ejemplo; no usarlo por defecto.
- **Solo ciudades, no pueblos** (3.4): la zona de entrega es una lista blanca de ciudades editable desde el admin. **Falta la lista de ciudades.**
- **Tarifas por distancia: en blanco** (3.2) y "a convenir": sin ellas no se puede calibrar `quote_shipping`. Pendiente definir si habrá tarifa manual por pedido.
- DHL internacional implica envíos fuera de Bolivia: confirmar si es desde el lanzamiento (el plan lo deja para S18).

---

## Estado real de entrega (2026-11-06)

**Entregado:** `quote_shipping` (determinista y auditable: dice qué regla aplicó y cómo llegó al costo; nunca un costo 0 por omisión), tarifas por distancia con tramos de borde superior **inclusivo**, km adicional, mínimo y máximo, tarifa plana, límites por monto y vigencia, prioridad determinista; zonas por ciudad o por radio con zonas **sin servicio** que bloquean siempre; método de recojo; franjas por día con cupo, fechas bloqueadas, antelación y tope de días (`America/La_Paz`); cupo atómico (`reserve_delivery_slot`/`release_delivery_slot`, solo `service_role`); vista pública `public_shipping_methods` sin coordenadas; panel `/admin/envios` (Tienda y métodos, Zonas, Tarifas, Entregas, Simulador); estimador de envío en `/carrito` con ubicación (pin o coordenadas), costo, plazo, «Total estimado» y fecha/franja opcional. Detalle en `docs/envios.md`. **Los valores cargados son de ejemplo** (marcados «(ejemplo)», en el bloque «Envíos (S8)» de `supabase/seed.sql`): el dueño aún no respondió `PENDIENTES_ADMIN §B`.

**Lo que dejaron los cuatro subagentes de interfaz (cortados por el límite de 5 h; el mapa de agentes los muestra con error 429):** las cinco pantallas del panel y el estimador de la bolsa estaban escritos y funcionaban, pero **«Tarifas» no tenía ninguna prueba de componente** (el agente se cortó ahí; solo existían pruebas de su lógica y de los mensajes). Se escribió `RatesPage.test.tsx` (22 pruebas: lista y estados, orden, resúmenes, zonas inutilizables, selector de métodos, crear tarifa fija / «envío gratis» / por distancia con los valores exactos enviados, validación y foco, decimales, error de la base, editar con la versión leída, conflicto de edición, archivar con aviso de «única tarifa activa», restaurar) y se comprobó con **12 mutantes** del código de producción, todos detectados.

**Cómo se hizo:** base de datos, pruebas SQL, capa de datos del panel y del cliente, editor de tramos y el contrato SQL↔TS por mí; las pantallas del panel y el estimador por cuatro subagentes (cortados por el límite de uso: dejaron trabajo útil pero con 4 pruebas rotas y errores de tipos, que se corrigieron); una revisión independiente (agente sin contexto, solo lectura); mutaciones en SQL (47 + 16 mutantes) y en la interfaz. Todo se probó **contra la nube** (sin base local ni Docker), con la migración y el seed ya aplicados.

**Desviaciones respecto al plan (y por qué):**
- **Zonas solo `city` y `radius`** (el plan decía `polygon|radius|city|list`): el dueño pidió «solo ciudades» y un radio basta; no hay dibujo de polígonos en el mapa. Reglas solo `distance` y `flat`; **no hay regla por peso** (cuando exista, es un tipo nuevo). «Zona» y «monto del pedido» son **condiciones** de una regla, no tipos.
- **`quote_shipping` recibe punto, ciudad, monto, método, fecha y franja**, no `cart_id|address_id`: el cliente le pasa lo que ya sabe y el servidor del checkout (S10) la recalcula con el monto real del pedido.
- **Distancia: Haversine × factor en SQL**; **no existe la interfaz `DistanceProvider`** del plan. Cambiar a ruteo real implica reescribir esa parte de la función (hoy está aislada en un cálculo).
- **Antelación y tope de días son ajustes globales**, no por franja.
- **Envío gratis sobre un monto: no es un campo**, es una regla plana de costo 0 con monto mínimo; **no hay ninguna cargada** (decisión del dueño, 3.3).
- **El envío NO entra en los totales del servidor de la bolsa**: el servidor lo llenará en S10. La bolsa muestra una **estimación** («Total estimado», un solo total a la vista) que el pedido recalcula.
- **El selector de franja en la bolsa solo comprueba disponibilidad**; la reserva real ocurre al crear el pedido (S10).

**Bugs reales encontrados por las pruebas y corregidos:**
- *Leaflet lanzaba `Cannot read properties of undefined (reading '_leaflet_pos')`* al confirmar la ubicación escrita (el cajón destruye el mapa mientras anima el zoom; `map.remove()` no baja `_animatingZoom` y el temporizador de 250 ms leía un panel borrado): el visitante veía «Algo salió mal». Lo halló una captura de pantalla; se corrigió en `LeafletMap` (sirve también al selector de direcciones de S6) y lo vigilan una prueba unitaria y el E2E (ambas detectan el defecto al quitar el arreglo).
- *El foco no iba al aviso del pin en el primer intento* (el aviso aún no existía): `flushSync` en `DestinationSheet`.
- *El resumen mostraba «Total Bs 60,00» justo debajo de «Envío Bs 20,00»*: con una estimación ahora se muestra un solo total.
- *La entrada pública pasó de 270 kB gzip (274,2)* por los textos del panel: el diccionario del panel se carga ahora con el panel (−22 kB; 256,9 kB), con una prueba E2E que falla si falta el registro.
- *Pruebas existentes que había que ampliar a propósito:* listas blancas de `05_estructura_seguridad` (tablas, funciones y vistas nuevas) y el número de ajustes de `06`. Al revisarlas se **quitó EXECUTE a anon/authenticated de `haversine_km` y `_ship_norm`** (solo las usan funciones `SECURITY DEFINER`).
- *La auditoría de la nube ya trae filas de otras corridas*: la prueba pgTAP cuenta la **diferencia**, no el total.
- *Mi prueba de concurrencia por HTTP (30 peticiones) NO detectaba un candado ausente* (el mutante sin `for update` sobrevivió): se reemplazó por una con dos sesiones, la primera sin confirmar; esa sí falla sin el candado.

**Revisión independiente (agente sin contexto, solo lectura; 25 hallazgos, ninguno crítico).** Cada uno se verificó antes de actuar.
- *Corregidos:* `reserve_delivery_slot` lanzaba una excepción con `owner_type` nulo (ahora `invalid`); cada cotización fallida listaba hasta 31 días de franjas (ahora solo con destino y tarifa válidos); **el simulador del panel no podía elegir la franja de la segunda semana** (el servidor repite el mismo `slotId` cada día y la opción se identificaba solo por él: ahora día + franja); el «Total estimado» ignoraba el descuento de S9 (ahora parte de `totals.total`); el estimador seguía con el costo del subtotal anterior mientras había cambios sin confirmar (ahora se atenúa y se marca ocupado); el resumen pegajoso podía crecer más que la pantalla y dejar «Pagar» fuera de alcance (ahora tiene altura máxima y se desplaza); un monto de tarifa con más de 2 decimales lo redondeaba la base en silencio (ahora se rechaza); ajustes que se contradicen (antelación mayor que todo el periodo) dejaban la bolsa sin fechas sin avisar (ahora el panel de Entregas avisa); el reloj no era inyectable, así que la zona horaria y la antelación exacta no se probaban de forma determinista (`_ship_slot_ok` recibe un `p_now` opcional, interno; ahora hay pruebas con relojes fijos: medianoche en La Paz contra UTC, antelación exacta, 23:59:59); aserciones débiles (404 aceptado como «permiso denegado», una tautología, una prueba que «pasaba» al omitirse, una espera fija de 3 s en la prueba del candado, una errata) y casos sin cubrir (desempate por id, tarifa plana de costo 0 dentro de la cotización —el «envío gratis»—, permisos de `anon`).
- *Mitigado:* la cobertura por ciudad es texto del cliente y no se cruza con el pin (la tarifa de ejemplo ahora va atada a la zona de radio; para bloquear se usa el radio).
- *Documentado como límite o decisión del dueño/S10, NO corregido* (`docs/envios.md`, «Límites conocidos»): las distancias que devuelve la cotización pública permiten deducir el origen; el monto del pedido lo manda el cliente (S10 debe recalcular); reservas sin caducidad y sin «mover franja»; distancia mostrada redondeada frente a la cobrada en el borde; el estimador solo cotiza `delivery`; tarifas absurdas pero válidas sin aviso; licencias de Nominatim; rendimiento sin medir; casos de El Alto/Santa Cruz y de monedas sin probar.
- *Sin hallazgo:* SQL sin inyección y con `search_path` fijo; grants mínimos; entradas hostiles (NaN, infinitos, desbordes) sin excepción; concurrencia de `reserve_delivery_slot` correcta; privacidad del destino en el cliente; carreras de respuestas del estimador; accesibilidad; registro del diccionario del panel antes de cualquier lectura de `admin.*` (el revisor señala que 17 módulos de productos y taxonomía llaman `t("admin.…")` al cargarse —esquemas zod— y dependen del orden de carga del router: es frágil a futuro, no un defecto hoy).

**Verificación (2026-11-06):**
- **Unitarias:** 4699 en 214 archivos (S7: 3830 / 184), con tipos, lint `--max-warnings=0` y Prettier limpios.
- **pgTAP:** 1820 aserciones en 16 archivos (S7: 1577 / 15; `15_s8_envios`: 243), todas verdes **contra la nube** (con los datos de ejemplo cargados).
- **Integración contra la nube:** 15 pruebas nuevas (`shipping.integration.test.ts`: cotización por el cliente real y `parseQuote`, vista pública sin coordenadas, cupo restante, 30 reservas simultáneas, candado con dos sesiones). El resto de la tanda de integración **no se repitió** en esta sesión.
- **Mutación:** SQL: 47 mutantes en la primera vuelta (36 detectados; 9 supervivientes y 2 que abortaban la prueba por un error de ejecución, p. ej. una reserva no idempotente → clave duplicada), lo que llevó a **reforzar la prueba pgTAP** (monto máximo exacto, borde del radio con una coordenada a 2,06 km calculada aparte, moneda existente pero deshabilitada, recojo con ubicación inactiva, tope de 31 días de la lista); en la segunda vuelta **todos fueron detectados salvo uno equivalente** (`origen: acepta inactivo`: un CHECK ya impide un origen inactivo, el filtro es defensa en profundidad), más 4 mutantes de la vista pública (todos detectados; uno más, el `ORDER BY` de la vista, se eliminó por no ser un contrato). El candado del cupo se mutó **en la nube** y se restauró (detectado por la prueba de dos sesiones, **no** por la de 30 peticiones). Una **tercera vuelta de 6 mutantes de las funciones** tras la revisión (zona horaria en UTC, antelación exacta exclusiva, reloj ignorado, `owner_type` nulo, desempate por id descendente, franjas listadas siempre): todos detectados. Interfaz: editor de tramos (mutantes probados), registro del diccionario del panel (detectado por el E2E) y el arreglo de Leaflet (detectado por la unitaria y el E2E).
- **E2E (Chromium móvil + escritorio, contra la nube):** `e2e/shipping.spec.ts` (estimador: costo y total con envío, fuera de cobertura sin total, coordenada mal escrita con foco, accesibilidad AA con axe, sin desbordes a 360 px, sin errores no controlados) y `e2e/admin-shipping.spec.ts` (las cinco pestañas con sus textos reales, el simulador, y una zona sin servicio creada en el panel que bloquea la cotización y, al archivarla, la devuelve). Los E2E del panel **no crean cuentas**: entran con una de las 4 cuentas admin de prueba existentes. **E2E de direcciones de la cuenta (S6, 15 pruebas en escritorio; usan el mismo selector de mapa que el estimador, que se tocó: arreglo de Leaflet y texto de ayuda opcional) re-ejecutados: todos verdes** (dejaron 18 clientas de prueba en la nube, que el vaciado de entrega elimina). **E2E del carrito de S7 (15 por proyecto, escritorio y móvil) re-ejecutados:** dos estaban desactualizados y se corrigieron (el texto de la fila de envío lo cambió S8 a propósito, y un localizador estricto estaba roto desde el cierre de S7 porque la región viva `sr-only` repite «Tu bolsa está vacía»).
- **Valores calculados a mano, comprobados contra la nube:** sobre el origen, Bs 15,00; a 4 km en línea recta (ruta 5,2 km), Bs 20,00; a 9 km (ruta 11,7 km), 30 + 3 × 1,7 = Bs 35,10; Cochabamba (≈ 233 km; ruta 303,76 km): fuera de cobertura; recojo: Bs 0.
- **Peso:** entrada pública gzip **256,9 kB** (`index` 73,4 + `App` 183,5; S7: 264,5; presupuesto 270). **CLS de `/carrito` con el estimador:** 0,015 (móvil) y 0,032 (escritorio) en el sitio local contra la nube.

**Criterios de aceptación:**
1. *El admin configura tarifas por distancia sin ayuda y el simulador coincide con lo que verá el cliente:* **cumplido en lo técnico** (misma función; E2E del simulador y de una zona nueva); **«sin ayuda» no está probado con la persona real** (revisión del admin pendiente).
2. *Una dirección en zona bloqueada o fuera de cobertura no permite continuar, con mensaje claro:* **cumplido en el estimador** (error claro y sin total); el **bloqueo de «Pagar»** lo hará el checkout (S10).
3. *El costo mostrado en el carrito = costo recalculado en el servidor:* **cumplido por diseño** (misma función); el recálculo al crear el pedido es de S10.
4. *Las franjas llenas o en fecha bloqueada no son seleccionables:* **cumplido** (pgTAP, integración y componentes).
5. *Cambiar reglas no afecta pedidos ya creados:* **pendiente de S10** (el pedido guardará el snapshot; aún no hay pedidos).

**Pendiente (no hecho / no verificado):**
- **Valores reales** de origen, ciudades, tarifas, franjas, feriados y recojo (SPRINT_19, sección M) y decidir el factor de ruta con entregas reales.
- **Revisión del panel con la persona real** (¿entiende los tramos y el simulador?). En móvil las tablas del panel hacen desplazamiento horizontal (como el resto del panel).
- **No probado:** el resto de los E2E de cuenta (solo se re-ejecutó `account-addresses`, ver arriba), teléfono real, VoiceOver/TalkBack, Lighthouse (no se repitió), los E2E antiguos del panel (`admin.spec.ts` y demás: crean administradores nuevos, no se ejecutaron) tras mover el diccionario del panel (lo cubre el E2E nuevo), la tanda completa de integración, y la carga con muchas reglas/zonas (rendimiento).
- **Código menor:** no hay `DistanceProvider`; un servicio de ruteo caído no tiene fallback (no existe servicio); `delivery_slots` no tiene antelación propia.

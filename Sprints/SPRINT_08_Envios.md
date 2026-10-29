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

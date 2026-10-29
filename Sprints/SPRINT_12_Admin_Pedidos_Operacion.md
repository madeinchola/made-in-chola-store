# Sprint 12 — Admin de pedidos y operación

**Release:** R3 · **Estimación:** 6 días · **Depende de:** S10 (pedidos/estados), S11 (pagos)

## Objetivo
Que los 2 admins gestionen el día a día: ver y avanzar pedidos, editarlos, crear pedidos manuales (ventas por WhatsApp), cancelar y reembolsar, administrar la lista negra y gestionar incidencias de entrega.

## Alcance
**Dentro:** bandeja de pedidos, detalle, transiciones de estado, edición de pedidos, pedidos manuales, cancelaciones y reembolsos (monto efectivamente pagado), devoluciones según política del admin, lista negra, contra entrega (cobrado/rechazado), incidencias, historial y auditoría.
**Fuera:** notificaciones salientes (S13), reportes (S14), facturación (S17).

## Reglas de negocio cubiertas
BR-ORD-01..04, BR-ORD-06, BR-PRC-03/04 (reversión de cupón y reembolso), BR-PAY-05, BR-PAY-07, BR-ADM-03, BR-SHP-03 (incidencias), S-05, S-06, S-07.

## Tareas

### BD
- [ ] `refunds` (order_id, payment_id, monto ≤ pagado, motivo, estado `requested|approved|processed|rejected`, método, procesado_por).
- [ ] `returns` + `return_items` (order_item_id, cantidad, motivo, estado, reingreso a stock `si|no|inspección`) — configurable según política que defina el admin.
- [ ] `blacklist_entries` (profile/teléfono/email, motivo, activo, creado_por, fechas) + función `is_blacklisted()` consumida por `create_order`.
- [ ] `order_notes` (internas) y `order_incidents` (tipo `lost|damaged|wrong_address|absent|rejected`, estado, costo asumido, resolución).
- [ ] RPC `admin_edit_order` (cambiar ítems/cantidades/dirección/envío antes de `shipped`): **recalcula** totales, ajusta stock con movimientos y deja **diff auditado**; bloqueada en estados finales.
- [ ] RPC `admin_create_manual_order` (cliente existente o alta rápida, canal `manual|whatsapp`, método de pago, descuentos manuales con motivo) reutilizando `create_order` internamente.
- [ ] RPC `refund_order` (total o parcial) que: calcula el reembolso = **monto pagado** prorrateando descuentos entre ítems devueltos, repone stock si corresponde, revierte uso de cupón si el pedido se cancela completo, llama `PaymentProvider.refund` o registra reembolso manual.
- [ ] Alertas de pedidos `pending_payment` antiguos (WhatsApp/contra entrega, S-05).

### Admin UI
- [ ] **Bandeja de pedidos:** filtros (estado, fecha, método de pago, canal, cliente, número), búsqueda, ordenamiento, contadores por estado, acciones masivas (marcar preparando, exportar) y atajos para el flujo típico.
- [ ] **Detalle del pedido:** cliente, dirección en mapa, ítems (con imagen), totales, pagos y comprobantes, historial/línea de tiempo, notas internas, acciones permitidas según estado.
- [ ] Avanzar estado con un clic y confirmación (con **deshacer** limitado dentro de una ventana segura cuando sea posible).
- [ ] **Editar pedido** con vista previa del diff de totales/stock antes de confirmar.
- [ ] **Crear pedido manual** (flujo guiado para quien atiende WhatsApp).
- [ ] **Cancelar y reembolsar** con asistente (cuánto, por qué, a dónde) y resumen del impacto (stock, cupón, dinero).
- [ ] **Contra entrega:** registrar *cobrado*/*rechazado*; el rechazo registra costo asumido (BR-PAY-07) y sugiere añadir a lista negra.
- [ ] **Lista negra:** alta/baja con motivo, ver pedidos relacionados, efecto (S-07 bloquea contra entrega y pedidos manuales).
- [ ] **Incidencias** de entrega con seguimiento y resolución.
- [ ] Vistas de "atención requerida": pagos por revisar, pedidos antiguos sin confirmar, stock insuficiente tras edición.

## Criterios de aceptación
1. El admin procesa un pedido de `pending_payment` a `completed` solo con la bandeja y el detalle.
2. Editar un pedido recalcula totales y stock correctamente y queda auditado.
3. Un pedido manual creado por WhatsApp descuenta stock, genera número `MIC-…` y respeta lista negra/validaciones.
4. Reembolso = lo realmente pagado; parcial prorratea descuentos; no se puede reembolsar más de lo pagado ni dos veces.
5. Cliente en lista negra no puede usar contra entrega.
6. Ninguna acción de admin es posible sin rol admin (RLS + RPC).

## Testing
- **Unit:** prorrateo de reembolso (con cupón %, cupón monto fijo, 2x1, envío gratis, redondeo con centavos sobrantes), transiciones permitidas por estado, cálculo de diff de edición.
- **SQL/Integración:** `admin_edit_order` bajo concurrencia con una compra del mismo stock; `refund_order` idempotente (doble clic/doble admin); cancelación + reposición de stock + reversión de cupón; manual order con lista negra.
- **RLS:** cliente no ve notas internas ni lista negra; admin completo.
- **E2E:** flujo diario completo (nuevo pedido → pago → preparar → enviar → entregar → completar); cancelación con reembolso parcial; pedido manual; contra entrega rechazado → lista negra.
- **Auditoría:** cada acción deja registro con actor y diff.
- **Usabilidad:** sesión con admin real cronometrando tareas comunes.
- **Resiliencia:** reembolso al proveedor falla a mitad (estado `requested` con reintento seguro, sin doble reembolso).

## Edge cases
- Reembolso parcial de un pedido con cupón: monto proporcional y centavos de redondeo.
- Reembolso de pedido con envío gratis condicionado por monto (el cliente deja de cumplir el umbral al devolver parte).
- Reembolso de pedido pagado en efectivo contra entrega (devolución manual, sin proveedor).
- Editar pedido ya `paid`: diferencia a favor/en contra del cliente (cobrar extra/reembolsar).
- Editar cantidades sin stock; variante archivada desde el pedido original.
- Cambiar dirección tras asignar franja de entrega; cupo de franja.
- Dos admins editan/avanzan el mismo pedido a la vez → bloqueo optimista y mensaje.
- Cliente cancela justo cuando el admin lo pasa a `preparing`.
- Devolución con producto dañado (no vuelve a stock), producto sin etiqueta, fuera de plazo (política del admin).
- Cliente en lista negra con pedidos abiertos; persona intenta evadir con otra cuenta (mismo teléfono/dirección → coincidencias sugeridas).
- Pedido manual para cliente sin cuenta (alta rápida con teléfono) → alinear con BR-ACC-01 creando cuenta mínima.
- Incidencia (paquete perdido) tras estado `delivered`; reapertura de pedido completado.
- Importes en moneda no BOB (preparación multi-país).
- Reembolso a un método ya no disponible/cuenta cerrada.

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de matriz de transiciones y permisos con el dueño.
- [ ] Auditoría de funciones `SECURITY DEFINER` y locks.
- [ ] Revisión contable del manejo de reembolsos (con quien lleva la contabilidad).
- [ ] Revisión UX: textos claros, confirmaciones en acciones destructivas.

## Riesgos
- Política de devoluciones aún sin definir → implementar flujo configurable y activarlo cuando el admin la redacte.
- Complejidad de prorrateo → tests de propiedad (la suma de reembolsos parciales nunca excede lo pagado).

## Pendientes externos
Política de devoluciones/cambios, criterios de lista negra, quién asume cada costo en incidencias (PENDIENTES_ADMIN §B, §C, §D).

## Entregables para sprints siguientes
Operación completa de pedidos, reembolsos, lista negra, eventos de estado fiables para S13, datos fiables de utilidad/devoluciones para S14, base de notas de crédito para S17.

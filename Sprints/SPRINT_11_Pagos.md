# Sprint 11 — Pagos: QR boliviano y capa de proveedores

**Release:** R3 · **Estimación:** 5 días · **Depende de:** S10 (pedidos, `payments`, `PaymentProvider`, estados)

## Objetivo
Cobrar con **QR boliviano** (manual con comprobante y vía API, p. ej. CobraFácil) con ventana de **10 minutos**, conciliación automática y revisión manual, sobre una capa de proveedores intercambiable lista para Stripe, Mercado Pago y PayPal.

## Alcance
**Dentro:** proveedor `manual_qr` (cliente sube comprobante, admin aprueba/rechaza), proveedor `cobrafacil` (o el que se elija) con webhooks, ventana de pago de 10 min con expiración, conciliación, tratamiento de duplicados/parciales/contracargos, UI cliente y admin de pagos, registro de eventos.
**Fuera:** Stripe/MP/PayPal reales (S18), reembolsos operativos completos (S12; aquí se deja el método `refund` del provider), facturación (S17).

## Reglas de negocio cubiertas
BR-PAY-01..06, BR-DAT-03, BR-ORD-01, S-05, S-06, D-03.

## Tareas

### BD
- [ ] Completar `payments` (provider, method, amount, currency, status `initiated|pending|paid|failed|expired|refunded|disputed`, `external_id`, `idempotency_key`, `raw jsonb`, `expires_at`).
- [ ] `payment_proofs` (payment_id, `file_path` en bucket **privado**, hash del archivo, estado `pending|approved|rejected`, motivo, revisado_por/fecha).
- [ ] `webhook_events` (provider, `event_id` único, firma verificada, payload, procesado, intentos) → **idempotencia**.
- [ ] Ajustes de pago por país: métodos habilitados, datos de la cuenta/QR, ventana (10 min), proveedor activo.
- [ ] Cron `expire_pending_payments` (cada minuto): `pending_payment` con ventana vencida → `cancelled` + liberar stock + revertir cupón + outbox.
- [ ] Cron `reconcile_payments` (cada N min): consulta al proveedor los pagos `pending` próximos a vencer o recién vencidos para capturar webhooks perdidos; un pago llegado **tras** vencer → pedido en revisión manual (no se pierde dinero).
- [ ] Reglas S-06: duplicado → excedente a reembolso/crédito + alerta; monto menor/mayor → queda `pending_payment` + alerta; contracargo → `disputed` + alerta.

### Edge Functions
- [ ] `payment-create` (inicia cobro con el proveedor activo del país/método; devuelve QR/instrucciones).
- [ ] `payment-webhook-<provider>`: verifica **firma**, registra en `webhook_events`, procesa idempotente, llama `transition_order_status`.
- [ ] `payment-reconcile` (cron) y `payment-proof-review` (acción admin con auditoría).
- [ ] Implementaciones `manual_qr` y `cobrafacil` bajo la interfaz común; mapeo de estados del proveedor → estados internos.
- [ ] Gestión de secretos del proveedor solo en Supabase secrets.

### Frontend
- [ ] Pantalla de pago QR: QR, monto exacto, instrucciones, **cuenta regresiva de 10 min**, botón "Ya pagué / Subir comprobante" (manual) o auto-detección por polling/Realtime (API).
- [ ] Subida de comprobante (imagen/PDF, límite de tipo/tamaño, vista previa, reintento).
- [ ] Estados: pendiente de verificación, pago confirmado, rechazado (con motivo y opción de reintentar), expirado (reintentar si hay stock).
- [ ] Admin: bandeja de **comprobantes por revisar** con vista del archivo, monto/pedido, aprobar/rechazar con motivo; vista de pagos con filtros y detalles del evento.
- [ ] Reintentar pago de un pedido (misma orden, nuevo `payment` con nueva ventana) si aún hay stock.

## Criterios de aceptación
1. Pago por QR confirmado (webhook o aprobación admin) mueve el pedido a `paid` una sola vez, aunque el webhook llegue duplicado.
2. Sin pago en 10 minutos el pedido se cancela y el stock vuelve; el cliente lo ve y puede reintentar.
3. Un webhook perdido se recupera con la conciliación.
4. Webhooks con firma inválida se rechazan y quedan registrados.
5. Ningún archivo de comprobante es público; solo el cliente dueño y admin acceden (URL firmada).
6. Todas las decisiones de admin quedan auditadas.

## Testing
- **Unit:** mapeo de estados proveedor→interno, verificación de firma (válida/alterada/expirada), cálculo de monto esperado vs. recibido.
- **Integración con *fake provider* y sandbox del proveedor real:** pago exitoso, fallido, duplicado, parcial, exceso, tardío, reembolsado.
- **Concurrencia/idempotencia:** el mismo webhook 20 veces y en paralelo → un solo efecto; webhook vs. expiración en el mismo segundo.
- **SQL/RLS:** buckets privados, políticas de `payment_proofs`; el cliente no cambia estado de pago.
- **E2E:** flujo QR manual completo (subir comprobante → admin aprueba); QR API simulado; expiración; reintento; rechazo con motivo.
- **Seguridad:** replay de webhooks, falsificación sin firma, archivo malicioso (extensión falsa, SVG con script, archivo enorme), IDOR sobre comprobantes.
- **Resiliencia:** proveedor caído/timeouts, reintentos con backoff, circuito de falla sin bloquear la tienda.

## Edge cases
- Cliente paga **después** de vencer la ventana (stock ya liberado) → revisión manual: reasignar si hay stock o reembolsar.
- Cliente paga dos veces / monto distinto / paga desde otra cuenta.
- Comprobante falso, ilegible, reutilizado en otro pedido (hash duplicado) o de otro monto.
- El admin aprueba y otro admin rechaza el mismo comprobante a la vez → bloqueo de fila, gana el primero.
- Pedido cancelado manualmente mientras llega el pago.
- Expiración justo cuando se confirma el pago (carrera) → el pago confirmado prevalece.
- Cambio de tipo de cambio entre creación y pago (monto en BOB fijado al crear).
- QR duplicado entre pedidos si el monto es idéntico → referencia única por pedido en el cobro.
- Reloj del cliente vs. servidor en la cuenta regresiva (usar hora servidor).
- Webhook para un pedido inexistente/archivado; evento fuera de orden (pagado antes de creado).
- Proveedor cambia el formato del webhook (versionado, logs, alerta).
- Pérdida de red al subir el comprobante; subida duplicada.
- Contra entrega: pago registrado manualmente por admin al entregar (cobrado/rechazado); rechazo → costo de envío asumido por la tienda (BR-PAY-07) y posible entrada en lista negra (S12).

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de seguridad de webhooks y Storage por una segunda persona.
- [ ] Conciliación contable de prueba: pagos de sandbox vs. libro de movimientos.
- [ ] Revisión de logs: sin datos sensibles de pago.
- [ ] Prueba con dinero real de bajo monto en producción antes de abrir (cuando existan cuentas).

## Riesgos
- Disponibilidad/estabilidad del proveedor local (CobraFácil) y calidad de su documentación → capa de abstracción y modo manual como respaldo.
- Pagos tardíos y dinero "en el limbo" → alerta y proceso de revisión obligatorio.

## Pendientes externos
Elección entre QR manual y API, credenciales/sandbox, datos de la cuenta, criterios de contracargos (PENDIENTES_ADMIN §C); D-03.

## Entregables para sprints siguientes
Capa de pagos operativa (QR manual y API), webhooks idempotentes, conciliación, bandeja de comprobantes, método `refund` en la interfaz (S12), base para pasarelas internacionales (S18).

---

## Decisiones del admin que afectan a este sprint (2026-10-28)
Fuente: `docs/admin/Cuestionario_Admin_RESPONDIDO.pdf` y [../PENDIENTES_ADMIN.md](../PENDIENTES_ADMIN.md).
- Quieren QR con **confirmación automática** (4.1), pero **no tienen servicio ni banco de cobros QR**. Se construye la capa de proveedores y `manual_qr`; el modo automático queda bloqueado hasta elegir proveedor y tener credenciales.
- Pago tardío sin stock: **devolver el dinero y avisar al cliente** (4.2, de acuerdo).
- El admin pide **24 h para pagar** con aviso al cliente (4.2). Contradice la ventana de **10 min** de este documento y de BR-PAY-03. Propuesta: ventana de pago configurable en `store_settings`, 24 h para QR, con aviso y recordatorios antes de vencer; la retención de carrito de S7 sigue en 10 min. **Por confirmar**: retener stock 24 h por un pedido sin pagar puede bloquear inventario.

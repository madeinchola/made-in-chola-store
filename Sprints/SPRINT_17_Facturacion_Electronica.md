# Sprint 17 — Facturación electrónica (condicional)

**Release:** R5 · **Estimación:** 5 días (a reestimar) · **Depende de:** S12 (pedidos, reembolsos, devoluciones), S16 (sistema estable) + **respuesta del admin (D-05)**

> **Sprint condicional.** Solo se ejecuta si el admin confirma que debe emitir facturas electrónicas desde la tienda (SIN Bolivia u otra autoridad) y define el proveedor/sistema. Si la facturación se hace fuera del sistema, este sprint se reduce a **exportar datos** (ya cubierto en S14).

## Objetivo
Emitir comprobantes fiscales válidos asociados a los pedidos (y notas de crédito por devoluciones/reembolsos) a través del proveedor elegido, con trazabilidad completa.

## Alcance
**Dentro:** modelo de comprobantes, integración con el proveedor/API fiscal, emisión automática o manual según política, notas de crédito, reintentos y conciliación, UI admin, entrega al cliente.
**Fuera:** contabilidad completa, libros de compras/ventas, otros países (S18 lo extiende con adaptadores).

## Reglas de negocio cubiertas
BR-PRC-01 (desglose fiscal), BR-ACC-06 (datos fiscales), BR-ORD-06 (snapshots), BR-PRC-04 (notas de crédito), D-05.

## Tareas

### Decisiones previas (bloqueantes)
- [ ] Obligación legal real y régimen del negocio (confirmar con contador).
- [ ] Proveedor/sistema de facturación (SIN: sistema de facturación en línea o proveedor autorizado), credenciales y sandbox.
- [ ] **Cuándo se emite**: al pagar, al enviar o al entregar; y si es automática o con acción del admin.
- [ ] Qué hacer con pedidos de contra entrega (se factura al cobrar).
- [ ] Datos fiscales mínimos requeridos del cliente (NIT/CI, razón social) y si son obligatorios.

### BD
- [ ] `invoices` (order_id, número fiscal, serie, CUF/código de control según normativa, estado `draft|issued|rejected|voided`, monto, impuestos, moneda, `issued_at`, `payload`, `pdf_path`, `external_id`).
- [ ] `credit_notes` (invoice_id, refund_id, monto, motivo, estado).
- [ ] `invoice_events` (log de interacciones con el proveedor, errores, reintentos) + `webhook_events` reutilizado.
- [ ] Tabla de impuestos aplicables (tasa, nombre, vigencia) para desglosar el precio final (BR-PRC-01).
- [ ] Numeración fiscal gestionada **por el proveedor** (no inventar correlativos propios).

### Edge Functions
- [ ] Interfaz `InvoiceProvider { issue, void, creditNote, getStatus }` con adaptador del proveedor elegido (reutiliza el patrón de `PaymentProvider`).
- [ ] `invoice-issue` idempotente por pedido (nunca dos facturas del mismo pedido), `invoice-void`, `invoice-credit-note`, `invoice-reconcile` (cron para pendientes/rechazadas).
- [ ] Envío del PDF/XML por el canal de notificaciones (S13) y descarga desde "Mis pedidos".

### Admin / Cliente
- [ ] Panel de facturas: estado, reintentar, anular, reemitir con datos corregidos, exportar lote.
- [ ] Alertas de facturas rechazadas por el proveedor/autoridad.
- [ ] Cliente: descargar factura/comprobante; solicitar corrección de datos fiscales dentro de un plazo.
- [ ] Reglas de consistencia: el pedido con factura emitida bloquea ediciones de importe (S12) salvo mediante nota de crédito/anulación.

## Criterios de aceptación
1. Un pedido pagado genera una factura válida en el sandbox/producción del proveedor, sin duplicados aunque el proceso se reintente.
2. Un reembolso total o parcial genera la nota de crédito correspondiente.
3. Los importes e impuestos de la factura coinciden con el pedido al centavo.
4. Errores del proveedor no bloquean el pedido y quedan visibles y reintentables.
5. El cliente recibe/descarga su comprobante.

## Testing
- **Unit:** desglose de impuestos (precio final → base + impuesto) con redondeos, mapeo pedido→payload fiscal, validación de NIT/CI.
- **Integración con sandbox:** emisión, anulación, nota de crédito, rechazo por datos inválidos, timeouts, respuestas duplicadas.
- **Idempotencia/concurrencia:** doble emisión simultánea del mismo pedido; webhook repetido.
- **SQL/RLS:** el cliente solo ve sus facturas; admin todo; sin DELETE físico.
- **E2E:** pedido → pago → factura → descarga; devolución → nota de crédito.
- **Contable:** cuadre de totales facturados vs. ventas del dashboard (S14) en un período de prueba.

## Edge cases
- Cliente sin datos fiscales (consumidor final) / datos inválidos o con NIT inexistente.
- Cambio de datos fiscales tras emitir; refacturación.
- Reembolso parcial con descuentos prorrateados → nota de crédito coherente con S12.
- Pedido editado después de emitido (bloqueado o con anulación + reemisión).
- Diferencias de redondeo entre el pedido y el sistema fiscal (centavos) → regla única documentada.
- Proveedor/autoridad caída o en modo contingencia (emisión offline y sincronización).
- Facturas de pedidos de contra entrega rechazados (no se emite o se anula).
- Cambio de moneda (pedidos no BOB) y tipo de cambio para efectos fiscales.
- Límites de plazo para anular/emitir notas según normativa.
- Fecha/hora y zona horaria del comprobante.
- Productos con tratamiento tributario distinto (exentos) si aplica.

## Revisión
- [ ] Checklist universal.
- [ ] **Revisión del contador/asesor legal** del flujo y de los comprobantes generados.
- [ ] Revisión de seguridad de credenciales fiscales (secretos, rotación).
- [ ] Verificación de cumplimiento de retención de datos fiscales (plazos legales de conservación).

## Riesgos
- Normativa y APIs cambiantes → adaptador aislado y pruebas de contrato.
- Dependencia de la disponibilidad de la autoridad fiscal → cola y reintentos.

## Pendientes externos
Todo lo de "Decisiones previas" (PENDIENTES_ADMIN §E).

## Entregables
Facturación integrada y auditable, notas de crédito, panel de facturas.

---

## Decisiones del admin que afectan a este sprint (2026-10-28)
Fuente: `docs/admin/Cuestionario_Admin_RESPONDIDO.pdf` y [../PENDIENTES_ADMIN.md](../PENDIENTES_ADMIN.md).
- La factura se emite **solo si el cliente la pide** (2.2) y **al enviar o entregar**, no al pagar. Implica un "Necesito factura" en el checkout (con los datos fiscales de S6) y disparar la emisión al pasar el pedido a enviado/entregado.
- Siguen sin respuesta: sistema o proveedor de facturación, notas de crédito y desglose de impuestos (¿IVA 13% + IT 3%?).

# Sprint 13 — Notificaciones y alertas

**Release:** R3 · **Estimación:** 4 días · **Depende de:** S10 y S12 (eventos de pedido en `notification_outbox`), S3 (alertas de stock)

## Objetivo
Entregar de forma fiable, por **email y/o WhatsApp**, las notificaciones transaccionales (confirmado, empacado, enviado, entregado), las de seguridad de cuenta y las alertas internas (stock bajo, pagos por revisar), con reintentos y sin bloquear nunca la operación.

## Alcance
**Dentro:** worker del outbox, proveedor de email (D-03), canal WhatsApp (API oficial o enlace manual), plantillas con marca, preferencias de canal, reintentos/backoff, alertas internas, registro y panel de entregas.
**Fuera:** marketing masivo/newsletter, recuperación de carritos (descartado), campañas.

## Reglas de negocio cubiertas
BR-SHP-04, BR-INV-05 (correo), BR-MKT-01, BR-LEG-01 (consentimiento marketing vs. transaccional), D-03.

## Tareas

### BD
- [ ] Completar `notification_outbox` (la crea S3 con tipo, canal, destinatario, `payload`, estado `pending|sent|failed`, intentos, `next_retry_at` y `dedupe_key` único; aquí se añaden `template`, `sent_at`, error y los estados `sending|dead`).
- [ ] `notification_templates` (clave, canal, idioma, asunto, cuerpo con variables, activo) editables por admin con vista previa y valores de ejemplo.
- [ ] `notification_preferences` (por cliente: canal preferido, consentimiento) y valores por defecto de la tienda.
- [ ] Triggers/función que encolan eventos de estado: **confirmado, empacado (`preparing`), enviado, entregado**, además de cancelación/reembolso, pago recibido/rechazado, comprobante rechazado.
- [ ] Alertas internas: stock bajo/crítico (dedupe por variante/umbral), pagos por revisar, pedidos antiguos sin confirmar, errores de webhook.

### Edge Functions
- [ ] `notify-worker` (invocado por cron cada minuto + `pg_net`/webhook al encolar): toma lotes con `FOR UPDATE SKIP LOCKED`, envía, marca estado, aplica backoff exponencial y pasa a `dead` tras N intentos con alerta.
- [ ] Proveedor de **email** (Resend/Postmark/SMTP — D-03): dominio propio con **SPF, DKIM y DMARC** configurados; plantillas HTML responsivas con la identidad de la diseñadora + texto plano.
- [ ] Canal **WhatsApp**: API oficial (plantillas aprobadas) **o** modo manual con enlace `wa.me` generado en el panel (decisión pendiente); fallback entre canales según preferencia.
- [ ] Reutilizar patrones de Acrosoft (`notify-stock-alert`, `send-*`, reintentos de WhatsApp) tras revisarlos.
- [ ] Emails de Auth (confirmación/recuperación) con SMTP propio y plantillas de marca.

### Admin
- [ ] Editor/preview de plantillas; envío de prueba.
- [ ] **Registro de notificaciones** por pedido/cliente (estado, error, reenviar manualmente).
- [ ] Configuración de destinatarios de alertas internas (los 2 admins) y de umbrales de ruido.

### Cliente
- [ ] Preferencias de notificación en la cuenta; enlace de baja solo para marketing (los transaccionales no se pueden desactivar).

## Criterios de aceptación
1. Cada cambio de estado relevante genera exactamente **una** notificación por canal elegido (sin duplicados).
2. Si el proveedor falla, el pedido no se afecta; se reintenta y, agotados los intentos, se alerta al admin.
3. Alertas de stock llegan al/los admin una vez por cruce de umbral (sin spam).
4. Los correos llegan a bandeja de entrada (no spam) y se ven bien en Gmail/Outlook/Apple Mail móvil.
5. El admin puede reenviar manualmente cualquier notificación y ver su historial.

## Testing
- **Unit:** render de plantillas (variables faltantes, caracteres especiales, XSS en nombres/direcciones), cálculo de backoff, `dedupe_key`.
- **Integración:** worker con proveedor *fake* (éxito, error transitorio, error permanente, timeout); `SKIP LOCKED` con dos workers en paralelo (sin doble envío).
- **E2E:** recorrer estados de un pedido y verificar mensajes en un buzón de prueba (Mailpit/Inbucket local); alerta de stock al bajar de umbral.
- **Entregabilidad:** prueba con mail-tester / Gmail postmaster; verificación SPF/DKIM/DMARC.
- **Resiliencia:** caída del proveedor 1 hora → recuperación sin pérdidas ni duplicados.
- **Privacidad:** el contenido no incluye más datos de los necesarios; enlaces de pedido requieren sesión.

## Edge cases
- Cliente sin email (solo teléfono) → canal WhatsApp o aviso en pantalla; cliente sin teléfono → solo email.
- Email rebotado/inválido, buzón lleno, número de WhatsApp sin la app o fuera de ventana de 24 h (plantillas aprobadas).
- Eventos rápidos consecutivos (paid→preparing→shipped en segundos): orden y consolidación.
- Estado revertido por error del admin (deshacer): no enviar notificaciones engañosas; mensaje de corrección opcional.
- Cambio de dirección de email/teléfono entre encolar y enviar.
- Idioma/moneda del cliente en plantillas; formato de fechas en `America/La_Paz`.
- Plantilla desactivada o con error de sintaxis → fallback seguro y alerta.
- Límites de envío del proveedor (rate limit) y picos por campaña.
- Doble disparo del trigger (reintento de transacción) → `dedupe_key`.
- Mensajes muy largos (WhatsApp), emojis, caracteres no soportados.
- Desactivación de cuenta con notificaciones pendientes → cancelar/anonimizar.
- Admin con correo caído: ¿a quién escalar? (segundo admin).

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de cumplimiento (consentimiento y transaccional vs. marketing).
- [ ] Revisión de costos del canal WhatsApp.
- [ ] Revisión de plantillas con la diseñadora (marca, legibilidad móvil, modo oscuro de clientes de correo).
- [ ] Prueba de carga del worker.

## Riesgos
- Entregabilidad de correo sin dominio/DNS bien configurado → configurar pronto el dominio (pendiente externo).
- Costo/aprobación de plantillas en API oficial de WhatsApp → opción manual como puente.

## Pendientes externos
Dominio y remitente, proveedor de email (D-03), decisión WhatsApp oficial vs. manual, textos de cada notificación (PENDIENTES_ADMIN §G).

## Entregables para sprints siguientes
Infraestructura de notificaciones robusta y reutilizable (la usarán S14 para reportes programados, S17 para facturas y S18 para multi-idioma).

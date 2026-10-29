# Sprint 18 — Multi-país y pasarelas internacionales

**Release:** R5 · **Estimación:** 8 días (puede dividirse por país/pasarela) · **Depende de:** S11 (capa de pagos), S2 (país/moneda/precios), S16 (sistema estable); S17 si algún país exige facturación

## Objetivo
Activar la venta en otros países y monedas (**ARS, EUR, USD**) sin tocar el núcleo: precios por país, tipos de cambio, impuestos, envíos y métodos de pago locales/internacionales (**Stripe, Mercado Pago, PayPal**), y soporte de idioma.

## Alcance
**Dentro:** habilitar países/monedas, selector de país, precios y tipos de cambio por país, impuestos por país, envíos internacionales (zonas, aduanas), nuevos `PaymentProvider` (Stripe/MP/PayPal), checkout con métodos por país, i18n, SEO internacional (hreflang), moneda en reportes, cumplimiento regional.
**Fuera:** operación logística propia fuera de Bolivia (se define con el admin), marketplaces externos.

## Reglas de negocio cubiertas
BR-PRC-02, BR-PRC-06, BR-CHK-02, BR-PAY-02, BR-SHP-03 (internacionales), BR-LEG-01, BR-MKT-04.

## Tareas

### Datos y precios
- [ ] Habilitar `countries`/`currencies` (ARS, EUR, USD) desde el panel; asignar moneda(s) por país.
- [ ] **Precios por país/moneda** explícitos o calculados desde el tipo de cambio (reglas de S2); redondeos por moneda (ARS/EUR/USD a 2 decimales; "precios psicológicos" opcional).
- [ ] Gestión de tipos de cambio: fijo/variable, actualización manual o por API externa, alertas de variación brusca, historial; **congelado al crear el pedido** (ya en S10).
- [ ] Particularidades de **ARS** (alta inflación, controles cambiarios): política de actualización frecuente y márgenes configurables.
- [ ] Impuestos por país (IVA/VAT inclusivo/exclusivo según mercado); desglose en checkout y facturas.

### Pagos internacionales
- [ ] Adaptadores `stripe`, `mercadopago`, `paypal` bajo `PaymentProvider` (S11): crear cobro, webhook idempotente con firma, reembolso, estados.
- [ ] Reutilizar patrones de `stripe-webhook` y claves por entorno de Acrosoft tras revisión.
- [ ] Configuración por país: qué métodos se ofrecen (tarjeta, wallets, efectivo local, cuotas) y comisiones.
- [ ] **3-D Secure/SCA** (UE), `payment_intent` y estados asíncronos; manejo de **contracargos/disputas**.
- [ ] Conciliación y reportes por pasarela y moneda; conversión de liquidaciones.
- [ ] Cumplimiento PCI: nunca tocar datos de tarjeta (Elements/Checkout alojado).

### Envíos internacionales
- [ ] Zonas por país, tarifas por peso/zona (extensión del motor de S8), tiempos estimados, países no atendidos.
- [ ] Aduanas/aranceles: quién los paga (DDP/DAP), mensajes claros al cliente; restricciones por producto si aplica.
- [ ] Direcciones internacionales: formatos por país, validación de códigos postales/teléfonos.

### Experiencia
- [ ] Selector de país/moneda con detección sugerida (no forzada), persistencia y coherencia carrito/precios.
- [ ] **i18n**: `es` (variantes), `en`; contenido de producto traducible (campos por idioma) y plantillas de notificación por idioma.
- [ ] SEO internacional: `hreflang`, URLs por país/idioma, feeds por país (Merchant/Meta).
- [ ] Legal por región (GDPR/consentimiento, términos por jurisdicción, derecho de desistimiento en UE).
- [ ] Reportes/dashboards por moneda y consolidados.

## Criterios de aceptación
1. Un cliente de otro país ve precios, impuestos, envío y métodos de pago correctos en su moneda.
2. Un pago con cada pasarela (en sandbox y luego real de bajo monto) llega como `paid` una sola vez y se puede reembolsar.
3. Los totales se calculan igual en cliente y servidor para todas las monedas.
4. Los reportes no mezclan monedas indebidamente.
5. Bolivia/BOB sigue funcionando exactamente igual (regresión completa verde).

## Testing
- **Unit:** conversión y redondeo por moneda, cálculo de impuestos incluidos, formateo local (separadores, símbolos), mapeo de estados por pasarela.
- **Integración con sandbox:** Stripe (éxito, 3DS requerido, fallo, disputa), Mercado Pago (aprobado, pendiente, rechazado, cuotas), PayPal (aprobado, cancelado, reembolso); webhooks duplicados/fuera de orden.
- **Concurrencia/idempotencia:** igual que S11 para cada pasarela.
- **E2E por país:** compra completa AR/EU/US con su moneda, método de pago, dirección y envío.
- **Regresión BOB:** suite completa de S5–S14 sin cambios de resultado.
- **Seguridad:** verificación de firmas, secretos por entorno, sin datos de tarjeta en logs/BD.
- **Contable:** cuadre de liquidaciones de pasarela vs. pedidos.

## Edge cases
- Tipo de cambio cambia entre el carrito y el pago (precio del carrito en moneda original, S-04) / cliente cambia de país con carrito lleno.
- Moneda sin decimales (si se incorpora alguna) o con redondeo especial.
- Producto sin precio en la moneda del país → calcular o no mostrar (regla configurada), nunca mostrar 0.
- Descuentos de monto fijo definidos solo en BOB (S9) → exigir valor por moneda.
- Envío gratis sobre monto en otra moneda; tarifas cambian por país.
- Pago aprobado tras vencer ventana; pago en moneda distinta a la del pedido; diferencias por comisiones/FX.
- Disputas/contracargos tardíos → `disputed` y proceso de evidencia.
- Reembolsos parciales con conversión de moneda; reembolso excede por FX.
- IVA/VAT inclusivo vs. exclusivo y redondeo por línea vs. total.
- Impuestos y aranceles de importación no previstos por el cliente (mensajes y términos).
- Direcciones sin código postal (algunos países), teléfonos internacionales, caracteres no latinos.
- Fraude en tarjetas internacionales: reglas de riesgo (Stripe Radar), límites por pedido/país y revisión manual.
- Cliente cambia de idioma en mitad del checkout; emails en el idioma correcto.
- Pasarela caída: ocultar método y ofrecer alternativa; no perder pedidos.
- Huso horario de cada país para ofertas flash y franjas.
- Países sancionados o restringidos: lista de bloqueo.

## Revisión
- [ ] Checklist universal.
- [ ] Revisión legal/fiscal por país (consumo, protección de datos, devoluciones, impuestos).
- [ ] Revisión de costos y comisiones por pasarela/país (impacto en margen del dashboard).
- [ ] Revisión de seguridad de integraciones y secretos.
- [ ] Prueba con transacciones reales de bajo monto por pasarela.

## Riesgos
- Complejidad fiscal y logística de cada país → lanzar **un país a la vez** y mantener alcance por país controlado.
- Volatilidad cambiaria (ARS) → política clara de actualización y márgenes.
- Costos de cumplimiento (GDPR, aduanas) → evaluar antes de abrir cada mercado.

## Pendientes externos
Países y monedas objetivo y orden de apertura, cuentas de Stripe/Mercado Pago/PayPal, política de aduanas/envíos internacionales, asesoría legal/fiscal por región.

## Entregables
Tienda multi-país y multi-moneda, pasarelas internacionales operativas, i18n y SEO internacional, documentación de cada mercado.

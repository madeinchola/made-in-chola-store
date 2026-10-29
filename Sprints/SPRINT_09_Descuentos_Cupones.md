# Sprint 9 — Descuentos y cupones

**Release:** R2 · **Estimación:** 4 días · **Depende de:** S3 (panel), S7 (carrito y puntos de extensión de totales); coordina con S8 (orden de cálculo)

## Objetivo
Motor de descuentos configurable desde el panel que soporte todos los tipos pedidos, con **un solo cupón por pedido**, cálculo siempre en servidor y trazabilidad total.

## Alcance
**Dentro:** modelo de descuentos y cupones, motor de evaluación/aplicación, UI admin, UI cliente (ingresar cupón, ver descuentos), redenciones y límites de uso, integración con carrito.
**Fuera:** reembolso prorrateado (S12), referidos/afiliados (descartado), puntos/gift cards (descartado).

## Reglas de negocio cubiertas
BR-PRC-03, BR-PRC-04 (base para S12), BR-PRC-07.

## Tipos soportados (configurables desde el panel)
1. Cupón **porcentaje**.
2. Cupón **monto fijo**.
3. **Envío gratis** sobre un monto.
4. **2x1** (o N×M configurable) por producto/categoría/colección.
5. **Descuento por volumen** (tramos por cantidad).
6. **Precio por tipo de cliente** (grupos de clientes).
7. **Oferta flash** con fecha/hora de inicio y fin.
8. **Primera compra.**

## Tareas

### BD
- [ ] `discounts` (nombre, tipo, valor, `rules jsonb`, alcance `order|product|category|collection`, vigencia con zona horaria, `usage_limit_total`, `usage_limit_per_customer`, prioridad, `stackable_with_automatic bool`, moneda, activo, `archived_at`).
- [ ] `coupons` (código único normalizado, `discount_id`, activo, vigencia propia opcional).
- [ ] `customer_groups` + `customer_group_members` (para precio por tipo de cliente).
- [ ] `discount_redemptions` (discount_id, coupon_id, profile_id, order_id, monto aplicado, estado `reserved|applied|reverted`) — única por `(order_id)` para cupón.
- [ ] RPC `apply_discounts(cart_id, coupon_code?)` → `{lines[], applied[], rejected[{code,reason}], totals}`: **determinista**, define **orden de aplicación** (ofertas automáticas → cupón único → envío gratis) y reglas de combinación (un cupón por pedido, descuentos automáticos según flag).
- [ ] Control de usos **atómico** (evita pasarse del límite bajo concurrencia); reserva de uso al crear pedido, reversión si se cancela (S12).
- [ ] Nunca devuelve total negativo; el descuento no excede el subtotal elegible.
- [ ] Productos ya rebajados: política explícita (excluir por flag `exclude_sale_items`).

### Admin
- [ ] Listado con estado (activo/programado/vencido/agotado) y uso.
- [ ] Asistente de creación por tipo con vista previa en lenguaje claro ("10% en la colección Verano, máx. 100 usos").
- [ ] Generar códigos (manual/aleatorio/lote), activar/desactivar, archivar.
- [ ] Reporte de redenciones (quién, cuándo, cuánto) y exportación CSV.
- [ ] Auditoría de cambios.

### Cliente
- [ ] Campo de cupón en carrito/checkout; mensajes específicos de rechazo (vencido, límite alcanzado, no aplica a tus productos, ya usaste uno, mínimo no alcanzado).
- [ ] Desglose: precio original, descuento, precio final por línea y total.
- [ ] Banners de ofertas flash con cuenta regresiva (si el diseño lo incluye).

## Criterios de aceptación
1. El admin crea cada uno de los 8 tipos sin código ni ayuda.
2. Solo se acepta **un cupón por pedido**; los demás se rechazan con mensaje claro.
3. Los límites de uso total/por cliente se respetan bajo concurrencia.
4. El servidor recalcula y manda; el cliente nunca puede alterar el descuento.
5. Totales nunca negativos y siempre a 2 decimales; coinciden entre carrito y pedido.

## Testing
- **Unit (matriz de reglas):** cada tipo con casos válidos/borde (porcentaje 0/100/>100, monto > subtotal, 2x1 con cantidad impar, tramos de volumen en límites, primera compra con/sin historial, oferta flash a 1 segundo del inicio/fin).
- **Propiedad:** para cualquier combinación, `0 ≤ total ≤ subtotal+envío` y orden de aplicación estable.
- **SQL/RLS:** el cliente no lee la tabla de cupones (no se puede listar códigos); solo valida un código por RPC; admin CRUD.
- **Concurrencia:** 50 intentos simultáneos sobre un cupón con 1 uso restante; mismo cliente usando el cupón desde dos dispositivos.
- **Integración:** envío gratis + cupón (orden), 2x1 con productos rebajados, cupón con vigencia por zona horaria.
- **E2E:** aplicar/quitar/cambiar cupón; rechazo por vencido; oferta automática visible; cupón agotado.
- **Seguridad:** fuerza bruta de códigos → rate limit y respuesta uniforme; manipulación de la petición.

## Edge cases
- Cupón en mayúsculas/minúsculas/espacios; caracteres confusos (0/O).
- Cupón vence mientras el cliente completa el checkout → revalidar al crear pedido con mensaje claro.
- Cupón aplicado y luego el carrito baja del mínimo (se quita con aviso).
- Producto con precio por moneda distinta y descuento monto fijo (¿en qué moneda?): el monto fijo se define por moneda.
- Descuento sobre productos específicos que el cliente quita del carrito.
- Redondeo acumulado en descuentos por línea vs. por total (definir y probar: se redondea por línea, suma exacta).
- 2x1 con variantes distintas (mismo producto, distintos colores) y con precios distintos (se regala el más barato).
- Dos ofertas automáticas aplicables a la misma línea → prioridad/mejor oferta, sin doble descuento.
- Primera compra: cliente con pedido cancelado previo (¿cuenta como compra?). Decisión: solo cuentan pedidos no cancelados.
- Precio por tipo de cliente cuando el cliente cambia de grupo en pleno carrito.
- Cupón de un solo uso por cliente y el cliente cancela el pedido → devolver el uso (S12).
- Cupón y envío gratis sobre monto: el umbral se evalúa **antes o después** del descuento (documentar; propuesta: después).
- Zona horaria de vigencia (`America/La_Paz`) y horario de verano de otros países futuros.
- Oferta flash que se agota por stock antes de su fin.

## Revisión
- [ ] Checklist universal.
- [ ] Revisión matemática del motor por segunda persona (ejemplos resueltos a mano).
- [ ] Revisión de abuso (enumeración de cupones, reutilización por cuentas múltiples).
- [ ] Revisión UX: textos de rechazo comprensibles.
- [ ] Alineación del orden de cálculo con S8 y S10 documentada en el maestro.

## Riesgos
- Complejidad combinatoria de reglas → limitar combinaciones permitidas y cubrir con tests de propiedad.
- Cuentas múltiples para reutilizar "primera compra" → criterio por teléfono/dirección (reforzar en S12/lista negra).

## Pendientes externos
Cupones/promociones de lanzamiento; política de combinación con productos rebajados (PENDIENTES_ADMIN §F).

## Entregables para sprints siguientes
`apply_discounts` estable, redenciones atómicas, admin de descuentos, desglose de líneas para S10 (snapshots) y S12 (reembolso prorrateado).

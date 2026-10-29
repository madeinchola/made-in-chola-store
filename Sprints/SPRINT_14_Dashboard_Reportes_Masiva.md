# Sprint 14 — Dashboard, reportes y carga masiva

**Release:** R3 · **Estimación:** 5 días · **Depende de:** S3 (CRUD catálogo), S10/S12 (pedidos, costos, reembolsos)

## Objetivo
Dar al admin visibilidad del negocio (ventas, más vendidos, stock bajo, margen y utilidad), herramientas de productividad (carga masiva CSV/Excel, exportaciones) y documentos operativos (etiquetas de envío, packing list).

## Alcance
**Dentro:** dashboard con `recharts`, métricas calculadas en BD, reportes filtrables y exportables, importación masiva de productos/stock/precios con validación previa, exportación de pedidos, etiquetas/guías/packing list.
**Fuera:** BI externo, reportes programados por email (posible extensión con S13), facturación (S17).

## Reglas de negocio cubiertas
BR-ADM-01, BR-ADM-02, BR-ADM-05, BR-CAT-05/06 (validación en import), BR-PRC-06.

## Tareas

### BD / métricas
- [ ] Vistas/RPC `get_dashboard_metrics(rango, moneda)`: ventas brutas/netas, n.º de pedidos, ticket promedio, descuentos, envíos, reembolsos, **margen y utilidad** (precio − costo snapshot − descuentos − costo de envío asumido en rechazos), por día/semana/mes.
- [ ] Rankings: más vendidos (unidades/ingresos), por categoría/colección, por variante (color/talla), menos vendidos, **sin rotación**.
- [ ] Stock: bajo/crítico, valor de inventario, cobertura estimada.
- [ ] Índices/vistas materializadas con refresco para evitar escaneos pesados; definición única de "venta" (solo pedidos `paid` o posteriores no cancelados; coherente entre reportes).
- [ ] Manejo explícito de **moneda**: reportes por moneda (sin sumar monedas distintas) y consolidado opcional al tipo de cambio del pedido.

### Dashboard (admin)
- [ ] Tarjetas KPI con comparativa vs. período anterior; gráficos de ventas en el tiempo, top productos, mix de métodos de pago, embudo simple (carritos→pedidos→pagados) si hay datos.
- [ ] Filtros de rango (hoy, 7/30 días, mes, personalizado) en `America/La_Paz`.
- [ ] Alertas de stock bajo y pedidos que requieren atención (reutiliza S12/S13).
- [ ] Estados vacíos informativos (tienda nueva sin datos).

### Reportes y exportación
- [ ] Reportes: ventas, productos, inventario, descuentos/cupones, pagos, devoluciones, clientes nuevos/recurrentes.
- [ ] **Exportar a CSV/Excel** (UTF-8 con BOM para Excel, separadores configurables), respetando filtros; exportación asíncrona para volúmenes grandes.
- [ ] Documentos: **etiqueta de envío**, **guía/hoja de despacho** y **packing list** en PDF (formato según lo que defina el admin), impresión por lote.

### Carga masiva
- [ ] Plantillas descargables (CSV/Excel) para: productos+variantes, stock, precios por moneda, categorías.
- [ ] Flujo en 3 pasos: **subir → validar (vista previa con errores por fila) → confirmar**; nada se escribe hasta confirmar.
- [ ] Importación transaccional por lote con *upsert* por `código/sku`, reporte final (creados, actualizados, omitidos, errores) descargable.
- [ ] Imágenes por URL o carpeta opcional; fallos de imagen no abortan el lote.
- [ ] Cada importación auditada y **reversible** cuando sea posible (rollback del lote).
- [ ] Reutilizar `papaparse`; límites de tamaño/filas; procesamiento por *chunks*.

## Criterios de aceptación
1. Las cifras del dashboard coinciden con una verificación manual en SQL sobre datos de prueba (cuadre al centavo).
2. El admin importa 500 productos con variantes sin ayuda y entiende los errores de cada fila.
3. Exportaciones abren correctamente en Excel/Google Sheets con acentos y ñ.
4. Las etiquetas y packing lists se imprimen correctamente en A4/carta y formato etiqueta.
5. Los reportes respetan zona horaria y no mezclan monedas.

## Testing
- **Unit:** funciones de agregación (margen, utilidad, ticket promedio), parser de importación (celdas vacías, formatos numéricos `1.234,56` vs `1,234.56`, texto en campos numéricos), generador de CSV (comillas, saltos de línea, `;`/`,`).
- **SQL:** dataset sintético conocido → métricas esperadas (incluye reembolsos, cupones, pedidos cancelados, rechazos de contra entrega).
- **Integración:** import con 10 000 filas (rendimiento y memoria), reimport idempotente, rollback del lote, conflicto de `código` duplicado.
- **E2E:** importar plantilla válida e inválida; exportar y reabrir el archivo; generar PDFs; permisos (cliente no accede).
- **Rendimiento:** dashboard con 100 000 pedidos simulados; consultas < 1–2 s con índices/vistas.
- **Regresión de cifras:** snapshot de métricas con datos de referencia.

## Edge cases
- Pedido cancelado/reembolsado parcialmente: ¿cómo afecta ventas y margen? (reglas escritas y probadas).
- Producto sin costo registrado → margen "desconocido", nunca 100% falso; aviso en el dashboard.
- Costos que cambian con el tiempo → usar **costo snapshot** del pedido.
- Productos archivados aparecen en reportes históricos.
- Cambio de tipo de cambio en el período; monedas múltiples.
- Rangos que cruzan cambio de mes/zona horaria; días sin ventas (huecos en gráfico).
- Import: filas con SKU duplicado en el mismo archivo; variantes parciales; talla vacía (producto sin tallas); colores con distinto nombre por mayúsculas/acentos; precios negativos; stock decimal; archivo con codificación Latin-1, BOM, Excel con fórmulas o celdas combinadas.
- Import que modifica stock con reservas/pedidos abiertos (usar movimientos `import` y respetar lo comprometido).
- Import interrumpido a medias (cierre de pestaña, error de red) → estado consistente.
- Dos admins importando el mismo SKU a la vez.
- Inyección de fórmulas en CSV (`=cmd|...`) → escapar al exportar.
- Exportación enorme → asíncrona con enlace de descarga.
- Etiquetas con direcciones/nombres muy largos o caracteres especiales; impresión sin saltos de página extraños.

## Revisión
- [ ] Checklist universal.
- [ ] Verificación de cifras con el dueño usando datos reales de las primeras ventas.
- [ ] Revisión de consultas (EXPLAIN, índices, costo en Supabase).
- [ ] Revisión de seguridad de exportaciones/URLs temporales.
- [ ] Revisión UX con el admin: ¿qué métrica mira primero? (ajustar el orden).

## Riesgos
- Definiciones ambiguas de "venta" o "utilidad" → documentarlas en el dashboard (tooltip) y acordar con el dueño.
- Imports defectuosos que dañan el catálogo → validación previa estricta y reversión de lote.

## Pendientes externos
Formato de etiquetas/guías (PENDIENTES_ADMIN §F), costos por producto, definición de utilidad (¿incluye costo de envío/comisiones?).

## Entregables para sprints siguientes
Métricas y exportaciones confiables (insumo de S16 y de la contabilidad en S17), importador reutilizable.

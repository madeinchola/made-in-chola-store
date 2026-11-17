# Resumen, reportes y documentos de despacho (Sprint 14)

Qué hace, cómo está hecho y por qué. Cubre BR-ADM-01, BR-ADM-02, BR-ADM-05 y BR-PRC-06 en lo que toca a cifras y exportaciones. La carga masiva está en [importacion.md](importacion.md).

## Dónde está cada cosa

```
 Resumen ─────────────────────────────  /admin           cifras del período, lo más vendido, cómo pagan, embudo, inventario, atención
 Reportes ────────────────────────────  /admin/reportes  una pestaña por reporte, con filtro y descarga CSV
   ├── Ventas                            /admin/reportes
   ├── Productos                         /admin/reportes/productos
   ├── Inventario                        /admin/reportes/inventario
   ├── Descuentos                        /admin/reportes/descuentos
   ├── Pagos                             /admin/reportes/pagos
   ├── Devoluciones                      /admin/reportes/devoluciones
   └── Clientas                          /admin/reportes/clientas
 Documentos de despacho ──────────────  /admin/pedidos/imprimir   desde la bandeja (por lote) o desde un pedido
```

Todo es de **solo lectura** y **solo para administradores**: cada función SQL se autoriza por dentro con `is_admin()` y no la ejecutan `anon` ni `service_role` (lo comprueban pgTAP y la integración por HTTP real).

## Una sola definición de «venta»

Todas las cifras (tarjetas, gráfico, rankings, reportes y exportaciones) salen de **la misma función** (`_sales_orders` / `_sales_lines`), así que un reporte y una tarjeta no pueden contradecirse (lo comprueba la integración: la suma del reporte de ventas es el neto del resumen).

- **Una venta es un pedido en `paid`, `preparing`, `shipped`, `delivered` o `completed`.** Su fecha es la del pago (`paid_at`; si faltara, la de creación) **en hora de La Paz**. Un pedido pagado a las 23:30 de La Paz cuenta en ese día aunque en UTC ya sea el siguiente.
- **No son ventas**: los pendientes de pago, los cancelados y los reembolsados por completo. Se cuentan **aparte** («Lo que no es venta») para que las ventas no se inflen.
- **Neto** = lo que pagó el pedido (con envío e impuestos) − reembolsos *no rechazados* (solicitados, aprobados o devueltos). Un reembolso parcial baja el neto del pedido **en la fecha de venta del pedido**, no en la fecha del reembolso: una cifra por pedido, sin cuentas en dos fechas.
- **Moneda**: cada moneda se cuenta por separado y **nunca se suman monedas distintas**. Hay un «consolidado» opcional a la moneda base, al tipo de cambio de cada pedido (`exchange_rate`).
- **Período anterior**: el mismo largo, justo antes del elegido. El rango máximo es de 731 días.

## Margen y utilidad (y por qué a veces dicen «desconocido»)

- **Margen** = ingreso de productos − costo de lo que se quedó, **solo en los pedidos en que TODAS las líneas tienen costo registrado**. Si a un producto le falta el costo, el margen de ese pedido es **desconocido**: nunca se rellena con cero (daría un margen del 100 % falso). El resumen avisa «solo N de M pedidos tienen costo».
  - Ingreso de productos = Σ de las líneas (ya con descuento) − lo reembolsado (menos el envío devuelto, que no es de productos).
  - Costo = Σ (unidades − unidades reembolsadas) × costo congelado en el pedido (`order_items.cost_unit`): si el costo del producto cambia después, el pedido conserva el suyo.
- **Utilidad** = margen − costos de incidencias de entrega que asumió la tienda (`order_incidents.cost_borne_by = 'store'`, por la fecha en que se abrió la incidencia). El envío que cobras se supone que **paga** el envío: el costo real del transportista todavía no se registra en ninguna parte.
- **Otra moneda ⇒ margen desconocido.** El costo del producto está en la moneda base y todavía no hay pedidos reales en otra moneda con los que comprobar cómo se congela; mezclarlas daría un número falso.
- Las definiciones están escritas en el propio resumen («¿Cómo se calculan estas cifras?»), a la vista y no escondidas en un globo que no aparece al tocar.

## Qué muestra el resumen

Tarjetas con su cambio frente al período anterior (con signo y texto, no solo color; «más reembolsos» se pinta como malo y «más ventas» como bueno), ventas netas en el tiempo (día, semana o mes según el largo, **sin huecos**: un día sin ventas es cero, no falta; el gráfico trae su tabla de datos), lo más vendido (por ingresos o unidades), cómo pagan, el embudo del carrito al pago, lo que no es venta, el inventario (valor al costo y semáforo), los pedidos que piden atención (de S12) y las alertas de stock. El período vive en la dirección (`?p=30d`, `?p=custom&desde=…&hasta=…`): recargar o copiar el enlace no lo pierde.

Rankings y desgloses (por categoría, colección, variante, método de pago o canal): una prenda en dos categorías cuenta en las dos, así que la suma de categorías puede superar el total. Los **sin rotación** son los productos activos con stock y sin una venta en N días. La **cobertura** es cuántos días alcanza lo que hay al ritmo de venta de los últimos N.

## Reportes y exportación

Cada reporte se pagina **en el servidor** (50 por página, con el total exacto) y se descarga **completo** (no solo la página visible):

- **CSV con BOM UTF-8** (las tildes y la ñ se abren bien en Excel y Google Sheets) y CRLF. Dos formatos de números: **«Excel en español»** (separa con `;` y usa coma decimal) o **estándar** (`,` y punto decimal). Los importes van sin símbolo ni separador de miles; lo desconocido va como celda vacía, no como cero. Las fechas van en hora de La Paz.
- **Inyección de fórmulas neutralizada**: una celda de texto que empieza con `=`, `+`, `-`, `@`, tabulador o retorno de carro lleva una comilla simple delante y pasa a ser texto (un nombre de clienta como `=HYPERLINK(...)` no se ejecuta al abrir el archivo). Los números no se tocan.
- El archivo se arma **en el navegador**, pidiendo páginas de 2000 filas con progreso y botón de cancelar: no queda en ningún servidor ni en ningún enlace temporal (no hay URL que filtrar). Cancelar no guarda nada.
- **Tope de 50 000 filas** por archivo: más allá se avisa y se pide acotar el período. *No hay exportación asíncrona con enlace de descarga* (ver «Límites»).

## Documentos de despacho

Desde la bandeja de pedidos (elige los pedidos) o desde el detalle de un pedido: `/admin/pedidos/imprimir?ids=…&doc=…&formato=…`.

| Documento | Qué es | Hojas |
| --- | --- | --- |
| **Etiquetas de envío** | Destinatario, teléfono, dirección completa y referencia, franja de entrega, unidades, espacio para los bultos y, si es contra entrega, **cuánto cobrar**. Los pedidos de recojo no llevan etiqueta (se avisa). | Una por pedido |
| **Guía de despacho** | Todos los pedidos **en el orden de la ruta** (franja más temprana primero) con dirección, cobro, unidades y espacio para la firma. | Una (apaisada) |
| **Lista de empaque** | Las líneas del pedido con SKU, color, talla y cantidad, casillas para marcar y «preparó / revisó». | Una por pedido |

Tamaños: **A4**, **carta** y **etiqueta de 10 × 15 cm** (`@page` con su medida). Es HTML que se imprime desde el navegador: para un **PDF**, elige «Guardar como PDF» en el cuadro de impresión. Las direcciones largas **se achican** (y se parten en líneas) antes de salirse de la hoja; el texto va siempre como texto, nunca como HTML.

## Rendimiento (medido, no supuesto)

Con **100 000 pedidos simulados** (200 000 líneas) en la nube, dentro de una transacción que se revirtió: resumen de 30 días **0,75 s**; de 365 días **2,7 s** y de 731 días **2,2 s** (incluyen el período anterior); rankings 0,2–0,7 s; desgloses ≈ 1 s; embudo, sin rotación e inventario por debajo de 0,4 s. La primera versión del resumen tardaba **11 s** porque calculaba la definición de venta cinco veces: ahora cada período se calcula una vez. Un índice parcial por fecha de venta (`orders_sold_at_idx`) evita recorrer todos los pedidos. La base corta cualquier llamada a los **8 s**, por eso los reportes se piden por páginas.

## Límites conocidos (nada de esto está escondido)

1. **Excel `.xlsx`**: solo CSV. Excel guarda «CSV UTF-8» sin problema.
2. **Exportación asíncrona con enlace** para volúmenes enormes: no se hizo. Se descarga hasta 50 000 filas desde el navegador y se avisa si hay más.
3. **Las exportaciones no quedan en la auditoría**: `audit_log` solo admite INSERT/UPDATE/DELETE. Los reportes con datos de clientas (nombre y correo) solo los ven los administradores.
4. **El costo real del envío** del transportista no se registra: la utilidad solo resta las incidencias que asumió la tienda.
5. **El margen en otra moneda es desconocido** hasta definir cómo se congela el costo en pedidos que no son de la moneda base (S18).
6. **El embudo** son conteos del período, no seguimiento de cada clienta, y los carritos viejos se borran (solo sirve para períodos recientes).
7. **Imágenes en etiquetas, formato de etiquetas definitivo y firma**: el formato que usará la tienda no está definido (PENDIENTES_ADMIN §F): por eso se ofrecen A4, carta y 10 × 15 cm.
8. **Cifras con datos reales**: verificadas con datos sintéticos conocidos (pgTAP, a mano) y contra una cuenta independiente sobre los datos de la nube, pero **no con las primeras ventas reales** del dueño (SPRINT_19).

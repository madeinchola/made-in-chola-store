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
- [x] Vistas/RPC `get_dashboard_metrics(rango, moneda)`: ventas brutas/netas, n.º de pedidos, ticket promedio, descuentos, envíos, reembolsos, **margen y utilidad** (precio − costo snapshot − descuentos − costo de envío asumido en rechazos), por día/semana/mes. *(`admin_sales_summary(desde, hasta, granularidad)`: indicadores por moneda, período anterior, serie sin huecos y consolidado; la utilidad resta las incidencias que asumió la tienda; el costo real del envío del transportista no se registra)*
- [x] Rankings: más vendidos (unidades/ingresos), por categoría/colección, por variante (color/talla), menos vendidos, **sin rotación**. *(`admin_top_products`, `admin_sales_breakdown` (categoría, colección, variante, método de pago, canal) y `admin_slow_movers`)*
- [x] Stock: bajo/crítico, valor de inventario, cobertura estimada. *(`admin_inventory_summary` y `admin_inventory_coverage`; el bajo/crítico es el semáforo de S2)*
- [x] Índices/vistas materializadas con refresco para evitar escaneos pesados; definición única de "venta" (solo pedidos `paid` o posteriores no cancelados; coherente entre reportes). *(índice parcial por fecha de venta y una sola definición en `_sales_orders`/`_sales_lines`; sin vistas materializadas: medido con 100 000 pedidos, el resumen de 30 días tarda 0,75 s)*
- [x] Manejo explícito de **moneda**: reportes por moneda (sin sumar monedas distintas) y consolidado opcional al tipo de cambio del pedido.

### Dashboard (admin)
- [x] Tarjetas KPI con comparativa vs. período anterior; gráficos de ventas en el tiempo, top productos, mix de métodos de pago, embudo simple (carritos→pedidos→pagados) si hay datos. *(el embudo son conteos del período)*
- [x] Filtros de rango (hoy, 7/30 días, mes, personalizado) en `America/La_Paz`. *(hoy, 7 y 30 días, este mes, mes pasado y a medida; todo en hora de La Paz)*
- [x] Alertas de stock bajo y pedidos que requieren atención (reutiliza S12/S13). *(reutiliza las de S3 y la lista de atención de S12; las de S13 llegan por el worker)*
- [x] Estados vacíos informativos (tienda nueva sin datos).

### Reportes y exportación
- [x] Reportes: ventas, productos, inventario, descuentos/cupones, pagos, devoluciones, clientes nuevos/recurrentes.
- [x] **Exportar a CSV/Excel** (UTF-8 con BOM para Excel, separadores configurables), respetando filtros; exportación asíncrona para volúmenes grandes. *(CSV con BOM (Excel y Google Sheets); **no** `.xlsx` ni exportación asíncrona con enlace; tope de 50 000 filas)*
- [x] Documentos: **etiqueta de envío**, **guía/hoja de despacho** y **packing list** en PDF (formato según lo que defina el admin), impresión por lote. *(HTML imprimible en A4, carta y 10 × 15 cm (Guardar como PDF); el formato definitivo lo define el dueño)*

### Carga masiva
- [x] Plantillas descargables (CSV/Excel) para: productos+variantes, stock, precios por moneda, categorías.
- [x] Flujo en 3 pasos: **subir → validar (vista previa con errores por fila) → confirmar**; nada se escribe hasta confirmar. *(subir → revisar (la base corre la importación y la deshace) → confirmar; nada se guarda hasta confirmar)*
- [x] Importación transaccional por lote con *upsert* por `código/sku`, reporte final (creados, actualizados, omitidos, errores) descargable. *(cada bloque de 100 filas es una transacción y cada fila una subtransacción; informe final descargable)*
- [ ] Imágenes por URL o carpeta opcional; fallos de imagen no abortan el lote.
- [x] Cada importación auditada y **reversible** cuando sea posible (rollback del lote). *(lote con antes y después; revertir archiva lo creado y restaura lo actualizado salvo que haya cambiado después)*
- [x] Reutilizar `papaparse`; límites de tamaño/filas; procesamiento por *chunks*.

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
- [x] Revisión de consultas (EXPLAIN, índices, costo en Supabase). *(plan de la consulta base, índice parcial y tiempos con 100 000 pedidos simulados; sin revisión independiente)*
- [x] Revisión de seguridad de exportaciones/URLs temporales. *(no hay URLs temporales: el archivo se arma en el navegador; solo administradores; las descargas no quedan en la auditoría; revisión propia, no independiente)*
- [ ] Revisión UX con el admin: ¿qué métrica mira primero? (ajustar el orden).

## Riesgos
- Definiciones ambiguas de "venta" o "utilidad" → documentarlas en el dashboard (tooltip) y acordar con el dueño.
- Imports defectuosos que dañan el catálogo → validación previa estricta y reversión de lote.

## Pendientes externos
Formato de etiquetas/guías (PENDIENTES_ADMIN §F), costos por producto, definición de utilidad (¿incluye costo de envío/comisiones?).

## Estado real de entrega (2026-11-17)

**Hecho y verificado contra la nube.** Tres migraciones (`20261117000100_s14_metricas.sql`, `…0200_s14_reportes.sql` y `…0300_s14_importacion.sql`) aplicadas; 23 funciones `admin_*` solo para administradores; resumen en `/admin`, reportes en `/admin/reportes`, carga masiva en `/admin/importar` y documentos de despacho en `/admin/pedidos/imprimir`. Explicación y límites en `docs/reportes.md` y `docs/importacion.md`; tareas y decisiones del dueño en SPRINT_19 §S.

**Cifras:** pgTAP `21_s14_metricas` **156** aserciones (valores calculados a mano; hermética: pedidos de 2020 y el resto del catálogo archivado dentro de la transacción) y `22_s14_importacion` **116**; la lista blanca de `05` ampliada a propósito; unitarias **6 200+ pruebas** en 280+ archivos; tipos, ESLint y Prettier limpios; **integración contra la nube** (permisos por HTTP; **las cifras del resumen coinciden al céntimo con una suma independiente hecha desde las tablas**, por moneda y en el rango más largo; el reporte de ventas suma lo mismo que el resumen; la vista previa no escribe; reimportar es idempotente; 300 variantes en 2 bloques y su reversión; **cuatro importaciones simultáneas del mismo SKU: un producto, una variante, una sola «creada», ningún 500**; importar un conteo mientras otra sesión mueve el stock); **E2E** (12 pasan y 2 se saltan a propósito en móvil): todas las pantallas con textos reales y axe AA, las cifras de la pantalla = las de la base, CSV completo descargado y abierto (BOM, `;`, encabezados), importación de punta a punta con su reversión y **PDF real** de etiquetas (10 × 15 cm), guía (A4 apaisada, una hoja) y lista de empaque (carta) con el número de hojas y el tamaño de papel correctos, también con una dirección larguísima y símbolos.

**Regresión final (2026-11-17, en serie contra la nube):**
- **pgTAP, las 23 suites (00–22): todas en verde** (la 17, que falló una vez sin reproducirse en S13, pasó).
- **Integración (S14, notificaciones, pedidos, pagos, cupones y checkout): 88 de 89.** Falla la misma prueba de siempre (`checkout`: «100 intentos simultáneos de 25 clientas sobre 10 unidades», `fetch failed`), que ya fallaba en S13 también con el aviso del pedido desactivado: **no es de S14** (ni de S13) y sigue abierta.
- **E2E (8 archivos, 194 casos): 182 en verde en la primera pasada y 8 fallidos.** 2 son el fallo antiguo y determinista de «enlace para saltar al contenido» (`admin.spec.ts:180`, ya fallaba en S12). Los otros **6** (3 de `account.spec`, 3 de `admin.spec`) fallaron todos igual: «`account-menu` no visible en 5 s», con peticiones a Supabase de 4–5 s o sin respuesta en sus trazas (el inicio de sesión de la nube va lento a ratos); **volvieron a pasar** al repetirlos (hubo que repetir dos veces algunos). No se tocó nada de esas pantallas en este sprint, salvo que el marco del panel y la tabla ancha ganaron reglas de impresión y de teclado.

**Mutación:** **58 cambios deliberados en el SQL** (28 de métricas, 10 de reportes, 20 de importación): **57 detectados y 1 equivalente** (D06: quitar la comprobación «el SKU es de otro producto» no cambia nada porque la siguiente, que compara color y talla, lanza el mismo error); uno de ellos (D20, no bloquear la variante antes de leer su stock) solo lo detecta la prueba de integración con otra sesión que retiene el candado. **60 en el código TypeScript, todos detectados.** Los sobrevivientes de la primera pasada fueron **huecos reales de mis pruebas** y ya tienen su caso: un reembolso con el envío devuelto (A07), una venta de hace exactamente 9 días en la cobertura (A26), una variante agotada sin costo (A20), un producto vendido con y sin costo (C02), un descuento con solo un canje revertido (C04), la cuenta del administrador entre las «cuentas nuevas» (C08), un error de la base que no debe devolver los datos de la fila (D19), el filtro de períodos probado por sí solo (U57).

**Rendimiento** (100 000 pedidos simulados en una transacción que se revirtió): resumen de 30 días **0,75 s**, de 365 días **2,7 s** y de 731 días **2,2 s** (con el período anterior); rankings 0,2–0,7 s; desgloses ≈ 1 s. La primera versión tardaba **11 s** (calculaba la definición de venta 5 veces). Importar **10 000 variantes**: 54 s en total (2,3 s por bloque de 200, 3,7 s el peor), reimportar 40 s, poner su stock 31 s: por eso el bloque es de **100 filas** (la base corta cada llamada a los 8 s).

**Lo que la verificación atrapó (arreglado):** el resumen tardaba 11 s; `admin_inventory_coverage` incluía productos archivados; `products.description` es NOT NULL y la importación mandaba nulo; papaparse no detecta el separador en archivos cortos (el salto de línea final cuenta como una fila de un campo): se detecta por el encabezado; imprimir con «ocultar todo menos la hoja» dejaba hojas en blanco (el marco del panel seguía ocupando espacio): ahora el marco no se imprime; las tablas anchas (el reporte de ventas tiene 13 columnas) no se podían recorrer con el teclado (también explicaba un fallo intermitente de axe en Monedas): ahora la región tiene `tabindex` y nombre.

**Lo que NO se pudo verificar:** las cifras con las **primeras ventas reales** (solo con datos sintéticos conocidos y contra una cuenta independiente sobre datos de prueba); una **impresión real en papel** (los PDF se comprobaron por número de hojas y tamaño, no en una impresora); una **importación con el catálogo real** del dueño; **10 000 filas por HTTP** (se midió dentro de una transacción que se revirtió, y por HTTP se probaron 300); un teléfono real.

**Decisiones y desvíos del spec:**
- **Sin `.xlsx`**: solo CSV UTF-8 (Excel lo guarda así; la pantalla lo explica y rechaza los `.xlsx`, también renombrados).
- **Sin exportación asíncrona con enlace**: se descarga hasta 50 000 filas desde el navegador, por páginas, con progreso y cancelación; no hay URLs que filtrar.
- **PDF = HTML imprimible** (Guardar como PDF): el formato de etiquetas lo define el dueño (PENDIENTES_ADMIN §F); se ofrecen A4, carta y 10 × 15 cm.
- **Imágenes no se importan** (los productos nacen en borrador: publicar exige imágenes).
- **Sin vistas materializadas**: con un índice parcial y una sola definición de venta, 100 000 pedidos dan 0,75 s en 30 días.
- **El margen en otra moneda es «desconocido»** y la utilidad no resta el costo real del transportista (no se registra).
- **Las descargas no quedan en la auditoría** (`audit_log` solo admite INSERT/UPDATE/DELETE).
- **De paso:** el CSV de cupones pasó a `src/lib/csv.ts` (con separador configurable); las tablas anchas del panel se pueden recorrer con el teclado; el marco del panel no se imprime.

**Criterios de aceptación:**
1. *Las cifras del dashboard coinciden con una verificación manual en SQL sobre datos de prueba (al centavo):* **cumplido** (pgTAP con valores calculados a mano y la integración contra una cuenta independiente); **no verificado con ventas reales**.
2. *El admin importa 500 productos con variantes sin ayuda y entiende los errores de cada fila:* **cumplido en lo técnico** (plantilla, revisión por fila con su motivo en palabras, informe descargable, 300 variantes por HTTP y 10 000 medidas); **la prueba de usabilidad con el dueño no se hizo**.
3. *Exportaciones abren en Excel/Google Sheets con acentos y ñ:* **cumplido** (BOM, CRLF, `;` y coma decimal; verificado en el contenido del archivo descargado); **no se abrió en un Excel real**.
4. *Etiquetas y packing lists se imprimen en A4/carta y formato etiqueta:* **cumplido en PDF** (número de hojas y tamaño de papel); **no en papel real**.
5. *Los reportes respetan la zona horaria y no mezclan monedas:* **cumplido** (La Paz, una moneda por consulta, verificado con un pedido de las 23:30 y otro de las 00:15).

## Entregables para sprints siguientes
Métricas y exportaciones confiables (insumo de S16 y de la contabilidad en S17), importador reutilizable.

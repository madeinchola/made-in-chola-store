# Carga masiva (Sprint 14)

Cargar o actualizar muchos productos, existencias, precios o categorías con un archivo CSV, sin ayuda y con la seguridad de que **nada se guarda hasta confirmar** y de que **cada carga se puede revertir**. Está en `/admin/importar`. Cubre BR-CAT-05/06 (validación al importar) y BR-PRC-06.

## El recorrido

1. **Qué importar** — cuatro tipos, cada uno con su plantilla descargable (UTF-8 con BOM, separada por «;» para que Excel en español la abra bien) y la lista de sus columnas con qué va en cada una y cuáles son obligatorias.
2. **Subir el archivo** — el navegador lo lee: detecta el separador (`,` `;` tabulador o `|`) y la codificación (UTF-8 o, si no lo es, Windows-1252: las tildes y las eñes salen bien), reconoce los encabezados con o sin tildes y mayúsculas, ignora (avisando) las columnas que no son de la plantilla y **entiende los números como los escribe una persona** (`1.234,56` y `1,234.56` dan lo mismo).
3. **Revisar** — la base corre la importación **de verdad dentro de una subtransacción y la deshace**: lo que se muestra es exactamente lo que pasará al confirmar (la misma cuenta, no una copia en el navegador que podría divergir). Cuenta lo que se crearía, actualizaría, quedaría igual o fallaría, y cada fila con error explica **por qué, en palabras** (campo incluido). Se puede ver solo lo que falla y descargar el informe.
4. **Confirmar** — se aplica por bloques de 100 filas (la base corta cualquier llamada a los 8 s), con progreso y botón de detener. Las filas con error **no se importan** y quedan en el informe para corregirlas y volver a subir. Al terminar, el resumen y el informe descargable (fila del archivo, clave, qué pasó y por qué).
5. **Cargas anteriores** — el historial con el resultado y el estado de cada carga y el botón de **revertir**.

## Los cuatro tipos

| Tipo | Una fila es… | Qué hace |
| --- | --- | --- |
| **Productos con variantes** | una variante (código del producto + color + talla + SKU) | Crea el producto la primera vez que aparece su código (**como borrador**), actualiza lo que viene escrito en los existentes (vacío = no se cambia), crea el color y la talla si faltan, el precio, el costo, las categorías (por nombre; deben existir) y el stock **inicial** de las variantes nuevas. |
| **Stock (conteo)** | un SKU y las unidades que HAY | Pone el conteo real. Cada cambio es un movimiento `import` del inventario que cita el lote; **nunca baja de lo reservado** por pedidos (dejarlo exactamente en lo reservado se permite). |
| **Precios** | un producto, una moneda, un precio | Crea o actualiza el precio (mayor que cero, con los decimales de la moneda). |
| **Categorías** | una categoría y, si cuelga de otra, su padre | Crea o actualiza (por identificador). Una hija puede colgar de una categoría que viene antes en el mismo archivo. Rechaza ciclos. |

## Lo que protege el catálogo

- **Cada fila va en su propia subtransacción**: una fila con error no tumba a las demás ni deja nada a medias (un producto cuya categoría no existe no queda creado sin categoría).
- **Los errores no devuelven datos de la fila**, solo el campo y un código; los de la base de datos salen como «la base de datos no aceptó esta fila», nunca como un 500.
- **Reimportar el mismo archivo no crea ni cambia nada** (idempotente): lo que ya existe se salta; el stock de lo que ya existía **no se toca** desde la importación de productos (para eso está el tipo «Stock»).
- **Repetidos**: un SKU repetido dentro del archivo se marca desde la segunda vez (sin importar mayúsculas), también si están en bloques distintos; un SKU que ya es de otro producto o de otra variante se rechaza; una variante con el mismo color y talla pero otro SKU, también.
- **Un producto o variante archivados no se «resucitan»** con un archivo: se explica y se restaura desde el panel.
- **Dos administradores importando el mismo SKU a la vez** no duplican nada: lo resuelven los candados y los índices únicos (la integración lo prueba con 4 llamadas simultáneas: un producto, una variante, una sola «creada»).
- **Las fórmulas** (`=SUMA(...)` sin calcular) y los **números ambiguos** (`1.234`: ¿miles o decimales?) se rechazan con una explicación; no se adivina.
- **Archivos de Excel** (`.xlsx`, `.xls`, `.ods`; también si los renombran a `.csv`) se rechazan con las instrucciones para guardarlos como «CSV UTF-8».
- **Límites**: 5 MB y 10 000 filas por archivo (500 las categorías).

## Cada carga queda registrada y se puede revertir

Cada carga es un **lote** (`import_batches`) con el detalle de cada cambio y su antes y después (`import_batch_rows`). Las tablas no se leen ni se escriben desde el navegador (ni siquiera un administrador): solo las funciones `admin_import_*`, que exigen ser administrador. Abrir, cerrar y revertir un lote queda en la **auditoría** con quién lo hizo; lo que la importación escribe en el catálogo queda en la auditoría del catálogo con el mismo administrador.

**Revertir no borra**: archiva lo que el lote creó (productos, variantes, colores, tallas, categorías), quita los precios y los enlaces a categorías que puso, compensa el stock inicial con un movimiento (el libro de stock es inmutable) y devuelve lo que actualizó a su valor anterior. **Si alguien lo cambió después, se deja como está y se informa** («cambió después de la carga», «el stock cambió después de la carga»): una reversión nunca pisa trabajo posterior. Si el lote era de stock y otro lote lo movió después, hay que revertir primero el más nuevo.

Si se cierra la pestaña o se corta la red **a mitad de una importación**, lo ya aplicado queda aplicado y consistente (cada bloque es una transacción): el lote queda «en curso», se ve en el historial y se puede revertir; o se sube el mismo archivo de nuevo (lo ya aplicado se salta).

## Rendimiento (medido)

Importar **10 000 variantes** (2 000 productos × 5) en la nube, en una transacción que se revirtió: crear 54 s en total (2,3 s por bloque de 200 filas de media, 3,7 s el peor), reimportar el mismo archivo 40 s, poner el stock de las 10 000 en 31 s: unos 5 ms por fila. Por eso el bloque es de **100 filas** (el doble de margen respecto a los 8 s por llamada cuando la nube va lenta; más llamadas, el mismo tiempo total). Una carga de 300 variantes por HTTP real tarda unos 4 s.

## Límites conocidos (nada de esto está escondido)

1. **Solo CSV**; los `.xlsx` se rechazan con instrucciones.
2. **Las imágenes no se importan** (ni por URL ni por carpeta): se suben desde la pantalla de cada producto. Los productos importados nacen en **borrador** porque publicar exige imágenes.
3. **Un producto con más de 500 variantes** se parte en bloques y la revisión de la segunda parte lo ve ya «existente» (la base no acepta más de 500 filas por llamada).
4. **Las categorías de un archivo de más de 500 filas** no se admiten (se envían en un solo bloque para que una hija vea a su madre).
5. **El stock de un producto que ya existe** no se cambia desde la importación de productos; el tipo «Stock» es el único que lo mueve.
6. **No se prueba con 10 000 filas por HTTP** (eso dejaría 10 000 variantes archivadas en la nube): el rendimiento de esa cantidad se midió dentro de una transacción que se revirtió, y la carga real de 300 se prueba por la API.
7. **Una carga de varias hojas de cálculo** (productos y luego categorías) hay que hacerla en el orden de dependencia: categorías → productos → precios y stock.

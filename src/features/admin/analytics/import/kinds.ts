import type { ImportKind } from "./types";

export interface ImportColumn {
  /** Nombre del campo que entiende la base. */
  key: string;
  /** Encabezado de la plantilla (en español). */
  header: string;
  /** Otros nombres con los que se reconoce la columna (sin tildes ni mayúsculas). */
  aliases: readonly string[];
  required: boolean;
  /** Se normaliza como número (acepta «1.234,56» y «1,234.56»). */
  numeric?: boolean;
  /** Ejemplo para la plantilla. */
  example: string;
  /** Línea de ayuda de la pantalla. */
  help: string;
}

export interface ImportKindDef {
  kind: ImportKind;
  fileBase: string;
  columns: readonly ImportColumn[];
  /** Filas de ejemplo de la plantilla (cada una, en el orden de `columns`). */
  examples: readonly (readonly string[])[];
}

const col = (
  key: string,
  header: string,
  aliases: string[],
  required: boolean,
  example: string,
  help: string,
  numeric = false,
): ImportColumn => ({ key, header, aliases, required, example, help, numeric });

export const IMPORT_KINDS: Record<ImportKind, ImportKindDef> = {
  products: {
    kind: "products",
    fileBase: "plantilla-productos",
    columns: [
      col(
        "code",
        "codigo",
        ["cod", "code", "codigo_producto"],
        true,
        "BLU-001",
        "Código del producto (letras, números, punto, guion). Las filas con el mismo código son variantes del mismo producto.",
      ),
      col(
        "name",
        "nombre",
        ["name", "producto", "nombre_producto"],
        false,
        "Blusa bordada",
        "Obligatorio la primera vez que aparece un código nuevo.",
      ),
      col(
        "description",
        "descripcion",
        ["description", "detalle"],
        false,
        "Blusa de algodón bordada a mano",
        "Vacío = no se cambia.",
      ),
      col("model", "modelo", ["model"], false, "Cholita", "Vacío = no se cambia."),
      col(
        "materials",
        "materiales",
        ["materials", "material"],
        false,
        "100% algodón",
        "Vacío = no se cambia.",
      ),
      col(
        "washcare",
        "lavado",
        ["washcare", "cuidado", "cuidados"],
        false,
        "Lavar a mano",
        "Vacío = no se cambia.",
      ),
      col(
        "cost",
        "costo",
        ["cost", "costo_base", "costo_bob"],
        false,
        "60",
        "Lo que te cuesta cada unidad (hasta 2 decimales).",
        true,
      ),
      col(
        "price",
        "precio",
        ["price", "precio_bob", "precio_venta"],
        false,
        "120",
        "Precio de venta en la moneda de la fila.",
        true,
      ),
      col(
        "currency",
        "moneda",
        ["currency", "divisa"],
        false,
        "BOB",
        "Vacío = la moneda base (BOB).",
      ),
      col(
        "categories",
        "categorias",
        ["categoria", "categories", "category"],
        false,
        "Blusas|Verano",
        "Nombres separados por «|». Deben existir (impórtalas antes).",
      ),
      col("color", "color", ["colour"], true, "Rojo", "Color de la variante."),
      col(
        "color_hex",
        "color_hex",
        ["hex", "tono", "codigo_color"],
        false,
        "#C0392B",
        "Tono del color, como #RRGGBB (vacío = gris).",
      ),
      col("size", "talla", ["size", "tamano"], false, "M", "Vacío = el producto no tiene tallas."),
      col(
        "sku",
        "sku",
        ["sku_variante", "codigo_variante"],
        true,
        "BLU-001-ROJ-M",
        "Código único de la variante.",
      ),
      col(
        "stock",
        "stock",
        ["existencias", "cantidad", "inventario"],
        false,
        "10",
        "Stock INICIAL de variantes nuevas (para cambiar el de las que ya existen, usa «Stock»).",
        true,
      ),
    ],
    examples: [
      [
        "BLU-001",
        "Blusa bordada",
        "Blusa de algodón bordada a mano",
        "Cholita",
        "100% algodón",
        "Lavar a mano",
        "60",
        "120",
        "BOB",
        "Blusas",
        "Rojo",
        "#C0392B",
        "M",
        "BLU-001-ROJ-M",
        "10",
      ],
      ["BLU-001", "", "", "", "", "", "", "", "", "", "Rojo", "", "L", "BLU-001-ROJ-L", "8"],
    ],
  },
  stock: {
    kind: "stock",
    fileBase: "plantilla-stock",
    columns: [
      col(
        "sku",
        "sku",
        ["sku_variante", "codigo_variante", "codigo"],
        true,
        "BLU-001-ROJ-M",
        "SKU de una variante que ya existe.",
      ),
      col(
        "stock",
        "stock",
        ["existencias", "cantidad", "inventario", "conteo"],
        true,
        "12",
        "Cuántas unidades HAY (el conteo real, no lo que se suma). No puede ser menos de lo reservado por pedidos.",
        true,
      ),
    ],
    examples: [
      ["BLU-001-ROJ-M", "12"],
      ["BLU-001-ROJ-L", "0"],
    ],
  },
  prices: {
    kind: "prices",
    fileBase: "plantilla-precios",
    columns: [
      col(
        "code",
        "codigo",
        ["cod", "code", "codigo_producto"],
        true,
        "BLU-001",
        "Código de un producto que ya existe.",
      ),
      col(
        "currency",
        "moneda",
        ["currency", "divisa"],
        false,
        "BOB",
        "Vacío = la moneda base (BOB).",
      ),
      col(
        "price",
        "precio",
        ["price", "precio_venta"],
        true,
        "130",
        "Precio nuevo (mayor que cero, con los decimales de la moneda).",
        true,
      ),
    ],
    examples: [
      ["BLU-001", "BOB", "130"],
      ["BLU-001", "USD", "18.5"],
    ],
  },
  categories: {
    kind: "categories",
    fileBase: "plantilla-categorias",
    columns: [
      col("name", "nombre", ["name", "categoria"], true, "Blusas", "Nombre de la categoría."),
      col(
        "parent",
        "padre",
        ["parent", "categoria_padre", "subcategoria_de"],
        false,
        "",
        "Nombre de otra categoría (ya existente o puesta antes en este archivo).",
      ),
      col(
        "slug",
        "slug",
        ["identificador", "url"],
        false,
        "blusas",
        "Vacío = se arma con el nombre.",
      ),
      col(
        "description",
        "descripcion",
        ["description", "detalle"],
        false,
        "Blusas y tops",
        "Vacío = no se cambia.",
      ),
    ],
    examples: [
      ["Blusas", "", "", "Blusas y tops"],
      ["Blusas manga larga", "Blusas", "", ""],
    ],
  },
};

/** Una fila para el CSV de la plantilla: el encabezado y las filas de ejemplo. */
export function templateRows(kind: ImportKind): string[][] {
  const def = IMPORT_KINDS[kind];
  return [def.columns.map((c) => c.header), ...def.examples.map((e) => [...e])];
}

/** Encabezado del archivo → clave: sin tildes, en minúsculas y con guiones bajos («Código del producto» → «codigo_del_producto»). */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Qué clave de la plantilla es esta columna del archivo (o null: se ignora). */
export function columnFor(kind: ImportKind, header: string): ImportColumn | null {
  const wanted = normalizeHeader(header);
  if (wanted === "") return null;
  return (
    IMPORT_KINDS[kind].columns.find(
      (c) => normalizeHeader(c.header) === wanted || c.key === wanted || c.aliases.includes(wanted),
    ) ?? null
  );
}

import { describe, expect, it } from "vitest";
import { access, CATALOG_SQL, render } from "./data-dictionary.mjs";

const TABLE = {
  name: "orders",
  comment: "Pedidos de la tienda.",
  rls: true,
  policies: 2,
  anon_read: false,
  auth_read: true,
  auth_insert: false,
  auth_update: false,
  columns: [
    {
      name: "id",
      type: "uuid",
      notnull: true,
      default: "gen_random_uuid()",
      pk: true,
      fk: null,
      auth_read: true,
    },
    {
      name: "profile_id",
      type: "uuid",
      notnull: true,
      default: null,
      pk: false,
      fk: "profiles.id",
      auth_read: true,
    },
    {
      name: "note",
      type: "text",
      notnull: false,
      default: null,
      pk: false,
      fk: null,
      auth_read: false,
    },
  ],
};
const MODEL = {
  tables: [
    TABLE,
    {
      ...TABLE,
      name: "rate_limits",
      comment: null,
      rls: true,
      policies: 0,
      auth_read: false,
      columns: [],
    },
  ],
  views: [
    { name: "public_products", anon: true, auth: true, invoker: false },
    { name: "discount_usage", anon: false, auth: true, invoker: true },
  ],
  functions: [
    { name: "healthcheck", args: "", returns: "jsonb", secdef: false, who: "visitante" },
    { name: "system_health", args: "", returns: "jsonb", secdef: true, who: "servicio" },
    { name: "ayuda", args: "a text, b integer", returns: "text", secdef: false, who: "interna" },
  ],
};

describe("access", () => {
  it("dice quién toca la tabla desde el navegador, y «cerrada» si nadie", () => {
    expect(access({ anon_read: true })).toBe("la lee un visitante");
    expect(access({ auth_read: true, auth_insert: true, auth_update: true })).toBe(
      "la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza",
    );
    expect(access({})).toBe("cerrada al navegador (solo funciones del servidor)");
  });
});

describe("render", () => {
  const md = render(MODEL);

  it("es determinista: el mismo modelo da exactamente el mismo texto", () => {
    expect(render(MODEL)).toBe(md);
  });

  it("cuenta tablas, vistas y funciones en el encabezado y lista cada tabla en el índice", () => {
    expect(md).toContain("**2 tablas**, 2 vistas y 3 funciones");
    expect(md).toContain("| [`orders`](#orders) | 3 | la lee una sesión (filtrada por RLS) |");
    expect(md).toContain(
      "| [`rate_limits`](#rate_limits) | 0 | cerrada al navegador (solo funciones del servidor) |",
    );
  });

  it("cada tabla trae su comentario, su RLS y sus columnas con clave primaria en negrita, nulos, relación y lectura", () => {
    expect(md).toContain("### orders\n\nPedidos de la tienda.");
    expect(md).toContain("RLS activa · 2 políticas · la lee una sesión (filtrada por RLS).");
    expect(md).toContain("| **id** | uuid | no | gen_random_uuid() |  | sí |");
    expect(md).toContain("| profile_id | uuid | no |  | profiles.id | sí |");
    expect(md).toContain("| note | text | sí |  |  | no |");
  });

  it("una tabla sin RLS se marca en negrita (sería un fallo grave)", () => {
    expect(render({ ...MODEL, tables: [{ ...TABLE, rls: false }] })).toContain("RLS **APAGADA**");
  });

  it("las vistas dicen quién las lee y si respetan la RLS de quien consulta", () => {
    expect(md).toContain("| `public_products` | sí | sí | no (filtra por dentro) |");
    expect(md).toContain("| `discount_usage` | no | sí | sí |");
  });

  it("las funciones dicen quién las llama y escapan la barra vertical de las tablas de Markdown", () => {
    expect(md).toContain("| `healthcheck` |  | jsonb | no | visitante |");
    expect(md).toContain("| `system_health` |  | jsonb | sí | servicio |");
    expect(md).toContain("| `ayuda` | a text, b integer | text | no | interna |");
  });

  it("escapa la barra vertical de un valor por omisión para no romper la tabla de Markdown", () => {
    const piped = { ...TABLE, columns: [{ ...TABLE.columns[0], default: "'a|b'::text" }] };
    expect(render({ ...MODEL, tables: [piped] })).toContain("| 'a\\|b'::text |");
  });

  it("recorta los valores por omisión largos con una elipsis", () => {
    const long = { ...TABLE, columns: [{ ...TABLE.columns[0], default: "x".repeat(100) }] };
    expect(render({ ...MODEL, tables: [long] })).toContain(`| ${"x".repeat(59)}… |`);
  });
});

describe("la consulta del catálogo", () => {
  it("es de solo lectura y devuelve un único texto JSON", () => {
    expect(CATALOG_SQL).toMatch(/^\s*select jsonb_build_object/);
    // las palabras «insert» y «update» aparecen como NOMBRES de privilegios entre comillas; lo que no debe haber es una sentencia de escritura
    expect(CATALOG_SQL).not.toMatch(
      /(^|;)\s*(insert\s+into|update\s+\S+\s+set|delete\s+from|drop\s|alter\s|create\s|truncate\s)/i,
    );
    expect(CATALOG_SQL.split(";").length).toBe(1);
    expect(CATALOG_SQL.trim().endsWith("::text")).toBe(true);
  });
});

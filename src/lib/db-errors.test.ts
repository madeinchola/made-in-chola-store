import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { fromDbError } from "./db-errors";

describe("fromDbError", () => {
  const cases: [string, string, AppError["code"]][] = [
    ["42501", "permission denied for table x", "forbidden"],
    ["PGRST301", "JWT expired", "unauthorized"],
    ["PGRST303", "JWT invalid", "unauthorized"],
    ["P0002", "variante inexistente", "not_found"],
    ["23505", "duplicate key", "conflict"],
    ["23503", "violates foreign key", "conflict"],
    ["P0001", "no puedes dejar el stock en 24", "conflict"],
    ["23514", "violates check constraint", "validation"],
    ["22023", "motivo inválido", "validation"],
    ["22P02", "invalid input syntax for type uuid", "validation"],
    ["22001", "value too long", "validation"],
    ["XX000", "internal error", "unknown"],
  ];

  it.each(cases)("código %s → %s", (code, message, expected) => {
    const e = fromDbError({ code, message });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe(expected);
  });

  it("sin código → unknown", () => {
    expect(fromDbError({ message: "boom" }).code).toBe("unknown");
  });

  it("conserva el mensaje de reglas de negocio (están en español y pensados para el usuario)", () => {
    expect(fromDbError({ code: "P0001", message: "no puedes dejar el stock en 24" }).message).toBe(
      "no puedes dejar el stock en 24",
    );
    expect(
      fromDbError({ code: "23514", message: "el precio 10.999 tiene más de 2 decimales" }).message,
    ).toBe("el precio 10.999 tiene más de 2 decimales");
  });

  it("NO filtra mensajes internos: permisos y desconocidos usan un texto genérico", () => {
    const forbidden = fromDbError({
      code: "42501",
      message: 'permission denied for table "profiles"',
    });
    expect(forbidden.message).not.toContain("profiles");
    const unknown = fromDbError({
      code: "XX000",
      message: "relation public.secret does not exist",
    });
    expect(unknown.message).not.toContain("secret");
  });

  it("guarda el error original como causa (para el log) y trae un id de correlación", () => {
    const original = { code: "23505", message: "dup" };
    const e = fromDbError(original);
    expect(e.cause).toBe(original);
    expect(e.correlationId).toMatch(/\S+/);
  });
});

describe("fromDbError: mensajes estándar de Postgres (inglés) vs reglas de negocio (español)", () => {
  const uniq = (name: string) => `duplicate key value violates unique constraint "${name}"`;

  it.each([
    ["products_code_key", "Ya existe un producto con ese código."],
    ["products_slug_key", "Esa dirección (slug) ya la usa otro producto."],
    ["categories_slug_key", "Ya existe una categoría con esa dirección (slug)."],
    ["collections_slug_key", "Ya existe una colección con esa dirección (slug)."],
    ["product_colors_name_key", "Ese color ya existe en este producto."],
    ["product_sizes_label_key", "Esa talla ya existe en este producto."],
    ["product_variants_color_size_key", "Esa combinación de color y talla ya existe."],
    ["product_variants_sku_key", "Ese SKU ya está en uso."],
    ["product_prices_currency_key", "Ese producto ya tiene precio en esa moneda."],
  ])("23505 sobre %s → mensaje claro en español", (constraint, expected) => {
    const e = fromDbError({ code: "23505", message: uniq(constraint) });
    expect(e.code).toBe("conflict");
    expect(e.message).toBe(expected);
  });

  it("23505 de una restricción desconocida → genérico, sin filtrar su nombre", () => {
    const e = fromDbError({ code: "23505", message: uniq("tabla_secreta_idx") });
    expect(e.message).toBe("Ya existe un registro con esos datos.");
    expect(e.message).not.toContain("secreta");
  });

  it("23505 lanzado por NUESTRAS funciones (español) se conserva tal cual", () => {
    expect(
      fromDbError({ code: "23505", message: "ya existe un producto con el código T-1" }).message,
    ).toBe("ya existe un producto con el código T-1");
  });

  it("23503 estándar → genérico; el de nuestras funciones se conserva", () => {
    const std = fromDbError({
      code: "23503",
      message: 'update or delete on table "categories" violates foreign key constraint "x_fkey"',
    });
    expect(std.message).toBe(
      "No se puede completar: este dato está relacionado con otros registros.",
    );
    expect(std.message).not.toContain("categories");
    expect(fromDbError({ code: "23503", message: "la categoría tiene productos" }).message).toBe(
      "la categoría tiene productos",
    );
  });

  it("23514 estándar → genérico sin nombres de tabla; el de nuestras reglas se conserva", () => {
    const std = fromDbError({
      code: "23514",
      message: 'new row for relation "products" violates check constraint "products_code_check"',
    });
    expect(std.message).toBe(
      "Algún dato no cumple las reglas permitidas. Revisa los valores ingresados.",
    );
    expect(std.message).not.toContain("products");
  });

  it("22P02 y 22001 estándar → mensajes claros sin detalles internos", () => {
    const uuid = fromDbError({
      code: "22P02",
      message: 'invalid input syntax for type uuid: "abc"',
    });
    expect(uuid.message).toBe("Algún dato tiene un formato no válido.");
    expect(uuid.message).not.toContain("uuid");
    const long = fromDbError({
      code: "22001",
      message: "value too long for type character varying(160)",
    });
    expect(long.message).toBe("Algún texto es demasiado largo.");
    expect(long.message).not.toContain("160");
  });
});

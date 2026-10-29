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

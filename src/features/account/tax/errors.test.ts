import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { fromTaxDbError, TaxProfileError, taxNotFound } from "./errors";

const CHECK = (name: string) =>
  `new row for relation "tax_profiles" violates check constraint "${name}"`;
const UNIQUE = (name: string) => `duplicate key value violates unique constraint "${name}"`;

describe("fromTaxDbError", () => {
  it("tope de 10 activos (mensaje de la regla de negocio de la base)", () => {
    const error = fromTaxDbError({
      code: "23514",
      message: "Alcanzaste el máximo de 10 registros activos; archiva alguno para agregar otro",
    });
    expect(error).toBeInstanceOf(TaxProfileError);
    expect(error).toMatchObject({
      reason: "cap",
      code: "validation",
      message: "Llegaste al máximo de 10 datos fiscales activos. Archiva alguno para agregar otro.",
    });
  });

  it.each([
    ["tax_profiles_doc_number", "doc_format", "El documento no tiene un formato válido."],
    [
      "tax_profiles_legal_name",
      "legal_name",
      "La razón social debe tener entre 1 y 160 caracteres.",
    ],
    ["tax_profiles_doc_type", "doc_type", "El tipo de documento no es válido."],
  ])("restricción %s → %s", (constraint, reason, message) => {
    expect(fromTaxDbError({ code: "23514", message: CHECK(constraint) })).toMatchObject({
      reason,
      code: "validation",
      message,
    });
  });

  it("otra restricción CHECK → mensaje genérico de la capa común (no el texto de Postgres)", () => {
    const error = fromTaxDbError({ code: "23514", message: CHECK("otra_cosa") });
    expect(error).not.toBeInstanceOf(TaxProfileError);
    expect(error.message).toBe(
      "Algún dato no cumple las reglas permitidas. Revisa los valores ingresados.",
    );
  });

  it("documento repetido entre los activos (índice tax_profiles_no_dup_idx)", () => {
    expect(
      fromTaxDbError({ code: "23505", message: UNIQUE("tax_profiles_no_dup_idx") }),
    ).toMatchObject({
      reason: "duplicate",
      code: "conflict",
      message: "Ya tienes datos fiscales activos con ese documento.",
    });
  });

  it("otra unicidad (p. ej. dos predeterminados a la vez) → cambio simultáneo", () => {
    expect(
      fromTaxDbError({ code: "23505", message: UNIQUE("tax_profiles_one_default_idx") }),
    ).toMatchObject({
      reason: "conflict",
      message: "Los datos cambiaron mientras los editabas. Inténtalo de nuevo.",
    });
  });

  it("lo demás pasa por la traducción común y nunca muestra el texto interno", () => {
    expect(
      fromTaxDbError({ code: "42501", message: "permission denied for table tax_profiles" }),
    ).toMatchObject({
      code: "forbidden",
      message: "No tienes permiso para realizar esta acción.",
    });
    const unknown = fromTaxDbError({ code: "XX000", message: "detalle interno con 1234567" });
    expect(unknown).toBeInstanceOf(AppError);
    expect(unknown.message).toBe("No se pudo completar la operación. Inténtalo de nuevo.");
    expect(unknown.message).not.toContain("1234567");
  });

  it("conserva la causa original (para el registro técnico, no para mostrarla)", () => {
    const cause = { code: "23505", message: UNIQUE("tax_profiles_no_dup_idx") };
    expect(fromTaxDbError(cause).cause).toBe(cause);
  });
});

describe("taxNotFound", () => {
  it("not_found con mensaje en español", () => {
    expect(taxNotFound()).toMatchObject({
      reason: "not_found",
      code: "not_found",
      message: "Esos datos fiscales ya no existen. Actualiza la página.",
    });
  });
});

import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { fromAddressDbError, isSessionError } from "./errors";

const pg = (code: string | undefined, message: string) => ({
  ...(code === undefined ? {} : { code }),
  message,
});
const check = (constraint: string) =>
  pg("23514", `new row for relation "addresses" violates check constraint "${constraint}"`);

describe("fromAddressDbError", () => {
  it("tope de 20 activas: mensaje en español propio, código `validation`", () => {
    const error = fromAddressDbError(
      pg("23514", "Alcanzaste el máximo de 20 registros activos; archiva alguno para agregar otro"),
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("validation");
    expect(error.message).toBe(
      "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar o restaurar otra.",
    );
  });

  it.each([
    ["addresses_phone_required", "La dirección necesita un teléfono de contacto válido."],
    ["addresses_phone_format", "La dirección necesita un teléfono de contacto válido."],
    [
      "addresses_coords_pair",
      "La ubicación del mapa no es válida: revisa la latitud y la longitud, o quita el pin.",
    ],
    [
      "addresses_lat_range",
      "La ubicación del mapa no es válida: revisa la latitud y la longitud, o quita el pin.",
    ],
    [
      "addresses_lng_range",
      "La ubicación del mapa no es válida: revisa la latitud y la longitud, o quita el pin.",
    ],
    ["addresses_purpose", "Elige al menos un uso para la dirección: envío o facturación."],
    [
      "addresses_label_len",
      "Algún texto de la dirección está vacío o es demasiado largo. Revísalo e inténtalo de nuevo.",
    ],
    [
      "addresses_recipient_len",
      "Algún texto de la dirección está vacío o es demasiado largo. Revísalo e inténtalo de nuevo.",
    ],
    [
      "addresses_line1_len",
      "Algún texto de la dirección está vacío o es demasiado largo. Revísalo e inténtalo de nuevo.",
    ],
    [
      "addresses_line2_len",
      "Algún texto de la dirección está vacío o es demasiado largo. Revísalo e inténtalo de nuevo.",
    ],
    [
      "addresses_city_len",
      "Algún texto de la dirección está vacío o es demasiado largo. Revísalo e inténtalo de nuevo.",
    ],
    [
      "addresses_department_len",
      "Algún texto de la dirección está vacío o es demasiado largo. Revísalo e inténtalo de nuevo.",
    ],
    [
      "addresses_reference_len",
      "Algún texto de la dirección está vacío o es demasiado largo. Revísalo e inténtalo de nuevo.",
    ],
  ])("restricción %s → texto en español, nunca el mensaje en inglés", (constraint, text) => {
    const error = fromAddressDbError(check(constraint));
    expect(error.code).toBe("validation");
    expect(error.message).toBe(text);
    expect(error.message).not.toMatch(/violates|relation|constraint/i);
  });

  it("una restricción desconocida cae en el mensaje genérico de reglas (sin nombres técnicos)", () => {
    const error = fromAddressDbError(check("addresses_inventada"));
    expect(error.code).toBe("validation");
    expect(error.message).toBe(
      "Algún dato no cumple las reglas permitidas. Revisa los valores ingresados.",
    );
  });

  it("país no habilitado (trigger) o inexistente (clave foránea)", () => {
    const text = "Ese país no está disponible para entregas.";
    const fromTrigger = fromAddressDbError(
      pg("22023", "Ese país no está disponible para entregas"),
    );
    expect(fromTrigger.code).toBe("validation");
    expect(fromTrigger.message).toBe(text);
    const fromFk = fromAddressDbError(
      pg(
        "23503",
        'insert or update on table "addresses" violates foreign key constraint "addresses_country_fkey"',
      ),
    );
    expect(fromFk.message).toBe(text);
  });

  it("otro 22023 (que no habla de países) conserva el comportamiento general", () => {
    const error = fromAddressDbError(pg("22023", "La moneda preferida no está habilitada"));
    expect(error.code).toBe("validation");
    expect(error.message).toBe("La moneda preferida no está habilitada");
  });

  it("sesión: JWT vencido → unauthorized; permiso/RLS → forbidden", () => {
    const expired = fromAddressDbError(pg("PGRST301", "JWT expired"));
    expect(expired.code).toBe("unauthorized");
    expect(expired.message).toBe("Tu sesión venció. Inicia sesión de nuevo.");
    expect(fromAddressDbError(pg("PGRST303", "JWT invalid")).code).toBe("unauthorized");
    const denied = fromAddressDbError(pg("42501", 'permission denied for table "addresses"'));
    expect(denied.code).toBe("forbidden");
    expect(denied.message).toBe(
      "No tienes permiso para guardar esta dirección. Tu sesión pudo haber vencido: inicia sesión de nuevo.",
    );
  });

  it("dirección inexistente (P0002)", () => {
    const error = fromAddressDbError(pg("P0002", "no data found"));
    expect(error.code).toBe("not_found");
    expect(error.message).toBe(
      "No encontramos esa dirección. Recarga la lista e inténtalo otra vez.",
    );
  });

  it.each([
    "TypeError: Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ])("sin conexión (%s) → network", (message) => {
    const error = fromAddressDbError(pg(undefined, message));
    expect(error.code).toBe("network");
    expect(error.message).toBe(
      "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.",
    );
  });

  it("un mensaje de red CON código de Postgres no se toma por falta de conexión", () => {
    expect(fromAddressDbError(pg("XX000", "Failed to fetch something")).code).toBe("unknown");
  });

  it("lo desconocido se oculta tras el mensaje general (jamás el texto interno)", () => {
    const error = fromAddressDbError(pg("XX000", "relation internal_table exploded at 0xdeadbeef"));
    expect(error.code).toBe("unknown");
    expect(error.message).toBe("No se pudo completar la operación. Inténtalo de nuevo.");
  });

  it("conserva el error original como causa (para el registro, no para la pantalla)", () => {
    const original = check("addresses_purpose");
    expect(fromAddressDbError(original).cause).toBe(original);
    const session = pg("42501", "denied");
    expect(fromAddressDbError(session).cause).toBe(session);
  });
});

describe("isSessionError", () => {
  it("unauthorized y forbidden son de sesión; el resto no", () => {
    expect(isSessionError(new AppError("unauthorized", "x"))).toBe(true);
    expect(isSessionError(new AppError("forbidden", "x"))).toBe(true);
    for (const code of ["validation", "conflict", "network", "not_found", "unknown"] as const) {
      expect(isSessionError(new AppError(code, "x"))).toBe(false);
    }
    expect(isSessionError(new Error("unauthorized"))).toBe(false);
    expect(isSessionError("unauthorized")).toBe(false);
    expect(isSessionError(null)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  parseTaxIdMode,
  taxIdHint,
  taxIdMessage,
  validateTaxId,
  type TaxDocType,
  type TaxIdFailure,
  type TaxIdMode,
} from "./taxId";

const ok = (value: string) => ({ ok: true, value });
const bad = (reason: TaxIdFailure) => ({ ok: false, reason });

// Todos los casos están calculados a mano contando dígitos y caracteres (no copiados de la salida del código).
describe("validateTaxId · CI (estricto: 4 a 10 dígitos + complemento opcional)", () => {
  it.each([
    ["1234", ok("1234")], // 4 dígitos: el mínimo
    ["1234567", ok("1234567")],
    ["1234567890", ok("1234567890")], // 10 dígitos: el máximo
    ["0001234", ok("0001234")], // los ceros a la izquierda se conservan
  ])("%s", (input, expected) => {
    expect(validateTaxId("ci", input)).toEqual(expected);
  });

  it("3 dígitos es demasiado corto y 11 demasiado largo (bordes exactos)", () => {
    expect(validateTaxId("ci", "123")).toEqual(bad("too_short"));
    expect(validateTaxId("ci", "12345678901")).toEqual(bad("too_long"));
  });

  it.each([
    ["1234567-1A", "1234567-1A"],
    ["1234567 1A", "1234567-1A"], // el espacio pasa a guion: forma canónica
    ["1234567-A", "1234567-A"],
    ["1234567 A", "1234567-A"],
    ["1234567-1a", "1234567-1A"], // sin distinguir mayúsculas
    ["1234567 a", "1234567-A"],
    ["1234567  1A", "1234567-1A"], // espacios repetidos se compactan
    ["  1234567-1A  ", "1234567-1A"], // espacios de los extremos fuera
    ["1234567 1A", "1234567-1A"], // espacio duro (NBSP) tratado como espacio
  ])("complemento válido «%s» → %s", (input, canonical) => {
    expect(validateTaxId("ci", input)).toEqual(ok(canonical));
  });

  it.each([
    "1234567-1", // el complemento no puede ser solo un dígito
    "1234567-AB", // ni dos letras
    "1234567-1AB",
    "1234567-11",
    "1234567A", // sin separador no hay complemento
    "1234567-", // separador sin complemento
    "1234567 - 1A", // espacios alrededor del guion
    "1234567-1-A",
    "12.345.678", // puntos
    "abcd", // letras
    "12a4567",
    "١٢٣٤٥٦٧", // dígitos arábigos orientales: solo 0-9 ASCII
  ])("formato inválido: «%s»", (input) => {
    expect(validateTaxId("ci", input)).toEqual(bad("invalid_format"));
  });

  it("la longitud se mide SOLO sobre los dígitos y manda antes que el formato del complemento", () => {
    expect(validateTaxId("ci", "123-1A")).toEqual(bad("too_short")); // 3 dígitos
    expect(validateTaxId("ci", "12345678901-1A")).toEqual(bad("too_long")); // 11 dígitos
    expect(validateTaxId("ci", "123-ZZZ")).toEqual(bad("too_short")); // complemento malo, pero antes falla la longitud
  });

  it("vacío o solo espacios", () => {
    expect(validateTaxId("ci", "")).toEqual(bad("empty"));
    expect(validateTaxId("ci", "   ")).toEqual(bad("empty"));
    expect(validateTaxId("ci", "\t\n")).toEqual(bad("empty"));
  });
});

describe("validateTaxId · NIT (estricto: 7 a 13 dígitos)", () => {
  it("bordes exactos: 6 corto · 7 · 13 · 14 largo", () => {
    expect(validateTaxId("nit", "123456")).toEqual(bad("too_short"));
    expect(validateTaxId("nit", "1234567")).toEqual(ok("1234567"));
    expect(validateTaxId("nit", "1234567890123")).toEqual(ok("1234567890123"));
    expect(validateTaxId("nit", "12345678901234")).toEqual(bad("too_long"));
  });

  it.each(["1234567A", "123-4567", "1234567 8", "12.34567", "ABCDEFG", "1234567-1"])(
    "solo números: «%s» es inválido",
    (input) => {
      expect(validateTaxId("nit", input)).toEqual(bad("invalid_format"));
    },
  );

  it("espacios de los extremos fuera", () => {
    expect(validateTaxId("nit", "  1020304021 ")).toEqual(ok("1020304021"));
  });
});

describe.each<[TaxDocType, number, number]>([
  ["ce", 5, 20],
  ["pas", 5, 20],
  ["otro", 3, 20],
])("validateTaxId · %s (estricto: %i a %i letras o números)", (type, min, max) => {
  it("bordes exactos de longitud", () => {
    expect(validateTaxId(type, "A".repeat(min - 1))).toEqual(bad("too_short"));
    expect(validateTaxId(type, "A".repeat(min))).toEqual(ok("A".repeat(min)));
    expect(validateTaxId(type, "A1".repeat(max / 2))).toEqual(ok("A1".repeat(max / 2)));
    expect(validateTaxId(type, "A".repeat(max + 1))).toEqual(bad("too_long"));
  });

  it("mayúsculas a la salida; separadores y letras no ASCII son inválidos", () => {
    expect(validateTaxId(type, "ab123")).toEqual(ok("AB123"));
    expect(validateTaxId(type, "AB-123")).toEqual(bad("invalid_format"));
    expect(validateTaxId(type, "AB 123")).toEqual(bad("invalid_format"));
    expect(validateTaxId(type, "AB.123")).toEqual(bad("invalid_format"));
    expect(validateTaxId(type, "AÑ123")).toEqual(bad("invalid_format"));
    expect(validateTaxId(type, "ııııı")).toEqual(bad("invalid_format")); // «ı» turca: mayúscula «I», pero NO es ASCII
  });
});

describe("validateTaxId · lenient (3 a 24 caracteres, sin importar el tipo)", () => {
  const types: TaxDocType[] = ["ci", "nit", "ce", "pas", "otro"];

  it.each(types)(
    "bordes exactos de longitud con el tipo %s: 2 corto · 3 · 24 · 25 largo",
    (type) => {
      expect(validateTaxId(type, "AB", "lenient")).toEqual(bad("too_short"));
      expect(validateTaxId(type, "ABC", "lenient")).toEqual(ok("ABC"));
      expect(validateTaxId(type, "A".repeat(24), "lenient")).toEqual(ok("A".repeat(24)));
      expect(validateTaxId(type, "A".repeat(25), "lenient")).toEqual(bad("too_long"));
    },
  );

  it("acepta lo que el nivel estricto rechazaría (separadores, tipo que no coincide)", () => {
    expect(validateTaxId("nit", "12.345/678-9", "lenient")).toEqual(ok("12.345/678-9"));
    expect(validateTaxId("nit", "AB-123", "lenient")).toEqual(ok("AB-123"));
    expect(validateTaxId("ci", "1234567890123456", "lenient")).toEqual(ok("1234567890123456")); // 16 dígitos
    expect(validateTaxId("ci", "1234567 1a", "lenient")).toEqual(ok("1234567 1A")); // no reescribe el CI
    expect(validateTaxId("nit", "123456", "strict")).toEqual(bad("too_short")); // …y el estricto sí lo exige
  });

  it("mayúsculas, espacios compactados y recortados; la longitud se cuenta ya normalizada", () => {
    expect(validateTaxId("otro", "  ab   cd  ", "lenient")).toEqual(ok("AB CD"));
    expect(validateTaxId("otro", "a  b", "lenient")).toEqual(ok("A B")); // 3 caracteres tras compactar
  });

  it.each(["-ABC", ".ABC", "/ABC", "AB#C", "AB_C", "ÁBC", "AB€"])(
    "carácter o inicio no permitido: «%s»",
    (input) => {
      expect(validateTaxId("otro", input, "lenient")).toEqual(bad("invalid_format"));
    },
  );

  it("vacío", () => {
    expect(validateTaxId("ci", "", "lenient")).toEqual(bad("empty"));
    expect(validateTaxId("ci", "  ", "lenient")).toEqual(bad("empty"));
  });
});

describe("parseTaxIdMode", () => {
  it("solo «lenient» activa el nivel flexible; todo lo demás (incluido un ajuste que no cargó) es estricto", () => {
    expect(parseTaxIdMode("lenient")).toBe("lenient");
    expect(parseTaxIdMode("strict")).toBe("strict");
    expect(parseTaxIdMode(undefined)).toBe("strict");
    expect(parseTaxIdMode(null)).toBe("strict");
    expect(parseTaxIdMode("LENIENT")).toBe("strict");
    expect(parseTaxIdMode(true)).toBe("strict");
    expect(parseTaxIdMode(1)).toBe("strict");
  });

  it("validateTaxId sin modo es estricto", () => {
    expect(validateTaxId("nit", "123")).toEqual(bad("too_short"));
  });
});

describe("mensajes", () => {
  const cases: [TaxDocType, TaxIdFailure, TaxIdMode, string][] = [
    ["ci", "too_short", "strict", "El CI debe tener al menos 4 dígitos."],
    ["ci", "too_long", "strict", "El CI debe tener como máximo 10 dígitos."],
    [
      "ci",
      "invalid_format",
      "strict",
      "El CI lleva solo números y, si corresponde, un complemento separado por guion o espacio (por ejemplo 1234567-1A).",
    ],
    ["nit", "too_short", "strict", "El NIT debe tener al menos 7 dígitos."],
    ["nit", "too_long", "strict", "El NIT debe tener como máximo 13 dígitos."],
    ["nit", "invalid_format", "strict", "El NIT lleva solo números."],
    ["ce", "too_short", "strict", "El carnet de extranjería debe tener al menos 5 caracteres."],
    ["ce", "too_long", "strict", "El carnet de extranjería debe tener como máximo 20 caracteres."],
    ["pas", "too_short", "strict", "El pasaporte debe tener al menos 5 caracteres."],
    [
      "pas",
      "invalid_format",
      "strict",
      "El pasaporte lleva solo letras y números, sin espacios ni símbolos.",
    ],
    ["otro", "too_short", "strict", "El documento debe tener al menos 3 caracteres."],
    ["otro", "too_long", "strict", "El documento debe tener como máximo 20 caracteres."],
    ["ci", "too_short", "lenient", "El documento debe tener al menos 3 caracteres."],
    ["nit", "too_long", "lenient", "El documento debe tener como máximo 24 caracteres."],
    [
      "otro",
      "invalid_format",
      "lenient",
      "Usa solo letras, números, espacios, puntos, barras o guiones, y empieza con una letra o un número.",
    ],
    ["ci", "empty", "strict", "Ingresa el número de documento."],
    ["nit", "empty", "lenient", "Ingresa el número de documento."],
  ];
  it.each(cases)("%s · %s · %s", (type, reason, mode, expected) => {
    expect(taxIdMessage(type, reason, mode)).toBe(expected);
  });

  it("la ayuda dice el formato esperado de cada tipo y nivel", () => {
    expect(taxIdHint("ci", "strict")).toBe(
      "4 a 10 dígitos, con complemento opcional (por ejemplo 1234567-1A).",
    );
    expect(taxIdHint("nit", "strict")).toBe("7 a 13 dígitos, solo números.");
    expect(taxIdHint("ce", "strict")).toBe("5 a 20 letras o números.");
    expect(taxIdHint("pas", "strict")).toBe("5 a 20 letras o números.");
    expect(taxIdHint("otro", "strict")).toBe("3 a 20 letras o números.");
    expect(taxIdHint("nit", "lenient")).toBe(
      "Letras, números, espacios, puntos, barras o guiones (3 a 24 caracteres).",
    );
  });
});

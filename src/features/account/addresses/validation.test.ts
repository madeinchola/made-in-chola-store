import { describe, expect, it } from "vitest";
import type { Address } from "./types";
import {
  addressFormSchema,
  addressToFormValues,
  BOLIVIA_DEPARTMENTS,
  canonicalDepartment,
  charLength,
  createAddressSchema,
  FIELD_LIMITS,
  toAddressInput,
  type AddressFormValues,
} from "./validation";

const valid: AddressFormValues = {
  label: "Casa",
  recipient: "Ana Cliente",
  phoneCountry: "BO",
  phone: "7123 4567",
  country: "BO",
  department: "La Paz",
  city: "La Paz",
  line1: "Calle 21 de Calacoto #123",
  line2: "",
  referenceText: "",
  lat: "",
  lng: "",
  forShipping: true,
  forBilling: false,
  isDefault: false,
};

/** Primer mensaje de error por campo (o un objeto vacío si el formulario es válido). */
function errorsOf(values: Partial<AddressFormValues>, schema = addressFormSchema) {
  const result = schema.safeParse({ ...valid, ...values });
  if (result.success) return {} as Record<string, string>;
  const byField: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]);
    byField[field] ??= issue.message;
  }
  return byField;
}

describe("esquema de dirección · caso válido", () => {
  it("acepta los valores mínimos válidos", () => {
    expect(addressFormSchema.safeParse(valid).success).toBe(true);
  });

  it("recorta los espacios de los textos", () => {
    const result = addressFormSchema.parse({
      ...valid,
      label: "  Casa  ",
      recipient: "  Ana  ",
      city: " La Paz ",
      line1: " Calle 1 ",
      line2: "  ",
      referenceText: "  ",
    });
    expect(result).toMatchObject({
      label: "Casa",
      recipient: "Ana",
      city: "La Paz",
      line1: "Calle 1",
      line2: "",
      referenceText: "",
    });
  });
});

describe("esquema de dirección · límites exactos de la base (en caracteres)", () => {
  it("los límites son los CHECK de la tabla: 40 / 120 / 200 / 200 / 80 / 80 / 300", () => {
    expect(FIELD_LIMITS).toEqual({
      label: 40,
      recipient: 120,
      line1: 200,
      line2: 200,
      city: 80,
      department: 80,
      referenceText: 300,
    });
  });

  it.each([
    ["label", 40, "La etiqueta admite hasta 40 caracteres."],
    ["recipient", 120, "El nombre admite hasta 120 caracteres."],
    ["line1", 200, "La calle y el número admiten hasta 200 caracteres."],
    ["line2", 200, "Este dato admite hasta 200 caracteres."],
    ["city", 80, "La ciudad admite hasta 80 caracteres."],
    ["referenceText", 300, "La referencia admite hasta 300 caracteres."],
  ] as const)("%s: %i caracteres pasan, uno más no", (field, max, message) => {
    expect(errorsOf({ [field]: "a".repeat(max) })[field]).toBeUndefined();
    expect(errorsOf({ [field]: "a".repeat(max + 1) })[field]).toBe(message);
  });

  it("departamento (país distinto de Bolivia): 80 pasan, 81 no", () => {
    expect(errorsOf({ country: "AR", department: "d".repeat(80) }).department).toBeUndefined();
    expect(errorsOf({ country: "AR", department: "d".repeat(81) }).department).toBe(
      "Este dato admite hasta 80 caracteres.",
    );
  });

  it("el largo se cuenta DESPUÉS de recortar (espacios sobrantes no cuentan)", () => {
    expect(errorsOf({ label: `  ${"a".repeat(40)}  ` }).label).toBeUndefined();
    expect(errorsOf({ label: `  ${"a".repeat(41)}  ` }).label).toBeDefined();
  });

  it("se cuentan caracteres, no unidades UTF-16: 40 emojis caben en una etiqueta de 40 (como char_length)", () => {
    const forty = "😀".repeat(40); // 80 unidades UTF-16 pero 40 caracteres
    expect(forty.length).toBe(80);
    expect(errorsOf({ label: forty }).label).toBeUndefined();
    expect(errorsOf({ label: "😀".repeat(41) }).label).toBe(
      "La etiqueta admite hasta 40 caracteres.",
    );
  });

  it("charLength cuenta puntos de código", () => {
    expect(charLength("")).toBe(0);
    expect(charLength("ñandú")).toBe(5);
    expect(charLength("a😀b")).toBe(3);
  });
});

describe("esquema de dirección · obligatorios y opcionales", () => {
  it.each([
    ["label", "Escribe un nombre para reconocer la dirección."],
    ["recipient", "Escribe quién recibe el pedido."],
    ["city", "Escribe la ciudad."],
    ["line1", "Escribe la calle y el número."],
  ] as const)("%s vacío o solo espacios es obligatorio", (field, message) => {
    expect(errorsOf({ [field]: "" })[field]).toBe(message);
    expect(errorsOf({ [field]: "   " })[field]).toBe(message);
  });

  it("línea 2 y referencia son opcionales", () => {
    expect(errorsOf({ line2: "", referenceText: "" })).toEqual({});
  });
});

describe("esquema de dirección · teléfono", () => {
  it("el celular boliviano válido (con o sin máscara) pasa", () => {
    expect(errorsOf({ phone: "7123 4567" }).phone).toBeUndefined();
    expect(errorsOf({ phone: "71234567" }).phone).toBeUndefined();
    expect(errorsOf({ phone: "67654321" }).phone).toBeUndefined();
  });

  it.each([
    ["", "Ingresa tu teléfono."],
    ["   ", "Ingresa tu teléfono."],
    ["abc", "El teléfono solo puede tener números, espacios y guiones."],
    ["712", "El teléfono es demasiado corto."],
    ["51234567", "Ingresa un celular boliviano de 8 dígitos que empiece en 6 o 7."], // empieza en 5
    ["7123456789", "El teléfono es demasiado largo."],
  ])("teléfono %j de Bolivia → %s", (phone, message) => {
    expect(errorsOf({ phone }).phone).toBe(message);
  });

  it("otro país: el prefijo del selector se aplica al número nacional", () => {
    expect(errorsOf({ phoneCountry: "ES", phone: "6123 4567 8" }).phone).toBeUndefined();
    expect(errorsOf({ phoneCountry: "ES", phone: "612" }).phone).toBe(
      "El teléfono es demasiado corto.",
    );
  });

  it("un número internacional con «+» vale con cualquier prefijo del selector", () => {
    expect(errorsOf({ phoneCountry: "BO", phone: "+34 612 345 678" }).phone).toBeUndefined();
  });

  it("un prefijo que no existe es un error del selector, no del número", () => {
    const errors = errorsOf({ phoneCountry: "ZZ" });
    expect(errors.phoneCountry).toBe("Elige el código de país del teléfono.");
    expect(errors.phone).toBeUndefined();
    // Las propiedades heredadas de Object tampoco son países.
    expect(errorsOf({ phoneCountry: "constructor" }).phoneCountry).toBeDefined();
  });
});

describe("esquema de dirección · país y departamento", () => {
  it("el país debe ser un código ISO-2 en mayúsculas", () => {
    for (const country of ["", "bo", "BOL", "B1", "B "]) {
      expect(errorsOf({ country, department: "" }).country).toBe("Elige un país de la lista.");
    }
    expect(errorsOf({ country: "AR", department: "" }).country).toBeUndefined();
  });

  it("con lista de países habilitados, solo valen esos", () => {
    const schema = createAddressSchema({ allowedCountries: ["BO"] });
    expect(errorsOf({}, schema).country).toBeUndefined();
    expect(errorsOf({ country: "AR", department: "" }, schema).country).toBe(
      "Elige un país de la lista.",
    );
  });

  it("Bolivia exige un departamento de la lista", () => {
    expect(errorsOf({ department: "" }).department).toBe("Elige un departamento.");
    expect(errorsOf({ department: "Lima" }).department).toBe("Elige un departamento de la lista.");
  });

  it("los 9 departamentos de Bolivia, y solo esos", () => {
    expect([...BOLIVIA_DEPARTMENTS]).toEqual([
      "La Paz",
      "Cochabamba",
      "Santa Cruz",
      "Oruro",
      "Potosí",
      "Chuquisaca",
      "Tarija",
      "Beni",
      "Pando",
    ]);
    for (const department of BOLIVIA_DEPARTMENTS) {
      expect(errorsOf({ department }).department).toBeUndefined();
    }
  });

  it("el departamento no distingue mayúsculas ni tildes", () => {
    expect(errorsOf({ department: "santa cruz" }).department).toBeUndefined();
    expect(errorsOf({ department: "POTOSI" }).department).toBeUndefined();
    expect(errorsOf({ department: "Potosí" }).department).toBeUndefined();
  });

  it("otro país: texto libre y OPCIONAL", () => {
    expect(errorsOf({ country: "AR", department: "" }).department).toBeUndefined();
    expect(errorsOf({ country: "AR", department: "Buenos Aires" }).department).toBeUndefined();
    expect(errorsOf({ country: "AR", department: "Lima" }).department).toBeUndefined();
  });

  it("canonicalDepartment devuelve el nombre oficial o null", () => {
    expect(canonicalDepartment("potosi")).toBe("Potosí");
    expect(canonicalDepartment("  LA PAZ ")).toBe("La Paz");
    expect(canonicalDepartment("Lima")).toBeNull();
    expect(canonicalDepartment("")).toBeNull();
  });
});

describe("esquema de dirección · pin opcional (latitud y longitud juntas)", () => {
  it("sin pin es válido; con pin válido también (punto o coma)", () => {
    expect(errorsOf({ lat: "", lng: "" })).toEqual({});
    expect(errorsOf({ lat: "-16.5", lng: "-68.15" })).toEqual({});
    expect(errorsOf({ lat: "-16,5", lng: "-68,15" })).toEqual({});
  });

  it("pin a medias: el error va en el campo que falta", () => {
    expect(errorsOf({ lat: "-16.5", lng: "" })).toEqual({
      lng: "Escribe también la longitud, o borra la latitud para no usar pin.",
    });
    expect(errorsOf({ lat: "", lng: "-68.15" })).toEqual({
      lat: "Escribe también la latitud, o borra la longitud para no usar pin.",
    });
  });

  it("rangos inclusivos: lat ±90, lng ±180", () => {
    expect(errorsOf({ lat: "90", lng: "180" })).toEqual({});
    expect(errorsOf({ lat: "-90", lng: "-180" })).toEqual({});
    expect(errorsOf({ lat: "90.000001", lng: "0" }).lat).toBe(
      "La latitud debe estar entre -90 y 90.",
    );
    expect(errorsOf({ lat: "0", lng: "-180.000001" }).lng).toBe(
      "La longitud debe estar entre -180 y 180.",
    );
    expect(errorsOf({ lat: "91", lng: "181" })).toEqual({
      lat: "La latitud debe estar entre -90 y 90.",
      lng: "La longitud debe estar entre -180 y 180.",
    });
  });

  it("texto que no es un número", () => {
    const message = "Escribe un número con punto o coma decimal, por ejemplo -16.5.";
    expect(errorsOf({ lat: "abc", lng: "-68.15" })).toEqual({ lat: message });
    expect(errorsOf({ lat: "-16.5", lng: "1e3" })).toEqual({ lng: message });
  });
});

describe("esquema de dirección · al menos un uso", () => {
  it("ninguno marcado → error en el primer uso", () => {
    expect(errorsOf({ forShipping: false, forBilling: false })).toEqual({
      forShipping: "Elige al menos un uso: envío o facturación.",
    });
  });

  it("basta con uno", () => {
    expect(errorsOf({ forShipping: true, forBilling: false })).toEqual({});
    expect(errorsOf({ forShipping: false, forBilling: true })).toEqual({});
    expect(errorsOf({ forShipping: true, forBilling: true })).toEqual({});
  });
});

describe("esquema de dirección · todos los errores a la vez", () => {
  it("un formulario vacío informa de cada campo inválido (para poder enfocar el primero)", () => {
    const errors = errorsOf({
      label: "",
      recipient: "",
      phone: "",
      department: "",
      city: "",
      line1: "",
      lat: "1",
      lng: "",
      forShipping: false,
      forBilling: false,
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["city", "department", "forShipping", "label", "line1", "lng", "phone", "recipient"].sort(),
    );
  });
});

describe("toAddressInput", () => {
  it("convierte a lo que se guarda: E.164, departamento oficial, opcionales vacíos en null, pin numérico", () => {
    const input = toAddressInput({
      label: "Casa",
      recipient: "Ana Cliente",
      phoneCountry: "BO",
      phone: "7123 4567",
      country: "BO",
      department: "potosi",
      city: "Potosí",
      line1: "Calle Bolívar 5",
      line2: "",
      referenceText: "",
      lat: "-16,5",
      lng: "-68.15",
      forShipping: true,
      forBilling: true,
      isDefault: true,
    });
    expect(input).toEqual({
      label: "Casa",
      recipient: "Ana Cliente",
      phoneE164: "+59171234567",
      line1: "Calle Bolívar 5",
      line2: null,
      city: "Potosí",
      department: "Potosí",
      country: "BO",
      referenceText: null,
      lat: -16.5,
      lng: -68.15,
      forShipping: true,
      forBilling: true,
      isDefault: true,
    });
  });

  it("sin pin → lat y lng null; con textos opcionales → recortados", () => {
    const input = toAddressInput({
      ...valid,
      line2: "  Piso 2 ",
      referenceText: " Puerta verde ",
    });
    expect(input.lat).toBeNull();
    expect(input.lng).toBeNull();
    expect(input.line2).toBe("Piso 2");
    expect(input.referenceText).toBe("Puerta verde");
  });

  it("otro país: departamento libre recortado, o null si está vacío", () => {
    expect(
      toAddressInput({ ...valid, country: "AR", department: " Buenos Aires " }).department,
    ).toBe("Buenos Aires");
    expect(toAddressInput({ ...valid, country: "AR", department: "  " }).department).toBeNull();
  });

  it("teléfono de otro país con su prefijo", () => {
    expect(toAddressInput({ ...valid, phoneCountry: "ES", phone: "612 345 678" }).phoneE164).toBe(
      "+34612345678",
    );
  });

  it("un pin 0,0 es un pin válido (no se confunde con «sin pin»)", () => {
    const input = toAddressInput({ ...valid, lat: "0", lng: "0" });
    expect(input.lat).toBe(0);
    expect(input.lng).toBe(0);
  });

  it("con datos SIN validar lanza en vez de guardar basura", () => {
    expect(() => toAddressInput({ ...valid, phone: "abc" })).toThrow();
    expect(() => toAddressInput({ ...valid, lat: "5", lng: "" })).toThrow();
  });
});

const address: Address = {
  id: "a-1",
  profileId: "p-1",
  label: "Oficina",
  recipient: "Luis Pérez",
  phone: "+34612345678",
  line1: "Calle 1",
  line2: "Piso 3",
  city: "Santa Cruz",
  department: "santa cruz",
  country: "BO",
  referenceText: "Frente al banco",
  lat: -17.78,
  lng: -63.18,
  isDefault: true,
  forShipping: false,
  forBilling: true,
  archivedAt: null,
  createdAt: "2026-11-01T10:00:00+00:00",
  updatedAt: "2026-11-01T10:00:00+00:00",
};

describe("addressToFormValues", () => {
  const defaults = { recipient: "Ana Cliente", phone: "+59171234567", country: "BO" };

  it("al CREAR: destinatario y teléfono del perfil, Bolivia, envío sí y facturación no", () => {
    expect(addressToFormValues(null, defaults)).toEqual({
      label: "",
      recipient: "Ana Cliente",
      phoneCountry: "BO",
      phone: "7123 4567",
      country: "BO",
      department: "",
      city: "",
      line1: "",
      line2: "",
      referenceText: "",
      lat: "",
      lng: "",
      forShipping: true,
      forBilling: false,
      isDefault: false,
    });
  });

  it("al crear sin teléfono de perfil: campo vacío y prefijo de Bolivia", () => {
    const values = addressToFormValues(null, { ...defaults, phone: null });
    expect(values.phone).toBe("");
    expect(values.phoneCountry).toBe("BO");
  });

  it("al EDITAR: los valores de la dirección (teléfono separado en prefijo + número, pin como texto)", () => {
    expect(addressToFormValues(address, defaults)).toEqual({
      label: "Oficina",
      recipient: "Luis Pérez",
      phoneCountry: "ES",
      phone: "6123 4567 8",
      country: "BO",
      department: "Santa Cruz", // «santa cruz» se lleva al nombre oficial de la lista
      city: "Santa Cruz",
      line1: "Calle 1",
      line2: "Piso 3",
      referenceText: "Frente al banco",
      lat: "-17.78",
      lng: "-63.18",
      forShipping: false,
      forBilling: true,
      isDefault: false, // «predeterminada» es una acción aparte; el formulario no desmarca la actual
    });
  });

  it("al editar, ignora el teléfono del perfil", () => {
    expect(addressToFormValues({ ...address, phone: "+59176543210" }, defaults)).toMatchObject({
      phoneCountry: "BO",
      phone: "7654 3210",
    });
  });

  it("un departamento de Bolivia que no está en la lista queda vacío (la persona debe elegir uno)", () => {
    expect(addressToFormValues({ ...address, department: "Lima" }, defaults).department).toBe("");
  });

  it("en otro país el departamento se conserva tal cual", () => {
    expect(
      addressToFormValues({ ...address, country: "AR", department: "Córdoba" }, defaults)
        .department,
    ).toBe("Córdoba");
  });

  it("dirección sin pin o sin opcionales → campos vacíos", () => {
    const values = addressToFormValues(
      { ...address, lat: null, lng: null, line2: null, referenceText: null, department: null },
      defaults,
    );
    expect(values).toMatchObject({
      lat: "",
      lng: "",
      line2: "",
      referenceText: "",
      department: "",
    });
  });

  it("lo que produce el editor vuelve a pasar el esquema y a dar la misma dirección", () => {
    const values = addressToFormValues(address, defaults);
    expect(addressFormSchema.safeParse(values).success).toBe(true);
    expect(toAddressInput(values)).toMatchObject({
      phoneE164: "+34612345678",
      department: "Santa Cruz",
      lat: -17.78,
      lng: -63.18,
    });
  });
});

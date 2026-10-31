import { describe, expect, it } from "vitest";
import {
  cleanText,
  productDataSchema,
  toProductPatch,
  validateColors,
  validateSizes,
  type ProductDataValues,
} from "./productSchema";

const valid: ProductDataValues = {
  name: "Camisa Chola",
  code: "CHQ-001",
  slug: "camisa-chola",
  model: "",
  description: "",
  materials: "",
  washcare: "",
  costBase: "",
  outOfStockBehavior: "sold_out",
  isNew: false,
  allowConvertedPrices: false,
};

const issuesOf = (patch: Partial<ProductDataValues>) => {
  const r = productDataSchema.safeParse({ ...valid, ...patch });
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("productDataSchema", () => {
  it("los datos mínimos son válidos", () => {
    expect(productDataSchema.safeParse(valid).success).toBe(true);
  });

  it("nombre: obligatorio (aun con espacios) y hasta 160 caracteres", () => {
    expect(issuesOf({ name: "   " })).toEqual(["name: Escribe el nombre del producto."]);
    expect(issuesOf({ name: "a".repeat(160) })).toEqual([]);
    expect(issuesOf({ name: "a".repeat(161) })).toEqual([
      "name: El nombre admite hasta 160 caracteres.",
    ]);
  });

  it.each(["CHQ 001", "CHQ/001", "código", "a".repeat(41), "CHQ,001"])(
    "código «%s» inválido",
    (code) => {
      expect(issuesOf({ code }).length).toBeGreaterThan(0);
    },
  );
  it.each(["CHQ-001", "a", "A.B_C-9", "a".repeat(40)])("código «%s» válido", (code) => {
    expect(issuesOf({ code })).toEqual([]);
  });

  it.each([
    "Camisa",
    "camisa chola",
    "camisa_chola",
    "camisa--chola",
    "-camisa",
    "camisa-",
    "ñandú",
    "a".repeat(81),
  ])("slug «%s» inválido", (slug) => {
    expect(issuesOf({ slug }).length).toBeGreaterThan(0);
  });
  it.each(["camisa", "camisa-chola-2027", "a1-b2", "a".repeat(80)])("slug «%s» válido", (slug) => {
    expect(issuesOf({ slug })).toEqual([]);
  });

  it("límites de texto: modelo 120, descripción 5000, materiales y cuidado 1000", () => {
    expect(issuesOf({ model: "m".repeat(120) })).toEqual([]);
    expect(issuesOf({ model: "m".repeat(121) })).toHaveLength(1);
    expect(issuesOf({ description: "d".repeat(5000) })).toEqual([]);
    expect(issuesOf({ description: "d".repeat(5001) })).toHaveLength(1);
    expect(issuesOf({ materials: "m".repeat(1001) })).toHaveLength(1);
    expect(issuesOf({ washcare: "w".repeat(1001) })).toHaveLength(1);
  });

  it("costo: opcional; admite 0 y hasta 2 decimales; rechaza 3 decimales, negativos y texto", () => {
    expect(issuesOf({ costBase: "" })).toEqual([]);
    expect(issuesOf({ costBase: "0" })).toEqual([]);
    expect(issuesOf({ costBase: "45,5" })).toEqual([]);
    expect(issuesOf({ costBase: "45.555" })).toEqual(["costBase: Máximo 2 decimales."]);
    expect(issuesOf({ costBase: "-1" })[0]).toMatch(/costBase/);
    expect(issuesOf({ costBase: "abc" })[0]).toMatch(/costBase/);
  });

  it("el comportamiento sin stock solo admite sold_out u hide", () => {
    expect(issuesOf({ outOfStockBehavior: "borrar" as never }).length).toBeGreaterThan(0);
  });
});

describe("toProductPatch", () => {
  it("vacíos → NULL en los opcionales; recorta espacios; costo normalizado", () => {
    expect(
      toProductPatch({
        ...valid,
        name: "  Camisa  ",
        model: "   ",
        materials: "",
        washcare: " ",
        costBase: "45,50",
        description: "  hola  ",
      }),
    ).toEqual({
      name: "Camisa",
      code: "CHQ-001",
      slug: "camisa-chola",
      model: null,
      description: "hola",
      materials: null,
      washcare: null,
      cost_base: 45.5,
      out_of_stock_behavior: "sold_out",
      is_new: false,
      allow_converted_prices: false,
    });
  });

  it("costo vacío → null; costo 0 se conserva como 0 (no es 'sin costo')", () => {
    expect(toProductPatch({ ...valid, costBase: "" }).cost_base).toBeNull();
    expect(toProductPatch({ ...valid, costBase: "0" }).cost_base).toBe(0);
  });
});

describe("cleanText (texto plano seguro)", () => {
  it("quita caracteres de control pero conserva saltos de línea y tabulaciones", () => {
    expect(cleanText("a\u0000b\u0007c\td\ne\u007Ff")).toBe("abc\td\nef");
  });
  it("normaliza \\r\\n y \\r a \\n", () => {
    expect(cleanText("a\r\nb\rc")).toBe("a\nb\nc");
  });
  it("NO altera HTML: se guarda como texto inerte (la tienda lo mostrará como texto, nunca como HTML)", () => {
    expect(cleanText('<img src=x onerror="alert(1)"> <3')).toBe(
      '<img src=x onerror="alert(1)"> <3',
    );
  });
});

describe("validateColors", () => {
  it("lista válida: sin errores; el tono es opcional", () => {
    expect(
      validateColors([
        { name: "Rojo", hex: "#FF0000" },
        { name: "Azul", hex: "" },
      ]),
    ).toEqual({});
  });
  it("nombre vacío, demasiado largo y repetido (sin distinguir mayúsculas) se señalan por posición", () => {
    const errors = validateColors([
      { name: "Rojo", hex: "" },
      { name: "  ", hex: "" },
      { name: "x".repeat(41), hex: "" },
      { name: "ROJO", hex: "" },
    ]);
    expect(Object.keys(errors).sort()).toEqual(["1", "2", "3"]);
    expect(errors[3]).toBe("Ya existe un color con ese nombre.");
  });
  it("40 caracteres exactos es válido", () => {
    expect(validateColors([{ name: "x".repeat(40), hex: "" }])).toEqual({});
  });
  it("tono inválido: sin #, 3 dígitos, letras fuera de hex", () => {
    for (const hex of ["FF0000", "#F00", "#GG0000", "#FF00000"]) {
      expect(validateColors([{ name: "Rojo", hex }])[0]).toBe(
        "El tono debe ser un color como #A1B2C3.",
      );
    }
  });
});

describe("validateSizes", () => {
  it("válidas y únicas sin distinguir mayúsculas", () => {
    expect(validateSizes(["XS", "S", "M"])).toEqual({});
    expect(validateSizes(["M", "m"])[1]).toBe("Ya existe esa talla.");
  });
  it("vacía y de más de 20 caracteres", () => {
    expect(validateSizes(["", "x".repeat(21)])).toEqual({
      0: "Escribe la talla.",
      1: "El nombre admite hasta 160 caracteres.",
    });
    expect(validateSizes(["x".repeat(20)])).toEqual({});
  });
});

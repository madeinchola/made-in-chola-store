import { describe, expect, it } from "vitest";
import { imagesForColor } from "./productImages";
import { COLORS, image, MATRIX, productFixture, SIZES, variantsFrom } from "./product-test-utils";
import {
  aggregateAvailability,
  autoSizeId,
  colorOptions,
  colorSlug,
  defaultColorId,
  hasSizes,
  keepSizeAfterColorChange,
  reconcileSize,
  resolveColorId,
  selectionState,
  sizeOptions,
  variantFor,
} from "./variantSelection";

const detail = productFixture();
const B = COLORS.blanco.id;
const N = COLORS.negro.id;
const R = COLORS.rojo.id;

describe("colorSlug", () => {
  it.each([
    ["Blanco", "blanco"],
    ["Azúl Marino", "azul-marino"],
    ["  ROJO   ", "rojo"],
    ["Verde/Oliva", "verde-oliva"],
    ["Ñandú", "nandu"],
    ["---", ""],
    ["", ""],
    ["Gris 2", "gris-2"],
    ["\u00c0zul", "azul"], // grave
    ["Caf\u00e9 \u00ca", "cafe-e"], // agudo y circunflejo
  ])("%s → %s", (name, slug) => {
    expect(colorSlug(name)).toBe(slug);
  });
});

describe("slugs de color únicos por producto", () => {
  const named = (names: string[]) =>
    productFixture({
      colors: names.map((name, i) => ({ id: `col${i}`, name, hex: null, sortOrder: i })),
      variants: names.map((_, i) => ({
        id: `v${i}`,
        colorId: `col${i}`,
        sizeId: null,
        stockStatus: "in_stock" as const,
      })),
      sizes: [],
    });

  it("nombres que dan el mismo slug: el primero lo conserva y los demás llevan -2, -3…", () => {
    expect(colorOptions(named(["Café", "Cafe", "CAFÉ"])).map((c) => c.slug)).toEqual([
      "cafe",
      "cafe-2",
      "cafe-3",
    ]);
    expect(colorOptions(named(["Verde Oliva", "Verde-Oliva"])).map((c) => c.slug)).toEqual([
      "verde-oliva",
      "verde-oliva-2",
    ]);
  });

  it("nombres sin letras ni números (emojis, otro alfabeto) usan color-<posición> en vez de un slug vacío", () => {
    expect(colorOptions(named(["🔴", "🟢"])).map((c) => c.slug)).toEqual(["color-1", "color-2"]);
    expect(colorOptions(named(["黑", "白", "Negro"])).map((c) => c.slug)).toEqual([
      "color-1",
      "color-2",
      "negro",
    ]);
  });

  it("un color de un nombre normal que choca con un color-N generado sigue siendo único", () => {
    // «Color 1» → color-1; el emoji en 1.ª posición pide color-1 → pasa a color-1-2
    expect(colorOptions(named(["🔴", "Color 1"])).map((c) => c.slug)).toEqual([
      "color-1",
      "color-1-2",
    ]);
  });

  it("el enlace con el slug del 2.º color elige ese color (antes elegía siempre el 1.º)", () => {
    const d = named(["Café", "Cafe"]);
    expect(resolveColorId(d, "cafe-2")).toBe("col1");
    expect(resolveColorId(d, "cafe")).toBe("col0");
    const emojis = named(["🔴", "🟢"]);
    expect(resolveColorId(emojis, "color-2")).toBe("col1");
  });
});

describe("colores", () => {
  it("cada color indica si tiene algo disponible", () => {
    expect(colorOptions(detail).map((c) => [c.slug, c.available])).toEqual([
      ["blanco", true],
      ["negro", false], // todo agotado
      ["rojo", true],
    ]);
  });

  it("el color por defecto es el primero con algo disponible (aunque el primero esté agotado)", () => {
    expect(defaultColorId(detail)).toBe(B);
    const negroPrimero = productFixture({
      colors: [{ ...COLORS.negro }, { ...COLORS.blanco }, { ...COLORS.rojo }],
    });
    expect(defaultColorId(negroPrimero)).toBe(B);
  });

  it("si TODO está agotado, el color por defecto es el primero", () => {
    const agotado = productFixture({
      variants: variantsFrom({
        blanco: { xs: "out", s: "out", m: "out", l: "out" },
        negro: { xs: "out", s: "out", m: "out", l: "out" },
        rojo: { xs: "out", s: "out", m: "out", l: undefined },
      }),
    });
    expect(defaultColorId(agotado)).toBe(B);
  });

  it("sin colores → null", () => {
    expect(defaultColorId(productFixture({ colors: [], variants: [] }))).toBeNull();
  });

  it("el color de la URL se acepta sin importar mayúsculas ni acentos", () => {
    expect(resolveColorId(detail, "rojo")).toBe(R);
    expect(resolveColorId(detail, "ROJO")).toBe(R);
    expect(resolveColorId(detail, "R\u00f3jo")).toBe(R); // con acento (ó escrita como \u00f3)
    expect(resolveColorId(detail, "negro")).toBe(N); // un color agotado SÍ se puede ver
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    "amarillo",
    "../../etc",
    "'; drop table",
    "__proto__",
    "constructor",
  ])(
    "un valor inválido o desconocido en la URL (%j) se ignora: manda el color por defecto",
    (value) => {
      expect(resolveColorId(detail, value)).toBe(B);
    },
  );
});

describe("tallas por color", () => {
  const states = (colorId: string) =>
    sizeOptions(detail, colorId).map((s) => [s.label, s.state, s.selectable]);

  it("Blanco: XS en stock, S pocas (se puede comprar), M agotada, L en stock", () => {
    expect(states(B)).toEqual([
      ["XS", "in_stock", true],
      ["S", "low", true],
      ["M", "out", false],
      ["L", "in_stock", true],
    ]);
  });

  it("Negro: todas agotadas y ninguna seleccionable", () => {
    expect(states(N)).toEqual([
      ["XS", "out", false],
      ["S", "out", false],
      ["M", "out", false],
      ["L", "out", false],
    ]);
  });

  it("Rojo no tiene la talla L: «no disponible en este color», no seleccionable", () => {
    expect(states(R)).toEqual([
      ["XS", "in_stock", true],
      ["S", "in_stock", true],
      ["M", "in_stock", true],
      ["L", "unavailable", false],
    ]);
  });

  it("mantiene el orden de las tallas del admin", () => {
    expect(sizeOptions(detail, B).map((s) => s.label)).toEqual(["XS", "S", "M", "L"]);
  });

  it("sin color elegido ninguna talla es seleccionable", () => {
    expect(sizeOptions(detail, null).every((s) => !s.selectable)).toBe(true);
  });

  it("variantFor encuentra la combinación exacta o nada", () => {
    expect(variantFor(detail, B, SIZES.s.id)?.stockStatus).toBe("low");
    expect(variantFor(detail, R, SIZES.l.id)).toBeUndefined();
  });

  it("hasSizes: con tallas sí; sin tallas no", () => {
    expect(hasSizes(detail)).toBe(true);
    expect(hasSizes(productFixture({ sizes: [] }))).toBe(false);
  });
});

describe("talla única y conservar la talla al cambiar de color", () => {
  const unica = productFixture({
    sizes: [{ ...SIZES.m }],
    variants: [
      { id: "v1", colorId: B, sizeId: SIZES.m.id, stockStatus: "in_stock" },
      { id: "v2", colorId: N, sizeId: SIZES.m.id, stockStatus: "out" },
    ],
    colors: [{ ...COLORS.blanco }, { ...COLORS.negro }],
  });

  it("con UNA sola talla disponible se preselecciona", () => {
    expect(autoSizeId(unica, B)).toBe(SIZES.m.id);
    expect(reconcileSize(unica, B, null)).toBe(SIZES.m.id);
  });

  it("la talla única agotada en ese color no se preselecciona", () => {
    expect(autoSizeId(unica, N)).toBeNull();
  });

  it("con varias tallas no se adivina ninguna", () => {
    expect(autoSizeId(detail, B)).toBeNull();
    expect(reconcileSize(detail, B, null)).toBeNull();
  });

  it("una talla elegida sigue valiendo si sigue disponible en el color nuevo (S: Blanco → Rojo)", () => {
    expect(keepSizeAfterColorChange(detail, R, SIZES.s.id)).toBe(SIZES.s.id);
  });

  it("se limpia si en el color nuevo está agotada (M: Rojo → Blanco)", () => {
    expect(keepSizeAfterColorChange(detail, B, SIZES.m.id)).toBeNull();
  });

  it("se limpia si en el color nuevo no existe (L: Blanco → Rojo)", () => {
    expect(keepSizeAfterColorChange(detail, R, SIZES.l.id)).toBeNull();
  });

  it("se limpia si el color nuevo está todo agotado (Negro)", () => {
    expect(keepSizeAfterColorChange(detail, N, SIZES.xs.id)).toBeNull();
  });

  it("una talla que no existe en el producto se descarta", () => {
    expect(reconcileSize(detail, B, "s-inventada")).toBeNull();
  });
});

describe("selectionState: qué puede hacer la persona", () => {
  it("todo el producto agotado → sold_out", () => {
    const agotado = productFixture({
      variants: variantsFrom({
        blanco: { xs: "out", s: "out", m: "out", l: "out" },
        negro: { xs: "out", s: "out", m: "out", l: "out" },
        rojo: { xs: "out", s: "out", m: "out", l: undefined },
      }),
    });
    expect(selectionState(agotado, B, null).state).toBe("sold_out");
  });

  it("sin variantes ni colores → sold_out (nunca se ofrece comprar)", () => {
    expect(
      selectionState(productFixture({ colors: [], variants: [], sizes: [] }), null, null).state,
    ).toBe("sold_out");
  });

  it("color agotado pero otros no → color_sold_out", () => {
    expect(selectionState(detail, N, null).state).toBe("color_sold_out");
    expect(selectionState(detail, N, SIZES.xs.id).state).toBe("color_sold_out");
  });

  it("hay tallas y falta elegir → choose_size", () => {
    expect(selectionState(detail, B, null)).toEqual({
      state: "choose_size",
      variant: null,
      status: null,
    });
  });

  it("talla agotada elegida a mano (no debería pasar) → choose_size, nunca ready", () => {
    expect(selectionState(detail, B, SIZES.m.id).state).toBe("choose_size");
  });

  it("talla disponible → ready con la variante y su estado", () => {
    const s = selectionState(detail, B, SIZES.xs.id);
    expect(s.state).toBe("ready");
    expect(s.variant?.id).toBe("v-blanco-xs");
    expect(s.status).toBe("in_stock");
  });

  it("pocas unidades se puede comprar y se señala (low)", () => {
    const s = selectionState(detail, B, SIZES.s.id);
    expect(s.state).toBe("ready");
    expect(s.status).toBe("low");
  });

  it("producto SIN tallas: listo en cuanto el color tiene stock", () => {
    const sinTallas = productFixture({
      sizes: [],
      variants: [
        { id: "a", colorId: B, sizeId: null, stockStatus: "low" },
        { id: "b", colorId: N, sizeId: null, stockStatus: "out" },
      ],
      colors: [{ ...COLORS.blanco }, { ...COLORS.negro }],
    });
    expect(selectionState(sinTallas, B, null)).toMatchObject({ state: "ready", status: "low" });
    expect(selectionState(sinTallas, N, null).state).toBe("color_sold_out");
  });

  it("talla única preseleccionada → ready sin que la persona elija", () => {
    const unica = productFixture({
      sizes: [{ ...SIZES.m }],
      variants: [{ id: "v", colorId: B, sizeId: SIZES.m.id, stockStatus: "in_stock" }],
      colors: [{ ...COLORS.blanco }],
    });
    expect(selectionState(unica, B, null).state).toBe("ready");
  });

  it("nunca expone cantidades: solo el estado público", () => {
    const s = selectionState(detail, B, SIZES.xs.id);
    expect(Object.keys(s.variant ?? {}).sort()).toEqual(["colorId", "id", "sizeId", "stockStatus"]);
  });
});

describe("aggregateAvailability (datos estructurados)", () => {
  it("algo en stock → in_stock", () => {
    expect(aggregateAvailability(detail)).toBe("in_stock");
  });
  it("solo pocas unidades → low", () => {
    expect(
      aggregateAvailability(
        productFixture({
          variants: [
            { id: "a", colorId: B, sizeId: null, stockStatus: "low" },
            { id: "b", colorId: B, sizeId: null, stockStatus: "out" },
          ],
        }),
      ),
    ).toBe("low");
  });
  it("nada → out", () => {
    expect(
      aggregateAvailability(
        productFixture({ variants: [{ id: "a", colorId: B, sizeId: null, stockStatus: "out" }] }),
      ),
    ).toBe("out");
    expect(aggregateAvailability(productFixture({ variants: [] }))).toBe("out");
  });
  it("una matriz que solo tiene Rojo con stock sigue siendo in_stock", () => {
    expect(
      aggregateAvailability(
        productFixture({
          variants: variantsFrom({
            ...MATRIX,
            blanco: { xs: "out", s: "out", m: "out", l: "out" },
          }),
        }),
      ),
    ).toBe("in_stock");
  });
});

describe("imagesForColor", () => {
  const images = [
    image("g2", null, 2),
    image("g1", null, 1),
    image("b2", B, 2),
    image("b1", B, 1),
    image("n1", N, 1),
  ];
  const ids = (colorId: string | null) => imagesForColor(images, colorId).map((i) => i.id);

  it("primero las del color (por orden) y después las generales (por orden)", () => {
    expect(ids(B)).toEqual(["b1", "b2", "g1", "g2"]);
  });
  it("un color sin imágenes propias muestra solo las generales", () => {
    expect(ids(R)).toEqual(["g1", "g2"]);
  });
  it("sin color elegido: solo las generales", () => {
    expect(ids(null)).toEqual(["g1", "g2"]);
  });
  it("si no hay propias NI generales (solo fotos de otros colores) se muestran todas antes que dejar la ficha sin foto", () => {
    const soloOtros = [image("n2", N, 2), image("n1", N, 1)];
    expect(imagesForColor(soloOtros, B).map((i) => i.id)).toEqual(["n1", "n2"]);
  });
  it("sin imágenes → lista vacía", () => {
    expect(imagesForColor([], B)).toEqual([]);
  });
  it("empates de orden se resuelven por id (orden estable)", () => {
    expect(
      imagesForColor([image("z", null, 1), image("a", null, 1)], null).map((i) => i.id),
    ).toEqual(["a", "z"]);
  });
  it("no modifica la lista original", () => {
    const original = [...images];
    imagesForColor(images, B);
    expect(images).toEqual(original);
  });
});

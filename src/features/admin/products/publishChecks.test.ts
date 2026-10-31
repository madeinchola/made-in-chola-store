import { describe, expect, it } from "vitest";
import { publishChecks } from "./publishChecks";
import type { AdminProductDetail } from "./types";

const base = (over: Partial<AdminProductDetail> = {}): AdminProductDetail => ({
  product: {
    id: "p",
    code: "A",
    slug: "a",
    name: "A",
    model: null,
    description: "",
    materials: null,
    washcare: null,
    costBase: null,
    outOfStockBehavior: "sold_out",
    status: "draft",
    isNew: false,
    allowConvertedPrices: false,
    archived: false,
    createdAt: "",
    updatedAt: "",
  },
  colors: [{ id: "c1", name: "Rojo", hex: null, sortOrder: 1, archived: false, updatedAt: "" }],
  sizes: [],
  variants: [
    {
      id: "v1",
      colorId: "c1",
      sizeId: null,
      sku: "A-ROJO",
      archived: false,
      stockOnHand: 5,
      reserved: 0,
      available: 5,
      light: "ok",
    },
  ],
  images: [{ id: "i1", path: "x", alt: null, colorId: null, sortOrder: 1, updatedAt: "" }],
  prices: [{ id: "pr", currency: "BOB", country: null, amount: "100", updatedAt: "" }],
  categoryIds: [],
  collectionIds: [],
  related: [],
  ...over,
});

describe("publishChecks", () => {
  it("producto completo: se puede publicar y no hay avisos", () => {
    expect(publishChecks(base())).toEqual({
      price: true,
      variants: true,
      images: true,
      stock: true,
      canPublish: true,
      hasWarnings: false,
    });
  });

  it("sin precio en BOB: BLOQUEA", () => {
    const c = publishChecks(base({ prices: [] }));
    expect(c.price).toBe(false);
    expect(c.canPublish).toBe(false);
  });

  it("un precio solo en otra moneda, o solo por país, no sirve: hace falta el general en BOB", () => {
    expect(
      publishChecks(
        base({
          prices: [{ id: "x", currency: "USD", country: null, amount: "10", updatedAt: "" }],
        }),
      ).price,
    ).toBe(false);
    expect(
      publishChecks(
        base({
          prices: [{ id: "x", currency: "BOB", country: "BO", amount: "10", updatedAt: "" }],
        }),
      ).price,
    ).toBe(false);
  });

  it("sin variantes activas: BLOQUEA (una archivada no cuenta)", () => {
    const v = base().variants[0];
    if (!v) throw new Error("fixture");
    const c = publishChecks(base({ variants: [{ ...v, archived: true }] }));
    expect(c.variants).toBe(false);
    expect(c.canPublish).toBe(false);
  });

  it("una variante activa de un color ARCHIVADO no cuenta como vendible", () => {
    const color = base().colors[0];
    if (!color) throw new Error("fixture");
    const c = publishChecks(base({ colors: [{ ...color, archived: true }] }));
    expect(c.variants).toBe(false);
    expect(c.canPublish).toBe(false);
  });

  it("sin imágenes: solo AVISA, sigue pudiéndose publicar", () => {
    const c = publishChecks(base({ images: [] }));
    expect(c.images).toBe(false);
    expect(c.canPublish).toBe(true);
    expect(c.hasWarnings).toBe(true);
  });

  it("sin stock disponible: solo AVISA (saldría como agotado)", () => {
    const v = base().variants[0];
    if (!v) throw new Error("fixture");
    const c = publishChecks(
      base({ variants: [{ ...v, stockOnHand: 3, reserved: 3, available: 0 }] }),
    );
    expect(c.stock).toBe(false);
    expect(c.canPublish).toBe(true);
    expect(c.hasWarnings).toBe(true);
  });

  it("el stock de una variante archivada no cuenta", () => {
    const v = base().variants[0];
    if (!v) throw new Error("fixture");
    const c = publishChecks(
      base({
        variants: [
          { ...v, available: 0 },
          { ...v, id: "v2", archived: true, available: 99 },
        ],
      }),
    );
    expect(c.stock).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { ProductDetail, ProductSummary, ProductVariant } from "@/features/catalog/types";
import {
  BUMP_CANDIDATES,
  BUMP_SHOWN,
  bumpCandidates,
  oneClickVariant,
  pickBumps,
} from "./bumpLogic";

const product = (id: string, over: Partial<ProductSummary> = {}): ProductSummary => ({
  id,
  slug: `p-${id}`,
  name: `Producto ${id}`,
  isNew: false,
  price: { amount: 5000, currency: "BOB", decimals: 2 } as ProductSummary["price"],
  colorsCount: 1,
  soldOut: false,
  coverPath: null,
  coverAlt: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});
const variant = (id: string, stockStatus: ProductVariant["stockStatus"]): ProductVariant => ({
  id,
  colorId: "c",
  sizeId: null,
  stockStatus,
});
const detail = (variants: ProductVariant[]): ProductDetail =>
  ({
    product: {} as ProductDetail["product"],
    colors: [],
    sizes: [],
    variants,
    images: [],
    related: [],
  }) as ProductDetail;

describe("bumpCandidates", () => {
  it("excluye lo que ya está en la bolsa y lo agotado, y se queda con los primeros", () => {
    const related = [
      product("a"),
      product("b", { soldOut: true }),
      product("c"),
      product("d"),
      product("e"),
      product("f"),
    ];
    expect(bumpCandidates(related, new Set(["a"])).map((p) => p.id)).toEqual(["c", "d", "e"]);
    expect(bumpCandidates(related, new Set()).length).toBe(BUMP_CANDIDATES);
  });
  it("sin relacionados no hay candidatos", () => {
    expect(bumpCandidates(undefined, new Set())).toEqual([]);
    expect(bumpCandidates([], new Set())).toEqual([]);
  });
});

describe("oneClickVariant · solo lo que no pide elegir nada", () => {
  it("exactamente UNA variante con stock → esa", () => {
    expect(oneClickVariant(detail([variant("v1", "in_stock")]))).toBe("v1");
    expect(oneClickVariant(detail([variant("v1", "low")]))).toBe("v1");
    // una agotada y otra con stock: solo queda una opción
    expect(oneClickVariant(detail([variant("v1", "out"), variant("v2", "in_stock")]))).toBe("v2");
  });
  it("si hay que ELEGIR (dos o más con stock) o no hay ninguna, no se ofrece", () => {
    expect(
      oneClickVariant(detail([variant("v1", "in_stock"), variant("v2", "in_stock")])),
    ).toBeNull();
    expect(oneClickVariant(detail([variant("v1", "out")]))).toBeNull();
    expect(oneClickVariant(detail([]))).toBeNull();
  });
  it("mientras la ficha no llega (o falló) no se ofrece nada", () => {
    expect(oneClickVariant(undefined)).toBeNull();
    expect(oneClickVariant(null)).toBeNull();
  });
});

describe("pickBumps", () => {
  it("empareja cada candidato con SU ficha (por posición), descarta los que piden elegir y limita a dos", () => {
    const candidates = [product("a"), product("b"), product("c")];
    const bumps = pickBumps(candidates, [
      detail([variant("va1", "in_stock"), variant("va2", "in_stock")]),
      detail([variant("vb", "in_stock")]),
      detail([variant("vc", "in_stock")]),
    ]);
    expect(bumps.map((b) => [b.product.id, b.variantId])).toEqual([
      ["b", "vb"],
      ["c", "vc"],
    ]);
    const many = pickBumps(
      [product("a"), product("b"), product("c")],
      [
        detail([variant("va", "in_stock")]),
        detail([variant("vb", "in_stock")]),
        detail([variant("vc", "in_stock")]),
      ],
    );
    expect(many).toHaveLength(BUMP_SHOWN);
  });
  it("sin fichas todavía no hay bumps", () => {
    expect(pickBumps([product("a")], [undefined])).toEqual([]);
  });
});

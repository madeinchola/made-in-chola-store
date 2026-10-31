import type { AdminProductDetail, AdminVariant } from "../types";

const variant = (
  id: string,
  colorId: string,
  sizeId: string,
  sku: string,
  on: number,
  reserved = 0,
): AdminVariant => ({
  id,
  colorId,
  sizeId,
  sku,
  archived: false,
  stockOnHand: on,
  reserved,
  available: Math.max(on - reserved, 0),
  light: on === 0 ? "out" : on <= 2 ? "critical" : on <= 5 ? "low" : "ok",
});

/**
 * Producto de prueba: 2 colores (Rojo, Azul) × 2 tallas (S, M) = 4 variantes con stock 10 / 4 / 1 / 0, 2 imágenes,
 * precio BOB 250, publicado, con una categoría, una colección y un relacionado.
 */
export function detailFixture(over: Partial<AdminProductDetail> = {}): AdminProductDetail {
  return {
    product: {
      id: "p1",
      code: "CHQ-001",
      slug: "chaqueta-chola",
      name: "Chaqueta Chola",
      model: "Modelo X",
      description: "Una chaqueta.",
      materials: "Algodón",
      washcare: "Lavar a mano",
      costBase: "100",
      outOfStockBehavior: "sold_out",
      status: "active",
      isNew: false,
      allowConvertedPrices: false,
      archived: false,
      createdAt: "2026-10-01T10:00:00+00:00",
      updatedAt: "2026-10-02T10:00:00.123456+00:00",
    },
    colors: [
      {
        id: "c-rojo",
        name: "Rojo",
        hex: "#FF0000",
        sortOrder: 1,
        archived: false,
        updatedAt: "2026-10-02T10:00:00.000001+00:00",
      },
      {
        id: "c-azul",
        name: "Azul",
        hex: null,
        sortOrder: 2,
        archived: false,
        updatedAt: "2026-10-02T10:00:00.000002+00:00",
      },
    ],
    sizes: [
      {
        id: "s-s",
        label: "S",
        sortOrder: 1,
        archived: false,
        updatedAt: "2026-10-02T10:00:00.000003+00:00",
      },
      {
        id: "s-m",
        label: "M",
        sortOrder: 2,
        archived: false,
        updatedAt: "2026-10-02T10:00:00.000004+00:00",
      },
    ],
    variants: [
      variant("v1", "c-rojo", "s-s", "CHQ-001-ROJO-S", 10),
      variant("v2", "c-rojo", "s-m", "CHQ-001-ROJO-M", 4),
      variant("v3", "c-azul", "s-s", "CHQ-001-AZUL-S", 1, 1),
      variant("v4", "c-azul", "s-m", "CHQ-001-AZUL-M", 0),
    ],
    images: [
      {
        id: "i1",
        path: "products/p1/a.webp",
        alt: "Frente",
        colorId: null,
        sortOrder: 1,
        updatedAt: "2026-10-02T10:00:00.000010+00:00",
      },
      {
        id: "i2",
        path: "products/p1/b.webp",
        alt: null,
        colorId: "c-rojo",
        sortOrder: 2,
        updatedAt: "2026-10-02T10:00:00.000011+00:00",
      },
    ],
    prices: [
      {
        id: "pr1",
        currency: "BOB",
        country: null,
        amount: "250",
        updatedAt: "2026-10-02T10:00:00.000020+00:00",
      },
    ],
    categoryIds: ["cat-1"],
    collectionIds: ["col-1"],
    related: [{ id: "p2", code: "CMS-001", name: "Camisa" }],
    ...over,
  };
}

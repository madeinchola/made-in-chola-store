import { describe, expect, it } from "vitest";
import {
  mapBanner,
  mapHome,
  mapProductDetail,
  mapProductSummary,
  mapSettings,
  mapVariant,
} from "./mappers";

const productRow = {
  id: "p1",
  slug: "chaqueta-japandi",
  name: "Chaqueta Japandi",
  is_new: true,
  price_bob: 450.5,
  colors_count: 2,
  sold_out: false,
  cover_path: "products/p1/a.jpg",
  cover_alt: "Chaqueta",
  created_at: "2026-10-28T00:00:00Z",
};

describe("mapProductSummary", () => {
  it("mapea todos los campos y convierte el precio a Money exacto", () => {
    expect(mapProductSummary(productRow)).toEqual({
      id: "p1",
      slug: "chaqueta-japandi",
      name: "Chaqueta Japandi",
      isNew: true,
      price: { amount: 45050, currency: "BOB" },
      colorsCount: 2,
      soldOut: false,
      coverPath: "products/p1/a.jpg",
      coverAlt: "Chaqueta",
      createdAt: "2026-10-28T00:00:00Z",
    });
  });

  it("los opcionales nulos toman valores seguros (sin imagen = null, no inventa una)", () => {
    const m = mapProductSummary({
      ...productRow,
      is_new: null,
      colors_count: null,
      sold_out: null,
      cover_path: null,
      cover_alt: null,
    });
    expect(m).toMatchObject({
      isNew: false,
      colorsCount: 0,
      soldOut: false,
      coverPath: null,
      coverAlt: null,
    });
  });

  it.each(["id", "slug", "name", "price_bob", "created_at"] as const)(
    "falla en voz alta si falta el campo obligatorio %s",
    (field) => {
      expect(() => mapProductSummary({ ...productRow, [field]: null })).toThrow(
        /Respuesta incompleta/,
      );
    },
  );
});

describe("mapProductDetail", () => {
  it("añade modelo, descripción, materiales y cuidado; descripción nula → vacía", () => {
    const d = mapProductDetail({
      ...productRow,
      model: "Japandi",
      description: null,
      materials: "Cuero",
      washcare: null,
    });
    expect(d).toMatchObject({
      model: "Japandi",
      description: "",
      materials: "Cuero",
      washcare: null,
      slug: "chaqueta-japandi",
    });
  });
});

describe("mapVariant", () => {
  const row = {
    id: "v1",
    color_id: "c1",
    size_id: null,
    product_id: "p1",
    stock_status: "in_stock",
  };
  it("conserva los estados válidos", () => {
    expect(mapVariant(row).stockStatus).toBe("in_stock");
    expect(mapVariant({ ...row, stock_status: "low" }).stockStatus).toBe("low");
    expect(mapVariant({ ...row, stock_status: "out" }).stockStatus).toBe("out");
  });
  it("un estado DESCONOCIDO o nulo se trata como agotado (ante la duda, no se vende)", () => {
    expect(mapVariant({ ...row, stock_status: "disponible" }).stockStatus).toBe("out");
    expect(mapVariant({ ...row, stock_status: null }).stockStatus).toBe("out");
  });
  it("sizeId null = producto sin tallas", () => {
    expect(mapVariant(row).sizeId).toBeNull();
  });
});

describe("mapSettings", () => {
  it("devuelve un mapa clave → valor primitivo", () => {
    expect(
      mapSettings([
        { key: "whatsapp_orders", value: "+59167528677" },
        { key: "n", value: 5 },
        { key: "b", value: true },
      ]),
    ).toEqual({ whatsapp_orders: "+59167528677", n: 5, b: true });
  });
  it("ignora filas sin clave y valores no primitivos (objeto, arreglo, null)", () => {
    expect(
      mapSettings([
        { key: null, value: "x" },
        { key: "obj", value: { a: 1 } },
        { key: "arr", value: [1] },
        { key: "nul", value: null },
      ]),
    ).toEqual({});
  });
});

describe("mapBanner", () => {
  it("mapea mensaje y enlace", () => {
    expect(
      mapBanner({
        id: "b1",
        message: "Envíos a todo el país",
        link_url: "/envios",
        starts_at: null,
        ends_at: null,
      }),
    ).toEqual({
      id: "b1",
      message: "Envíos a todo el país",
      linkUrl: "/envios",
    });
  });
});

describe("mapHome", () => {
  const section = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    kind: "hero",
    sort_order: 1,
    title: "Verano 2027",
    body: null,
    cta_label: "Ver colección",
    cta_url: "/coleccion/verano",
    media_kind: "image",
    media_path: "home/a.jpg",
    media_alt: "Modelo",
    source_type: "none",
    source_category_id: null,
    source_collection_id: null,
    item_limit: 4,
    ...over,
  });
  const item = (over: Record<string, unknown> = {}) => ({
    id: "i1",
    section_id: "s1",
    sort_order: 1,
    label: "Carteras",
    link_url: "/categoria/carteras",
    media_kind: "none",
    media_path: null,
    media_alt: null,
    product_id: null,
    category_id: null,
    collection_id: null,
    ...over,
  });

  it("une cada sección con SUS elementos, ordenados", () => {
    const home = mapHome(
      [section({ id: "s1" }), section({ id: "s2", kind: "category_tiles", sort_order: 2 })],
      [
        item({ id: "i2", section_id: "s2", sort_order: 2, label: "B" }),
        item({ id: "i1", section_id: "s2", sort_order: 1, label: "A" }),
        item({ id: "i3", section_id: "s1", label: "solo de s1" }),
      ],
    );
    expect(home.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(home[1]?.items.map((i) => i.label)).toEqual(["A", "B"]);
    expect(home[0]?.items.map((i) => i.label)).toEqual(["solo de s1"]);
  });

  it("ordena las secciones por sortOrder", () => {
    const home = mapHome(
      [section({ id: "b", sort_order: 5 }), section({ id: "a", sort_order: 1 })],
      [],
    );
    expect(home.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("OMITE una sección de un tipo desconocido (el home no se rompe si se añade un tipo nuevo)", () => {
    const home = mapHome([section({ id: "x", kind: "carrusel_3d" }), section({ id: "ok" })], []);
    expect(home.map((s) => s.id)).toEqual(["ok"]);
  });

  it("mapea origen de productos y medio", () => {
    const [s] = mapHome(
      [
        section({
          kind: "product_row",
          source_type: "category",
          source_category_id: "cat1",
          item_limit: 8,
          media_kind: "none",
          media_path: null,
        }),
      ],
      [],
    );
    expect(s?.source).toEqual({ type: "category", categoryId: "cat1", collectionId: null });
    expect(s?.itemLimit).toBe(8);
    expect(s?.media).toEqual({ kind: "none", path: null, alt: "Modelo" });
  });

  it("un tipo de medio inconsistente (video sin ruta) se normaliza a 'none'", () => {
    const [s] = mapHome([section({ media_kind: "video", media_path: null })], []);
    expect(s?.media.kind).toBe("none");
    expect(s?.media.path).toBeNull();
  });

  it("un origen de productos desconocido cae a 'none'", () => {
    const [s] = mapHome([section({ source_type: "inventado" })], []);
    expect(s?.source.type).toBe("none");
  });
});

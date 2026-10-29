import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeConfig } from "./testing/fakeSupabase";

const state = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.client }));

import { adjustStock, isPurchasable, listAdminProductStock, listAdminStock } from "./stockService";

let calls: ReturnType<typeof createFakeSupabase>["calls"];
function use(config: FakeConfig) {
  const fake = createFakeSupabase(config);
  state.client = fake.client;
  calls = fake.calls;
}
beforeEach(() => use({ tables: {} }));

describe("isPurchasable", () => {
  it("in_stock y low se pueden comprar; out no", () => {
    expect(isPurchasable("in_stock")).toBe(true);
    expect(isPurchasable("low")).toBe(true);
    expect(isPurchasable("out")).toBe(false);
  });
});

describe("adjustStock", () => {
  it("llama a adjust_stock con los parámetros correctos y devuelve el stock resultante", async () => {
    use({ tables: {}, rpc: { adjust_stock: () => 27 } });
    const result = await adjustStock({
      variantId: "v1",
      delta: -5,
      reason: "adjust",
      note: "  merma  ",
    });
    expect(result).toBe(27);
    expect(calls[0]).toMatchObject({
      kind: "rpc",
      name: "adjust_stock",
      args: { p_variant_id: "v1", p_delta: -5, p_reason: "adjust", p_note: "merma" },
    });
  });

  it("sin nota no envía p_note; una nota de solo espacios tampoco", async () => {
    use({ tables: {}, rpc: { adjust_stock: () => 1 } });
    await adjustStock({ variantId: "v1", delta: 1, reason: "import" });
    await adjustStock({ variantId: "v1", delta: 1, reason: "import", note: "   " });
    for (const c of calls) expect(c.args).not.toHaveProperty("p_note");
  });

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rechaza el delta %s SIN llamar al servidor",
    async (delta) => {
      use({ tables: {}, rpc: { adjust_stock: () => 1 } });
      await expect(adjustStock({ variantId: "v1", delta, reason: "adjust" })).rejects.toMatchObject(
        { code: "validation" },
      );
      expect(calls).toHaveLength(0);
    },
  );

  it("rechaza un motivo que no es de ajuste manual (p. ej. 'sale') SIN llamar al servidor", async () => {
    use({ tables: {}, rpc: { adjust_stock: () => 1 } });
    await expect(
      adjustStock({ variantId: "v1", delta: 1, reason: "sale" as never }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(calls).toHaveLength(0);
  });

  it("traduce los errores del servidor: sin permiso, stock comprometido, variante inexistente", async () => {
    use({
      tables: {},
      errors: { adjust_stock: { code: "42501", message: "solo administradores" } },
    });
    await expect(
      adjustStock({ variantId: "v1", delta: 1, reason: "adjust" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    use({
      tables: {},
      errors: {
        adjust_stock: {
          code: "P0001",
          message:
            "no puedes dejar el stock en 24 porque 25 unidades ya están comprometidas en pedidos",
        },
      },
    });
    await expect(
      adjustStock({ variantId: "v1", delta: -3, reason: "adjust" }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("comprometidas"),
    });

    use({
      tables: {},
      errors: { adjust_stock: { code: "P0002", message: "variante inexistente" } },
    });
    await expect(adjustStock({ variantId: "x", delta: 1, reason: "adjust" })).rejects.toMatchObject(
      { code: "not_found" },
    );
  });
});

const variantRow = (over: Record<string, unknown> = {}) => ({
  variant_id: "v1",
  product_id: "p1",
  product_code: "CHQ-001",
  product_name: "Chaqueta",
  product_status: "active",
  color_name: "Blanco",
  size_label: "XS",
  sku: "CHQ-001-BLANCO-XS",
  variant_archived_at: null,
  stock_on_hand: 10,
  reserved: 4,
  available: 6,
  low_threshold: 5,
  critical_threshold: 2,
  stock_light: "ok",
  ...over,
});

describe("listAdminStock", () => {
  it("mapea cantidades, semáforo y marca archivadas", async () => {
    use({
      tables: {
        admin_stock_overview: [
          variantRow(),
          variantRow({
            variant_id: "v2",
            color_name: "Negro",
            variant_archived_at: "2026-10-01",
            stock_light: "out",
            stock_on_hand: 0,
            reserved: 0,
            available: 0,
          }),
        ],
      },
    });
    const rows = await listAdminStock();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      variantId: "v1",
      stockOnHand: 10,
      reserved: 4,
      available: 6,
      light: "ok",
      archived: false,
      sizeLabel: "XS",
    });
    expect(rows[1]).toMatchObject({ variantId: "v2", light: "out", archived: true });
  });

  it("filtra por producto cuando se pide", async () => {
    use({
      tables: {
        admin_stock_overview: [variantRow(), variantRow({ variant_id: "v9", product_id: "p2" })],
      },
    });
    const rows = await listAdminStock("p2");
    expect(rows.map((r) => r.variantId)).toEqual(["v9"]);
  });

  it("un semáforo desconocido se trata como el más grave (que el admin lo revise)", async () => {
    use({ tables: { admin_stock_overview: [variantRow({ stock_light: "violeta" })] } });
    expect((await listAdminStock())[0]?.light).toBe("critical");
  });

  it("sin talla → sizeLabel null", async () => {
    use({ tables: { admin_stock_overview: [variantRow({ size_label: null })] } });
    expect((await listAdminStock())[0]?.sizeLabel).toBeNull();
  });

  it("un error de la BD se propaga como AppError", async () => {
    use({ tables: {}, errors: { admin_stock_overview: { code: "42501", message: "x" } } });
    await expect(listAdminStock()).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("listAdminProductStock", () => {
  const prodRow = (over: Record<string, unknown> = {}) => ({
    product_id: "p1",
    code: "CHQ-001",
    name: "Chaqueta",
    status: "active",
    archived_at: null,
    total_on_hand: 13,
    total_available: 13,
    variants_count: 3,
    variants_out: 1,
    worst_light: "out",
    ...over,
  });

  it("mapea los totales y el peor semáforo", async () => {
    use({ tables: { admin_product_stock: [prodRow()] } });
    expect((await listAdminProductStock())[0]).toEqual({
      productId: "p1",
      code: "CHQ-001",
      name: "Chaqueta",
      totalOnHand: 13,
      totalAvailable: 13,
      variantsCount: 3,
      variantsOut: 1,
      worstLight: "out",
    });
  });

  it("excluye los productos archivados", async () => {
    use({
      tables: {
        admin_product_stock: [
          prodRow(),
          prodRow({ product_id: "p2", name: "Vieja", archived_at: "2026-10-01" }),
        ],
      },
    });
    expect((await listAdminProductStock()).map((r) => r.productId)).toEqual(["p1"]);
  });

  it("un producto sin variantes tiene semáforo null", async () => {
    use({ tables: { admin_product_stock: [prodRow({ worst_light: null, variants_count: 0 })] } });
    expect((await listAdminProductStock())[0]?.worstLight).toBeNull();
  });
});

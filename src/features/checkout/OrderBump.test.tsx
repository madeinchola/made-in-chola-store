import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductDetail, ProductSummary, ProductVariant } from "@/features/catalog/types";
import { makeLine, makeSnapshot, renderWithCart } from "@/features/cart/cart-test-utils";
import { subscribeToTracking, type TrackEvent } from "@/features/storefront/analytics/track";
import { OrderBump } from "./OrderBump";

const catalog = vi.hoisted(() => ({ getProductBySlug: vi.fn() }));
vi.mock("@/features/catalog/catalogService", async (original) => ({
  ...(await original<typeof import("@/features/catalog/catalogService")>()),
  ...catalog,
}));

const summary = (id: string, over: Partial<ProductSummary> = {}): ProductSummary =>
  ({
    id,
    slug: `prod-${id}`,
    name: `Producto ${id}`,
    isNew: false,
    price: { amount: 5000, currency: "BOB", decimals: 2 },
    colorsCount: 1,
    soldOut: false,
    coverPath: null,
    coverAlt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as ProductSummary;
const variant = (
  id: string,
  stockStatus: ProductVariant["stockStatus"] = "in_stock",
): ProductVariant => ({ id, colorId: "c", sizeId: null, stockStatus });
const detail = (over: Partial<ProductDetail>): ProductDetail =>
  ({
    product: {} as ProductDetail["product"],
    colors: [],
    sizes: [],
    variants: [],
    images: [],
    related: [],
    ...over,
  }) as ProductDetail;

// La bolsa tiene «chaqueta-v1» (producto p-v1). Sus relacionados: A (una variante), B (hay que elegir), C (agotado), D (ya está en la bolsa)
const RELATED = [summary("A"), summary("B"), summary("C", { soldOut: true }), summary("p-v1")];
function serve(over: Record<string, ProductDetail | null> = {}) {
  catalog.getProductBySlug.mockImplementation(async (slug: string) => {
    if (slug in over) return over[slug];
    if (slug === "chaqueta-v1") return detail({ related: RELATED });
    if (slug === "prod-A") return detail({ variants: [variant("vA")] });
    if (slug === "prod-B") return detail({ variants: [variant("vB1"), variant("vB2")] });
    return null;
  });
}
const mount = (onAdded = vi.fn()) => {
  const view = renderWithCart(<OrderBump onAdded={onAdded} />, {
    snapshot: makeSnapshot([makeLine("v1", 1)]),
  });
  return { ...view, onAdded };
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("OrderBump", () => {
  it("ofrece solo lo que se añade con un clic: una variante con stock; no lo que pide elegir, lo agotado ni lo que ya está en la bolsa", async () => {
    serve();
    mount();
    const section = await screen.findByRole("region", { name: "Suma a tu pedido" });
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Producto A");
    expect(within(section).getByRole("link", { name: "Producto A" })).toHaveAttribute(
      "href",
      "/producto/prod-A",
    );
    expect(
      within(section).getByRole("button", { name: /Agregar Producto A por Bs 50,00 a tu pedido/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Producto B")).not.toBeInTheDocument();
    expect(screen.queryByText("Producto C")).not.toBeInTheDocument();
  });

  it("con un clic agrega esa variante a la bolsa, avisa a la analítica (add_to_cart) y pide recalcular el total", async () => {
    serve();
    const events: TrackEvent[] = [];
    const off = subscribeToTracking((e) => events.push(e));
    const { cart, onAdded } = mount();
    const add = vi.spyOn(cart().store, "addOne").mockResolvedValue(undefined);
    await userEvent.click(await screen.findByRole("button", { name: /Agregar Producto A/ }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith("vA");
    expect(events).toContainEqual({
      name: "add_to_cart",
      quantity: 1,
      item: { id: "A", name: "Producto A", price: 50, currency: "BOB" },
    });
    off();
  });

  it("un segundo clic mientras agrega no agrega dos veces", async () => {
    serve();
    let finish: () => void = () => undefined;
    const { cart } = mount();
    const add = vi
      .spyOn(cart().store, "addOne")
      .mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const button = await screen.findByRole("button", { name: /Agregar Producto A/ });
    await userEvent.click(button);
    expect(await screen.findByRole("button", { name: /Agregar Producto A/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Agregar Producto A/ }));
    expect(add).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("DOS clics en el mismo instante (antes de que la pantalla se repinte) agregan UNA sola vez", async () => {
    serve();
    let finish: () => void = () => undefined;
    const { cart } = mount();
    const add = vi
      .spyOn(cart().store, "addOne")
      .mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const button = await screen.findByRole("button", { name: /Agregar Producto A/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(add).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("sin relacionados, o si ninguno se puede agregar con un clic, NO pinta nada (ni el título)", async () => {
    serve({ "chaqueta-v1": detail({ related: [] }) });
    const { container } = mount();
    await waitFor(() => expect(catalog.getProductBySlug).toHaveBeenCalled());
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
    expect(container.querySelector("section")).toBeNull();
    expect(screen.queryByText("Suma a tu pedido")).not.toBeInTheDocument();
  });

  it("si la ficha de un candidato falla o todavía no llega, no se ofrece (no se adivina)", async () => {
    serve({ "prod-A": null });
    mount();
    await waitFor(() => expect(catalog.getProductBySlug).toHaveBeenCalledWith("prod-A"));
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
    expect(screen.queryByText("Suma a tu pedido")).not.toBeInTheDocument();
  });
});

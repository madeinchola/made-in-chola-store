import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeConfig } from "./testing/fakeSupabase";

const state = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.client }));

import { catalogKeys } from "./queryKeys";
import { useAdjustStock, useProduct, useProductSearch, useProducts } from "./hooks";

let calls: ReturnType<typeof createFakeSupabase>["calls"];
function use(config: FakeConfig) {
  const fake = createFakeSupabase(config);
  state.client = fake.client;
  calls = fake.calls;
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const row = (id: string, name: string, price: number) => ({
  id,
  slug: name.toLowerCase(),
  name,
  is_new: false,
  price_bob: price,
  colors_count: 1,
  sold_out: false,
  cover_path: null,
  cover_alt: null,
  created_at: "2026-10-01T00:00:00Z",
});

beforeEach(() => use({ tables: {} }));

describe("useProducts", () => {
  it("carga el listado y lo deja en caché bajo su clave normalizada", async () => {
    use({ tables: { public_products: [row("p1", "Chaqueta", 560)] } });
    const { wrapper, queryClient } = setup();
    const { result } = renderHook(() => useProducts({ sort: "name" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.price).toEqual({ amount: 56000, currency: "BOB" });
    expect(queryClient.getQueryData(catalogKeys.productList({ sort: "name" }))).toBe(
      result.current.data,
    );
  });

  it("un error del servidor deja la consulta en estado error con un AppError", async () => {
    use({ tables: {}, errors: { public_products: { code: "42501", message: "x" } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ name: "AppError", code: "forbidden" });
  });
});

describe("useProduct", () => {
  it("sin slug NO consulta nada", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useProduct(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("un slug inexistente resuelve a null (404), no a error", async () => {
    use({ tables: { public_product_detail: [] } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useProduct("no-existe"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("useProductSearch", () => {
  it("con menos de 2 caracteres no lanza la consulta", () => {
    use({ tables: {}, rpc: { public_search_products: () => [] } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useProductSearch(" a "), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("con 2+ caracteres consulta y devuelve los productos", async () => {
    use({ tables: {}, rpc: { public_search_products: () => [row("p1", "Chaqueta", 560)] } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useProductSearch("chaq"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("useAdjustStock", () => {
  it("tras un ajuste exitoso invalida el stock del panel Y los productos públicos", async () => {
    use({ tables: {}, rpc: { adjust_stock: () => 12 } });
    const { wrapper, queryClient } = setup();
    // Se siembran las cachés que deben refrescarse y una que NO debe tocarse.
    queryClient.setQueryData(catalogKeys.adminStock(), ["x"]);
    queryClient.setQueryData(catalogKeys.adminStock("p1"), ["x"]);
    queryClient.setQueryData(catalogKeys.adminProductStock(), ["x"]);
    queryClient.setQueryData(catalogKeys.productList(), ["x"]);
    queryClient.setQueryData(catalogKeys.product("chaqueta"), ["x"]);
    queryClient.setQueryData(catalogKeys.categories(), ["x"]);

    const { result } = renderHook(() => useAdjustStock(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ variantId: "v1", delta: 2, reason: "adjust" });
    });
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect(stale(catalogKeys.adminStock())).toBe(true);
    expect(stale(catalogKeys.adminStock("p1"))).toBe(true);
    expect(stale(catalogKeys.adminProductStock())).toBe(true);
    expect(stale(catalogKeys.productList())).toBe(true);
    expect(stale(catalogKeys.product("chaqueta"))).toBe(true);
    expect(stale(catalogKeys.categories())).toBe(false); // lo que no depende del stock no se invalida
  });

  it("si el ajuste falla NO invalida nada y expone el error", async () => {
    use({ tables: {}, errors: { adjust_stock: { code: "P0001", message: "comprometido" } } });
    const { wrapper, queryClient } = setup();
    queryClient.setQueryData(catalogKeys.adminProductStock(), ["x"]);
    const { result } = renderHook(() => useAdjustStock(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ variantId: "v1", delta: -9, reason: "adjust" }),
      ).rejects.toMatchObject({ code: "conflict" });
    });
    expect(queryClient.getQueryState(catalogKeys.adminProductStock())?.isInvalidated).toBe(false);
  });
});

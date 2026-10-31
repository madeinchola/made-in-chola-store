import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryTree, listCollections } from "@/features/catalog/catalogService";
import { DEFAULT_QUERY } from "@/features/storefront/listing/listParams";
import { listProductsFiltered } from "@/features/storefront/shopService";
import { COLLECTION, item, product, section, TREE } from "./home-test-utils";
import { getProductsByIds } from "./homeService";
import { useSectionProducts } from "./useHomeProducts";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getCategoryTree: vi.fn(),
  listCollections: vi.fn(),
}));
vi.mock("@/features/storefront/shopService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/storefront/shopService")>()),
  listProductsFiltered: vi.fn(),
}));
vi.mock("./homeService", () => ({ getProductsByIds: vi.fn() }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const run = (over: Parameters<typeof section>[0]) =>
  renderHook(() => useSectionProducts(section(over)), { wrapper });

const latest = { type: "latest", categoryId: null, collectionId: null } as const;
const page = (...items: ReturnType<typeof product>[]) => ({ items, total: items.length });

beforeEach(() => {
  vi.mocked(getCategoryTree).mockReset().mockResolvedValue(TREE);
  vi.mocked(listCollections).mockReset().mockResolvedValue([COLLECTION]);
  vi.mocked(listProductsFiltered)
    .mockReset()
    .mockResolvedValue(page(product(1), product(2)));
  vi.mocked(getProductsByIds).mockReset().mockResolvedValue([]);
});

describe("useSectionProducts", () => {
  it("latest: arranca pendiente y luego entrega los productos; pide los más nuevos, página 1, tamaño = límite", async () => {
    const { result } = run({ source: latest, itemLimit: 6 });
    expect(result.current.isPending).toBe(true);
    expect(result.current.products).toEqual([]);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.products.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.current.isError).toBe(false);
    expect(listProductsFiltered).toHaveBeenCalledWith({
      scope: {},
      query: { ...DEFAULT_QUERY, sort: "newest" },
      pageSize: 6,
    });
  });

  it.each([
    [0, 1],
    [-5, 1],
    [1, 1],
    [24, 24],
    [999, 24],
    [Number.NaN, 4],
  ])("el límite %s se acota a %s", async (itemLimit, expected) => {
    const { result } = run({ source: latest, itemLimit });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(listProductsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: expected }),
    );
  });

  it("category: NO consulta hasta conocer el slug (sigue pendiente) y luego usa el slug, no el id", async () => {
    let release: (tree: typeof TREE) => void = () => {};
    vi.mocked(getCategoryTree).mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { result } = run({
      source: { type: "category", categoryId: "cat-2", collectionId: null },
    });
    expect(result.current.isPending).toBe(true);
    expect(listProductsFiltered).not.toHaveBeenCalled();
    await act(async () => release(TREE));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(listProductsFiltered).toHaveBeenCalledTimes(1);
    expect(listProductsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { categorySlug: "carteras" } }),
    );
  });

  it("collection: usa el slug de la colección", async () => {
    const { result } = run({
      source: { type: "collection", categoryId: null, collectionId: "col-1" },
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(listProductsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { collectionSlug: "nadas" } }),
    );
  });

  it("origen sin resolver (none, id inexistente, sin id): sin productos, ni pendiente ni error, y sin consultas", async () => {
    for (const source of [
      { type: "none", categoryId: null, collectionId: null },
      { type: "category", categoryId: "no-existe", collectionId: null },
      { type: "category", categoryId: null, collectionId: null },
      { type: "collection", categoryId: null, collectionId: "vencida" },
    ] as const) {
      const { result, unmount } = run({ source });
      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(result.current).toMatchObject({ products: [], isPending: false, isError: false });
      unmount();
    }
    expect(listProductsFiltered).not.toHaveBeenCalled();
    expect(getProductsByIds).not.toHaveBeenCalled();
  });

  it("manual: pide por id en el orden del admin, sin repetidos, y recorta al límite", async () => {
    vi.mocked(getProductsByIds).mockResolvedValue([product(3), product(1), product(2)]);
    const { result } = run({
      source: { type: "manual", categoryId: null, collectionId: null },
      itemLimit: 2,
      items: [
        item({ id: "a", sortOrder: 3, productId: "p2" }),
        item({ id: "b", sortOrder: 1, productId: "p3" }),
        item({ id: "c", sortOrder: 2, productId: "p1" }),
        item({ id: "d", sortOrder: 4, productId: "p3" }), // repetido
        item({ id: "e", sortOrder: 5, productId: null }), // sin producto: se ignora
      ],
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(getProductsByIds).toHaveBeenCalledWith(["p3", "p1", "p2"]);
    expect(result.current.products.map((p) => p.id)).toEqual(["p3", "p1"]);
    expect(listProductsFiltered).not.toHaveBeenCalled();
  });

  it("manual sin ningún producto elegido equivale a none", async () => {
    const { result } = run({
      source: { type: "manual", categoryId: null, collectionId: null },
      items: [item({ productId: null })],
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.products).toEqual([]);
    expect(getProductsByIds).not.toHaveBeenCalled();
  });

  it("si falla la consulta: isError, sin productos y `refetch` lo recupera", async () => {
    vi.mocked(listProductsFiltered).mockRejectedValueOnce(new Error("caído"));
    const { result } = run({ source: latest });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.products).toEqual([]);
    expect(result.current.isPending).toBe(false);
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.products.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("si falla el árbol de categorías no se queda en esqueleto para siempre: da error", async () => {
    vi.mocked(getCategoryTree).mockRejectedValue(new Error("sin árbol"));
    const { result } = run({
      source: { type: "category", categoryId: "cat-1", collectionId: null },
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPending).toBe(false);
    expect(listProductsFiltered).not.toHaveBeenCalled();
  });

  it("si falla la lista de colecciones ocurre lo mismo con una sección de colección", async () => {
    vi.mocked(listCollections).mockRejectedValue(new Error("sin colecciones"));
    const { result } = run({
      source: { type: "collection", categoryId: null, collectionId: "col-1" },
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPending).toBe(false);
  });

  it("un fallo del árbol NO afecta a una fila `latest` (no lo necesita)", async () => {
    vi.mocked(getCategoryTree).mockRejectedValue(new Error("sin árbol"));
    const { result } = run({ source: latest });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.products).toHaveLength(2);
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { ProductsListPage } from "./ProductsListPage";
import type { AdminProductListParams, AdminProductRow } from "./types";

const api = vi.hoisted(() => ({
  listAdminProducts: vi.fn(),
  listCategoryOptions: vi.fn(),
  listCollectionOptions: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://cdn.test/${path}`,
}));

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const K1 = "33333333-3333-4333-8333-333333333333";

const row = (over: Partial<AdminProductRow> = {}): AdminProductRow => ({
  id: "p1",
  code: "CHQ-001",
  slug: "chaqueta",
  name: "Chaqueta Chola",
  status: "active",
  archived: false,
  isNew: false,
  outOfStockBehavior: "sold_out",
  createdAt: "2026-10-01T10:00:00+00:00",
  updatedAt: "2026-10-02T10:00:00+00:00",
  priceBob: "250",
  coverPath: "products/p1/a.webp",
  categoryIds: [C1],
  collectionIds: [],
  totalOnHand: 12,
  totalAvailable: 12,
  variantsCount: 3,
  variantsOut: 0,
  worstLight: "ok",
  displayState: "active",
  ...over,
});

let search = "";
function Probe() {
  search = useLocation().search;
  return null;
}

function renderPage(initialUrl = "/admin/productos") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <ProductsListPage />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lastParams = (): AdminProductListParams => api.listAdminProducts.mock.lastCall?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
  api.listCategoryOptions.mockResolvedValue([
    { id: C1, name: "Chaquetas", archived: false },
    { id: C2, name: "Antiguas", archived: true },
  ]);
  api.listCollectionOptions.mockResolvedValue([{ id: K1, name: "Verano", archived: false }]);
  api.listAdminProducts.mockResolvedValue({ rows: [row()], total: 1 });
});

describe("ProductsListPage", () => {
  it("muestra cada producto con foto, nombre enlazado, código, categoría, precio, stock y estado", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Productos" });
    const body = within(table);
    expect(body.getByRole("link", { name: "Editar Chaqueta Chola" })).toHaveAttribute(
      "href",
      "/admin/productos/p1",
    );
    expect(body.getByText("CHQ-001")).toBeInTheDocument();
    expect(body.getByText("Chaquetas")).toBeInTheDocument();
    expect(body.getByText(/250,00/)).toBeInTheDocument();
    expect(body.getByText("12 u.")).toBeInTheDocument();
    expect(body.getByText("Normal")).toBeInTheDocument();
    expect(body.getByText("Publicado")).toBeInTheDocument();
    expect(table.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.test/products/p1/a.webp",
    );
  });

  it("sin foto ni precio ni categoría muestra marcadores claros, no celdas vacías", async () => {
    api.listAdminProducts.mockResolvedValue({
      rows: [row({ coverPath: null, priceBob: null, categoryIds: [], worstLight: null })],
      total: 1,
    });
    renderPage();
    await screen.findByRole("table");
    expect(screen.getByRole("img", { name: "Sin foto" })).toBeInTheDocument();
    expect(screen.getByText("Sin precio")).toBeInTheDocument();
    expect(screen.getByText("Sin categoría")).toBeInTheDocument();
  });

  it("muchas categorías: muestra dos y cuenta el resto", async () => {
    api.listCategoryOptions.mockResolvedValue(
      ["a", "b", "c", "d"].map((n) => ({ id: n, name: `Cat ${n}`, archived: false })), // ids libres: no pasan por la URL
    );
    api.listAdminProducts.mockResolvedValue({
      rows: [row({ categoryIds: ["a", "b", "c", "d"] })],
      total: 1,
    });
    renderPage();
    expect(await screen.findByText("Cat a, Cat b +2")).toBeInTheDocument();
  });

  it("pide al servidor los valores por defecto: sin archivados, más recientes, página 1 de 20", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(lastParams()).toEqual({ state: "all", sort: "newest", page: 1, pageSize: 20 });
  });

  it("lee los filtros de la URL y los manda al servidor", async () => {
    renderPage("/admin/productos?estado=borradores&stock=alert&orden=nombre&pagina=2&q=camisa");
    await screen.findByRole("table");
    expect(lastParams()).toMatchObject({
      state: "draft",
      stockLight: "alert",
      sort: "name",
      page: 2,
      search: "camisa",
    });
    expect(screen.getByRole("searchbox", { name: "Buscar por nombre o código" })).toHaveValue(
      "camisa",
    );
  });

  it("cambiar un filtro lo manda al servidor, lo escribe en la URL y vuelve a la página 1", async () => {
    const user = userEvent.setup();
    renderPage("/admin/productos?pagina=3");
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("Estado"), "Agotados");
    await waitFor(() => expect(lastParams()).toMatchObject({ state: "soldout", page: 1 }));
    expect(search).toBe("?estado=agotados");
  });

  it("filtrar por categoría y por stock usa los ids y niveles correctos", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("Categoría"), "Chaquetas");
    await waitFor(() => expect(lastParams().categoryId).toBe(C1));
    await user.selectOptions(screen.getByLabelText("Stock"), "Crítico");
    await waitFor(() => expect(lastParams().stockLight).toBe("critical"));
    await user.selectOptions(screen.getByLabelText("Categoría"), "Todas");
    await waitFor(() => expect(lastParams().categoryId).toBeUndefined());
    expect(lastParams().stockLight).toBe("critical");
  });

  it("las categorías archivadas se pueden filtrar pero se marcan como tales", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(screen.getByRole("option", { name: "Antiguas (archivada)" })).toBeInTheDocument();
  });

  it("la búsqueda espera una pausa al escribir (no una consulta por tecla) y usa el texto final", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    const calls = api.listAdminProducts.mock.calls.length;
    await user.type(screen.getByRole("searchbox"), "cam");
    expect(api.listAdminProducts.mock.calls.length).toBe(calls); // todavía dentro del retraso
    await waitFor(() => expect(lastParams().search).toBe("cam"), { timeout: 2000 });
    expect(api.listAdminProducts.mock.calls.length - calls).toBeLessThanOrEqual(2);
    expect(search).toBe("?q=cam");
  });

  it("paginación: total exacto, página actual y 'Siguiente' pide la página 2", async () => {
    const user = userEvent.setup();
    api.listAdminProducts.mockResolvedValue({ rows: [row()], total: 45 });
    renderPage();
    await screen.findByRole("table");
    expect(screen.getByText("45 resultados")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(lastParams().page).toBe(2));
    expect(search).toBe("?pagina=2");
  });

  it("si la página pedida ya no existe (más allá del final) salta a la última válida en vez de mostrar una tabla vacía", async () => {
    api.listAdminProducts.mockImplementation(async (p: AdminProductListParams) =>
      p.page > 3 ? { rows: [], total: 45 } : { rows: [row()], total: 45 },
    );
    renderPage("/admin/productos?pagina=99");
    await waitFor(() => expect(search).toBe("?pagina=3")); // 45 productos / 20 por página = 3 páginas
    await screen.findByText("Página 3 de 3");
    expect(lastParams().page).toBe(3);
  });

  it("en la última página 'Siguiente' está deshabilitado (45 productos, 20 por página → 3 páginas)", async () => {
    api.listAdminProducts.mockResolvedValue({ rows: [row()], total: 45 });
    renderPage("/admin/productos?pagina=3");
    await screen.findByText("Página 3 de 3");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });

  it("sin productos y sin filtros: invita a crear el primero", async () => {
    api.listAdminProducts.mockResolvedValue({ rows: [], total: 0 });
    renderPage();
    expect(
      await screen.findByText("Todavía no hay productos. Crea el primero."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Nuevo producto" })[0]).toHaveAttribute(
      "href",
      "/admin/productos/nuevo",
    );
    expect(screen.queryByRole("navigation", { name: "Paginación" })).not.toBeInTheDocument();
  });

  it("sin resultados con filtros: lo dice y 'Quitar filtros' los limpia (también el buscador)", async () => {
    const user = userEvent.setup();
    api.listAdminProducts.mockResolvedValue({ rows: [], total: 0 });
    renderPage("/admin/productos?estado=archivados&q=zzz");
    expect(
      await screen.findByText("Ningún producto coincide con los filtros."),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Quitar filtros" })[0] as HTMLElement);
    await waitFor(() => expect(search).toBe(""));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    await waitFor(() =>
      expect(lastParams()).toEqual({ state: "all", sort: "newest", page: 1, pageSize: 20 }),
    );
  });

  it("si el servidor falla muestra el error con reintento, y reintentar vuelve a pedir los datos", async () => {
    const user = userEvent.setup();
    api.listAdminProducts.mockRejectedValueOnce(new AppError("network", "x"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("un producto agotado, oculto o archivado muestra su estado y su semáforo", async () => {
    api.listAdminProducts.mockResolvedValue({
      rows: [
        row({ id: "a", code: "A", displayState: "soldout", worstLight: "out" }),
        row({ id: "b", code: "B", displayState: "hidden", worstLight: "out" }),
        row({ id: "c", code: "C", displayState: "archived", archived: true, worstLight: "low" }),
        row({ id: "d", code: "D", displayState: "draft", worstLight: "critical" }),
      ],
      total: 4,
    });
    renderPage();
    await screen.findByRole("table");
    for (const label of [
      "Agotado",
      "Oculto (sin stock)",
      "Archivado",
      "Borrador",
      "Crítico",
      "Bajo",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("la tabla y los controles tienen nombre accesible (caption, buscador, filtros)", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Productos" });
    expect(screen.getByRole("search", { name: "Filtros" })).toBeInTheDocument();
    for (const name of ["Estado", "Categoría", "Colección", "Stock", "Ordenar"]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });
});

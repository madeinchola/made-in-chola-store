import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { ProductEditPage } from "./ProductEditPage";
import { detailFixture } from "./testing/fixtures";
import type { AdminProductDetail } from "./types";

const api = vi.hoisted(() => ({
  getAdminProduct: vi.fn(),
  updateProductData: vi.fn(),
  setProductStatus: vi.fn(),
  setProductArchived: vi.fn(),
  duplicateProduct: vi.fn(),
  savePrices: vi.fn(),
  addColor: vi.fn(),
  addSize: vi.fn(),
  updateColor: vi.fn(),
  updateSize: vi.fn(),
  setColorArchived: vi.fn(),
  setSizeArchived: vi.fn(),
  syncProductVariants: vi.fn(),
  uploadProductImage: vi.fn(),
  updateImage: vi.fn(),
  archiveImage: vi.fn(),
  saveImageOrder: vi.fn(),
  setProductCategories: vi.fn(),
  setProductCollections: vi.fn(),
  setProductRelated: vi.fn(),
  listCategoryOptions: vi.fn(),
  listCollectionOptions: vi.fn(),
  listEnabledCurrencies: vi.fn(),
  searchProductsForRelation: vi.fn(),
  isSlugAvailable: vi.fn(),
  isCodeAvailable: vi.fn(),
  setVariantStock: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  ...api,
}));
const prepareImage = vi.hoisted(() => vi.fn());
vi.mock("./imageProcessing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./imageProcessing")>()),
  prepareImage,
}));
vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (p: string) => `https://cdn.test/${p}`,
}));
vi.mock("../ui/UnsavedChangesGuard", () => ({ UnsavedChangesGuard: () => null }));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

function renderEditor(
  detail: AdminProductDetail = detailFixture(),
  opts: { applyAccept?: boolean; notFound?: boolean } = {},
) {
  api.getAdminProduct.mockResolvedValue(opts.notFound ? null : detail);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup({ applyAccept: opts.applyAccept ?? true });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/productos/${detail.product.id}`]}>
        <Routes>
          <Route path="/admin/productos/:id" element={<ProductEditPage />} />
          <Route path="/admin/productos" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, view };
}

const section = (name: string) => screen.getByRole("region", { name });
const draft = (over: Partial<AdminProductDetail> = {}): AdminProductDetail => {
  const base = detailFixture(over);
  return { ...base, product: { ...base.product, status: "draft", ...(over.product ?? {}) } };
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listCategoryOptions.mockResolvedValue([
    { id: "cat-1", name: "Ropa", parentId: null, archived: false },
    { id: "cat-2", name: "Camisas", parentId: "cat-1", archived: false },
    { id: "cat-old", name: "Vieja", parentId: null, archived: true },
  ]);
  api.listCollectionOptions.mockResolvedValue([
    { id: "col-1", name: "Verano", archived: false },
    { id: "col-2", name: "Invierno", archived: false },
  ]);
  api.listEnabledCurrencies.mockResolvedValue([
    { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2 },
  ]);
  api.searchProductsForRelation.mockResolvedValue([]);
  api.isSlugAvailable.mockResolvedValue(true);
  api.isCodeAvailable.mockResolvedValue(true);
  api.syncProductVariants.mockResolvedValue({ create: [], restore: [], archive: [], blocked: [] });
  for (const fn of [
    api.updateProductData,
    api.setProductStatus,
    api.setProductArchived,
    api.updateColor,
    api.updateSize,
    api.setColorArchived,
    api.setSizeArchived,
    api.updateImage,
    api.archiveImage,
  ])
    fn.mockResolvedValue("2026-10-03T10:00:00+00:00");
  for (const fn of [
    api.savePrices,
    api.addColor,
    api.addSize,
    api.saveImageOrder,
    api.setProductCategories,
    api.setProductCollections,
    api.setProductRelated,
  ])
    fn.mockResolvedValue(undefined);
  api.setVariantStock.mockResolvedValue(0);
  api.duplicateProduct.mockResolvedValue("copia-id");
});

describe("ProductEditPage: carga y encabezado", () => {
  it("muestra nombre, código, slug, estado y todas las secciones", async () => {
    renderEditor();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Chaqueta Chola" }),
    ).toBeInTheDocument();
    expect(screen.getByText("CHQ-001 · /chaqueta-chola")).toBeInTheDocument();
    for (const name of [
      "Datos",
      "Precios",
      "Colores y tallas",
      "Variantes y stock",
      "Imágenes",
      "Categorías, colecciones y relacionados",
      "Vista previa en la tienda",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  it("un producto inexistente muestra el aviso con el enlace de regreso", async () => {
    renderEditor(detailFixture(), { notFound: true });
    expect(await screen.findByText("No encontramos ese producto.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al listado" })).toHaveAttribute(
      "href",
      "/admin/productos",
    );
  });

  it("si la carga falla muestra el error con reintento", async () => {
    api.getAdminProduct.mockRejectedValue(new AppError("network", "x"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/productos/p1"]}>
          <Routes>
            <Route path="/admin/productos/:id" element={<ProductEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("un producto archivado lo dice y ofrece Restaurar (sin Publicar)", async () => {
    renderEditor(detailFixture({ product: { ...detailFixture().product, archived: true } }));
    expect(await screen.findByText(/Este producto está archivado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publicar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pasar a borrador" })).not.toBeInTheDocument();
  });
});

describe("Datos: guardado con control de edición concurrente", () => {
  it("'Guardar datos' está deshabilitado hasta que algo cambie", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Guardar datos" })).toBeDisabled();
  });

  it("guardar manda el updated_at EXACTO leído (con microsegundos) y el parche con el cambio", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const name = within(section("Datos")).getByRole("textbox", { name: "Nombre" });
    await user.clear(name);
    await user.type(name, "Chaqueta Nueva");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(api.updateProductData).toHaveBeenCalledTimes(1));
    const [id, version, patch] = api.updateProductData.mock.calls[0] ?? [];
    expect(id).toBe("p1");
    expect(version).toBe("2026-10-02T10:00:00.123456+00:00");
    expect(patch).toMatchObject({
      name: "Chaqueta Nueva",
      code: "CHQ-001",
      slug: "chaqueta-chola",
      cost_base: 100,
    });
    expect(toast.success).toHaveBeenCalledWith("Cambios guardados.");
  });

  it("un nombre vacío no se guarda y muestra el error", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.clear(within(section("Datos")).getByRole("textbox", { name: "Nombre" }));
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(await screen.findByText("Escribe el nombre del producto.")).toBeInTheDocument();
    expect(api.updateProductData).not.toHaveBeenCalled();
  });

  it("cambiar el slug avisa que el enlace anterior seguirá funcionando", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const slug = within(section("Datos")).getByRole("textbox", { name: /Dirección web/ });
    await user.clear(slug);
    await user.type(slug, "chaqueta-nueva");
    expect(screen.getByText(/el enlace anterior seguirá funcionando/)).toBeInTheDocument();
  });

  it("CONFLICTO: si otra persona guardó antes, avisa, NO pisa, conserva lo escrito y 'Recargar' trae la versión actual", async () => {
    api.updateProductData.mockRejectedValue(new StaleVersionError());
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const name = within(section("Datos")).getByRole("textbox", { name: "Nombre" });
    await user.clear(name);
    await user.type(name, "Mi versión");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));

    const banner = await screen.findByText("Alguien más modificó esto");
    expect(banner).toBeInTheDocument();
    expect(name).toHaveValue("Mi versión"); // lo escrito sigue visible hasta que el usuario decida
    expect(toast.error).not.toHaveBeenCalled(); // un conflicto no es un "error inesperado"

    const remote = detailFixture();
    api.getAdminProduct.mockResolvedValue({
      ...remote,
      product: {
        ...remote.product,
        name: "Versión de la otra persona",
        updatedAt: "2026-10-02T11:00:00.000001+00:00",
      },
    });
    await user.click(screen.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(name).toHaveValue("Versión de la otra persona"));
    expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument();
  });

  it("publicar, archivar o restaurar NO borra lo que se está editando en Datos (y guardar después usa la versión nueva)", async () => {
    const { user } = renderEditor(draft());
    await screen.findByRole("heading", { level: 1 });
    const description = within(section("Datos")).getByRole("textbox", { name: /Descripción/ });
    await user.clear(description);
    await user.type(description, "Texto a medio escribir");

    // publicar cambia products.updated_at: el detalle se vuelve a cargar con la versión nueva
    const published = draft();
    api.getAdminProduct.mockResolvedValue({
      ...published,
      product: {
        ...published.product,
        status: "active",
        updatedAt: "2026-10-03T10:00:00.999999+00:00",
      },
    });
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Publicar" }),
    );
    await waitFor(() => expect(api.setProductStatus).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Pasar a borrador" }); // el detalle ya refleja "publicado"

    expect(description).toHaveValue("Texto a medio escribir"); // lo escrito sigue ahí
    expect(screen.getByRole("button", { name: "Guardar datos" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(api.updateProductData).toHaveBeenCalledTimes(1));
    const [, version, patch] = api.updateProductData.mock.calls[0] ?? [];
    expect(version).toBe("2026-10-03T10:00:00.999999+00:00"); // la versión NUEVA, no la vieja (sería un falso conflicto)
    expect(patch).toMatchObject({ description: "Texto a medio escribir" });
  });

  it("un error de la base (código duplicado) se muestra en la sección y como aviso", async () => {
    api.updateProductData.mockRejectedValue(
      new AppError("conflict", "Ya existe un producto con ese código."),
    );
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const model = within(section("Datos")).getByRole("textbox", { name: "Modelo" });
    await user.type(model, "2");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(await within(section("Datos")).findByRole("alert")).toHaveTextContent(
      "Ya existe un producto con ese código.",
    );
    expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument();
  });
});

describe("Acciones: publicar, borrador, archivar, restaurar, duplicar", () => {
  it("borrador completo: Publicar abre el diálogo con la lista y confirmar publica con la versión leída", async () => {
    const { user } = renderEditor(draft());
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Publicar este producto?" });
    await user.click(within(dialog).getByRole("button", { name: "Publicar" }));
    await waitFor(() =>
      expect(api.setProductStatus).toHaveBeenCalledWith(
        "p1",
        "2026-10-02T10:00:00.123456+00:00",
        "active",
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Producto publicado.");
  });

  it("sin precio en BOB no se puede confirmar la publicación (bloquea), y lo dice en texto", async () => {
    const d = draft({ prices: [] });
    const { user } = renderEditor(d);
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Publicar" })).toBeDisabled();
    expect(within(dialog).getByText("Tiene precio en bolivianos").parentElement).toHaveTextContent(
      "(Falta)",
    );
    expect(api.setProductStatus).not.toHaveBeenCalled();
  });

  it("sin imágenes solo AVISA: el diálogo lo marca como aviso y sí deja publicar", async () => {
    const { user } = renderEditor(draft({ images: [] }));
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Tiene al menos una imagen").parentElement).toHaveTextContent(
      "(Aviso)",
    );
    expect(within(dialog).getByRole("button", { name: "Publicar" })).toBeEnabled();
  });

  it("un publicado se pasa a borrador solo tras confirmar", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Pasar a borrador" }));
    expect(api.setProductStatus).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "¿Pasar a borrador?" });
    await user.click(within(dialog).getByRole("button", { name: "Pasar a borrador" }));
    await waitFor(() =>
      expect(api.setProductStatus).toHaveBeenCalledWith("p1", expect.any(String), "draft"),
    );
  });

  it("archivar exige confirmación y explica que no se borra nada; cancelar no hace nada", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Archivar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar este producto?" });
    expect(dialog).toHaveTextContent("No se borra nada: podrás restaurarlo");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(api.setProductArchived).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Archivar" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar producto" }),
    );
    await waitFor(() =>
      expect(api.setProductArchived).toHaveBeenCalledWith("p1", expect.any(String), true),
    );
  });

  it("restaurar un archivado pide confirmación (puede volver a publicarse de inmediato) y manda archived=false", async () => {
    const { user } = renderEditor(
      detailFixture({ product: { ...detailFixture().product, archived: true } }),
    );
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Restaurar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Restaurar este producto?" });
    expect(dialog).toHaveTextContent("volverá a mostrarse en la tienda de inmediato");
    expect(api.setProductArchived).not.toHaveBeenCalled(); // todavía no: falta confirmar
    await user.click(within(dialog).getByRole("button", { name: "Restaurar producto" }));
    await waitFor(() =>
      expect(api.setProductArchived).toHaveBeenCalledWith("p1", expect.any(String), false),
    );
  });

  it("cancelar la restauración no hace nada", async () => {
    const { user } = renderEditor(
      detailFixture({ product: { ...detailFixture().product, archived: true } }),
    );
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Restaurar" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );
    expect(api.setProductArchived).not.toHaveBeenCalled();
  });

  it("si la base rechaza publicar (regla de negocio), muestra su mensaje y no marca éxito", async () => {
    api.setProductStatus.mockRejectedValue(
      new AppError("validation", 'no se puede publicar "Chaqueta": falta el precio en BOB'),
    );
    const { user } = renderEditor(draft());
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Publicar" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0]?.[1]).toMatchObject({
      description: expect.stringContaining("falta el precio en BOB"),
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Duplicar: el diálogo trae código y nombre sugeridos, y al aceptar lleva al producto nuevo", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Duplicar" }));
    const dialog = await screen.findByRole("dialog", { name: "Duplicar producto" });
    expect(within(dialog).getByRole("textbox", { name: "Código del duplicado" })).toHaveValue(
      "CHQ-001-COPIA",
    );
    expect(within(dialog).getByRole("textbox", { name: "Nombre del duplicado" })).toHaveValue(
      "Chaqueta Chola (copia)",
    );
    await user.click(within(dialog).getByRole("button", { name: "Duplicar producto" }));
    await waitFor(() =>
      expect(api.duplicateProduct).toHaveBeenCalledWith(
        "p1",
        "CHQ-001-COPIA",
        "Chaqueta Chola (copia)",
      ),
    );
  });

  it("Duplicar valida el código y muestra el error de la base sin cerrar el diálogo", async () => {
    api.duplicateProduct.mockRejectedValue(
      new AppError("conflict", "ya existe un producto con el código X-1"),
    );
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Duplicar" }));
    const dialog = await screen.findByRole("dialog");
    const code = within(dialog).getByRole("textbox", { name: "Código del duplicado" });
    await user.clear(code);
    await user.type(code, "mal código");
    await user.click(within(dialog).getByRole("button", { name: "Duplicar producto" }));
    expect(await within(dialog).findByText(/El código solo admite letras/)).toBeInTheDocument();
    expect(api.duplicateProduct).not.toHaveBeenCalled();
    await user.clear(code);
    await user.type(code, "X-1");
    await user.click(within(dialog).getByRole("button", { name: "Duplicar producto" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "ya existe un producto con el código X-1",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Precios", () => {
  it("cambiar el precio en BOB y guardar manda solo ese cambio, normalizado", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const price = within(section("Precios")).getByRole("textbox", { name: /Precio en Boliviano/ });
    expect(price).toHaveValue("250");
    await user.clear(price);
    await user.type(price, "300,5");
    await user.click(screen.getByRole("button", { name: "Guardar precios" }));
    await waitFor(() => expect(api.savePrices).toHaveBeenCalledTimes(1));
    const [productId, existing, changes] = api.savePrices.mock.calls[0] ?? [];
    expect(productId).toBe("p1");
    expect(existing).toEqual(detailFixture().prices);
    expect(changes).toEqual([{ currency: "BOB", amount: "300.5" }]);
  });

  it("con 3 decimales muestra el error y no guarda", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const price = within(section("Precios")).getByRole("textbox", { name: /Precio en Boliviano/ });
    await user.clear(price);
    await user.type(price, "10.999");
    await user.click(screen.getByRole("button", { name: "Guardar precios" }));
    expect(await within(section("Precios")).findByText("Máximo 2 decimales.")).toBeInTheDocument();
    expect(api.savePrices).not.toHaveBeenCalled();
  });

  it("no deja quitar el precio en BOB de un producto publicado", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.clear(
      within(section("Precios")).getByRole("textbox", { name: /Precio en Boliviano/ }),
    );
    await user.click(screen.getByRole("button", { name: "Guardar precios" }));
    expect(
      await screen.findByText(
        "No se puede quitar el precio en bolivianos de un producto publicado.",
      ),
    ).toBeInTheDocument();
    expect(api.savePrices).not.toHaveBeenCalled();
  });
});

describe("Variantes y stock", () => {
  it("lista cada variante con su SKU, stock y totales calculados", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const stock = section("Variantes y stock");
    expect(within(stock).getByRole("rowheader", { name: "Rojo / S" })).toBeInTheDocument();
    expect(within(stock).getByText("CHQ-001-ROJO-S")).toBeInTheDocument();
    expect(within(stock).getByRole("textbox", { name: "Nuevo stock de Rojo / S" })).toHaveValue(
      "10",
    );
    expect(within(stock).getByRole("textbox", { name: "Nuevo stock de Azul / M" })).toHaveValue(
      "0",
    );
    // en stock 10+4+1+0 = 15; disponible 10+4+0+0 = 14 (la de Azul/S tiene 1 reservada)
    expect(within(stock).getByText("Total en stock: 15 · disponible: 14")).toBeInTheDocument();
  });

  it("cambiar dos cantidades registra DOS ajustes con el valor nuevo y el que se veía (10→7 y 0→5)", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const stock = section("Variantes y stock");
    const a = within(stock).getByRole("textbox", { name: "Nuevo stock de Rojo / S" });
    const b = within(stock).getByRole("textbox", { name: "Nuevo stock de Azul / M" });
    await user.clear(a);
    await user.type(a, "7");
    await user.clear(b);
    await user.type(b, "5");
    await user.click(within(stock).getByRole("button", { name: "Guardar stock" }));
    await waitFor(() => expect(api.setVariantStock).toHaveBeenCalledTimes(2));
    // cada cambio lleva el valor nuevo Y el que se veía al editar (la base comprueba que no cambió)
    expect(api.setVariantStock).toHaveBeenNthCalledWith(1, {
      variantId: "v1",
      expected: 10,
      newValue: 7,
      reason: "adjust",
    });
    expect(api.setVariantStock).toHaveBeenNthCalledWith(2, {
      variantId: "v4",
      expected: 0,
      newValue: 5,
      reason: "adjust",
    });
  });

  it("la nota se envía con cada ajuste", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const stock = section("Variantes y stock");
    const a = within(stock).getByRole("textbox", { name: "Nuevo stock de Rojo / S" });
    await user.clear(a);
    await user.type(a, "12");
    await user.type(
      within(stock).getByRole("textbox", { name: "Nota (opcional)" }),
      "conteo físico",
    );
    await user.click(within(stock).getByRole("button", { name: "Guardar stock" }));
    await waitFor(() =>
      expect(api.setVariantStock).toHaveBeenCalledWith({
        variantId: "v1",
        expected: 10,
        newValue: 12,
        reason: "adjust",
        note: "conteo físico",
      }),
    );
  });

  it("un valor inválido (letras, decimal, negativo) se señala y NO registra nada", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const stock = section("Variantes y stock");
    const a = within(stock).getByRole("textbox", { name: "Nuevo stock de Rojo / S" });
    await user.clear(a);
    await user.type(a, "-3");
    await user.click(within(stock).getByRole("button", { name: "Guardar stock" }));
    expect(
      await within(stock).findByText("El stock debe ser un número entero de 0 o más."),
    ).toBeInTheDocument();
    expect(api.setVariantStock).not.toHaveBeenCalled();
  });

  it("'Carga inicial' no admite restar: lo dice y no registra", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const stock = section("Variantes y stock");
    await user.selectOptions(within(stock).getByLabelText("Motivo del ajuste"), "Carga inicial");
    const a = within(stock).getByRole("textbox", { name: "Nuevo stock de Rojo / S" });
    await user.clear(a);
    await user.type(a, "2");
    await user.click(within(stock).getByRole("button", { name: "Guardar stock" }));
    expect(
      await within(stock).findByText(
        "«Carga inicial» solo permite sumar. Usa «Ajuste» para restar.",
      ),
    ).toBeInTheDocument();
    expect(api.setVariantStock).not.toHaveBeenCalled();
  });

  it("si falla un ajuste a mitad de la tanda, informa cuántos SÍ se guardaron y cuál falló", async () => {
    api.setVariantStock
      .mockResolvedValueOnce(7)
      .mockRejectedValueOnce(
        new AppError("conflict", "no puedes dejar el stock por debajo de lo comprometido"),
      );
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const stock = section("Variantes y stock");
    const a = within(stock).getByRole("textbox", { name: "Nuevo stock de Rojo / S" });
    const b = within(stock).getByRole("textbox", { name: "Nuevo stock de Azul / M" });
    await user.clear(a);
    await user.type(a, "7");
    await user.clear(b);
    await user.type(b, "5");
    await user.click(within(stock).getByRole("button", { name: "Guardar stock" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Se guardaron 1 de 2 cambios. Falló «Azul / M»: no puedes dejar el stock por debajo de lo comprometido",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("si el stock cambió mientras se editaba (otra persona, una venta), la base lo rechaza: se informa lo que hay ahora y se recarga", async () => {
    api.setVariantStock.mockRejectedValue(
      new AppError(
        "conflict",
        "el stock cambió mientras editabas: ahora hay 7 unidades y esperabas 10",
      ),
    );
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const stock = section("Variantes y stock");
    const a = within(stock).getByRole("textbox", { name: "Nuevo stock de Rojo / S" });
    await user.clear(a);
    await user.type(a, "8");
    const loads = api.getAdminProduct.mock.calls.length;
    await user.click(within(stock).getByRole("button", { name: "Guardar stock" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("ahora hay 7 unidades y esperabas 10"),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.getAdminProduct.mock.calls.length).toBeGreaterThan(loads)); // se recarga el stock real
  });

  it("lo que se escribió NO se borra si el stock cambia por otro lado: al guardar se compara con lo nuevo", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const stock = section("Variantes y stock");
    const a = within(stock).getByRole("textbox", { name: "Nuevo stock de Rojo / S" });
    await user.clear(a);
    await user.type(a, "8");

    // mientras tanto una venta deja la variante en 9; algo provoca una recarga (aquí, "Actualizar variantes")
    const fresh = detailFixture();
    api.getAdminProduct.mockResolvedValue({
      ...fresh,
      variants: fresh.variants.map((v) =>
        v.id === "v1" ? { ...v, stockOnHand: 9, available: 9 } : v,
      ),
    });
    await user.click(
      within(section("Colores y tallas")).getByRole("button", { name: "Actualizar variantes" }),
    );
    await waitFor(() => expect(api.syncProductVariants).toHaveBeenCalled());
    await waitFor(() => expect(within(stock).getByText(/disponible: 13/)).toBeInTheDocument()); // 9+4+1+0 en stock; 9+4+0+0 disponibles

    expect(a).toHaveValue("8"); // lo escrito sigue ahí
    await user.click(within(stock).getByRole("button", { name: "Guardar stock" }));
    await waitFor(() => expect(api.setVariantStock).toHaveBeenCalledTimes(1));
    // el "esperado" es el stock NUEVO (9), no el viejo (10): si no, la base lo rechazaría sin motivo
    expect(api.setVariantStock).toHaveBeenCalledWith({
      variantId: "v1",
      expected: 9,
      newValue: 8,
      reason: "adjust",
    });
  });

  it("sin cambios, el botón está deshabilitado", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    expect(
      within(section("Variantes y stock")).getByRole("button", { name: "Guardar stock" }),
    ).toBeDisabled();
  });

  it("producto sin variantes: invita a agregar colores", async () => {
    renderEditor(detailFixture({ variants: [] }));
    await screen.findByRole("heading", { level: 1 });
    expect(
      within(section("Variantes y stock")).getByText(/todavía no tiene variantes/),
    ).toBeInTheDocument();
  });

  it("las variantes archivadas no aparecen en la matriz", async () => {
    const d = detailFixture();
    renderEditor({
      ...d,
      variants: d.variants.map((v) => (v.id === "v4" ? { ...v, archived: true } : v)),
    });
    await screen.findByRole("heading", { level: 1 });
    expect(
      within(section("Variantes y stock")).queryByRole("rowheader", { name: "Azul / M" }),
    ).not.toBeInTheDocument();
  });
});

describe("Imágenes", () => {
  it("lista las imágenes con la primera marcada como principal", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const images = section("Imágenes");
    expect(within(images).getByText("Principal")).toBeInTheDocument();
    expect(
      within(images).getByRole("textbox", { name: "Texto alternativo (Imagen 1)" }),
    ).toHaveValue("Frente");
    expect(within(images).getByRole("combobox", { name: "Color (Imagen 2)" })).toHaveValue(
      "c-rojo",
    );
    expect(
      within(images)
        .getAllByRole("img")
        .map((i) => i.getAttribute("src")),
    ).toEqual(["https://cdn.test/products/p1/a.webp", "https://cdn.test/products/p1/b.webp"]);
  });

  it("mover la segunda imagen antes escribe SOLO el nuevo orden (2 filas)", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(
      within(section("Imágenes")).getByRole("button", { name: "Mover antes: Imagen 2" }),
    );
    await waitFor(() => expect(api.saveImageOrder).toHaveBeenCalledTimes(1));
    expect(api.saveImageOrder.mock.calls[0]?.[0]).toEqual([
      { id: "i2", sortOrder: 1 },
      { id: "i1", sortOrder: 2 },
    ]);
  });

  it("los extremos no se pueden mover más allá (primera: sin 'antes'; última: sin 'después')", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const images = section("Imágenes");
    expect(within(images).getByRole("button", { name: "Mover antes: Imagen 1" })).toBeDisabled();
    expect(within(images).getByRole("button", { name: "Mover después: Imagen 2" })).toBeDisabled();
  });

  it("'Hacer principal' en la segunda la lleva al primer lugar", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const images = section("Imágenes");
    expect(within(images).getAllByRole("button", { name: "Hacer principal" })).toHaveLength(1); // la primera ya lo es
    await user.click(within(images).getByRole("button", { name: "Hacer principal" }));
    await waitFor(() => expect(api.saveImageOrder).toHaveBeenCalled());
    expect(api.saveImageOrder.mock.calls[0]?.[0]).toEqual([
      { id: "i2", sortOrder: 1 },
      { id: "i1", sortOrder: 2 },
    ]);
  });

  it("si falla al guardar el orden avisa y el orden vuelve a como estaba", async () => {
    api.saveImageOrder.mockRejectedValue(new AppError("network", "x"));
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const images = section("Imágenes");
    await user.click(within(images).getByRole("button", { name: "Mover antes: Imagen 2" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        within(images)
          .getAllByRole("img")
          .map((i) => i.getAttribute("src"))[0],
      ).toBe("https://cdn.test/products/p1/a.webp"),
    );
  });

  it("quitar una imagen pide confirmación y la archiva (no borra el archivo)", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(
      within(section("Imágenes")).getByRole("button", { name: "Quitar imagen: Imagen 2" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "¿Quitar esta imagen?" });
    expect(dialog).toHaveTextContent("El archivo no se borra del almacenamiento");
    await user.click(within(dialog).getByRole("button", { name: "Quitar imagen" }));
    await waitFor(() =>
      expect(api.archiveImage).toHaveBeenCalledWith(expect.objectContaining({ id: "i2" })),
    );
  });

  it("el texto alternativo se guarda al salir del campo, solo si cambió", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const alt = within(section("Imágenes")).getByRole("textbox", {
      name: "Texto alternativo (Imagen 1)",
    });
    await user.click(alt);
    await user.tab();
    expect(api.updateImage).not.toHaveBeenCalled(); // sin cambios: nada que guardar
    await user.clear(alt);
    await user.type(alt, "Vista frontal");
    await user.tab();
    await waitFor(() =>
      expect(api.updateImage).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), {
        alt: "Vista frontal",
      }),
    );
  });

  it("vaciar el texto alternativo lo guarda como null", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const alt = within(section("Imágenes")).getByRole("textbox", {
      name: "Texto alternativo (Imagen 1)",
    });
    await user.clear(alt);
    await user.tab();
    await waitFor(() =>
      expect(api.updateImage).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), {
        alt: null,
      }),
    );
  });

  it("asignar una imagen a un color (y volver a 'General') actualiza color_id", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const images = section("Imágenes");
    await user.selectOptions(
      within(images).getByRole("combobox", { name: "Color (Imagen 1)" }),
      "Azul",
    );
    await waitFor(() =>
      expect(api.updateImage).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), {
        color_id: "c-azul",
      }),
    );
    await user.selectOptions(
      within(images).getByRole("combobox", { name: "Color (Imagen 2)" }),
      "General (todos los colores)",
    );
    await waitFor(() =>
      expect(api.updateImage).toHaveBeenCalledWith(expect.objectContaining({ id: "i2" }), {
        color_id: null,
      }),
    );
  });

  it("subir varias imágenes: se preparan y suben una a una, con el orden siguiente al último", async () => {
    prepareImage.mockImplementation(async (f: File) => ({
      blob: f,
      contentType: f.type,
      ext: "png",
    }));
    api.uploadProductImage.mockImplementation(
      async (_id: string, _img: unknown, existing: { sortOrder: number }[]) => ({
        id: `n${existing.length}`,
        path: "x",
        alt: null,
        colorId: null,
        sortOrder: Math.max(...existing.map((e) => e.sortOrder)) + 1,
        updatedAt: "",
      }),
    );
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const files = [
      new File(["a"], "uno.png", { type: "image/png" }),
      new File(["b"], "dos.png", { type: "image/png" }),
    ];
    await user.upload(within(section("Imágenes")).getByLabelText("Subir imágenes"), files);
    await waitFor(() => expect(api.uploadProductImage).toHaveBeenCalledTimes(2));
    expect(prepareImage).toHaveBeenCalledTimes(2);
    // 1.ª sube con las existentes (órdenes 1 y 2); la 2.ª ya cuenta la recién subida (orden 3)
    expect(api.uploadProductImage.mock.calls[0]?.[2]).toEqual([{ sortOrder: 1 }, { sortOrder: 2 }]);
    expect(api.uploadProductImage.mock.calls[1]?.[2]).toEqual([
      { sortOrder: 1 },
      { sortOrder: 2 },
      { sortOrder: 3 },
    ]);
    expect(api.uploadProductImage.mock.calls[0]?.[0]).toBe("p1");
    expect((await screen.findAllByText("Subida")).length).toBe(2);
  });

  it("si una subida falla, las demás siguen; la fallida muestra su motivo y se puede reintentar", async () => {
    prepareImage.mockImplementation(async (f: File) => {
      if (f.name === "grande.png") throw new Error("too_large");
      return { blob: f, contentType: f.type, ext: "png" };
    });
    api.uploadProductImage.mockResolvedValue({
      id: "n",
      path: "x",
      alt: null,
      colorId: null,
      sortOrder: 3,
      updatedAt: "",
    });
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.upload(within(section("Imágenes")).getByLabelText("Subir imágenes"), [
      new File(["a"], "grande.png", { type: "image/png" }),
      new File(["b"], "chica.png", { type: "image/png" }),
    ]);
    expect(
      await screen.findByText("«grande.png» pesa demasiado, incluso reducida (máximo 5 MB)."),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.uploadProductImage).toHaveBeenCalledTimes(1)); // solo la buena
    // al reintentar (ya sin el error) sube
    prepareImage.mockImplementation(async (f: File) => ({
      blob: f,
      contentType: f.type,
      ext: "png",
    }));
    await user.click(await screen.findByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(api.uploadProductImage).toHaveBeenCalledTimes(2));
  });

  it("un archivo que no es imagen se rechaza con un mensaje claro y no se sube", async () => {
    prepareImage.mockRejectedValue(new Error("type"));
    const { user } = renderEditor(detailFixture(), { applyAccept: false });
    await screen.findByRole("heading", { level: 1 });
    await user.upload(
      within(section("Imágenes")).getByLabelText("Subir imágenes"),
      new File(["x"], "doc.pdf", { type: "application/pdf" }),
    );
    expect(
      await screen.findByText("«doc.pdf» no es una imagen compatible (usa JPG, PNG, WebP o AVIF)."),
    ).toBeInTheDocument();
    expect(api.uploadProductImage).not.toHaveBeenCalled();
  });

  it("si la primera imagen es de un color ARCHIVADO, la portada es la siguiente visible, y la oculta se marca", async () => {
    const d = detailFixture();
    renderEditor({
      ...d,
      colors: d.colors.map((c) => (c.id === "c-rojo" ? { ...c, archived: true } : c)),
      images: [
        { ...(d.images[0] as (typeof d.images)[number]), colorId: "c-rojo" }, // la nº 1, asignada a Rojo (archivado)
        { ...(d.images[1] as (typeof d.images)[number]), colorId: null }, // la nº 2, general
      ],
    });
    await screen.findByRole("heading", { level: 1 });
    const images = section("Imágenes");
    expect(within(images).getAllByText("Principal", { exact: true })).toHaveLength(1);
    // la etiqueta "Principal" está en la tarjeta de la imagen 2 (la que la tienda muestra), no en la 1
    const cards = within(images).getAllByRole("listitem");
    expect(
      within(cards[0] as HTMLElement).queryByText("Principal", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      within(cards[1] as HTMLElement).getByText("Principal", { exact: true }),
    ).toBeInTheDocument();
    expect(
      within(cards[0] as HTMLElement).getByText("Oculta en la tienda: su color está archivado."),
    ).toBeInTheDocument();
    // a la oculta no se le ofrece "Hacer principal"; a la visible tampoco (ya lo es)
    expect(
      within(images).queryByRole("button", { name: "Hacer principal" }),
    ).not.toBeInTheDocument();
  });

  it("el color archivado de una imagen sigue apareciendo en su selector (marcado) para poder cambiarla", async () => {
    const d = detailFixture();
    renderEditor({
      ...d,
      colors: d.colors.map((c) => (c.id === "c-rojo" ? { ...c, archived: true } : c)),
    });
    await screen.findByRole("heading", { level: 1 });
    const select = within(section("Imágenes")).getByRole("combobox", { name: "Color (Imagen 2)" });
    expect(
      within(select).getByRole("option", { name: "c-rojo (archivado)".replace("c-rojo", "Rojo") }),
    ).toBeInTheDocument();
    expect(select).toHaveValue("c-rojo");
    // la imagen 1 (general) NO ofrece el color archivado: no tiene sentido asignarle uno que ya no está activo
    const other = within(section("Imágenes")).getByRole("combobox", { name: "Color (Imagen 1)" });
    expect(within(other).queryByRole("option", { name: /Rojo/ })).not.toBeInTheDocument();
  });

  it("la vista previa usa la MISMA portada que la tienda (la primera visible)", async () => {
    const d = detailFixture();
    renderEditor({
      ...d,
      colors: d.colors.map((c) => (c.id === "c-rojo" ? { ...c, archived: true } : c)),
      images: [
        { ...(d.images[0] as (typeof d.images)[number]), colorId: "c-rojo" },
        { ...(d.images[1] as (typeof d.images)[number]), colorId: null },
      ],
    });
    await screen.findByRole("heading", { level: 1 });
    const prev = section("Vista previa en la tienda");
    expect(within(prev).getByRole("img", { name: "Chaqueta Chola" }).getAttribute("src")).toBe(
      "https://cdn.test/products/p1/b.webp",
    );
  });

  it("sin imágenes lo dice", async () => {
    renderEditor(detailFixture({ images: [] }));
    await screen.findByRole("heading", { level: 1 });
    expect(within(section("Imágenes")).getByText("Todavía no hay imágenes.")).toBeInTheDocument();
  });
});

describe("Colores y tallas", () => {
  it("agregar un color lo crea con el siguiente orden y re-sincroniza las variantes", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const sec = section("Colores y tallas");
    await user.type(within(sec).getByRole("textbox", { name: "Agregar color" }), "Verde");
    await user.click(within(sec).getAllByRole("button", { name: "Agregar" })[0] as HTMLElement);
    await waitFor(() =>
      expect(api.addColor).toHaveBeenCalledWith("p1", { name: "Verde", hex: "" }, 3),
    );
    await waitFor(() => expect(api.syncProductVariants).toHaveBeenCalledWith("p1"));
  });

  it("un color repetido (sin distinguir mayúsculas) se rechaza antes de llamar al servidor", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const sec = section("Colores y tallas");
    await user.type(within(sec).getByRole("textbox", { name: "Agregar color" }), "ROJO");
    await user.click(within(sec).getAllByRole("button", { name: "Agregar" })[0] as HTMLElement);
    expect(await within(sec).findByText("Ya existe un color con ese nombre.")).toBeInTheDocument();
    expect(api.addColor).not.toHaveBeenCalled();
  });

  it("agregar una talla la crea y sincroniza", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const sec = section("Colores y tallas");
    await user.type(within(sec).getByRole("textbox", { name: "Agregar talla" }), "L");
    await user.click(within(sec).getAllByRole("button", { name: "Agregar" })[1] as HTMLElement);
    await waitFor(() => expect(api.addSize).toHaveBeenCalledWith("p1", "L", 3));
    await waitFor(() => expect(api.syncProductVariants).toHaveBeenCalled());
  });

  it("archivar un color avisa cuánto stock tiene (Rojo: 10 + 4 = 14) y solo archiva al confirmar", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(
      within(section("Colores y tallas")).getByRole("button", { name: "Archivar color: Rojo" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar «Rojo»?" });
    expect(dialog).toHaveTextContent("tiene 14 unidades en stock");
    expect(api.setColorArchived).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Archivar" }));
    await waitFor(() =>
      expect(api.setColorArchived).toHaveBeenCalledWith(
        expect.objectContaining({ id: "c-rojo" }),
        true,
      ),
    );
    await waitFor(() => expect(api.syncProductVariants).toHaveBeenCalled());
  });

  it("un color sin stock se archiva sin la advertencia de stock", async () => {
    const d = detailFixture();
    renderEditor({
      ...d,
      variants: d.variants.map((v) => ({ ...v, stockOnHand: 0, available: 0 })),
    });
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1 });
    await user.click(
      within(section("Colores y tallas")).getByRole("button", { name: "Archivar color: Azul" }),
    );
    expect(await screen.findByRole("dialog")).not.toHaveTextContent("unidades en stock");
  });

  it("restaurar un color archivado lo reactiva y sincroniza (restaura sus variantes)", async () => {
    const d = detailFixture();
    const { user } = renderEditor({
      ...d,
      colors: d.colors.map((c) => (c.id === "c-azul" ? { ...c, archived: true } : c)),
    });
    await screen.findByRole("heading", { level: 1 });
    await user.click(
      within(section("Colores y tallas")).getByRole("button", { name: "Restaurar: Azul" }),
    );
    await waitFor(() =>
      expect(api.setColorArchived).toHaveBeenCalledWith(
        expect.objectContaining({ id: "c-azul" }),
        false,
      ),
    );
    await waitFor(() => expect(api.syncProductVariants).toHaveBeenCalled());
  });

  it("renombrar un color muestra 'Guardar' solo si cambió y manda el nombre y tono", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const sec = section("Colores y tallas");
    expect(within(sec).queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
    const name = within(sec).getByRole("textbox", { name: "Nombre del color: Rojo" });
    await user.clear(name);
    await user.type(name, "Rojo oscuro");
    await user.click(within(sec).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(api.updateColor).toHaveBeenCalledWith(expect.objectContaining({ id: "c-rojo" }), {
        name: "Rojo oscuro",
        hex: "#FF0000",
      }),
    );
  });

  it("si al sincronizar quedan variantes con stock sin poder archivarse, advierte", async () => {
    api.syncProductVariants.mockResolvedValue({
      create: [],
      restore: [],
      archive: [],
      blocked: [{ variantId: "v1", stockOnHand: 5 }],
    });
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(
      within(section("Colores y tallas")).getByRole("button", { name: "Actualizar variantes" }),
    );
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("1 variantes sobran pero tienen stock"),
      ),
    );
  });

  it("'Actualizar variantes' cuando ya están al día informa que no había nada que hacer", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(
      within(section("Colores y tallas")).getByRole("button", { name: "Actualizar variantes" }),
    );
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Las variantes ya están al día."));
  });

  it("si la base rechaza archivar (p. ej. la última variante de un producto publicado) muestra su mensaje y deja el diálogo abierto", async () => {
    api.setColorArchived.mockRejectedValue(
      new AppError(
        "validation",
        "no se puede archivar la última variante de un producto publicado",
      ),
    );
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    await user.click(
      within(section("Colores y tallas")).getByRole("button", { name: "Archivar color: Rojo" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar" }),
    );
    await waitFor(() =>
      expect(toast.error.mock.calls.at(-1)?.[1]).toMatchObject({
        description: "no se puede archivar la última variante de un producto publicado",
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Categorías, colecciones y relacionados", () => {
  it("muestra las categorías con su ruta y marca las del producto", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const org = section("Categorías, colecciones y relacionados");
    await within(org).findByRole("checkbox", { name: "Ropa" });
    expect(within(org).getByRole("checkbox", { name: "Ropa" })).toBeChecked();
    expect(within(org).getByRole("checkbox", { name: "Ropa › Camisas" })).not.toBeChecked();
    expect(within(org).getByRole("checkbox", { name: "Verano" })).toBeChecked();
  });

  it("una categoría archivada solo se ofrece si el producto sigue asociado a ella", async () => {
    renderEditor(detailFixture({ categoryIds: ["cat-1", "cat-old"] }));
    await screen.findByRole("heading", { level: 1 });
    const org = section("Categorías, colecciones y relacionados");
    expect(await within(org).findByRole("checkbox", { name: /Vieja/ })).toBeChecked();
    expect(within(org).getByText("(archivada)")).toBeInTheDocument();
  });

  it("no se muestran categorías archivadas a las que el producto no pertenece", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const org = section("Categorías, colecciones y relacionados");
    await within(org).findByRole("checkbox", { name: "Ropa" });
    expect(within(org).queryByRole("checkbox", { name: /Vieja/ })).not.toBeInTheDocument();
  });

  it("agregar una categoría y guardar manda solo la lista nueva de categorías (colecciones y relacionados no cambiaron)", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const org = section("Categorías, colecciones y relacionados");
    await user.click(await within(org).findByRole("checkbox", { name: "Ropa › Camisas" }));
    await user.click(within(org).getByRole("button", { name: "Guardar organización" }));
    await waitFor(() =>
      expect(api.setProductCategories).toHaveBeenCalledWith("p1", ["cat-1", "cat-2"]),
    );
    expect(api.setProductCollections).not.toHaveBeenCalled();
    expect(api.setProductRelated).not.toHaveBeenCalled();
  });

  it("quitar todas las categorías manda una lista vacía", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const org = section("Categorías, colecciones y relacionados");
    await user.click(await within(org).findByRole("checkbox", { name: "Ropa" }));
    await user.click(within(org).getByRole("button", { name: "Guardar organización" }));
    await waitFor(() => expect(api.setProductCategories).toHaveBeenCalledWith("p1", []));
  });

  it("relacionados: buscar, agregar al final, reordenar y quitar; guarda el orden final", async () => {
    api.searchProductsForRelation.mockResolvedValue([
      { id: "p3", code: "VST-001", name: "Vestido" },
    ]);
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const org = section("Categorías, colecciones y relacionados");
    await user.type(
      within(org).getByRole("searchbox", { name: "Buscar producto para relacionar" }),
      "ves",
    );
    await user.click(
      await within(org).findByRole("button", { name: "Agregar Vestido" }, { timeout: 2000 }),
    );
    // ahora la lista es [Camisa, Vestido]; mover Vestido antes → [Vestido, Camisa]
    await user.click(within(org).getByRole("button", { name: "Mover antes: Vestido" }));
    await user.click(within(org).getByRole("button", { name: "Guardar organización" }));
    await waitFor(() => expect(api.setProductRelated).toHaveBeenCalledWith("p1", ["p3", "p2"]));
    expect(api.searchProductsForRelation).toHaveBeenCalledWith("ves", "p1");
  });

  it("quitar un relacionado lo saca de la lista", async () => {
    const { user } = renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const org = section("Categorías, colecciones y relacionados");
    await user.click(within(org).getByRole("button", { name: "Quitar Camisa" }));
    await user.click(within(org).getByRole("button", { name: "Guardar organización" }));
    await waitFor(() => expect(api.setProductRelated).toHaveBeenCalledWith("p1", []));
  });

  it("'Guardar organización' está deshabilitado sin cambios", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const org = section("Categorías, colecciones y relacionados");
    expect(within(org).getByRole("button", { name: "Guardar organización" })).toBeDisabled();
  });
});

describe("Vista previa", () => {
  it("muestra nombre, precio formateado, colores y la imagen principal", async () => {
    renderEditor();
    await screen.findByRole("heading", { level: 1 });
    const prev = section("Vista previa en la tienda");
    expect(
      within(prev).getByRole("heading", { level: 3, name: "Chaqueta Chola" }),
    ).toBeInTheDocument();
    expect(within(prev).getByText(/250,00/)).toBeInTheDocument();
    expect(within(prev).getByText("Rojo")).toBeInTheDocument();
    expect(within(prev).getByRole("img", { name: "Frente" })).toHaveAttribute(
      "src",
      "https://cdn.test/products/p1/a.webp",
    );
  });

  it("marca 'Nuevo' y 'Agotado' según el producto", async () => {
    const d = detailFixture();
    renderEditor({
      ...d,
      product: { ...d.product, isNew: true },
      variants: d.variants.map((v) => ({ ...v, stockOnHand: 0, available: 0 })),
    });
    await screen.findByRole("heading", { level: 1 });
    const prev = section("Vista previa en la tienda");
    expect(within(prev).getByText("Nuevo")).toBeInTheDocument();
    expect(within(prev).getByText("Agotado")).toBeInTheDocument();
  });

  it("sin imagen ni precio muestra marcadores, no huecos", async () => {
    renderEditor(detailFixture({ images: [], prices: [] }));
    await screen.findByRole("heading", { level: 1 });
    const prev = section("Vista previa en la tienda");
    expect(within(prev).getByText("Sin imagen")).toBeInTheDocument();
    expect(within(prev).getByText("Sin precio")).toBeInTheDocument();
  });
});

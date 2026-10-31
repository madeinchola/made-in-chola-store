import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCategoryTree,
  getProductBySlug,
  listCollections,
} from "@/features/catalog/catalogService";
import { getListingFacets, listProductsFiltered } from "@/features/storefront/shopService";

vi.mock("@/features/storefront/shopService", () => ({
  listProductsFiltered: vi.fn(),
  getListingFacets: vi.fn(),
  findSlugRedirect: vi.fn(),
}));
vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getCategoryTree: vi.fn(),
  listCollections: vi.fn(),
  searchProducts: vi.fn(),
  getProductBySlug: vi.fn(),
}));
vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://img.test/${path}`,
  publicMediaUrl: (_bucket: string, path: string) => `https://img.test/${path}`,
  homeMediaUrl: () => null,
}));
vi.mock("@/features/storefront/seo/siteUrl", () => ({ siteUrl: () => "https://tienda.test" }));

import { ALL_PRODUCTS, CATEGORIES, COLLECTIONS, FACETS, renderListing } from "./listing-test-utils";
import { DEFAULT_QUERY, PAGE_SIZE } from "./listParams";

type ListArgs = Parameters<typeof listProductsFiltered>[0];

/** Servicio falso con paginación REAL sobre 50 productos (los filtros se verifican por los argumentos recibidos). */
async function fakeList({ query, pageSize }: ListArgs) {
  const size = pageSize ?? PAGE_SIZE;
  const start = (query.page - 1) * size;
  return { items: ALL_PRODUCTS.slice(start, start + size), total: ALL_PRODUCTS.length };
}
const lastArgs = () => vi.mocked(listProductsFiltered).mock.calls.at(-1)?.[0] as ListArgs;
const location = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  document.head.innerHTML = "";
  document.title = "";
  vi.mocked(getCategoryTree).mockReset().mockResolvedValue(CATEGORIES);
  vi.mocked(listCollections).mockReset().mockResolvedValue(COLLECTIONS);
  vi.mocked(getListingFacets).mockReset().mockResolvedValue(FACETS);
  vi.mocked(listProductsFiltered).mockReset().mockImplementation(fakeList);
  vi.mocked(getProductBySlug).mockReset().mockResolvedValue(null);
});

async function loaded(path: string, heading: string) {
  const view = renderListing(path);
  await screen.findByRole("heading", { level: 1, name: heading });
  await screen.findAllByRole("article");
  return { ...view, user: userEvent.setup() };
}

describe("rutas y cabecera del listado", () => {
  it("/tienda: título, migas «Inicio › Tienda», total y una rejilla de 24 tarjetas", async () => {
    await loaded("/tienda", "Tienda");
    const crumbs = screen.getByRole("navigation", { name: "Ruta de navegación" });
    expect(within(crumbs).getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/");
    expect(within(crumbs).getByText("Tienda")).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("article")).toHaveLength(24);
    expect(lastArgs()).toMatchObject({ scope: {}, query: DEFAULT_QUERY });
  });

  it("el total se anuncia en una región «polite» (singular y plural)", async () => {
    await loaded("/tienda", "Tienda");
    const count = screen.getByText("50 productos");
    expect(count).toHaveAttribute("aria-live", "polite");
    expect(count).toHaveAttribute("role", "status");
  });

  it("un solo producto: «1 producto»", async () => {
    vi.mocked(listProductsFiltered).mockResolvedValue({ items: [ALL_PRODUCTS[0]!], total: 1 });
    await loaded("/tienda", "Tienda");
    expect(screen.getByText("1 producto")).toBeInTheDocument();
  });

  it("categoría: nombre, descripción y listado restringido a su slug", async () => {
    await loaded("/categoria/ropa", "Ropa");
    expect(screen.getByText("Prendas hechas a mano.")).toBeInTheDocument();
    expect(lastArgs().scope).toEqual({ categorySlug: "ropa" });
    expect(getListingFacetsScope()).toEqual({ categorySlug: "ropa" });
  });

  it("subcategoría: las migas muestran el camino «Inicio › Tienda › Ropa › Chaquetas»", async () => {
    await loaded("/categoria/chaquetas", "Chaquetas");
    const crumbs = screen.getByRole("navigation", { name: "Ruta de navegación" });
    expect(within(crumbs).getByRole("link", { name: "Tienda" })).toHaveAttribute("href", "/tienda");
    expect(within(crumbs).getByRole("link", { name: "Ropa" })).toHaveAttribute(
      "href",
      "/categoria/ropa",
    );
    expect(within(crumbs).getByText("Chaquetas")).toHaveAttribute("aria-current", "page");
  });

  it("las migas son HTML válido: lista plana de 4 tramos + 3 separadores, sin <li> dentro de <li>", async () => {
    await loaded("/categoria/chaquetas", "Chaquetas");
    const crumbs = screen.getByRole("navigation", { name: "Ruta de navegación" });
    const list = crumbs.querySelector("ol")!;
    // Inicio, Tienda, Ropa, Chaquetas (4) con un separador entre cada par (3): 7 hijos directos.
    expect(Array.from(list.children).map((li) => li.tagName)).toEqual(Array(7).fill("LI"));
    expect(
      Array.from(list.children).map((li) => li.getAttribute("aria-hidden") === "true"),
    ).toEqual([false, true, false, true, false, true, false]);
    expect(list.querySelectorAll("li li")).toHaveLength(0);
  });

  it("colección: nombre y listado restringido a su slug", async () => {
    await loaded("/coleccion/verano-2027", "Verano 2027");
    expect(lastArgs().scope).toEqual({ collectionSlug: "verano-2027" });
    expect(screen.getByText("Lo nuevo de la temporada.")).toBeInTheDocument();
  });

  it("categoría inexistente: 404 amable (no pantalla en blanco), sin indexar y sin pedir productos", async () => {
    renderListing("/categoria/nada");
    expect(
      await screen.findByRole("heading", { name: "Página no encontrada" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
        "noindex,nofollow",
      ),
    );
    expect(listProductsFiltered).not.toHaveBeenCalled();
  });

  it("colección inexistente, vencida o archivada (no está en la lista pública): también 404", async () => {
    renderListing("/coleccion/vencida");
    expect(
      await screen.findByRole("heading", { name: "Página no encontrada" }),
    ).toBeInTheDocument();
    expect(listProductsFiltered).not.toHaveBeenCalled();
  });

  it("slug con mayúsculas redirige al minúsculo conservando los parámetros", async () => {
    renderListing("/categoria/Ropa?color=Rojo");
    await screen.findByRole("heading", { level: 1, name: "Ropa" });
    expect(location()).toBe("/categoria/ropa?color=Rojo");
  });

  it("colección: slug con mayúsculas redirige al minúsculo conservando los parámetros", async () => {
    renderListing("/coleccion/Verano-2027?orden=nombre");
    await screen.findByRole("heading", { level: 1, name: "Verano 2027" });
    expect(location()).toBe("/coleccion/verano-2027?orden=nombre");
  });

  it("mientras llegan las categorías muestra un esqueleto anunciado, no una pantalla en blanco", async () => {
    vi.mocked(getCategoryTree).mockReturnValue(new Promise(() => {}));
    renderListing("/categoria/ropa");
    expect(await screen.findByText("Cargando productos…")).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("si las categorías fallan: error con «Reintentar» que lo recupera", async () => {
    const user = userEvent.setup();
    vi.mocked(getCategoryTree).mockRejectedValueOnce(new Error("caído"));
    renderListing("/categoria/ropa");
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los productos");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ropa" })).toBeInTheDocument();
  });
});

function getListingFacetsScope() {
  return vi.mocked(getListingFacets).mock.calls.at(-1)?.[0];
}

describe("la URL es la única fuente de verdad", () => {
  it("lee filtros, orden y página de la URL y los manda al servicio", async () => {
    await loaded(
      "/tienda?color=Rojo&talla=M&min=100&max=250.5&disponibles=1&orden=precio-asc&pagina=2",
      "Tienda",
    );
    expect(lastArgs().query).toEqual({
      colors: ["Rojo"],
      sizes: ["M"],
      minPrice: 100,
      maxPrice: 250.5,
      inStockOnly: true,
      sort: "price_asc",
      page: 2,
    });
  });

  it("URL manipulada: valores inválidos se descartan sin romper nada", async () => {
    await loaded(
      "/tienda?pagina=abc&min=-5&max=1e3&orden=hack&color=&talla=%20&utm_source=x&fbclid=y",
      "Tienda",
    );
    expect(lastArgs().query).toEqual(DEFAULT_QUERY);
    expect(screen.getByText("50 productos")).toBeInTheDocument();
  });

  it("el botón de filtros muestra cuántos hay activos", async () => {
    await loaded("/tienda?color=Rojo&talla=M&min=100", "Tienda");
    expect(screen.getByRole("button", { name: "Filtros (3)" })).toBeInTheDocument();
  });

  it("sin filtros el botón se llama solo «Filtros»", async () => {
    await loaded("/tienda?orden=nombre&pagina=2", "Tienda");
    expect(screen.getByRole("button", { name: "Filtros" })).toBeInTheDocument();
  });

  it("ordenar cambia la URL, vuelve a la página 1 y el orden por defecto no se escribe", async () => {
    const { user } = await loaded("/tienda?pagina=2", "Tienda");
    const select = screen.getByRole("combobox", { name: "Ordenar por" });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Más nuevos",
      "Precio: de menor a mayor",
      "Precio: de mayor a menor",
      "Nombre (A-Z)",
    ]);
    await user.selectOptions(select, "Precio: de menor a mayor");
    await waitFor(() => expect(location()).toBe("/tienda?orden=precio-asc"));
    await waitFor(() => expect(lastArgs().query).toMatchObject({ sort: "price_asc", page: 1 }));
    await user.selectOptions(select, "Más nuevos");
    await waitFor(() => expect(location()).toBe("/tienda"));
  });

  it("«Atrás» deshace el filtro (cada cambio es una navegación nueva)", async () => {
    const { user } = await loaded("/tienda", "Tienda");
    await user.click(screen.getByRole("button", { name: "Filtros" }));
    const dialog = await screen.findByRole("dialog", { name: "Filtros" });
    await user.click(within(dialog).getByRole("checkbox", { name: "Rojo (2)" }));
    await user.click(within(dialog).getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(location()).toBe("/tienda?color=Rojo"));
    await user.click(screen.getByRole("button", { name: "Atrás (prueba)" }));
    await waitFor(() => expect(location()).toBe("/tienda"));
    // La consulta sin filtros ya está en caché: no hace falta pedirla otra vez, la pantalla vuelve a ella.
    expect(screen.getByRole("button", { name: "Filtros" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Filtros activos" })).not.toBeInTheDocument();
  });
});

describe("fichas de filtros activos", () => {
  it("una ficha por filtro con su botón «Quitar filtro: …»", async () => {
    await loaded("/tienda?color=Rojo&talla=M&min=100&disponibles=1", "Tienda");
    const chips = screen.getByRole("list", { name: "Filtros activos" });
    for (const name of [
      "Quitar filtro: Rojo",
      "Quitar filtro: Talla M",
      "Quitar filtro: Desde Bs 100,00",
      "Quitar filtro: Solo disponibles",
    ]) {
      expect(within(chips).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("el rango completo se escribe «Bs a – Bs b»", async () => {
    await loaded("/tienda?min=50&max=400", "Tienda");
    expect(
      screen.getByRole("button", { name: "Quitar filtro: Bs 50,00 – Bs 400,00" }),
    ).toBeInTheDocument();
  });

  it("quitar una ficha cambia la URL, vuelve a la página 1 y deja los demás filtros", async () => {
    const { user } = await loaded(
      "/tienda?color=Rojo&color=Azul&talla=M&pagina=2&orden=nombre",
      "Tienda",
    );
    await user.click(screen.getByRole("button", { name: "Quitar filtro: Rojo" }));
    await waitFor(() => expect(location()).toBe("/tienda?color=Azul&talla=M&orden=nombre"));
    await waitFor(() =>
      expect(lastArgs().query).toMatchObject({
        colors: ["Azul"],
        sizes: ["M"],
        sort: "name",
        page: 1,
      }),
    );
  });

  it("«Quitar todos» limpia los filtros pero conserva el orden", async () => {
    const { user } = await loaded(
      "/tienda?color=Rojo&talla=M&min=5&disponibles=1&orden=nombre",
      "Tienda",
    );
    await user.click(screen.getByRole("button", { name: "Quitar todos" }));
    await waitFor(() => expect(location()).toBe("/tienda?orden=nombre"));
    expect(screen.queryByRole("button", { name: "Quitar todos" })).not.toBeInTheDocument();
  });
});

describe("panel de filtros", () => {
  async function openPanel(path = "/tienda") {
    const ctx = await loaded(path, "Tienda");
    await ctx.user.click(screen.getByRole("button", { name: /^Filtros/ }));
    const dialog = await screen.findByRole("dialog", { name: "Filtros" });
    return { ...ctx, dialog };
  }

  it("muestra las opciones de las facetas: colores con contador, tallas y precio sugerido", async () => {
    const { dialog } = await openPanel();
    expect(within(dialog).getByRole("checkbox", { name: "Azul (1)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Rojo (2)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "S", pressed: false })).toBeInTheDocument();
    expect(within(dialog).getByText("Entre Bs 50,00 y Bs 400,00")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Mínimo (Bs)")).toHaveAttribute("placeholder", "50");
  });

  it("el borrador parte de la URL (sin distinguir mayúsculas ni acentos)", async () => {
    const { dialog } = await openPanel("/tienda?color=rójo&talla=m&min=70&disponibles=1");
    expect(within(dialog).getByRole("checkbox", { name: "Rojo (2)" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Azul (1)" })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "M", pressed: true })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Mínimo (Bs)")).toHaveValue("70");
    expect(within(dialog).getByRole("switch", { name: "Solo disponibles" })).toBeChecked();
  });

  it("«Aplicar» escribe todos los filtros en la URL, cierra el cajón y vuelve a la página 1", async () => {
    const { user, dialog } = await openPanel("/tienda?pagina=2");
    await user.click(within(dialog).getByRole("checkbox", { name: "Azul (1)" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Rojo (2)" }));
    await user.click(within(dialog).getByRole("button", { name: "M" }));
    await user.type(within(dialog).getByLabelText("Mínimo (Bs)"), "100,5");
    await user.type(within(dialog).getByLabelText("Máximo (Bs)"), "50");
    await user.click(within(dialog).getByRole("switch", { name: "Solo disponibles" }));
    await user.click(within(dialog).getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // mínimo y máximo estaban invertidos: se intercambian
    expect(location()).toBe("/tienda?color=Azul&color=Rojo&talla=M&min=50&max=100.5&disponibles=1");
    await waitFor(() =>
      expect(lastArgs().query).toMatchObject({
        minPrice: 50,
        maxPrice: 100.5,
        inStockOnly: true,
        page: 1,
      }),
    );
  });

  it("un precio inválido NO aplica nada, marca el campo y deja el cajón abierto", async () => {
    const { user, dialog } = await openPanel();
    await user.type(within(dialog).getByLabelText("Mínimo (Bs)"), "abc");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar" }));
    expect(
      await within(dialog).findByText("Escribe un monto válido, con hasta 2 decimales."),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Mínimo (Bs)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(location()).toBe("/tienda");
  });

  it("«Limpiar» vacía el borrador y «Aplicar» quita los filtros de la URL", async () => {
    const { user, dialog } = await openPanel("/tienda?color=Rojo&min=70&disponibles=1");
    await user.click(within(dialog).getByRole("button", { name: "Limpiar" }));
    expect(within(dialog).getByRole("checkbox", { name: "Rojo (2)" })).not.toBeChecked();
    expect(within(dialog).getByLabelText("Mínimo (Bs)")).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(location()).toBe("/tienda"));
  });

  it("las secciones sin opciones no se pintan (el precio y la disponibilidad siguen)", async () => {
    vi.mocked(getListingFacets).mockResolvedValue({
      colors: [],
      sizes: [],
      priceMin: null,
      priceMax: null,
    });
    const { dialog } = await openPanel();
    await waitFor(() =>
      expect(within(dialog).queryByText("Cargando opciones…")).not.toBeInTheDocument(),
    );
    expect(within(dialog).queryByText("Color")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Talla")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Mínimo (Bs)")).toBeInTheDocument();
    expect(within(dialog).getByRole("switch", { name: "Solo disponibles" })).toBeInTheDocument();
  });

  it("mientras llegan las opciones lo anuncia; si fallan, avisa y deja reintentar", async () => {
    vi.mocked(getListingFacets).mockReturnValueOnce(new Promise(() => {}));
    const first = await openPanel();
    expect(within(first.dialog).getByText("Cargando opciones…")).toBeInTheDocument();
  });

  it("si las opciones de filtro fallan: aviso con «Reintentar» que las recupera", async () => {
    vi.mocked(getListingFacets).mockRejectedValueOnce(new Error("caído"));
    const { user, dialog } = await openPanel();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No pudimos cargar todas las opciones de filtro.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Reintentar" }));
    expect(await within(dialog).findByRole("checkbox", { name: "Rojo (2)" })).toBeInTheDocument();
  });
});

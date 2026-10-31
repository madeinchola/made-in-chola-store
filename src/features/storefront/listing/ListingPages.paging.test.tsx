import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryTree, listCollections } from "@/features/catalog/catalogService";
import { subscribeToTracking, type TrackEvent } from "@/features/storefront/analytics/track";
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
}));
vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://img.test/${path}`,
  publicMediaUrl: (_bucket: string, path: string) => `https://img.test/${path}`,
  homeMediaUrl: () => null,
}));
vi.mock("@/features/storefront/seo/siteUrl", () => ({ siteUrl: () => "https://tienda.test" }));

import { ALL_PRODUCTS, CATEGORIES, COLLECTIONS, FACETS, renderListing } from "./listing-test-utils";
import { PAGE_SIZE } from "./listParams";

type ListArgs = Parameters<typeof listProductsFiltered>[0];

async function fakeList({ query, pageSize }: ListArgs) {
  const size = pageSize ?? PAGE_SIZE;
  const start = (query.page - 1) * size;
  return { items: ALL_PRODUCTS.slice(start, start + size), total: ALL_PRODUCTS.length };
}
const location = () => screen.getByTestId("location").textContent;
const pagesRequested = () =>
  vi.mocked(listProductsFiltered).mock.calls.map(([args]) => (args as ListArgs).query.page);

const metaContent = (name: string) =>
  document.head.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
const linkHref = (rel: string) =>
  document.head.querySelector(`link[rel="${rel}"]`)?.getAttribute("href") ?? null;
const jsonLd = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => JSON.parse(script.textContent ?? "null") as Record<string, unknown>,
  );

let events: TrackEvent[] = [];
let unsubscribe = () => {};

beforeEach(() => {
  document.head.innerHTML = "";
  document.title = "";
  events = [];
  unsubscribe = subscribeToTracking((event) => events.push(event));
  vi.mocked(getCategoryTree).mockReset().mockResolvedValue(CATEGORIES);
  vi.mocked(listCollections).mockReset().mockResolvedValue(COLLECTIONS);
  vi.mocked(getListingFacets).mockReset().mockResolvedValue(FACETS);
  vi.mocked(listProductsFiltered).mockReset().mockImplementation(fakeList);
});

afterEach(() => {
  unsubscribe();
  vi.restoreAllMocks();
});

async function loaded(path: string, heading: string) {
  const view = renderListing(path);
  await screen.findByRole("heading", { level: 1, name: heading });
  await screen.findAllByRole("article");
  return { ...view, user: userEvent.setup() };
}

describe("paginación", () => {
  it("enlaces reales a cada página, con la actual marcada", async () => {
    await loaded("/tienda", "Tienda");
    const nav = screen.getByRole("navigation", { name: "Paginación" });
    expect(within(nav).getByRole("link", { name: "Página 1, página actual" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Página 2" })).toHaveAttribute(
      "href",
      "/tienda?pagina=2",
    );
    expect(within(nav).getByRole("link", { name: "Página 3" })).toHaveAttribute(
      "href",
      "/tienda?pagina=3",
    );
  });

  it("los enlaces conservan filtros y orden (y los parámetros de campaña)", async () => {
    await loaded("/tienda?color=Rojo&orden=nombre&utm_source=fb", "Tienda");
    const nav = screen.getByRole("navigation", { name: "Paginación" });
    const href = within(nav).getByRole("link", { name: "Página 2" }).getAttribute("href") ?? "";
    const params = new URL(href, "https://x.test").searchParams;
    expect(href.startsWith("/tienda?")).toBe(true);
    expect(params.getAll("color")).toEqual(["Rojo"]);
    expect(params.get("orden")).toBe("nombre");
    expect(params.get("utm_source")).toBe("fb");
    expect(params.get("pagina")).toBe("2");
  });

  it("una sola página: no se pinta la paginación", async () => {
    vi.mocked(listProductsFiltered).mockResolvedValue({
      items: ALL_PRODUCTS.slice(0, 5),
      total: 5,
    });
    await loaded("/tienda", "Tienda");
    expect(screen.queryByRole("navigation", { name: "Paginación" })).not.toBeInTheDocument();
  });

  it("cambiar de página: URL nueva, productos de esa página, scroll al inicio y foco en el título", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const { user } = await loaded("/tienda", "Tienda");
    // En la primera carga el foco NO se roba (la usuaria no hizo nada todavía).
    expect(document.body).toHaveFocus();
    expect(scroll).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: "Página 2" }));
    await waitFor(() => expect(location()).toBe("/tienda?pagina=2"));
    expect(
      await screen.findByRole("heading", { level: 2, name: "Producto 25" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Producto 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Tienda" })).toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.calls[0]?.[0]).toMatchObject({ block: "start" });
    expect(screen.getByRole("link", { name: "Página 2, página actual" })).toBeInTheDocument();
  });

  it("en desarrollo (StrictMode ejecuta los efectos dos veces) la primera carga tampoco roba el foco ni hace scroll", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    renderListing("/tienda", { strict: true });
    await screen.findByRole("heading", { level: 1, name: "Tienda" });
    await screen.findAllByRole("article");
    expect(document.body).toHaveFocus();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("«Atrás» vuelve a la página anterior (cada página es una navegación nueva)", async () => {
    const { user } = await loaded("/tienda", "Tienda");
    await user.click(screen.getByRole("link", { name: "Página 3" }));
    await waitFor(() => expect(location()).toBe("/tienda?pagina=3"));
    await user.click(screen.getByRole("button", { name: "Atrás (prueba)" }));
    await waitFor(() => expect(location()).toBe("/tienda"));
    expect(
      await screen.findByRole("heading", { level: 2, name: "Producto 1" }),
    ).toBeInTheDocument();
  });

  it("«Siguiente» avanza una página", async () => {
    const { user } = await loaded("/tienda?pagina=2", "Tienda");
    await user.click(screen.getByRole("link", { name: "Siguiente" }));
    await waitFor(() => expect(location()).toBe("/tienda?pagina=3"));
  });

  it("mientras llega la otra página se ve la anterior (atenuada, anunciada y ocupada), sin saltos", async () => {
    let release: () => void = () => {};
    vi.mocked(listProductsFiltered).mockImplementation(async (args) => {
      if (args.query.page === 2) await new Promise<void>((resolve) => (release = resolve));
      return fakeList(args);
    });
    const { user } = await loaded("/tienda", "Tienda");
    await user.click(screen.getByRole("link", { name: "Página 2" }));
    expect(await screen.findByText("Actualizando…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Producto 1" })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    release();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Producto 25" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.queryByText("Actualizando…")).not.toBeInTheDocument();
  });
});

describe("página fuera de rango", () => {
  it("salta a la última página real (sin dejar la URL rota en el historial)", async () => {
    renderListing("/tienda?pagina=99");
    await waitFor(() => expect(location()).toBe("/tienda?pagina=3"));
    expect(await screen.findAllByRole("article")).toHaveLength(2);
    expect(pagesRequested()).toContain(99);
    expect(pagesRequested().at(-1)).toBe(3);
    expect(screen.getByText("50 productos")).toBeInTheDocument();
  });

  it("el salto REEMPLAZA la entrada: «atrás» sale del listado en vez de caer otra vez en la página rota", async () => {
    const user = userEvent.setup();
    renderListing("/");
    await user.click(await screen.findByRole("link", { name: "Ir a una página lejana (prueba)" }));
    await waitFor(() => expect(location()).toBe("/tienda?pagina=3"));
    await screen.findAllByRole("article");
    await user.click(screen.getByRole("button", { name: "Atrás (prueba)" }));
    await waitFor(() => expect(location()).toBe("/"));
  });

  it("conserva los filtros al saltar", async () => {
    vi.mocked(listProductsFiltered).mockImplementation(async ({ query }) => ({
      items:
        query.page === 1
          ? ALL_PRODUCTS.slice(0, 24)
          : query.page === 2
            ? ALL_PRODUCTS.slice(24, 30)
            : [],
      total: 30,
    }));
    renderListing("/tienda?color=Rojo&pagina=4");
    await waitFor(() => expect(location()).toBe("/tienda?color=Rojo&pagina=2"));
    expect(await screen.findAllByRole("article")).toHaveLength(6);
  });

  it("con la lista realmente vacía no hay salto ni bucle: se muestra el estado vacío", async () => {
    vi.mocked(listProductsFiltered).mockResolvedValue({ items: [], total: 0 });
    renderListing("/tienda?pagina=5");
    expect(await screen.findByText("Aún no hay productos aquí")).toBeInTheDocument();
    expect(location()).toBe("/tienda?pagina=5");
    expect(listProductsFiltered).toHaveBeenCalledTimes(1);
  });
});

describe("estados", () => {
  it("cargando: esqueleto anunciado y zona ocupada, sin tarjetas", async () => {
    vi.mocked(listProductsFiltered).mockReturnValue(new Promise(() => {}));
    renderListing("/tienda");
    await screen.findByRole("heading", { level: 1, name: "Tienda" });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByText("Aún no hay productos aquí")).not.toBeInTheDocument();
  });

  it("vacío SIN filtros: mensaje, categorías y «Ver toda la tienda»", async () => {
    vi.mocked(listProductsFiltered).mockResolvedValue({ items: [], total: 0 });
    renderListing("/categoria/ropa");
    expect(await screen.findByText("Aún no hay productos aquí")).toBeInTheDocument();
    expect(screen.getByText("Vuelve pronto: estamos preparando novedades.")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Categorías" });
    expect(within(nav).getByRole("link", { name: "Ropa" })).toHaveAttribute(
      "href",
      "/categoria/ropa",
    );
    expect(within(nav).getByRole("link", { name: "Sombreros" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver toda la tienda" })).toHaveAttribute(
      "href",
      "/tienda",
    );
    expect(screen.queryByRole("button", { name: "Quitar filtros" })).not.toBeInTheDocument();
  });

  it("vacío CON filtros: lo dice y ofrece «Quitar filtros»", async () => {
    vi.mocked(listProductsFiltered).mockImplementation(async ({ query }) =>
      query.colors.length > 0 ? { items: [], total: 0 } : fakeList({ query } as ListArgs),
    );
    const user = userEvent.setup();
    renderListing("/tienda?color=Rojo&orden=nombre");
    expect(await screen.findByText("Ningún producto coincide con tus filtros")).toBeInTheDocument();
    expect(screen.getByText("0 productos")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitar filtros" }));
    await waitFor(() => expect(location()).toBe("/tienda?orden=nombre"));
    expect(await screen.findAllByRole("article")).toHaveLength(24);
  });

  it("error del servicio: mensaje con «Reintentar» que lo recupera", async () => {
    vi.mocked(listProductsFiltered).mockRejectedValueOnce(new Error("caído"));
    const user = userEvent.setup();
    renderListing("/tienda");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar los productos");
    expect(screen.getByRole("heading", { level: 1, name: "Tienda" })).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findAllByRole("article")).toHaveLength(24);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SEO", () => {
  it("/tienda: indexable, canónico limpio, página siguiente y título", async () => {
    await loaded("/tienda", "Tienda");
    await waitFor(() => expect(metaContent("robots")).toBe("index,follow"));
    expect(document.title).toBe("Tienda · Made In Chola");
    expect(linkHref("canonical")).toBe("https://tienda.test/tienda");
    expect(linkHref("next")).toBe("https://tienda.test/tienda?pagina=2");
    expect(linkHref("prev")).toBeNull();
    expect(metaContent("description")).toBeTruthy();
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      "https://img.test/c/1.jpg",
    );
  });

  it("con filtros: noindex,follow y canónico SIN filtros", async () => {
    await loaded("/tienda?color=Rojo&talla=M", "Tienda");
    await waitFor(() => expect(metaContent("robots")).toBe("noindex,follow"));
    expect(linkHref("canonical")).toBe("https://tienda.test/tienda");
  });

  it("con un orden distinto al de por defecto: noindex,follow", async () => {
    await loaded("/tienda?orden=precio-desc", "Tienda");
    await waitFor(() => expect(metaContent("robots")).toBe("noindex,follow"));
    expect(linkHref("canonical")).toBe("https://tienda.test/tienda");
  });

  it("utm_ y fbclid no ensucian el canónico ni quitan la indexación; la página 2 sí se indexa", async () => {
    await loaded("/tienda?utm_source=fb&fbclid=abc&pagina=2", "Tienda");
    await waitFor(() => expect(metaContent("robots")).toBe("index,follow"));
    expect(linkHref("canonical")).toBe("https://tienda.test/tienda?pagina=2");
    expect(linkHref("prev")).toBe("https://tienda.test/tienda");
    expect(linkHref("next")).toBe("https://tienda.test/tienda?pagina=3");
    expect(document.title).toBe("Tienda · página 2 · Made In Chola");
  });

  it("categoría: título, canónico propio y migas con todo el camino en el JSON-LD", async () => {
    await loaded("/categoria/chaquetas", "Chaquetas");
    await waitFor(() => expect(document.title).toBe("Chaquetas · Made In Chola"));
    expect(linkHref("canonical")).toBe("https://tienda.test/categoria/chaquetas");
    const breadcrumb = jsonLd().find((item) => item["@type"] === "BreadcrumbList");
    const names = (breadcrumb?.itemListElement as { name: string }[]).map((el) => el.name);
    expect(names).toEqual(["Inicio", "Tienda", "Ropa", "Chaquetas"]);
  });

  it("JSON-LD de la lista: un elemento por producto con URL e imagen absolutas", async () => {
    await loaded("/tienda", "Tienda");
    await waitFor(() => expect(jsonLd().length).toBe(2));
    const list = jsonLd().find((item) => item["@type"] === "ItemList");
    const elements = list?.itemListElement as {
      position: number;
      url?: string;
      item?: { url?: string };
    }[];
    expect(elements).toHaveLength(24);
    expect(JSON.stringify(elements[0])).toContain("https://tienda.test/producto/p-1");
    expect(JSON.stringify(elements[0])).toContain("https://img.test/c/1.jpg");
    for (const script of document.head.querySelectorAll('script[type="application/ld+json"]')) {
      expect(script.textContent).not.toContain("<");
    }
  });

  it("no publica etiquetas con datos a medias: nada de SEO hasta que llegan los productos", async () => {
    vi.mocked(listProductsFiltered).mockReturnValue(new Promise(() => {}));
    renderListing("/tienda");
    await screen.findByRole("heading", { level: 1, name: "Tienda" });
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("al pasar a la página 2 no publica etiquetas con los productos de la 1 mientras espera; al llegar, las de la 2", async () => {
    let release: () => void = () => {};
    vi.mocked(listProductsFiltered).mockImplementation(async (args) => {
      if (args.query.page === 2) await new Promise<void>((resolve) => (release = resolve));
      return fakeList(args);
    });
    const { user } = await loaded("/tienda", "Tienda");
    await waitFor(() => expect(linkHref("canonical")).toBe("https://tienda.test/tienda"));
    await user.click(screen.getByRole("link", { name: "Página 2" }));
    await screen.findByText("Actualizando…");
    // Se ven los productos de la 1: ni canónico de la 2, ni imagen/JSON-LD de la 1 bajo la URL de la 2.
    expect(linkHref("canonical")).toBeNull();
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull();
    expect(jsonLd()).toHaveLength(0);
    release();
    await waitFor(() => expect(linkHref("canonical")).toBe("https://tienda.test/tienda?pagina=2"));
    expect(document.title).toBe("Tienda · página 2 · Made In Chola");
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      "https://img.test/c/25.jpg",
    );
    expect(jsonLd()).toHaveLength(2);
  });

  it("al salir de la página retira sus etiquetas", async () => {
    const { unmount } = await loaded("/tienda", "Tienda");
    await waitFor(() => expect(metaContent("robots")).toBe("index,follow"));
    unmount();
    expect(document.head.querySelector("[data-seo]")).toBeNull();
  });
});

describe("analítica", () => {
  it("emite view_item_list una vez al llegar los resultados, con posiciones y sin datos personales", async () => {
    await loaded("/categoria/ropa", "Ropa");
    await waitFor(() => expect(events).toHaveLength(1));
    const event = events[0];
    expect(event).toMatchObject({
      name: "view_item_list",
      listId: "category:ropa",
      listName: "Ropa",
    });
    if (event?.name !== "view_item_list") throw new Error("evento inesperado");
    expect(event.items).toHaveLength(24);
    expect(event.items[0]).toEqual({
      id: "id-1",
      name: "Producto 1",
      price: 101,
      currency: "BOB",
      position: 1,
    });
    expect(event.items[23]?.position).toBe(24);
  });

  it("al cambiar de página vuelve a emitir, con las posiciones de esa página, y no con los datos de relleno", async () => {
    let release: () => void = () => {};
    vi.mocked(listProductsFiltered).mockImplementation(async (args) => {
      if (args.query.page === 2) await new Promise<void>((resolve) => (release = resolve));
      return fakeList(args);
    });
    const { user } = await loaded("/tienda", "Tienda");
    await waitFor(() => expect(events).toHaveLength(1));
    await user.click(screen.getByRole("link", { name: "Página 2" }));
    await screen.findByText("Actualizando…");
    // Mientras llega la página 2 se ven los productos de la 1: NO se vuelve a emitir con ellos.
    expect(events).toHaveLength(1);
    release();
    await waitFor(() => expect(events).toHaveLength(2));
    const second = events[1];
    if (second?.name !== "view_item_list") throw new Error("evento inesperado");
    expect(second.items[0]?.position).toBe(25);
    expect(second.items[0]?.id).toBe("id-25");
  });

  it("sin resultados no se emite nada", async () => {
    vi.mocked(listProductsFiltered).mockResolvedValue({ items: [], total: 0 });
    renderListing("/tienda");
    await screen.findByText("Aún no hay productos aquí");
    expect(events).toHaveLength(0);
  });

  it("con error del servicio no se emite nada", async () => {
    vi.mocked(listProductsFiltered).mockRejectedValue(new Error("caído"));
    renderListing("/tienda");
    await screen.findByRole("alert");
    expect(events).toHaveLength(0);
  });
});

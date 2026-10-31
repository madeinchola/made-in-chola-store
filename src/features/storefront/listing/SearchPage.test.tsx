import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCategoryTree,
  getProductBySlug,
  listCollections,
  searchProducts,
} from "@/features/catalog/catalogService";
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
  getProductBySlug: vi.fn(),
}));
vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://img.test/${path}`,
  publicMediaUrl: (_bucket: string, path: string) => `https://img.test/${path}`,
  homeMediaUrl: () => null,
}));
vi.mock("@/features/storefront/seo/siteUrl", () => ({ siteUrl: () => "https://tienda.test" }));

import { ALL_PRODUCTS, CATEGORIES, COLLECTIONS, FACETS, renderListing } from "./listing-test-utils";
import { SEARCH_LIMIT } from "./searchQuery";

const location = () => screen.getByTestId("location").textContent;
const metaContent = (name: string) =>
  document.head.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
const linkHref = (rel: string) =>
  document.head.querySelector(`link[rel="${rel}"]`)?.getAttribute("href") ?? null;
const field = () => screen.getByRole("searchbox", { name: "¿Qué buscas?" });

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
  vi.mocked(listProductsFiltered).mockReset().mockResolvedValue({ items: [], total: 0 });
  vi.mocked(getProductBySlug).mockReset().mockResolvedValue(null);
  vi.mocked(searchProducts)
    .mockReset()
    .mockImplementation(async () => ALL_PRODUCTS.slice(0, 3));
});

afterEach(() => unsubscribe());

describe("invitación y consulta corta", () => {
  it("sin q: invita a buscar, ofrece categorías y la tienda, y no consulta nada", async () => {
    renderListing("/buscar");
    expect(await screen.findByRole("heading", { level: 1, name: "Buscar" })).toBeInTheDocument();
    expect(screen.getByText("¿Qué estás buscando?")).toBeInTheDocument();
    expect(field()).toHaveAttribute("type", "search");
    expect(field()).toHaveValue("");
    const nav = await screen.findByRole("navigation", { name: "Categorías" });
    expect(within(nav).getByRole("link", { name: "Ropa" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver toda la tienda" })).toHaveAttribute(
      "href",
      "/tienda",
    );
    expect(searchProducts).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("una sola letra en la URL: avisa «Escribe al menos 2 letras», no consulta y no cuenta como búsqueda", async () => {
    renderListing("/buscar?q=a");
    expect(await screen.findByText("Escribe al menos 2 letras.")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(searchProducts).not.toHaveBeenCalled();
    expect(screen.getByText("¿Qué estás buscando?")).toBeInTheDocument();
    expect(events).toHaveLength(0);
  });

  it("enviar el formulario con 1 letra o vacío: aviso, la URL no cambia y no se consulta", async () => {
    const user = userEvent.setup();
    renderListing("/buscar");
    await screen.findByRole("heading", { level: 1, name: "Buscar" });
    await user.type(field(), "a{Enter}");
    expect(await screen.findByText("Escribe al menos 2 letras.")).toBeInTheDocument();
    expect(location()).toBe("/buscar");
    await user.clear(field());
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByText("Escribe al menos 2 letras.")).toBeInTheDocument();
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it("el aviso desaparece cuando la búsqueda ya es válida", async () => {
    const user = userEvent.setup();
    renderListing("/buscar");
    await user.type(field(), "a{Enter}");
    await screen.findByText("Escribe al menos 2 letras.");
    await user.type(field(), "b{Enter}");
    await waitFor(() =>
      expect(screen.queryByText("Escribe al menos 2 letras.")).not.toBeInTheDocument(),
    );
    expect(location()).toBe("/buscar?q=ab");
  });
});

describe("resultados", () => {
  it("muestra «N resultados para “…”» en una región polite y las tarjetas", async () => {
    renderListing("/buscar?q=poncho");
    expect(await screen.findAllByRole("article")).toHaveLength(3);
    const count = screen.getByText("3 resultados para “poncho”");
    expect(count).toHaveAttribute("aria-live", "polite");
    expect(count).toHaveAttribute("role", "status");
    expect(field()).toHaveValue("poncho");
    expect(searchProducts).toHaveBeenCalledWith("poncho", SEARCH_LIMIT);
  });

  it("un solo resultado: «1 resultado para …»", async () => {
    vi.mocked(searchProducts).mockResolvedValue([ALL_PRODUCTS[0]!]);
    renderListing("/buscar?q=poncho");
    expect(await screen.findByText("1 resultado para “poncho”")).toBeInTheDocument();
  });

  it("enviar el formulario escribe q en la URL (con «atrás» posible) y conserva los otros parámetros", async () => {
    const user = userEvent.setup();
    renderListing("/buscar?utm_source=fb");
    await screen.findByRole("heading", { level: 1, name: "Buscar" });
    await user.type(field(), "sombrero{Enter}");
    await waitFor(() => expect(location()).toBe("/buscar?utm_source=fb&q=sombrero"));
    expect(await screen.findAllByRole("article")).toHaveLength(3);
    expect(searchProducts).toHaveBeenCalledWith("sombrero", SEARCH_LIMIT);
  });

  it("«Atrás» devuelve la búsqueda anterior y el campo la sigue", async () => {
    const user = userEvent.setup();
    renderListing("/buscar?q=uno1");
    await screen.findAllByRole("article");
    await user.clear(field());
    await user.type(field(), "dos2{Enter}");
    await waitFor(() => expect(location()).toBe("/buscar?q=dos2"));
    await user.click(screen.getByRole("button", { name: "Atrás (prueba)" }));
    await waitFor(() => expect(location()).toBe("/buscar?q=uno1"));
    await waitFor(() => expect(field()).toHaveValue("uno1"));
  });

  it("volver a enviar la misma búsqueda no la repite ni apila el historial", async () => {
    const user = userEvent.setup();
    renderListing("/buscar?q=poncho");
    await screen.findAllByRole("article");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await user.click(screen.getByRole("button", { name: "Atrás (prueba)" }));
    expect(location()).toBe("/buscar?q=poncho");
    expect(searchProducts).toHaveBeenCalledTimes(1);
  });

  it("la misma búsqueda otra vez no apila una entrada en el historial: «atrás» sale de la búsqueda", async () => {
    const user = userEvent.setup();
    renderListing("/");
    await user.click(await screen.findByRole("link", { name: "Ir a la búsqueda (prueba)" }));
    await screen.findAllByRole("article");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await user.click(screen.getByRole("button", { name: "Atrás (prueba)" }));
    await waitFor(() => expect(location()).toBe("/"));
  });

  it("limpia la consulta: espacios colapsados y recorte a 80 caracteres", async () => {
    renderListing("/buscar?q=%20%20po%20%20%20ncho%20");
    await screen.findAllByRole("article");
    expect(searchProducts).toHaveBeenLastCalledWith("po ncho", SEARCH_LIMIT);
    expect(field()).toHaveValue("po ncho");
  });

  it("una consulta de 200 caracteres se recorta a 80", async () => {
    renderListing(`/buscar?q=${"x".repeat(200)}`);
    await screen.findAllByRole("article");
    expect(searchProducts).toHaveBeenLastCalledWith("x".repeat(80), SEARCH_LIMIT);
  });

  it("si hay tantos como el límite lo avisa", async () => {
    vi.mocked(searchProducts).mockResolvedValue(
      Array.from({ length: SEARCH_LIMIT }, (_, i) => ALL_PRODUCTS[i % ALL_PRODUCTS.length]!),
    );
    renderListing("/buscar?q=ropa");
    expect(
      await screen.findByText(
        `Mostrando los ${SEARCH_LIMIT} más relevantes. Afina tu búsqueda para ver otros.`,
      ),
    ).toBeInTheDocument();
  });

  it("el texto buscado se muestra como texto, nunca como HTML", async () => {
    vi.mocked(searchProducts).mockResolvedValue([]);
    renderListing(`/buscar?q=${encodeURIComponent("<b>hola</b>")}`);
    expect(
      await screen.findByText("No encontramos resultados para “<b>hola</b>”"),
    ).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });
});

describe("sin resultados, carga y error", () => {
  it("sin resultados: lo dice, ofrece categorías y la tienda, y registra la búsqueda con 0", async () => {
    vi.mocked(searchProducts).mockResolvedValue([]);
    renderListing("/buscar?q=zzz");
    expect(await screen.findByText("No encontramos resultados para “zzz”")).toBeInTheDocument();
    expect(screen.getByText("Revisa la ortografía o prueba con otra palabra.")).toBeInTheDocument();
    expect(await screen.findByRole("navigation", { name: "Categorías" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver toda la tienda" })).toBeInTheDocument();
    await waitFor(() => expect(events).toEqual([{ name: "search", query: "zzz", results: 0 }]));
  });

  it("cargando: esqueleto con la zona ocupada y nada de «sin resultados»", async () => {
    vi.mocked(searchProducts).mockReturnValue(new Promise(() => {}));
    renderListing("/buscar?q=poncho");
    await screen.findByRole("heading", { level: 1, name: "Buscar" });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(/No encontramos resultados/)).not.toBeInTheDocument();
    expect(events).toHaveLength(0);
  });

  it("error: aviso con «Reintentar» que lo recupera (el campo sigue disponible)", async () => {
    vi.mocked(searchProducts).mockRejectedValueOnce(new Error("caído"));
    const user = userEvent.setup();
    renderListing("/buscar?q=poncho");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos buscar ahora");
    expect(field()).toHaveValue("poncho");
    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findAllByRole("article")).toHaveLength(3);
    expect(events).toHaveLength(1);
  });
});

describe("analítica y SEO de la búsqueda", () => {
  it("emite «search» una vez por resultado con la consulta limpia y el número de resultados", async () => {
    renderListing("/buscar?q=%20poncho%20");
    await screen.findAllByRole("article");
    await waitFor(() => expect(events).toEqual([{ name: "search", query: "poncho", results: 3 }]));
  });

  it("no se indexa (noindex,follow), el canónico es /buscar sin la consulta y el título nombra lo buscado", async () => {
    renderListing("/buscar?q=poncho&utm_source=fb");
    await screen.findAllByRole("article");
    await waitFor(() => expect(metaContent("robots")).toBe("noindex,follow"));
    expect(linkHref("canonical")).toBe("https://tienda.test/buscar");
    expect(document.title).toBe("Buscar: poncho · Made In Chola");
  });

  it("sin consulta: también noindex y título genérico", async () => {
    renderListing("/buscar");
    await screen.findByRole("heading", { level: 1, name: "Buscar" });
    await waitFor(() => expect(metaContent("robots")).toBe("noindex,follow"));
    expect(document.title).toBe("Buscar · Made In Chola");
  });
});

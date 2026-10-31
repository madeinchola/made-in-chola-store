import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCategoryTree,
  getHome,
  getStoreSettings,
  listCollections,
} from "@/features/catalog/catalogService";
import { subscribeToTracking, type TrackEvent } from "@/features/storefront/analytics/track";
import { listProductsFiltered } from "@/features/storefront/shopService";
import { getProductsByIds } from "./homeService";
import { HomePage } from "./HomePage";
import {
  COLLECTION,
  image,
  item,
  NO_MEDIA,
  product,
  renderHome,
  section,
  TREE,
  video,
} from "./home-test-utils";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://img.test/p/${path}`,
  homeMediaUrl: (kind: string, path: string | null) =>
    path && kind !== "none" ? `https://img.test/${kind}/${path}` : null,
}));
vi.mock("@/features/storefront/seo/siteUrl", () => ({ siteUrl: () => "https://tienda.test" }));
vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getHome: vi.fn(),
  getCategoryTree: vi.fn(),
  listCollections: vi.fn(),
  getStoreSettings: vi.fn(),
}));
vi.mock("@/features/storefront/shopService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/storefront/shopService")>()),
  listProductsFiltered: vi.fn(),
}));
vi.mock("./homeService", () => ({ getProductsByIds: vi.fn() }));
vi.mock("embla-carousel-react", () => {
  const self = {
    canScrollPrev: () => false,
    canScrollNext: () => false,
    scrollPrev: () => {},
    scrollNext: () => {},
    on: () => self,
    off: () => self,
  };
  return { default: () => [() => {}, self] };
});

const latest = { type: "latest", categoryId: null, collectionId: null } as const;
const hero = (over = {}) =>
  section({
    id: "hero",
    kind: "hero",
    sortOrder: 1,
    title: "Verano 2027",
    media: image("hero.jpg", "Modelos"),
    ...over,
  });
const row = (over = {}) =>
  section({
    id: "row",
    kind: "product_row",
    sortOrder: 2,
    title: "Lo más popular",
    source: latest,
    ...over,
  });
const page = (...items: ReturnType<typeof product>[]) => ({ items, total: items.length });
const h1s = () => screen.queryAllByRole("heading", { level: 1 });
const meta = (selector: string) => document.head.querySelector(selector);

beforeEach(() => {
  vi.mocked(getHome).mockReset().mockResolvedValue([hero(), row()]);
  vi.mocked(getCategoryTree).mockReset().mockResolvedValue(TREE);
  vi.mocked(listCollections).mockReset().mockResolvedValue([COLLECTION]);
  vi.mocked(getStoreSettings).mockReset().mockResolvedValue({});
  vi.mocked(listProductsFiltered)
    .mockReset()
    .mockResolvedValue(page(product(1), product(2), product(3)));
  vi.mocked(getProductsByIds).mockReset().mockResolvedValue([]);
});
afterEach(() => {
  for (const el of document.head.querySelectorAll("[data-seo]")) el.remove();
});

describe("HomePage · carga", () => {
  it("mientras llega: esqueleto con el ÚNICO h1, estado accesible y la altura del hero reservada", () => {
    vi.mocked(getHome).mockReturnValue(new Promise(() => {}));
    const { container } = renderHome(<HomePage />);
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveTextContent("Made In Chola");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando la portada…");
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    // fondo de la marca y altura del hero: la cabecera es blanca encima y la página no salta al cargar
    const reserved = container.querySelector(".bg-primary");
    expect(reserved).toHaveClass("h-[clamp(32rem,67.5vw,57.6rem)]");
  });

  it("al llegar, el esqueleto desaparece y el h1 pasa a ser el título del hero", async () => {
    renderHome(<HomePage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Verano 2027" }),
    ).toBeInTheDocument();
    expect(h1s()).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("si falla: error con h1 oculto y botón «Reintentar» que vuelve a pedir y pinta la portada", async () => {
    vi.mocked(getHome).mockRejectedValueOnce(new Error("caído"));
    renderHome(<HomePage />);
    expect(await screen.findByText("No pudimos cargar la portada")).toBeInTheDocument();
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveTextContent("Made In Chola");
    expect(h1s()[0]).toHaveClass("sr-only");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Verano 2027" }),
    ).toBeInTheDocument();
    expect(getHome).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("No pudimos cargar la portada")).toBeNull();
  });

  it("el error y el hero provisional usan el fondo de la marca (la cabecera es blanca sobre la portada)", async () => {
    vi.mocked(getHome).mockRejectedValueOnce(new Error("caído"));
    const { container, unmount } = renderHome(<HomePage />);
    await screen.findByText("No pudimos cargar la portada");
    expect(container.querySelector(".theme-inverse")).not.toBeNull();
    unmount();
    vi.mocked(getHome).mockResolvedValue([]);
    const second = renderHome(<HomePage />);
    await screen.findByText("Próximamente");
    expect(second.container.querySelector(".theme-inverse")).not.toBeNull();
  });

  it("sin secciones en la base: hero provisional de la marca con su único h1", async () => {
    vi.mocked(getHome).mockResolvedValue([]);
    renderHome(<HomePage />);
    // «Próximamente» solo existe en el hero provisional (el esqueleto ya tiene su propio h1 «Made In Chola»)
    expect(await screen.findByText("Próximamente")).toBeInTheDocument();
    expect(screen.getByText(/Estamos preparando la tienda/)).toBeInTheDocument();
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveTextContent("Made In Chola");
    expect(h1s()[0]).not.toHaveClass("sr-only");
    expect(screen.queryByRole("status")).toBeNull();
    expect(listProductsFiltered).not.toHaveBeenCalled();
  });
});

describe("HomePage · orden y encabezados", () => {
  it("pinta las secciones por `sortOrder`, no por el orden en que llegan", async () => {
    vi.mocked(getHome).mockResolvedValue([
      section({ id: "t", kind: "tagline", sortOrder: 30, title: "Lema final" }),
      hero({ id: "h", sortOrder: 10 }),
      section({ id: "b", kind: "banner", sortOrder: 20, media: image("b.jpg", "Banner central") }),
    ]);
    renderHome(<HomePage />);
    const title = await screen.findByRole("heading", { level: 1, name: "Verano 2027" });
    const banner = screen.getByRole("img", { name: "Banner central" });
    const tagline = screen.getByText("Lema final");
    expect(title.compareDocumentPosition(banner)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(banner.compareDocumentPosition(tagline)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("una portada con dos heroes: el h1 es el PRIMERO por orden; el otro baja a h2", async () => {
    vi.mocked(getHome).mockResolvedValue([
      hero({ id: "b", sortOrder: 2, title: "Segundo hero" }),
      hero({ id: "a", sortOrder: 1, title: "Primer hero" }),
    ]);
    renderHome(<HomePage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Primer hero" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Segundo hero" })).toBeInTheDocument();
    expect(h1s()).toHaveLength(1);
  });

  it("hero SIN título: «Made In Chola» oculto hace de h1 (siempre hay uno, nunca dos)", async () => {
    vi.mocked(getHome).mockResolvedValue([hero({ title: "  " }), row()]);
    renderHome(<HomePage />);
    await screen.findByRole("heading", { name: "Lo más popular" });
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveTextContent("Made In Chola");
    expect(h1s()[0]).toHaveClass("sr-only");
  });

  it("sin ningún hero también hay un único h1 oculto", async () => {
    vi.mocked(getHome).mockResolvedValue([row()]);
    renderHome(<HomePage />);
    await screen.findByRole("heading", { name: "Lo más popular" });
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveClass("sr-only");
  });

  it("las demás secciones usan h2 (jerarquía correcta: h1 → h2 → h3 de las tarjetas)", async () => {
    renderHome(<HomePage />);
    const rowHeading = await screen.findByRole("heading", { name: "Lo más popular" });
    expect(rowHeading.tagName).toBe("H2");
    const card = (await screen.findAllByRole("article"))[0]!;
    expect(within(card).getByRole("heading", { level: 3 })).toBeInTheDocument();
  });
});

describe("HomePage · las siete secciones", () => {
  it("cada tipo se pinta con su componente", async () => {
    vi.mocked(getHome).mockResolvedValue([
      hero({ sortOrder: 1 }),
      row({ sortOrder: 2 }),
      section({
        id: "feature",
        kind: "collection_feature",
        sortOrder: 3,
        title: "Colección NADAS",
        media: image("nadas.jpg", "Vestido blanco"),
        source: { type: "collection", categoryId: null, collectionId: "col-1" },
        itemLimit: 2,
      }),
      section({
        id: "about",
        kind: "about",
        sortOrder: 4,
        title: "Sobre nosotros",
        items: [item({ id: "v", media: video("about.mp4") })],
      }),
      section({ id: "banner", kind: "banner", sortOrder: 5, media: image("b.jpg", "Banner") }),
      section({ id: "tag", kind: "tagline", sortOrder: 6, title: "Lema" }),
      section({
        id: "tiles",
        kind: "category_tiles",
        sortOrder: 7,
        items: [item({ id: "c", label: "Carteras", linkUrl: "/categoria/carteras" })],
      }),
    ]);
    renderHome(<HomePage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Verano 2027" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Lo más popular" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Colección NADAS" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Sobre nosotros" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Banner" })).toBeInTheDocument();
    expect(screen.getByText("Lema")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Carteras" })).toHaveAttribute(
      "href",
      "/categoria/carteras",
    );
    expect(h1s()).toHaveLength(1);
  });
});

describe("HomePage · SEO", () => {
  it("título, descripción y canónica de la portada (título sin sufijo duplicado)", async () => {
    renderHome(<HomePage />);
    await screen.findByRole("heading", { level: 1, name: "Verano 2027" });
    expect(document.title).toBe("Made In Chola · Hecho a mano en Bolivia");
    expect(meta("link[rel='canonical']")).toHaveAttribute("href", "https://tienda.test/");
    expect(meta("meta[name='description']")?.getAttribute("content")).toMatch(/\S{10}/);
    expect(meta("meta[property='og:url']")).toHaveAttribute("content", "https://tienda.test/");
  });

  it("la imagen para compartir es la del hero si existe; sin imagen no se inventa ninguna", async () => {
    const { unmount } = renderHome(<HomePage />);
    await screen.findByRole("heading", { level: 1, name: "Verano 2027" });
    expect(meta("meta[property='og:image']")).toHaveAttribute(
      "content",
      "https://img.test/image/hero.jpg",
    );
    unmount();
    expect(meta("meta[property='og:image']")).toBeNull();
    vi.mocked(getHome).mockResolvedValue([hero({ media: NO_MEDIA })]);
    renderHome(<HomePage />);
    await screen.findByRole("heading", { level: 1, name: "Verano 2027" });
    expect(meta("meta[property='og:image']")).toBeNull();
  });

  it("JSON-LD de Organization (con las redes de los ajustes) y de WebSite con su buscador", async () => {
    vi.mocked(getStoreSettings).mockResolvedValue({
      social_instagram: "https://www.instagram.com/madeinchola/",
      social_tiktok: "javascript:alert(1)",
    });
    renderHome(<HomePage />);
    await screen.findByRole("heading", { level: 1, name: "Verano 2027" });
    await waitFor(() =>
      expect(document.head.innerHTML).toContain("https://www.instagram.com/madeinchola/"),
    );
    const blocks = [...document.head.querySelectorAll("script[type='application/ld+json']")].map(
      (s) => JSON.parse(s.textContent ?? "{}") as Record<string, unknown>,
    );
    const org = blocks.find((b) => b["@type"] === "Organization");
    const site = blocks.find((b) => b["@type"] === "WebSite");
    expect(org).toMatchObject({
      name: "Made In Chola",
      url: "https://tienda.test",
      sameAs: ["https://www.instagram.com/madeinchola/"],
    });
    expect(JSON.stringify(blocks)).not.toContain("javascript:");
    expect(site).toMatchObject({
      name: "Made In Chola",
      url: "https://tienda.test",
      potentialAction: {
        target: { urlTemplate: "https://tienda.test/buscar?q={search_term_string}" },
      },
    });
  });

  it("al salir de la portada se retiran sus etiquetas y se restaura el título", async () => {
    document.title = "Antes";
    const { unmount } = renderHome(<HomePage />);
    await screen.findByRole("heading", { level: 1, name: "Verano 2027" });
    expect(meta("script[type='application/ld+json']")).not.toBeNull();
    unmount();
    expect(document.title).toBe("Antes");
    expect(document.head.querySelector("[data-seo]")).toBeNull();
  });

  it("el título SEO se aplica ya durante la carga y también si falla (no queda el de la página anterior)", async () => {
    vi.mocked(getHome).mockRejectedValue(new Error("caído"));
    renderHome(<HomePage />);
    expect(document.title).toBe("Made In Chola · Hecho a mano en Bolivia");
    await screen.findByText("No pudimos cargar la portada");
    expect(document.title).toBe("Made In Chola · Hecho a mano en Bolivia");
  });
});

describe("HomePage · analítica", () => {
  it("emite un view_item_list por cada fila de productos (y ninguno por el resto)", async () => {
    vi.mocked(getHome).mockResolvedValue([
      hero(),
      row({ id: "r1", sortOrder: 2, title: "Primera fila" }),
      section({ id: "tag", kind: "tagline", sortOrder: 3, title: "Lema" }),
      row({ id: "r2", sortOrder: 4, title: "Segunda fila" }),
    ]);
    const events: TrackEvent[] = [];
    const off = subscribeToTracking((e) => events.push(e));
    try {
      renderHome(<HomePage />);
      await screen.findByRole("heading", { name: "Segunda fila" });
      await screen.findByRole("heading", { name: "Primera fila" });
      await waitFor(() => expect(events).toHaveLength(2));
      expect(events.map((e) => (e.name === "view_item_list" ? e.listId : null)).sort()).toEqual([
        "r1",
        "r2",
      ]);
      expect(events.every((e) => e.name === "view_item_list" && e.items.length === 3)).toBe(true);
    } finally {
      off();
    }
  });

  it("una fila sin productos no emite evento", async () => {
    vi.mocked(listProductsFiltered).mockResolvedValue(page());
    const events: TrackEvent[] = [];
    const off = subscribeToTracking((e) => events.push(e));
    try {
      renderHome(<HomePage />);
      await screen.findByRole("heading", { level: 1, name: "Verano 2027" });
      await waitFor(() => expect(listProductsFiltered).toHaveBeenCalled());
      expect(events).toHaveLength(0);
    } finally {
      off();
    }
  });
});

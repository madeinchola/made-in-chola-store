import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryTree, listCollections } from "@/features/catalog/catalogService";
import { subscribeToTracking, type TrackEvent } from "@/features/storefront/analytics/track";
import { listProductsFiltered } from "@/features/storefront/shopService";
import { getProductsByIds } from "./homeService";
import { AboutSection } from "./sections/AboutSection";
import { BannerSection } from "./sections/BannerSection";
import { CategoryTilesSection } from "./sections/CategoryTilesSection";
import { CollectionFeatureSection } from "./sections/CollectionFeatureSection";
import { HeroSection } from "./sections/HeroSection";
import { ProductRowSection } from "./sections/ProductRowSection";
import { TaglineSection } from "./sections/TaglineSection";
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
// embla no tiene layout en jsdom: se prueba la estructura, no el deslizamiento
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

const page = (...items: ReturnType<typeof product>[]) => ({ items, total: items.length });

/** Cajas que ocupan sitio en la página: todo el DOM salvo el sondeo de ruta que añade `renderHome`. */
const painted = (container: HTMLElement) =>
  [...container.children].filter((el) => el.getAttribute("data-testid") !== "location");

beforeEach(() => {
  vi.mocked(getCategoryTree).mockReset().mockResolvedValue(TREE);
  vi.mocked(listCollections).mockReset().mockResolvedValue([COLLECTION]);
  vi.mocked(listProductsFiltered)
    .mockReset()
    .mockResolvedValue(page(product(1), product(2), product(3)));
  vi.mocked(getProductsByIds).mockReset().mockResolvedValue([]);
});

describe("HeroSection", () => {
  const hero = (over = {}) =>
    section({
      kind: "hero",
      title: "Verano 2027",
      body: "Hecho a mano en los Andes.",
      ctaLabel: "Ver colección",
      ctaUrl: "/coleccion/verano-2027",
      media: image("hero.jpg", "Dos modelos con sombreros"),
      ...over,
    });

  it("título en el único h1 (por defecto), enlace subrayado y párrafo justificado", () => {
    renderHome(<HeroSection section={hero()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Verano 2027" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ver colección" });
    expect(link).toHaveAttribute("href", "/coleccion/verano-2027");
    expect(link).toHaveClass("underline", "eyebrow");
    expect(screen.getByText("Hecho a mano en los Andes.")).toHaveClass("text-justify");
  });

  it("`as=h2` baja el nivel (una segunda portada no duplica el h1)", () => {
    renderHome(<HeroSection section={hero()} as="h2" />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Verano 2027" })).toBeInTheDocument();
  });

  it("la imagen del hero carga YA (eager + fetchpriority alta) y lleva el alt del admin", () => {
    renderHome(<HeroSection section={hero()} />);
    const img = screen.getByRole("img", { name: "Dos modelos con sombreros" });
    expect(img).toHaveAttribute("src", "https://img.test/image/hero.jpg");
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
    expect(img).toHaveClass("object-cover");
  });

  it("mide lo que el PDF: altura fluida ≈ 922 px a 1366 px y empieza bajo la cabecera transparente", () => {
    const { container } = renderHome(<HeroSection section={hero()} />);
    expect(container.querySelector("section")).toHaveClass(
      "h-[clamp(32rem,67.5vw,57.6rem)]",
      "relative",
    );
  });

  it("sin imagen queda el fondo liso de la marca (sin marcador provisional ni icono)", () => {
    const { container } = renderHome(<HeroSection section={hero({ media: NO_MEDIA })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-placeholder]")).toBeNull();
    expect(container.querySelector("section")).toHaveClass("bg-primary");
  });

  it("si la imagen falla al cargar tampoco queda un icono roto", () => {
    const { container } = renderHome(<HeroSection section={hero()} />);
    fireEvent.error(screen.getByRole("img"));
    expect(container.querySelector("img")).toBeNull();
  });

  it("lleva un degradado tenue DECORATIVO tras el texto (el blanco sobre una foto clara no cumple AA)", () => {
    const { container } = renderHome(<HeroSection section={hero()} />);
    const scrim = container.querySelector("[aria-hidden='true'].bg-gradient-to-t");
    expect(scrim).not.toBeNull();
  });

  it.each(["javascript:alert(1)", "//otro.sitio/x", "data:text/html,x"])(
    "un enlace peligroso (%s) se ve como TEXTO, no como enlace",
    (ctaUrl) => {
      renderHome(<HeroSection section={hero({ ctaUrl })} />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("Ver colección")).toBeVisible();
    },
  );

  it("un enlace externo https abre con rel noopener noreferrer", () => {
    renderHome(
      <HeroSection section={hero({ ctaUrl: "https://www.instagram.com/madeinchola/" })} />,
    );
    expect(screen.getByRole("link", { name: "Ver colección" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("sin título ni enlace ni párrafo no pinta encabezado vacío", () => {
    renderHome(<HeroSection section={hero({ title: " ", ctaLabel: null, body: null })} />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("con un video del admin pinta el video mudo y en bucle (nunca con sonido)", () => {
    const { container } = renderHome(<HeroSection section={hero({ media: video("hero.mp4") })} />);
    const el = container.querySelector("video")!;
    expect(el.muted).toBe(true);
    expect(el).toHaveAttribute("loop");
    expect(el).toHaveAttribute("playsinline");
    expect(el.getAttribute("src")).toBe("https://img.test/video/hero.mp4#t=0.001");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("ProductRowSection", () => {
  const row = (over = {}) =>
    section({
      id: "row",
      kind: "product_row",
      title: "Lo más popular",
      ctaLabel: "Ver todo",
      ctaUrl: "/tienda",
      source: { type: "latest", categoryId: null, collectionId: null },
      itemLimit: 3,
      ...over,
    });

  it("latest: pide los más nuevos de toda la tienda con el límite del admin y pinta una tarjeta por producto", async () => {
    renderHome(<ProductRowSection section={row()} />);
    expect(
      await screen.findByRole("heading", { level: 2, name: "Lo más popular" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(listProductsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {},
        pageSize: 3,
        query: expect.objectContaining({ sort: "newest", page: 1 }),
      }),
    );
  });

  it("category: resuelve el id a su slug antes de pedir los productos", async () => {
    renderHome(
      <ProductRowSection
        section={row({ source: { type: "category", categoryId: "cat-1", collectionId: null } })}
      />,
    );
    await screen.findByRole("heading", { name: "Lo más popular" });
    expect(listProductsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { categorySlug: "sombreros" } }),
    );
  });

  it("collection: igual con la colección", async () => {
    renderHome(
      <ProductRowSection
        section={row({ source: { type: "collection", categoryId: null, collectionId: "col-1" } })}
      />,
    );
    await screen.findByRole("heading", { name: "Lo más popular" });
    expect(listProductsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { collectionSlug: "nadas" } }),
    );
  });

  it("manual: trae los productos por id, en el orden del admin, sin consultar el listado", async () => {
    vi.mocked(getProductsByIds).mockResolvedValue([product(9), product(8)]);
    renderHome(
      <ProductRowSection
        section={row({
          source: { type: "manual", categoryId: null, collectionId: null },
          items: [
            item({ id: "a", sortOrder: 1, productId: "p9" }),
            item({ id: "b", sortOrder: 2, productId: "p8" }),
          ],
        })}
      />,
    );
    expect(await screen.findAllByRole("article")).toHaveLength(2);
    expect(getProductsByIds).toHaveBeenCalledWith(["p9", "p8"]);
    expect(listProductsFiltered).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toContain(
      "/producto/producto-9",
    );
  });

  it("respeta `itemLimit` también en las manuales (recorta a ese número)", async () => {
    vi.mocked(getProductsByIds).mockResolvedValue([product(1), product(2), product(3)]);
    renderHome(
      <ProductRowSection
        section={row({
          itemLimit: 2,
          source: { type: "manual", categoryId: null, collectionId: null },
          items: [
            item({ id: "a", productId: "p1" }),
            item({ id: "b", sortOrder: 2, productId: "p2" }),
            item({ id: "c", sortOrder: 3, productId: "p3" }),
          ],
        })}
      />,
    );
    expect(await screen.findAllByRole("article")).toHaveLength(2);
  });

  it("una fila SIN productos no se pinta (ni título ni flechas)", async () => {
    vi.mocked(listProductsFiltered).mockResolvedValue(page());
    const { container } = renderHome(<ProductRowSection section={row()} />);
    await waitFor(() => expect(listProductsFiltered).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("[aria-busy]")).toBeNull());
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // ni siquiera una caja vacía con su relleno: dejaría un hueco entre dos secciones
    expect(painted(container)).toHaveLength(0);
  });

  it.each([
    ["sin origen (none)", { type: "none" as const, categoryId: null, collectionId: null }],
    [
      "categoría inexistente",
      { type: "category" as const, categoryId: "no-existe", collectionId: null },
    ],
    ["colección vencida", { type: "collection" as const, categoryId: null, collectionId: "otra" }],
  ])("%s → no hay fila", async (_name, source) => {
    const { container } = renderHome(<ProductRowSection section={row({ source })} />);
    await waitFor(() => expect(container.querySelector("[aria-busy]")).toBeNull());
    expect(screen.queryByRole("heading")).toBeNull();
    expect(listProductsFiltered).not.toHaveBeenCalled();
    expect(painted(container)).toHaveLength(0);
  });

  it("si la consulta falla la fila desaparece sin romper el resto de la portada", async () => {
    vi.mocked(listProductsFiltered).mockRejectedValue(new Error("caído"));
    const { container } = renderHome(<ProductRowSection section={row()} />);
    await waitFor(() => expect(container.querySelector("[aria-busy]")).toBeNull());
    expect(screen.queryByRole("heading")).toBeNull();
    expect(painted(container)).toHaveLength(0);
  });

  it("mientras carga reserva el sitio con un esqueleto (aria-busy) y sin encabezados", () => {
    vi.mocked(listProductsFiltered).mockReturnValue(new Promise(() => {}));
    const { container } = renderHome(<ProductRowSection section={row()} />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("«VER TODO» usa el enlace seguro del admin", async () => {
    renderHome(<ProductRowSection section={row()} />);
    expect(await screen.findByRole("link", { name: "Ver todo" })).toHaveAttribute(
      "href",
      "/tienda",
    );
  });

  it("sin enlace del admin, «VER TODO» lleva a la categoría de origen con el texto por defecto", async () => {
    renderHome(
      <ProductRowSection
        section={row({
          ctaUrl: null,
          ctaLabel: null,
          source: { type: "category", categoryId: "cat-1", collectionId: null },
        })}
      />,
    );
    expect(await screen.findByRole("link", { name: "Ver todo" })).toHaveAttribute(
      "href",
      "/categoria/sombreros",
    );
  });

  it("un enlace peligroso nunca se sigue: en una fila manual (sin categoría de origen) no hay «VER TODO»", async () => {
    vi.mocked(getProductsByIds).mockResolvedValue([product(1)]);
    renderHome(
      <ProductRowSection
        section={row({
          ctaUrl: "javascript:alert(1)",
          source: { type: "manual", categoryId: null, collectionId: null },
          items: [item({ productId: "p1" })],
        })}
      />,
    );
    await screen.findByRole("heading", { name: "Lo más popular" });
    expect(screen.queryByRole("link", { name: "Ver todo" })).toBeNull();
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
  });

  it("un enlace peligroso en una fila de categoría se cambia por la ruta de la propia categoría (nunca el valor escrito)", async () => {
    renderHome(
      <ProductRowSection
        section={row({
          ctaUrl: "javascript:alert(1)",
          source: { type: "category", categoryId: "cat-1", collectionId: null },
        })}
      />,
    );
    const link = await screen.findByRole("link", { name: "Ver todo" });
    expect(link).toHaveAttribute("href", "/categoria/sombreros");
  });

  it("sin título del admin usa «Productos»", async () => {
    renderHome(<ProductRowSection section={row({ title: null })} />);
    expect(await screen.findByRole("heading", { name: "Productos" })).toBeInTheDocument();
  });

  it("emite view_item_list UNA vez con los productos y sus posiciones (precio en unidades mayores)", async () => {
    const events: TrackEvent[] = [];
    const off = subscribeToTracking((e) => events.push(e));
    function Harness() {
      const [n, setN] = useState(0);
      return (
        <>
          <button onClick={() => setN(n + 1)}>repintar {n}</button>
          {/* `row()` crea un objeto NUEVO en cada pintado, con el mismo id */}
          <ProductRowSection section={row()} />
        </>
      );
    }
    try {
      renderHome(<Harness />);
      await screen.findByRole("heading", { name: "Lo más popular" });
      fireEvent.click(screen.getByRole("button", { name: /repintar/ }));
      await screen.findByRole("button", { name: "repintar 1" });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: "view_item_list",
        listId: "row",
        listName: "Lo más popular",
        items: [
          { id: "p1", name: "Chakra 1", price: 80, currency: "BOB", position: 1 },
          { id: "p2", position: 2 },
          { id: "p3", position: 3 },
        ],
      });
    } finally {
      off();
    }
  });
});

describe("CollectionFeatureSection", () => {
  const feature = (over = {}) =>
    section({
      id: "feature",
      kind: "collection_feature",
      title: "Colección NADAS",
      body: "Texto de la colección.",
      ctaLabel: "Ver toda la colección",
      ctaUrl: "/coleccion/nadas",
      media: image("nadas.jpg", "Modelo con vestido blanco"),
      source: { type: "collection", categoryId: null, collectionId: "col-1" },
      itemLimit: 2,
      ...over,
    });

  it("el nombre de la colección va en cursiva dentro del h2 («Colección *NADAS*»)", () => {
    renderHome(<CollectionFeatureSection section={feature()} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Colección NADAS");
    expect(heading.querySelector("em")).toHaveTextContent("NADAS");
    expect(heading.textContent).not.toBe(heading.querySelector("em")!.textContent);
  });

  it("un título que no empieza por «Colección» se pinta entero y sin cursiva", () => {
    renderHome(<CollectionFeatureSection section={feature({ title: "Verano 2027" })} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Verano 2027" });
    expect(heading.querySelector("em")).toBeNull();
  });

  it("las tarjetas de la colección llevan «DESDE Bs …» y la baldosa 4:5 del PDF", async () => {
    renderHome(<CollectionFeatureSection section={feature()} />);
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card).toHaveTextContent(/Desde\s*Bs 80,00/);
      expect(card.querySelector("img")!.parentElement).toHaveClass("aspect-[4/5]");
    }
    expect(listProductsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { collectionSlug: "nadas" }, pageSize: 2 }),
    );
  });

  it("la baldosa grande ocupa 2 columnas y dos filas en escritorio; lleva el párrafo y el enlace", () => {
    const { container } = renderHome(<CollectionFeatureSection section={feature()} />);
    const tile = container.querySelector("img")!.closest("div.relative") as HTMLElement;
    expect(tile).toHaveClass("col-span-2", "lg:row-span-2", "aspect-[7/9]");
    expect(screen.getByText("Texto de la colección.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver toda la colección" })).toHaveAttribute(
      "href",
      "/coleccion/nadas",
    );
  });

  it("una línea fina oscura la separa de la fila anterior (como el PDF)", () => {
    const { container } = renderHome(<CollectionFeatureSection section={feature()} />);
    expect(container.querySelector("section")).toHaveClass("border-t", "border-foreground");
  });

  it("sin imagen usa el marcador provisional y sin colección en la base solo queda la baldosa", async () => {
    vi.mocked(listCollections).mockResolvedValue([]);
    const { container } = renderHome(
      <CollectionFeatureSection section={feature({ media: NO_MEDIA })} />,
    );
    expect(container.querySelector("[data-placeholder]")).not.toBeNull();
    await waitFor(() => expect(listCollections).toHaveBeenCalled());
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("enlace peligroso → texto sin enlace", () => {
    renderHome(<CollectionFeatureSection section={feature({ ctaUrl: "javascript:alert(1)" })} />);
    expect(screen.queryByRole("link", { name: "Ver toda la colección" })).toBeNull();
    expect(screen.getByText("Ver toda la colección")).toBeVisible();
  });
});

describe("AboutSection", () => {
  const about = (over = {}) =>
    section({
      kind: "about",
      title: "Sobre nosotros",
      body: "La historia de Made In Chola.",
      media: image("about.jpg", "Sombreros apilados"),
      items: [item({ id: "v", media: video("about.mp4") })],
      ...over,
    });

  it("dos baldosas: imagen con título y párrafo, y video con su botón de reproducir", () => {
    const { container } = renderHome(<AboutSection section={about()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Sobre nosotros" })).toBeInTheDocument();
    expect(screen.getByText("La historia de Made In Chola.")).toBeVisible();
    expect(screen.getByRole("img", { name: "Sombreros apilados" })).toHaveAttribute(
      "loading",
      "lazy",
    );
    expect(container.querySelector("video")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reproducir video" })).toBeInTheDocument();
    expect(container.querySelector("section")).toHaveClass("lg:grid-cols-2");
  });

  it("sin título del admin usa «Sobre nosotros»", () => {
    renderHome(<AboutSection section={about({ title: null })} />);
    expect(screen.getByRole("heading", { name: "Sobre nosotros" })).toBeInTheDocument();
  });

  it("sin video muestra el marcador provisional y NO hay botón de reproducir", () => {
    const { container } = renderHome(<AboutSection section={about({ items: [] })} />);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-placeholder]")).not.toBeNull();
  });

  it("también encuentra el video si lo puso el admin en la propia sección", () => {
    const { container } = renderHome(
      <AboutSection section={about({ media: video("seccion.mp4"), items: [] })} />,
    );
    expect(container.querySelector("video")?.getAttribute("src")).toContain("seccion.mp4");
  });

  it("la imagen puede venir de un elemento si la sección no tiene la suya", () => {
    renderHome(
      <AboutSection
        section={about({
          media: NO_MEDIA,
          items: [
            item({ id: "i", sortOrder: 1, media: image("item.jpg", "Del elemento") }),
            item({ id: "v", sortOrder: 2, media: video("v.mp4") }),
          ],
        })}
      />,
    );
    expect(screen.getByRole("img", { name: "Del elemento" })).toBeInTheDocument();
  });

  it("enlace del admin seguro → enlace; peligroso → texto", () => {
    const { unmount } = renderHome(
      <AboutSection section={about({ ctaLabel: "Conócenos", ctaUrl: "/nosotros" })} />,
    );
    expect(screen.getByRole("link", { name: "Conócenos" })).toHaveAttribute("href", "/nosotros");
    unmount();
    renderHome(<AboutSection section={about({ ctaLabel: "Conócenos", ctaUrl: "javascript:x" })} />);
    expect(screen.queryByRole("link", { name: "Conócenos" })).toBeNull();
  });
});

describe("BannerSection", () => {
  it("imagen a todo el ancho en proporción 2:1, perezosa y decorativa si no hay alt", () => {
    const { container } = renderHome(
      <BannerSection section={section({ kind: "banner", media: image("banner.jpg") })} />,
    );
    expect(container.querySelector("section")).toHaveClass("aspect-[2/1]");
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://img.test/image/banner.jpg");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("alt", "");
  });

  it("usa el alt del admin si lo escribió; sin imagen, el marcador provisional", () => {
    const { unmount } = renderHome(
      <BannerSection
        section={section({ kind: "banner", media: image("b.jpg", "Hombre con sombrero azul") })}
      />,
    );
    expect(screen.getByRole("img", { name: "Hombre con sombrero azul" })).toBeInTheDocument();
    unmount();
    const { container } = renderHome(
      <BannerSection section={section({ kind: "banner", media: NO_MEDIA })} />,
    );
    expect(container.querySelector("[data-placeholder]")).not.toBeNull();
  });
});

describe("TaglineSection", () => {
  it("frase grande como PÁRRAFO (no es un encabezado de sección) con el símbolo provisional a la derecha", () => {
    const { container } = renderHome(
      <TaglineSection
        section={section({ kind: "tagline", title: "El futuro está hecho a mano" })}
      />,
    );
    const text = screen.getByText("El futuro está hecho a mano");
    expect(text.tagName).toBe("P");
    expect(text).toHaveClass("font-display", "text-balance");
    expect(screen.queryByRole("heading")).toBeNull();
    const symbol = container.querySelector("svg")!;
    expect(symbol).toHaveAttribute("aria-hidden", "true");
    expect(symbol).toHaveAttribute("data-provisional", "true");
    expect(text.compareDocumentPosition(symbol)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("sin texto no se pinta (solo quedaría el símbolo suelto)", () => {
    const { container } = renderHome(
      <TaglineSection section={section({ kind: "tagline", title: "  " })} />,
    );
    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("CategoryTilesSection", () => {
  const tiles = (
    items = [
      item({
        id: "1",
        sortOrder: 1,
        label: "Carteras",
        linkUrl: "/categoria/carteras",
        media: image("c.jpg"),
      }),
      item({ id: "2", sortOrder: 2, label: "Objetos", linkUrl: "/categoria/objetos" }),
      item({
        id: "3",
        sortOrder: 3,
        label: "Ropa",
        linkUrl: "/categoria/ropa",
        media: image("r.jpg"),
      }),
    ],
  ) => section({ kind: "category_tiles", items });

  it("la etiqueta va ARRIBA de la imagen y la baldosa entera es un enlace cuyo nombre es la etiqueta", () => {
    renderHome(<CategoryTilesSection section={tiles()} />);
    const link = screen.getByRole("link", { name: "Carteras" });
    expect(link).toHaveAttribute("href", "/categoria/carteras");
    const label = within(link).getByText("Carteras");
    const tile = link.querySelector("img")!.closest("span.relative") as HTMLElement;
    expect(label.compareDocumentPosition(tile)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("3 baldosas: anchos 1·1·2 y alturas distintas alineadas arriba", () => {
    const { container } = renderHome(<CategoryTilesSection section={tiles()} />);
    const lis = [...container.querySelectorAll("li")];
    expect(lis.map((li) => li.className)).toEqual(["col-span-1", "col-span-1", "col-span-2"]);
    expect(container.querySelector("ul")).toHaveClass("items-start", "lg:grid-cols-4");
    const aspects = [...container.querySelectorAll("li span.relative")].map((el) =>
      [...el.classList].find((c) => c.startsWith("aspect-")),
    );
    expect(aspects).toEqual(["aspect-[5/7]", "aspect-[7/6]", "aspect-[7/8]"]);
  });

  it("una línea fina oscura la separa de lo anterior y el orden es el del admin", () => {
    const { container } = renderHome(
      <CategoryTilesSection
        section={tiles([
          item({ id: "b", sortOrder: 2, label: "Segunda", linkUrl: "/b" }),
          item({ id: "a", sortOrder: 1, label: "Primera", linkUrl: "/a" }),
        ])}
      />,
    );
    expect(container.querySelector("section")).toHaveClass("border-t", "border-foreground");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAccessibleName("Primera");
    expect(links[1]).toHaveAccessibleName("Segunda");
  });

  it("sin enlace propio usa la categoría del elemento (nombre y ruta del árbol)", async () => {
    renderHome(
      <CategoryTilesSection
        section={tiles([item({ id: "x", categoryId: "cat-2", media: image("x.jpg") })])}
      />,
    );
    const link = await screen.findByRole("link", { name: "Carteras" });
    expect(link).toHaveAttribute("href", "/categoria/carteras");
  });

  it("un enlace peligroso NO se sustituye por la categoría: la baldosa se ve sin enlace", () => {
    renderHome(
      <CategoryTilesSection
        section={tiles([
          item({ id: "x", label: "Trampa", linkUrl: "javascript:alert(1)", categoryId: "cat-1" }),
        ])}
      />,
    );
    expect(screen.getByText("Trampa")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("un enlace externo abre con rel; los elementos vacíos (sin etiqueta ni imagen) se omiten; sin ninguno no se pinta", () => {
    const { unmount } = renderHome(
      <CategoryTilesSection
        section={tiles([
          item({ id: "e", label: "Instagram", linkUrl: "https://www.instagram.com/madeinchola/" }),
          item({ id: "v", sortOrder: 2 }),
        ])}
      />,
    );
    expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    unmount();
    const { container } = renderHome(<CategoryTilesSection section={tiles([])} />);
    expect(container.querySelector("section")).toBeNull();
  });

  it("una baldosa SIN imagen sigue llamándose solo por su etiqueta (el texto oculto del marcador no se suma)", () => {
    renderHome(
      <CategoryTilesSection
        section={tiles([item({ id: "1", label: "Ropa", linkUrl: "/categoria/ropa" })])}
      />,
    );
    expect(screen.getByRole("link", { name: "Ropa" })).toHaveAttribute("href", "/categoria/ropa");
  });

  it("sin imagen muestra el marcador provisional en cada baldosa", () => {
    const { container } = renderHome(
      <CategoryTilesSection
        section={tiles([item({ id: "1", label: "Ropa", linkUrl: "/categoria/ropa" })])}
      />,
    );
    expect(container.querySelector("[data-placeholder]")).not.toBeNull();
  });
});

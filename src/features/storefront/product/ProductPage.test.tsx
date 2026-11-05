import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigate } from "react-router-dom";
import { getProductBySlug, getStoreSettings } from "@/features/catalog/catalogService";
import { catalogKeys } from "@/features/catalog/queryKeys";
import { subscribeToTracking, type TrackEvent } from "../analytics/track";
import { findSlugRedirect } from "../shopService";
import { siteUrl } from "../seo/siteUrl";
import { ProductPage } from "./ProductPage";
import {
  COLORS,
  image,
  MATRIX,
  productFixture,
  renderAt,
  SETTINGS,
  setViewport,
  variantsFrom,
} from "./product-test-utils";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getProductBySlug: vi.fn(),
  getStoreSettings: vi.fn(),
}));
vi.mock("../shopService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shopService")>()),
  findSlugRedirect: vi.fn(),
}));
vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://cdn.test/storage/${path}`,
}));
// embla no funciona sin layout (jsdom): el carrusel móvil y la fila de relacionados se sustituyen por dobles simples.
vi.mock("@/components/store/Gallery", () => ({
  Gallery: ({ images }: { images: { id: string }[] }) => (
    <div data-testid="gallery">{images.map((i) => i.id).join(",")}</div>
  ),
}));
vi.mock("@/components/store/ProductRow", () => ({
  // Igual que la fila real: sin productos no pinta nada.
  ProductRow: ({ title, products }: { title: string; products: { id: string; name: string }[] }) =>
    products.length === 0 ? null : (
      <section aria-label={title}>
        <h2>{title}</h2>
        <ul>
          {products.map((p) => (
            <li key={p.id}>{p.name}</li>
          ))}
        </ul>
      </section>
    ),
}));

const detail = productFixture();

function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      atrás del navegador
    </button>
  );
}

function serve(
  options: {
    product?: ReturnType<typeof productFixture> | null;
    settings?: Record<string, string | number | boolean>;
    redirect?: string | null;
  } = {},
) {
  const { product = detail, settings = SETTINGS, redirect = null } = options;
  vi.mocked(getProductBySlug).mockImplementation(async (slug) =>
    product && slug === product.product.slug ? product : null,
  );
  vi.mocked(getStoreSettings).mockResolvedValue(settings);
  vi.mocked(findSlugRedirect).mockResolvedValue(redirect);
}

const loaded = () => screen.findByRole("heading", { level: 1 });
const location = () => screen.getByTestId("location").textContent;

describe("ProductPage", () => {
  beforeEach(() => {
    vi.mocked(getProductBySlug).mockReset();
    vi.mocked(getStoreSettings).mockReset();
    vi.mocked(findSlugRedirect).mockReset();
    setViewport("desktop");
    serve();
  });

  describe("contenido", () => {
    it("título (h1), precio en bolivianos exactos, modelo y migas Inicio › Tienda › producto", async () => {
      renderAt(<ProductPage />);
      expect(await loaded()).toHaveTextContent("Chaqueta Japandi");
      expect(screen.getByText("Bs 560,00")).toBeInTheDocument();
      expect(screen.getByText("Modelo: Japandi")).toBeInTheDocument();
      const crumbs = screen.getByRole("navigation", { name: "Ruta de navegación" });
      expect(within(crumbs).getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/");
      expect(within(crumbs).getByRole("link", { name: "Tienda" })).toHaveAttribute(
        "href",
        "/tienda",
      );
      expect(within(crumbs).getByText("Chaqueta Japandi")).toHaveAttribute("aria-current", "page");
    });

    it("la descripción conserva los saltos de línea (pre-line) y es TEXTO: nada de HTML ni scripts", async () => {
      const hostile = productFixture(
        {},
        {
          description:
            'Hola 🧥\n<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2"><b>negrita</b>',
        },
      );
      serve({ product: hostile });
      const { container } = renderAt(<ProductPage />);
      await loaded();
      const paragraph = screen.getByText(/Hola 🧥/);
      expect(paragraph).toHaveClass("whitespace-pre-line");
      expect(paragraph.textContent).toBe(hostile.product.description);
      expect(container.querySelector("article script")).toBeNull();
      expect(container.querySelector("article img[src='x'], article b")).toBeNull();
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    });

    it("los encabezados siguen el orden del documento: h1 y luego h2 (los acordeones no saltan a h3)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const levels = screen
        .getAllByRole("heading")
        .map((heading) => Number(heading.tagName.slice(1)));
      expect(levels[0]).toBe(1);
      levels.forEach((level, i) => {
        if (i > 0) expect(level, `encabezado ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1);
      });
      expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    });

    it("una descripción larguísima sin espacios no desborda (break-words)", async () => {
      serve({ product: productFixture({}, { description: "x".repeat(2000) }) });
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getByText("x".repeat(2000))).toHaveClass("break-words");
    });

    it("sin descripción no se pinta un párrafo vacío", async () => {
      serve({ product: productFixture({}, { description: "  " }) });
      const { container } = renderAt(<ProductPage />);
      await loaded();
      expect(container.querySelectorAll("article p.whitespace-pre-line")).toHaveLength(0);
    });

    it("los acordeones de envíos y asistencia llevan el texto de los ajustes; los vacíos no aparecen", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const names = screen.getAllByRole("button").map((b) => b.textContent?.trim());
      expect(names).toEqual(
        expect.arrayContaining(["Materiales", "Cuidados", "Envíos y devoluciones", "Asistencia"]),
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Envíos y devoluciones" }));
      expect(screen.getByText(/Envíos a todo el país/).textContent).toBe(
        "Envíos a todo el país.\nCambios en 7 días.",
      );
    });

    it("ajustes vacíos o ausentes: sin acordeones de envíos/asistencia", async () => {
      serve({
        settings: {
          business_name: "MIC",
          pdp_shipping_return_text: "",
          pdp_assistance_text: "   ",
        },
      });
      renderAt(<ProductPage />);
      await loaded();
      expect(
        screen.queryByRole("button", { name: "Envíos y devoluciones" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Asistencia" })).not.toBeInTheDocument();
    });

    it("«También te puede gustar» con los relacionados", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const related = screen.getByRole("region", { name: "También te puede gustar" });
      expect(
        within(related)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ).toEqual(["Sombrero Chakra", "Cartera Verde"]);
    });

    it("sin relacionados no hay sección", async () => {
      serve({ product: productFixture({ related: [] }) });
      renderAt(<ProductPage />);
      await loaded();
      expect(
        screen.queryByRole("region", { name: "También te puede gustar" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("color", () => {
    it("entra con el primer color disponible elegido y muestra «Color: Blanco»", async () => {
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getByText("Color: Blanco")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Blanco" })).toBeChecked();
    });

    it("las imágenes son las del color primero y luego las generales (Blanco: b1, b2, g1)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const imgs = within(
        screen.getByRole("region", { name: "Imágenes del producto" }),
      ).getAllByRole("img");
      expect(imgs.map((i) => i.getAttribute("src")?.split("/").pop())).toEqual([
        "b1.jpg",
        "b2.jpg",
        "g1.jpg",
      ]);
    });

    it("elegir otro color actualiza texto, imágenes y la URL (replace, sin añadir historial)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      await userEvent.setup().click(screen.getByRole("radio", { name: "Rojo" }));
      expect(screen.getByText("Color: Rojo")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Rojo" })).toBeChecked();
      expect(location()).toBe("/producto/chaqueta-japandi?color=rojo");
      const imgs = within(
        screen.getByRole("region", { name: "Imágenes del producto" }),
      ).getAllByRole("img");
      expect(imgs.map((i) => i.getAttribute("src")?.split("/").pop())).toEqual(["g1.jpg"]); // Rojo no tiene propias
    });

    it("dos colores cuyo nombre da el mismo slug («Café» y «Cafe»): el 2.º queda en la URL con su propio slug y recargar lo conserva", async () => {
      const twin = productFixture({
        colors: [
          { id: "k1", name: "Café", hex: null, sortOrder: 1 },
          { id: "k2", name: "Cafe", hex: null, sortOrder: 2 },
        ],
        sizes: [],
        variants: [
          { id: "w1", colorId: "k1", sizeId: null, stockStatus: "in_stock" },
          { id: "w2", colorId: "k2", sizeId: null, stockStatus: "in_stock" },
        ],
        images: [],
      });
      serve({ product: twin });
      renderAt(<ProductPage />);
      await loaded();
      await userEvent.setup().click(screen.getByRole("radio", { name: "Cafe" }));
      expect(screen.getByText("Color: Cafe")).toBeInTheDocument();
      expect(location()).toBe("/producto/chaqueta-japandi?color=cafe-2");
    });

    it("entrar con ?color=cafe-2 elige el segundo color de nombre repetido (antes elegía el primero)", async () => {
      const twin = productFixture({
        colors: [
          { id: "k1", name: "Café", hex: null, sortOrder: 1 },
          { id: "k2", name: "Cafe", hex: null, sortOrder: 2 },
        ],
        sizes: [],
        variants: [
          { id: "w1", colorId: "k1", sizeId: null, stockStatus: "in_stock" },
          { id: "w2", colorId: "k2", sizeId: null, stockStatus: "in_stock" },
        ],
        images: [],
      });
      serve({ product: twin });
      renderAt(<ProductPage />, "/producto/chaqueta-japandi?color=cafe-2");
      await loaded();
      expect(screen.getByText("Color: Cafe")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Cafe" })).toBeChecked();
    });

    it("elegir color REEMPLAZA la entrada del historial: «atrás» sale de la ficha (no pasa por cada color)", async () => {
      renderAt(
        <>
          <ProductPage />
          <BackButton />
        </>,
        ["/previa", "/producto/chaqueta-japandi"],
      );
      await loaded();
      const user = userEvent.setup();
      await user.click(screen.getByRole("radio", { name: "Rojo" }));
      await user.click(screen.getByRole("radio", { name: "Negro (agotado)" }));
      expect(location()).toBe("/producto/chaqueta-japandi?color=negro");
      await user.click(screen.getByRole("button", { name: "atrás del navegador" }));
      expect(location()).toBe("/previa");
    });

    it("un enlace con ?color=negro entra con Negro elegido (aunque esté agotado) y conserva otros parámetros", async () => {
      renderAt(<ProductPage />, "/producto/chaqueta-japandi?color=negro&utm_source=ig");
      await loaded();
      expect(screen.getByRole("radio", { name: "Negro (agotado)" })).toBeChecked();
      expect(screen.getByText("Color: Negro")).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("radio", { name: "Rojo" }));
      expect(location()).toBe("/producto/chaqueta-japandi?color=rojo&utm_source=ig");
    });

    it.each(["zzz", "", "../../etc", "'; drop table", "__proto__"])(
      "?color=%j inválido se ignora: queda el color por defecto",
      async (value) => {
        renderAt(<ProductPage />, `/producto/chaqueta-japandi?color=${encodeURIComponent(value)}`);
        await loaded();
        expect(screen.getByRole("radio", { name: "Blanco" })).toBeChecked();
      },
    );

    it("un solo color: se nombra pero no se pide elegir (sin barras)", async () => {
      serve({
        product: productFixture({
          colors: [{ ...COLORS.blanco }],
          variants: variantsFrom({
            ...MATRIX,
            negro: { xs: undefined, s: undefined, m: undefined, l: undefined },
            rojo: { xs: undefined, s: undefined, m: undefined, l: undefined },
          }),
        }),
      });
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getByText("Color: Blanco")).toBeInTheDocument();
      expect(screen.queryByRole("radiogroup", { name: "Color" })).not.toBeInTheDocument();
    });

    it("el texto alternativo de la foto es el del admin (sin espacios sobrantes); si está vacío o en blanco, uno generado", async () => {
      serve({
        product: productFixture({
          images: [
            image("b1", COLORS.blanco.id, 1, "  Vista frontal  "),
            image("b2", COLORS.blanco.id, 2, "   "),
            image("b3", COLORS.blanco.id, 3, null),
          ],
        }),
      });
      renderAt(<ProductPage />);
      await loaded();
      const gallery = within(screen.getByRole("region", { name: "Imágenes del producto" }));
      expect(gallery.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual([
        "Vista frontal",
        "Chaqueta Japandi, imagen 2 de 3",
        "Chaqueta Japandi, imagen 3 de 3",
      ]);
    });

    it("en móvil las imágenes van al carrusel (galería) con las del color elegido", async () => {
      setViewport("mobile");
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getByTestId("gallery")).toHaveTextContent("b1,b2,g1");
      expect(
        screen.queryByRole("region", { name: "Imágenes del producto" }),
      ).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("radio", { name: "Rojo" }));
      expect(screen.getByTestId("gallery")).toHaveTextContent("g1");
    });
  });

  describe("tallas y botón principal", () => {
    it("Blanco: M agotada deshabilitada; L y XS elegibles; «pocas unidades» no se anuncia hasta elegir esa talla", async () => {
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getByRole("radio", { name: "M (agotada)" })).toBeDisabled();
      expect(screen.getByRole("radio", { name: "XS" })).toBeEnabled();
      expect(screen.queryByText("Pocas unidades")).not.toBeInTheDocument();
    });

    it("antes de elegir talla el botón dice «Elige una talla», no es un enlace y explica por qué", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const button = screen.getByRole("button", { name: "Elige una talla" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription("Elige una talla para continuar.");
      expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    });

    it("con talla elegida aparece «Consultar por WhatsApp» con producto, color, talla, precio y enlace codificados", async () => {
      renderAt(<ProductPage />);
      await loaded();
      await userEvent.setup().click(screen.getByRole("radio", { name: "XS" }));
      const link = screen.getByRole("link", { name: /Consultar por WhatsApp/ });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      const href = new URL(link.getAttribute("href")!);
      expect(href.origin + href.pathname).toBe("https://wa.me/59167528677");
      expect(href.searchParams.get("text")).toBe(
        [
          "Hola, quiero consultar por este producto:",
          "Chaqueta Japandi",
          "Color: Blanco",
          "Talla: XS",
          "Precio: Bs 560,00",
          `${siteUrl()}/producto/chaqueta-japandi`,
        ].join("\n"),
      );
      expect(link.getAttribute("href")).not.toContain("\n"); // los saltos viajan codificados (%0A)
    });

    it("el enlace de WhatsApp cambia con el color y la talla elegidos", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const user = userEvent.setup();
      await user.click(screen.getByRole("radio", { name: "Rojo" }));
      await user.click(screen.getByRole("radio", { name: "M" }));
      const text = new URL(
        screen.getByRole("link", { name: /WhatsApp/ }).getAttribute("href")!,
      ).searchParams.get("text")!;
      expect(text).toContain("Color: Rojo");
      expect(text).toContain("Talla: M");
      expect(text).not.toContain("Color: Blanco");
    });

    it("la URL de la consulta es la canónica: sin utm ni color", async () => {
      renderAt(<ProductPage />, "/producto/chaqueta-japandi?utm_source=ig&fbclid=1&color=rojo");
      await loaded();
      await userEvent.setup().click(screen.getByRole("radio", { name: "XS" }));
      const text = new URL(
        screen.getByRole("link", { name: /WhatsApp/ }).getAttribute("href")!,
      ).searchParams.get("text")!;
      expect(text.split("\n").at(-1)).toBe(`${siteUrl()}/producto/chaqueta-japandi`);
    });

    it("«Pocas unidades» aparece solo con la variante elegida en ese estado (S de Blanco)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const user = userEvent.setup();
      await user.click(screen.getByRole("radio", { name: "S" }));
      expect(screen.getByText("Pocas unidades")).toBeInTheDocument();
      await user.click(screen.getByRole("radio", { name: "XS" }));
      expect(screen.queryByText("Pocas unidades")).not.toBeInTheDocument();
    });

    it("cambiar a un color donde la talla elegida sigue existiendo la conserva (S: Blanco → Rojo)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const user = userEvent.setup();
      await user.click(screen.getByRole("radio", { name: "S" }));
      await user.click(screen.getByRole("radio", { name: "Rojo" }));
      expect(screen.getByRole("radio", { name: "S" })).toBeChecked();
      expect(screen.getByRole("link", { name: /WhatsApp/ })).toBeInTheDocument();
    });

    it("…y la limpia si ya no existe o está agotada (L: Blanco → Rojo no la tiene)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const user = userEvent.setup();
      await user.click(screen.getByRole("radio", { name: "L" }));
      await user.click(screen.getByRole("radio", { name: "Rojo" }));
      expect(
        screen.getByRole("radio", { name: "L (no disponible en este color)" }),
      ).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Elige una talla" })).toBeInTheDocument();
    });

    it("…y al volver al color anterior no resucita una talla que se limpió (L: Blanco → Rojo → Blanco)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const user = userEvent.setup();
      await user.click(screen.getByRole("radio", { name: "L" }));
      await user.click(screen.getByRole("radio", { name: "Rojo" }));
      await user.click(screen.getByRole("radio", { name: "Blanco" }));
      expect(screen.getByRole("radio", { name: "L" })).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Elige una talla" })).toBeInTheDocument();
    });

    it("…mientras que una talla que sí existe en ambos colores se conserva en el viaje de ida y vuelta (S)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const user = userEvent.setup();
      await user.click(screen.getByRole("radio", { name: "S" }));
      await user.click(screen.getByRole("radio", { name: "Rojo" }));
      await user.click(screen.getByRole("radio", { name: "Blanco" }));
      expect(screen.getByRole("radio", { name: "S" })).toBeChecked();
    });

    it("un color agotado (Negro): botón «Agotado en este color» y sin enlace de consulta", async () => {
      renderAt(<ProductPage />, "/producto/chaqueta-japandi?color=negro");
      await loaded();
      expect(screen.getByRole("button", { name: "Agotado en este color" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
      for (const radio of within(screen.getByRole("radiogroup", { name: "Talla" })).getAllByRole(
        "radio",
      )) {
        expect(radio).toBeDisabled();
      }
    });

    it("TODO agotado: botón «Agotado» y etiqueta «Agotado»", async () => {
      const out = { xs: "out", s: "out", m: "out", l: "out" } as const;
      serve({
        product: productFixture({
          variants: variantsFrom({ blanco: out, negro: out, rojo: { ...out, l: undefined } }),
        }),
      });
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getByRole("button", { name: "Agotado" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getAllByText("Agotado").length).toBeGreaterThanOrEqual(2); // etiqueta + botón
      expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    });

    it("con talla elegida el botón principal es «Agregar a la bolsa» y la consulta por WhatsApp queda como enlace debajo", async () => {
      renderAt(<ProductPage />);
      await loaded();
      await userEvent.setup().click(screen.getByRole("radio", { name: "XS" }));
      const add = screen.getByRole("button", { name: "Agregar a la bolsa" });
      const link = screen.getByRole("link", { name: /Consultar por WhatsApp/ });
      expect(add.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("«Agregar a la bolsa» agrega la variante ELEGIDA (color + talla), emite add_to_cart y abre el cajón", async () => {
      const events: TrackEvent[] = [];
      const off = subscribeToTracking((e) => events.push(e));
      const { server, cart } = renderAt(<ProductPage />);
      await loaded();
      const user = userEvent.setup();
      await user.click(screen.getByRole("radio", { name: "Rojo" }));
      await user.click(screen.getByRole("radio", { name: "M" }));
      await user.click(screen.getByRole("button", { name: "Agregar a la bolsa" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      off();
      expect(server.callsOf("set_item")).toEqual([
        { action: "set_item", variant_id: "v-rojo-m", qty: 1 },
      ]);
      expect(cart().open).toBe(true);
      expect(events.filter((e) => e.name === "add_to_cart")).toEqual([
        {
          name: "add_to_cart",
          item: { id: "p1", name: "Chaqueta Japandi", price: 560, currency: "BOB" },
          quantity: 1,
          variant: { color: "Rojo", size: "M" },
        },
      ]);
    });

    it("en estados no listos (elige talla, agotado) no se puede agregar nada", async () => {
      const { server } = renderAt(<ProductPage />);
      await loaded();
      await userEvent.setup().click(screen.getByRole("button", { name: "Elige una talla" }));
      expect(screen.queryByRole("button", { name: "Agregar a la bolsa" })).not.toBeInTheDocument();
      expect(server.calls).toHaveLength(0);
    });

    it("sin WhatsApp configurado: «Agregar a la bolsa» sigue disponible y no hay enlace de consulta", async () => {
      serve({ settings: { business_name: "MIC" } });
      renderAt(<ProductPage />);
      await loaded();
      await userEvent.setup().click(screen.getByRole("radio", { name: "XS" }));
      const add = screen.getByRole("button", { name: "Agregar a la bolsa" });
      expect(add).not.toHaveAttribute("aria-disabled");
      expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    });

    it.each(["59167528677", "javascript:alert(1)", "+123", "https://evil.com", "+59 167 528 677"])(
      "un número de WhatsApp inválido (%j) NO produce enlace",
      async (bad) => {
        serve({ settings: { whatsapp_orders: bad } });
        renderAt(<ProductPage />);
        await loaded();
        await userEvent.setup().click(screen.getByRole("radio", { name: "XS" }));
        expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Agregar a la bolsa" })).toBeInTheDocument();
      },
    );

    it("producto sin tallas: el botón está listo en cuanto hay stock y no hay fila de talla", async () => {
      serve({
        product: productFixture({
          sizes: [],
          colors: [{ ...COLORS.blanco }],
          variants: [{ id: "v", colorId: COLORS.blanco.id, sizeId: null, stockStatus: "in_stock" }],
        }),
      });
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.queryByRole("radiogroup", { name: "Talla" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Consultar por WhatsApp/ })).toBeInTheDocument();
    });

    it("con un solo color el mensaje de WhatsApp no nombra el color (no hay nada que elegir)", async () => {
      serve({
        product: productFixture({
          sizes: [],
          colors: [{ ...COLORS.blanco }],
          variants: [{ id: "v", colorId: COLORS.blanco.id, sizeId: null, stockStatus: "in_stock" }],
        }),
      });
      renderAt(<ProductPage />);
      await loaded();
      const link = screen.getByRole("link", { name: /WhatsApp/ });
      const text = new URL(link.getAttribute("href")!).searchParams.get("text")!;
      expect(text).toContain("Chaqueta Japandi");
      expect(text).not.toContain("Color:");
      expect(text).not.toContain("Talla:");
    });

    it("talla única: se preselecciona y el botón queda listo", async () => {
      serve({
        product: productFixture({
          sizes: [{ id: "s-u", label: "Única", sortOrder: 1 }],
          colors: [{ ...COLORS.blanco }],
          variants: [
            { id: "v", colorId: COLORS.blanco.id, sizeId: "s-u", stockStatus: "in_stock" },
          ],
        }),
      });
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getByRole("radio", { name: "Única" })).toBeChecked();
      expect(screen.getByRole("link", { name: /Consultar por WhatsApp/ })).toBeInTheDocument();
    });

    it("nunca se muestran cantidades de stock en la ficha", async () => {
      const { container } = renderAt(<ProductPage />);
      await loaded();
      expect(container.textContent).not.toMatch(/\b\d+\s*(unidades|uds?\.?|en stock|disponibles)/i);
    });
  });

  describe("estados: cargando, error, 404, redirecciones", () => {
    it("mientras carga se ve un esqueleto anunciado (nunca la pantalla en blanco)", async () => {
      vi.mocked(getProductBySlug).mockReturnValue(new Promise(() => {}));
      renderAt(<ProductPage />);
      expect(await screen.findByText("Cargando producto…")).toBeInTheDocument();
      expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    });

    it("un error de red muestra el aviso con «Reintentar» y al reintentar se recupera", async () => {
      vi.mocked(getProductBySlug).mockRejectedValueOnce(new Error("sin red"));
      renderAt(<ProductPage />);
      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar el producto");
      await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
      expect(await loaded()).toHaveTextContent("Chaqueta Japandi");
    });

    it("si falla la consulta de slugs renombrados no dice «no existe»: error con «Reintentar» y, al reintentar, redirige", async () => {
      serve();
      vi.mocked(findSlugRedirect).mockRejectedValueOnce(new Error("sin red"));
      vi.mocked(findSlugRedirect).mockResolvedValueOnce("chaqueta-japandi");
      renderAt(<ProductPage />, "/producto/chaqueta-vieja");
      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar el producto");
      expect(screen.queryByText("No encontramos este producto")).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
      expect(await loaded()).toHaveTextContent("Chaqueta Japandi");
      expect(location()).toBe("/producto/chaqueta-japandi");
    });

    it.each([
      [
        "inexistente / oculto / borrador / archivado (la base devuelve nada)",
        "/producto/no-existe",
      ],
      ["con caracteres imposibles", "/producto/a%20b%3Cscript%3E"],
      ["demasiado largo", `/producto/${"a".repeat(300)}`],
    ])("slug %s → 404 amable con enlace a la tienda, sin indexar", async (_name, path) => {
      renderAt(<ProductPage />, path);
      expect(
        await screen.findByRole("heading", { level: 1, name: "No encontramos este producto" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ver la tienda" })).toHaveAttribute(
        "href",
        "/tienda",
      );
      expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
        "noindex,nofollow",
      );
    });

    it("los slugs malformados ni siquiera consultan la base", async () => {
      renderAt(<ProductPage />, "/producto/a%20b%3Cscript%3E");
      await screen.findByRole("heading", { level: 1, name: "No encontramos este producto" });
      expect(getProductBySlug).not.toHaveBeenCalled();
    });

    it("un slug de más de 120 caracteres ni siquiera consulta la base; uno de exactamente 120 sí", async () => {
      const { unmount } = renderAt(<ProductPage />, `/producto/${"a".repeat(121)}`);
      await screen.findByRole("heading", { level: 1, name: "No encontramos este producto" });
      expect(getProductBySlug).not.toHaveBeenCalled();
      unmount();

      renderAt(<ProductPage />, `/producto/${"a".repeat(120)}`);
      await screen.findByRole("heading", { level: 1, name: "No encontramos este producto" });
      expect(getProductBySlug).toHaveBeenCalledWith("a".repeat(120));
    });

    it("un slug con MAYÚSCULAS redirige (replace) al slug en minúsculas, conservando los parámetros, y no consulta con mayúsculas", async () => {
      renderAt(<ProductPage />, "/producto/Chaqueta-JAPANDI?color=rojo");
      expect(await loaded()).toHaveTextContent("Chaqueta Japandi");
      expect(location()).toBe("/producto/chaqueta-japandi?color=rojo");
      for (const [slug] of vi.mocked(getProductBySlug).mock.calls)
        expect(slug).toBe(slug.toLowerCase());
    });

    it("un slug ANTERIOR de un producto renombrado redirige al actual", async () => {
      serve({ redirect: "chaqueta-japandi" });
      renderAt(<ProductPage />, "/producto/chaqueta-vieja?utm_source=ig");
      expect(await loaded()).toHaveTextContent("Chaqueta Japandi");
      expect(location()).toBe("/producto/chaqueta-japandi?utm_source=ig");
      expect(findSlugRedirect).toHaveBeenCalledWith("chaqueta-vieja");
    });

    it("la redirección solo se consulta si el producto no existe (no en cada ficha)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      expect(findSlugRedirect).not.toHaveBeenCalled();
    });

    it("una redirección que apunta al mismo slug no provoca un bucle: 404", async () => {
      serve({ product: null, redirect: "fantasma" });
      renderAt(<ProductPage />, "/producto/fantasma");
      expect(
        await screen.findByRole("heading", { level: 1, name: "No encontramos este producto" }),
      ).toBeInTheDocument();
      expect(location()).toBe("/producto/fantasma");
    });

    it("si la consulta de redirecciones sigue caída, no se queda cargando ni afirma que no existe: error con reintento", async () => {
      serve({ product: null });
      vi.mocked(findSlugRedirect).mockRejectedValue(new Error("caído"));
      renderAt(<ProductPage />, "/producto/otro");
      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar el producto");
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      expect(document.querySelector("[aria-busy='true']")).toBeNull();
      expect(screen.queryByText("No encontramos este producto")).not.toBeInTheDocument();
    });

    it("si el administrador repone un producto oculto, la MISMA URL vuelve a funcionar al recargar los datos", async () => {
      serve({ product: null });
      const { queryClient } = renderAt(<ProductPage />);
      await screen.findByRole("heading", { level: 1, name: "No encontramos este producto" });
      serve({ product: detail });
      await act(async () => {
        await queryClient.invalidateQueries();
      });
      expect(
        await screen.findByRole("heading", { level: 1, name: "Chaqueta Japandi" }),
      ).toBeInTheDocument();
    });
  });

  describe("datos frescos", () => {
    afterEach(() => {
      vi.useRealTimers();
      focusManager.setFocused(undefined);
    });

    it("al volver a enfocar la pestaña con datos viejos se vuelve a pedir el producto (cambia el precio sin recargar)", async () => {
      const cheaper = productFixture({}, { price: { amount: 60000, currency: "BOB" } });
      vi.mocked(getProductBySlug).mockResolvedValueOnce(detail).mockResolvedValue(cheaper);
      // el cliente de prueba desactiva el refresco por foco por defecto: la pantalla debe activarlo ella misma
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getByText("Bs 560,00")).toBeInTheDocument();
      // Solo se falsea la fecha (los temporizadores siguen siendo reales) y se mantiene falsa hasta que React Query
      // reaccione al foco: lo hace en una microtarea posterior.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 31_000); // pasan más de los 30 s de frescura
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(screen.getByText("Bs 600,00")).toBeInTheDocument());
      expect(getProductBySlug).toHaveBeenCalledTimes(2);
    });

    it("…pero si los datos son recientes (menos de 30 s) enfocar la pestaña NO vuelve a pedirlos", async () => {
      renderAt(<ProductPage />);
      await loaded();
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(getProductBySlug).toHaveBeenCalledTimes(1);
    });

    it("si el refresco en segundo plano falla, la ficha sigue mostrándose (no se pierde lo que ya se veía)", async () => {
      vi.mocked(getProductBySlug)
        .mockResolvedValueOnce(detail)
        .mockRejectedValue(new Error("sin red"));
      const { queryClient } = renderAt(<ProductPage />);
      await loaded();
      await act(async () => {
        await queryClient.refetchQueries();
        // React Query avisa a los componentes en una tarea posterior: sin esperarla la prueba miraría demasiado pronto.
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      // la consulta SÍ falló (estado de error con los datos viejos retenidos) y aun así la ficha sigue ahí
      expect(getProductBySlug).toHaveBeenCalledTimes(2);
      const state = queryClient.getQueryCache().find({
        queryKey: catalogKeys.product("chaqueta-japandi"),
      })?.state;
      expect(state?.status).toBe("error");
      expect(state?.data).toBeDefined();
      expect(
        screen.getByRole("heading", { level: 1, name: "Chaqueta Japandi" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("SEO y analítica", () => {
    it("título, descripción, canónico limpio, Open Graph de producto y robots", async () => {
      renderAt(<ProductPage />, "/producto/chaqueta-japandi?utm_source=ig&fbclid=abc&color=rojo");
      await loaded();
      expect(document.title).toBe("Chaqueta Japandi · Made In Chola");
      const head = document.head;
      expect(head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
        "Chaqueta de cuero vegano. Corte holgado.",
      );
      expect(head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
        `${siteUrl()}/producto/chaqueta-japandi`,
      );
      expect(head.querySelector('meta[property="og:type"]')?.getAttribute("content")).toBe(
        "product",
      );
      expect(head.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
        "https://cdn.test/storage/products/p1/b1.jpg",
      );
      expect(head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(
        `${siteUrl()}/producto/chaqueta-japandi`,
      );
      expect(head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
        "index,follow",
      );
    });

    it("JSON-LD: un Product y un BreadcrumbList parseables, con precio 560.00 BOB", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const blocks = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(
        (s) => JSON.parse(s.textContent ?? ""),
      );
      expect(blocks.map((b) => b["@type"])).toEqual(["Product", "BreadcrumbList"]);
      expect(blocks[0].offers).toMatchObject({
        price: "560.00",
        priceCurrency: "BOB",
        availability: "https://schema.org/InStock",
      });
      expect(blocks[0].brand.name).toBe("Made In Chola");
    });

    it("la marca sale del ajuste business_name", async () => {
      serve({ settings: { ...SETTINGS, business_name: "Chola Studio" } });
      renderAt(<ProductPage />);
      await loaded();
      await waitFor(() => {
        const product = JSON.parse(
          document.head.querySelector('script[type="application/ld+json"]')?.textContent ?? "{}",
        );
        expect(product.brand.name).toBe("Chola Studio");
      });
    });

    it("un nombre con </script> no puede cerrar la etiqueta del JSON-LD", async () => {
      serve({ product: productFixture({}, { name: "</script><script>alert(1)</script>" }) });
      renderAt(<ProductPage />);
      await screen.findByRole("heading", { level: 1 });
      const script = document.head.querySelector('script[type="application/ld+json"]')!;
      expect(script.textContent).not.toContain("<");
      expect(JSON.parse(script.textContent!).name).toBe("</script><script>alert(1)</script>");
      expect(document.head.querySelectorAll("script:not([type])")).toHaveLength(0);
    });

    it("al salir de la ficha se retiran las etiquetas SEO (no se arrastran a otra página)", async () => {
      const { unmount } = renderAt(<ProductPage />);
      await loaded();
      unmount();
      expect(document.head.querySelectorAll("[data-seo]")).toHaveLength(0);
    });

    it("emite view_item UNA vez por producto (no al cambiar de color o talla) y sin cantidades", async () => {
      const events: TrackEvent[] = [];
      const off = subscribeToTracking((e) => events.push(e));
      try {
        renderAt(<ProductPage />);
        await loaded();
        const user = userEvent.setup();
        await user.click(screen.getByRole("radio", { name: "Rojo" }));
        await user.click(screen.getByRole("radio", { name: "XS" }));
        expect(events).toEqual([
          {
            name: "view_item",
            item: { id: "p1", name: "Chaqueta Japandi", price: 560, currency: "BOB" },
          },
        ]);
      } finally {
        off();
      }
    });
  });

  describe("accesibilidad", () => {
    it("la ficha es un artículo con un único h1 y los grupos de color y talla nombrados", async () => {
      renderAt(<ProductPage />);
      await loaded();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("article")).toBeInTheDocument();
      expect(screen.getByRole("radiogroup", { name: "Color" })).toBeInTheDocument();
      expect(screen.getByRole("radiogroup", { name: "Talla" })).toBeInTheDocument();
    });

    it("las miniaturas se pueden usar con el teclado (botones con nombre)", async () => {
      renderAt(<ProductPage />);
      await loaded();
      const thumb = screen.getByRole("button", { name: "Ver imagen 2 de 3" });
      act(() => thumb.focus());
      expect(thumb).toHaveFocus();
      fireEvent.click(thumb);
    });
  });
});

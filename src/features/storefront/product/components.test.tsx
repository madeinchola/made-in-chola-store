import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColorBars } from "./ColorBars";
import { ProductAccordions } from "./ProductAccordions";
import { ProductMedia } from "./ProductMedia";
import { PurchaseButton } from "./PurchaseButton";
import { SizePicker } from "./SizePicker";
import { COLORS, image, productFixture, setViewport } from "./product-test-utils";
import { colorOptions, sizeOptions } from "./variantSelection";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://cdn.test/${path}`,
}));
// El carrusel de móvil usa embla (sin layout en jsdom): se sustituye por un doble que cuenta cuántas veces se monta.
const gallery = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("@/components/store/Gallery", async () => {
  const React = await import("react");
  return {
    Gallery: ({ images }: { images: { id: string }[] }) => {
      React.useState(() => ++gallery.mounts);
      return <div data-testid="gallery">{images.map((i) => i.id).join(",")}</div>;
    },
  };
});

const detail = productFixture();

describe("ColorBars", () => {
  function Harness({ onChange = () => {} }: { onChange?: (id: string) => void }) {
    const [value, setValue] = useState<string | null>(COLORS.blanco.id);
    return (
      <ColorBars
        options={colorOptions(detail)}
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange(id);
        }}
      />
    );
  }

  it("es un grupo «Color» con una opción por color y la elegida marcada", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Color" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Blanco",
      "Negro (agotado)",
      "Rojo",
    ]);
    expect(screen.getByRole("radio", { name: "Blanco" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Rojo" })).not.toBeChecked();
  });

  it("elegir un color lo marca y avisa; un color agotado SÍ se puede ver", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Rojo" }));
    expect(onChange).toHaveBeenLastCalledWith(COLORS.rojo.id);
    expect(screen.getByRole("radio", { name: "Rojo" })).toBeChecked();
    await userEvent.setup().click(screen.getByRole("radio", { name: "Negro (agotado)" }));
    expect(onChange).toHaveBeenLastCalledWith(COLORS.negro.id);
  });

  it("las flechas del teclado cambian de color", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    act(() => screen.getByRole("radio", { name: "Blanco" }).focus());
    // Radix selecciona al llegar el foco solo si la flecha sigue pulsada (user-event la suelta al instante).
    await user.keyboard("{ArrowRight>}");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await user.keyboard("{/ArrowRight}");
    expect(onChange).toHaveBeenCalledWith(COLORS.negro.id);
  });

  it("es una barra rectangular con borde SIEMPRE (el blanco no se pierde) y el color de fondo; sin hex válido, rayado", () => {
    render(
      <ColorBars
        options={[
          { id: "a", name: "Blanco", hex: "#FFFFFF", slug: "blanco", available: true },
          { id: "b", name: "Sin definir", hex: "no-es-color", slug: "x", available: true },
        ]}
        value="a"
        onChange={() => {}}
      />,
    );
    const white = screen.getByRole("radio", { name: "Blanco" });
    expect(white).toHaveClass("border", "border-input", "h-4", "w-[4.1rem]");
    expect(white).toHaveStyle({ backgroundColor: "#ffffff" });
    const striped = screen.getByRole("radio", { name: "Sin definir" });
    expect(striped.getAttribute("style")).toContain("repeating-linear-gradient");
    expect(striped.getAttribute("style")).not.toContain("no-es-color");
  });

  it("los colores agotados se marcan con una raya, sin atenuar la barra", () => {
    render(<Harness />);
    const soldOut = screen.getByRole("radio", { name: "Negro (agotado)" });
    // marcado con una raya (no con transparencia: el borde conserva su contraste) y solo el agotado la lleva
    expect(soldOut.querySelector("[data-sold-out-mark]")).not.toBeNull();
    expect(Array.from(soldOut.classList).some((c) => c.startsWith("opacity-"))).toBe(false);
    expect(
      screen.getByRole("radio", { name: "Blanco" }).querySelector("[data-sold-out-mark]"),
    ).toBeNull();
  });
});

describe("SizePicker", () => {
  const options = sizeOptions(detail, COLORS.blanco.id); // XS stock · S pocas · M agotada · L stock
  function Harness({
    onChange = () => {},
    opts = options,
  }: {
    onChange?: (id: string) => void;
    opts?: typeof options;
  }) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <SizePicker
        options={opts}
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange(id);
        }}
      />
    );
  }

  it("muestra la etiqueta «Talla» y las tallas como texto, con la agotada deshabilitada y el motivo para lectores", () => {
    render(<Harness />);
    expect(screen.getByText("Talla")).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent?.trim())).toEqual(["XS", "S", "M (agotada)", "L"]);
    expect(screen.getByRole("radio", { name: "M (agotada)" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "XS" })).toBeEnabled();
  });

  it("una talla agotada NO se puede elegir ni con clic", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "M (agotada)" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "M (agotada)" })).not.toBeChecked();
  });

  it("una talla que ese color no tiene se anuncia como «no disponible en este color»", () => {
    render(<Harness opts={sizeOptions(detail, COLORS.rojo.id)} />);
    const l = screen.getByRole("radio", { name: "L (no disponible en este color)" });
    expect(l).toBeDisabled();
  });

  it("elegir una talla disponible la marca (subrayada) y avisa; «pocas unidades» se puede elegir", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "S" }));
    expect(onChange).toHaveBeenCalledWith("s-s");
    expect(screen.getByRole("radio", { name: "S" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "S" })).toHaveClass("data-[state=checked]:underline");
  });

  it("las tallas agotadas se tachan y atenúan; objetivo táctil ≥ 44 px de alto", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "M (agotada)" })).toHaveClass("line-through");
    expect(screen.getByRole("radio", { name: "XS" })).toHaveClass("min-h-11");
  });

  it("el grupo se nombra con la etiqueta «Talla»", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Talla" })).toBeInTheDocument();
  });
});

describe("PurchaseButton", () => {
  const href = "https://wa.me/59167528677?text=Hola";

  it("listo + WhatsApp: enlace «Consultar por WhatsApp» que abre pestaña nueva con noopener noreferrer", () => {
    render(<PurchaseButton state="ready" whatsappHref={href} />);
    const link = screen.getByRole("link", { name: /Consultar por WhatsApp/ });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName("Consultar por WhatsApp (se abre en una pestaña nueva)");
  });

  it("listo SIN WhatsApp: botón deshabilitado «Próximamente: agregar a la bolsa»", () => {
    render(<PurchaseButton state="ready" whatsappHref={null} />);
    const button = screen.getByRole("button", { name: "Próximamente: agregar a la bolsa" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each([
    ["choose_size", "Elige una talla", "Elige una talla para continuar."],
    ["color_sold_out", "Agotado en este color", "Este color está agotado: prueba con otro."],
  ] as const)(
    "estado %s: «%s» deshabilitado, con su mensaje enlazado, y sin enlace aunque haya WhatsApp",
    (state, label, hint) => {
      render(<PurchaseButton state={state} whatsappHref={href} />);
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(hint);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it("todo agotado: «Agotado» deshabilitado y sin mensaje extra", () => {
    render(<PurchaseButton state="sold_out" whatsappHref={href} />);
    const button = screen.getByRole("button", { name: "Agotado" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("un botón no disponible sigue enfocable (aria-disabled, no disabled) y su clic no hace nada", async () => {
    const onClick = vi.fn();
    render(
      <form onSubmit={onClick}>
        <PurchaseButton state="choose_size" whatsappHref={href} />
      </form>,
    );
    const button = screen.getByRole("button", { name: "Elige una talla" });
    expect(button).toBeEnabled();
    act(() => button.focus());
    expect(button).toHaveFocus();
    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("ProductAccordions", () => {
  it("muestra los cuatro cuando todo tiene texto; cada cabecera es un botón con el «+» a la derecha", () => {
    render(
      <ProductAccordions
        materials="100 % algodón"
        washcare="Lavar a mano"
        shippingReturn="Envíos"
        assistance="Ayuda"
      />,
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent?.trim())).toEqual([
      "Materiales",
      "Cuidados",
      "Envíos y devoluciones",
      "Asistencia",
    ]);
  });

  it("un acordeón sin texto (null, vacío o solo espacios) NO se pinta", () => {
    render(
      <ProductAccordions materials={null} washcare="   " shippingReturn="" assistance="Ayuda" />,
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Asistencia"]);
  });

  it("sin ningún texto no pinta nada", () => {
    const { container } = render(
      <ProductAccordions
        materials={null}
        washcare={null}
        shippingReturn={null}
        assistance={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("al abrir muestra el texto con saltos de línea respetados, como TEXTO (sin interpretar HTML)", async () => {
    render(
      <ProductAccordions
        materials={null}
        washcare={null}
        shippingReturn={"Línea 1\nLínea 2 <b>no</b> <img src=x onerror=alert(1)>"}
        assistance={null}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Envíos y devoluciones" }));
    const content = screen.getByText(/Línea 1/);
    expect(content).toHaveClass("whitespace-pre-line");
    expect(content.textContent).toBe("Línea 1\nLínea 2 <b>no</b> <img src=x onerror=alert(1)>");
    expect(content.querySelector("b, img")).toBeNull();
  });

  it("los iconos son decorativos", () => {
    render(<ProductAccordions materials="a" washcare="b" shippingReturn="c" assistance="d" />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.querySelector("svg")?.closest("[aria-hidden='true']")).not.toBeNull();
    }
  });
});

describe("ProductMedia", () => {
  const images = [image("a", null, 1, "Frente"), image("b", null, 2), image("c", null, 3)];
  const scroll = vi.fn();
  const original = Element.prototype.scrollIntoView;
  const originalMatch = window.matchMedia;

  beforeEach(() => {
    gallery.mounts = 0;
    scroll.mockClear();
    Element.prototype.scrollIntoView = scroll;
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
    window.matchMedia = originalMatch;
  });

  describe("escritorio (apiladas)", () => {
    beforeEach(() => setViewport("desktop"));

    it("todas las imágenes apiladas, en orden, con su texto alternativo (el propio o «nombre, imagen n de total»)", () => {
      render(<ProductMedia images={images} productName="Chaqueta" colorId="c1" />);
      const section = screen.getByRole("region", { name: "Imágenes del producto" });
      const imgs = within(section).getAllByRole("img");
      expect(imgs.map((i) => i.getAttribute("alt"))).toEqual([
        "Frente",
        "Chaqueta, imagen 2 de 3",
        "Chaqueta, imagen 3 de 3",
      ]);
      expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
        "https://cdn.test/products/p1/a.jpg",
        "https://cdn.test/products/p1/b.jpg",
        "https://cdn.test/products/p1/c.jpg",
      ]);
      expect(screen.queryByTestId("gallery")).not.toBeInTheDocument();
    });

    it("LCP: la primera imagen es eager con prioridad alta y las demás perezosas; todas con tamaño reservado", () => {
      render(<ProductMedia images={images} productName="Chaqueta" colorId="c1" />);
      const imgs = within(
        screen.getByRole("region", { name: "Imágenes del producto" }),
      ).getAllByRole("img");
      expect(imgs[0]).toHaveAttribute("loading", "eager");
      expect(imgs[0]).toHaveAttribute("fetchpriority", "high");
      for (const img of imgs.slice(1)) {
        expect(img).toHaveAttribute("loading", "lazy");
        expect(img).not.toHaveAttribute("fetchpriority", "high");
      }
      for (const img of imgs) {
        expect(img).toHaveAttribute("width");
        expect(img).toHaveAttribute("height");
        expect(img.closest("li")).toHaveClass("aspect-[4/5]");
      }
    });

    it("las miniaturas llevan a cada imagen con desplazamiento suave", async () => {
      render(<ProductMedia images={images} productName="Chaqueta" colorId="c1" />);
      const thumbs = within(screen.getByRole("list", { name: "Miniaturas" })).getAllByRole(
        "button",
      );
      expect(thumbs.map((b) => b.getAttribute("aria-label"))).toEqual([
        "Ver imagen 1 de 3",
        "Ver imagen 2 de 3",
        "Ver imagen 3 de 3",
      ]);
      await userEvent.setup().click(thumbs[2]!);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });

    it("con «reducir movimiento» el desplazamiento es inmediato", async () => {
      const desktop = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        ...desktop(query),
        matches: query.includes("min-width: 1024px") || query.includes("reduce"),
      })) as typeof window.matchMedia;
      render(<ProductMedia images={images} productName="Chaqueta" colorId="c1" />);
      await userEvent.setup().click(screen.getByRole("button", { name: "Ver imagen 2 de 3" }));
      expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    });

    it("las miniaturas son decorativas (alt vacío): el botón ya tiene nombre", () => {
      render(<ProductMedia images={images} productName="Chaqueta" colorId="c1" />);
      for (const b of within(screen.getByRole("list", { name: "Miniaturas" })).getAllByRole(
        "button",
      )) {
        expect(b.querySelector("img")).toHaveAttribute("alt", "");
      }
    });

    it("una sola imagen: sin miniaturas", () => {
      render(<ProductMedia images={[images[0]!]} productName="Chaqueta" colorId="c1" />);
      expect(screen.queryByRole("list", { name: "Miniaturas" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("img")).toHaveLength(1);
    });

    it("sin imágenes: baldosa provisional (nunca un hueco)", () => {
      const { container } = render(
        <ProductMedia images={[]} productName="Chaqueta" colorId="c1" />,
      );
      expect(container.querySelector("[data-placeholder]")).not.toBeNull();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("una imagen que falla se sustituye por la baldosa (no icono roto) y su miniatura también", () => {
      const { container } = render(
        <ProductMedia images={images} productName="Chaqueta" colorId="c1" />,
      );
      const first = within(
        screen.getByRole("region", { name: "Imágenes del producto" }),
      ).getAllByRole("img")[0]!;
      fireEvent.error(first);
      expect(container.querySelectorAll("[data-placeholder]").length).toBeGreaterThanOrEqual(1);
      expect(
        within(screen.getByRole("region", { name: "Imágenes del producto" })).getAllByRole("img"),
      ).toHaveLength(2);
    });
  });

  describe("móvil (carrusel)", () => {
    beforeEach(() => setViewport("mobile"));

    it("usa la galería con las imágenes dadas y no pinta la pila de escritorio", () => {
      render(<ProductMedia images={images} productName="Chaqueta" colorId="c1" />);
      expect(screen.getByTestId("gallery")).toHaveTextContent("a,b,c");
      expect(
        screen.queryByRole("region", { name: "Imágenes del producto" }),
      ).not.toBeInTheDocument();
    });

    it("al cambiar de color la galería se vuelve a montar (vuelve a la primera imagen); con el mismo color no", () => {
      const { rerender } = render(
        <ProductMedia images={images} productName="Chaqueta" colorId="c1" />,
      );
      expect(gallery.mounts).toBe(1);
      rerender(<ProductMedia images={[...images]} productName="Chaqueta" colorId="c1" />);
      expect(gallery.mounts).toBe(1);
      rerender(<ProductMedia images={images} productName="Chaqueta" colorId="c2" />);
      expect(gallery.mounts).toBe(2);
    });
  });
});

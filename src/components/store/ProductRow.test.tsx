import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductSummary } from "@/features/catalog/types";
import { money } from "@/lib/money";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://img.test/${path}`,
}));

// embla necesita medidas reales de layout (jsdom no las tiene): se sustituye por una API simulada para probar
// NUESTRO código (flechas, aria-disabled, desplazamiento, estructura).
const api = vi.hoisted(() => {
  const handlers: Record<string, ((embla: unknown) => void)[]> = {};
  const self = {
    canScrollPrev: vi.fn(() => false),
    canScrollNext: vi.fn(() => true),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: vi.fn((event: string, handler: (embla: unknown) => void) => {
      (handlers[event] ??= []).push(handler);
      return self;
    }),
    off: vi.fn(() => self),
    // embla entrega su propia API a los manejadores
    emit: (event: string) => (handlers[event] ?? []).forEach((h) => h(self)),
    reset: () => {
      for (const key of Object.keys(handlers)) delete handlers[key];
    },
  };
  return self;
});
vi.mock("embla-carousel-react", () => ({ default: () => [vi.fn(), api] }));

import { ProductRow } from "./ProductRow";

const product = (n: number, over: Partial<ProductSummary> = {}): ProductSummary => ({
  id: `p${n}`,
  slug: `producto-${n}`,
  name: `Chakra ${n}`,
  isNew: false,
  price: money(8000, "BOB"),
  colorsCount: 5,
  soldOut: false,
  coverPath: `p${n}.jpg`,
  coverAlt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});
const products = [1, 2, 3, 4, 5].map((n) => product(n));

const renderRow = (props: Partial<React.ComponentProps<typeof ProductRow>> = {}) =>
  render(
    <MemoryRouter>
      <ProductRow title="Lo más popular" products={products} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.reset();
  api.canScrollPrev.mockReturnValue(false);
  api.canScrollNext.mockReturnValue(true);
});

describe("ProductRow", () => {
  it("título en un encabezado (h2 por defecto, cambiable) y un carrusel con ese nombre", () => {
    const { unmount } = renderRow();
    expect(screen.getByRole("heading", { level: 2, name: "Lo más popular" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Lo más popular" })).toHaveAttribute(
      "aria-roledescription",
      "carousel",
    );
    unmount();
    renderRow({ headingAs: "h3" });
    expect(screen.getByRole("heading", { level: 3, name: "Lo más popular" })).toBeInTheDocument();
  });

  it("una tarjeta por producto, en su orden, cada una con UN solo enlace", () => {
    renderRow();
    const links = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(links).toEqual([1, 2, 3, 4, 5].map((n) => `/producto/producto-${n}`));
    expect(screen.getAllByRole("article")).toHaveLength(5);
  });

  it("sin productos NO se pinta nada (ni título ni flechas)", () => {
    const { container } = renderRow({ products: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("«VER TODO» interno es un enlace con rel normal; externo abre con noopener noreferrer", () => {
    const { unmount } = renderRow({ viewAll: { to: "/tienda", label: "Ver todo" } });
    const internal = screen.getByRole("link", { name: "Ver todo" });
    expect(internal).toHaveAttribute("href", "/tienda");
    expect(internal).toHaveClass("underline", "eyebrow");
    unmount();
    renderRow({ viewAll: { to: "https://otro.com/x", label: "Ver todo", external: true } });
    const external = screen.getByRole("link", { name: "Ver todo" });
    expect(external).toHaveAttribute("href", "https://otro.com/x");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("sin `viewAll` no hay enlace «Ver todo»", () => {
    renderRow();
    expect(screen.queryByRole("link", { name: /ver todo/i })).toBeNull();
  });

  describe("flechas ‹ ›", () => {
    it("son botones con nombre y estado: «Anterior» bloqueada al inicio, «Siguiente» activa", () => {
      renderRow();
      expect(screen.getByRole("button", { name: "Anterior" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByRole("button", { name: "Siguiente" })).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    });

    it("usan aria-disabled y NUNCA el atributo disabled (un botón que se desactiva con el foco lo pierde)", () => {
      renderRow();
      for (const name of ["Anterior", "Siguiente"]) {
        expect(screen.getByRole("button", { name })).not.toHaveAttribute("disabled");
      }
    });

    it("«Siguiente» desplaza el carrusel; «Anterior» (bloqueada) no hace nada aunque se active con el teclado", async () => {
      const user = userEvent.setup();
      renderRow();
      const prev = screen.getByRole("button", { name: "Anterior" });
      act(() => prev.focus());
      await user.keyboard("{Enter}");
      expect(api.scrollPrev).not.toHaveBeenCalled();
      expect(prev).toHaveFocus(); // y no pierde el foco
      await user.click(screen.getByRole("button", { name: "Siguiente" }));
      expect(api.scrollNext).toHaveBeenCalledTimes(1);
    });

    it("al llegar al final «Siguiente» se bloquea SIN perder el foco, y «Anterior» se activa", () => {
      renderRow();
      const next = screen.getByRole("button", { name: "Siguiente" });
      act(() => next.focus());
      api.canScrollPrev.mockReturnValue(true);
      api.canScrollNext.mockReturnValue(false);
      act(() => api.emit("select"));
      expect(next).toHaveAttribute("aria-disabled", "true");
      expect(next).toHaveFocus();
      expect(screen.getByRole("button", { name: "Anterior" })).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    });

    it("se actualizan también al cambiar el tamaño de la ventana (evento reInit)", () => {
      renderRow();
      api.canScrollNext.mockReturnValue(false);
      act(() => api.emit("reInit"));
      expect(screen.getByRole("button", { name: "Siguiente" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    it("con «reducir movimiento» el desplazamiento salta sin animar", async () => {
      const user = userEvent.setup();
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes("reduce"),
      })) as unknown as typeof window.matchMedia;
      try {
        renderRow();
        await user.click(screen.getByRole("button", { name: "Siguiente" }));
        expect(api.scrollNext).toHaveBeenCalledWith(true);
      } finally {
        window.matchMedia = original;
      }
    });

    it("las flechas del teclado del carrusel también desplazan", async () => {
      const user = userEvent.setup();
      renderRow();
      act(() => screen.getAllByRole("link")[0]!.focus());
      await user.keyboard("{ArrowRight}");
      expect(api.scrollNext).toHaveBeenCalledTimes(1);
    });
  });

  describe("tarjetas", () => {
    it("4 por pantalla en escritorio, 3 en tableta y 2,3 en móvil (43 %)", () => {
      renderRow();
      const item = screen.getAllByRole("group")[0]!;
      expect(item).toHaveClass("basis-[43%]", "sm:basis-1/3", "lg:basis-1/4");
    });

    it("separación de ≈ 10 px entre tarjetas (la del PDF), no los 16 px por defecto", () => {
      renderRow();
      const item = screen.getAllByRole("group")[0]!;
      expect(item).toHaveClass("pl-2.5");
      expect(item.parentElement).toHaveClass("-ml-2.5");
    });

    it("`pricePrefix` llega a todas las tarjetas", () => {
      renderRow({ pricePrefix: "Desde" });
      expect(screen.getAllByText("Desde")).toHaveLength(5);
    });

    it("`onPrefetch` se dispara al pasar el puntero por una tarjeta con SU slug", () => {
      const onPrefetch = vi.fn();
      renderRow({ onPrefetch });
      fireEvent.pointerEnter(screen.getAllByRole("article")[2]!);
      expect(onPrefetch).toHaveBeenCalledWith("producto-3");
    });

    it("una tarjeta agotada y una nueva conservan su chip dentro de la fila", () => {
      renderRow({ products: [product(1, { isNew: true }), product(2, { soldOut: true })] });
      const [first, second] = screen.getAllByRole("article");
      expect(within(first!).getByText("Nuevo")).toBeVisible();
      expect(within(second!).getByText("Agotado")).toBeVisible();
    });
  });
});

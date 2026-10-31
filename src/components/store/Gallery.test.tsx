import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductImage } from "@/features/catalog/types";
import { Gallery } from "./Gallery";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://img.test/${path}`,
}));

// embla necesita layout real (jsdom no lo tiene): se sustituye por un doble que cumple el mismo contrato
// (`on/off/scrollTo/selectedScrollSnap/canScroll*`) para probar NUESTRA sincronización de miniaturas y visor.
const embla = vi.hoisted(() => {
  type Handler = (api: unknown) => void;
  const state = {
    selected: 0,
    count: 0,
    handlers: new Map<string, Set<Handler>>(),
  };
  const api = {
    on(event: string, fn: Handler) {
      if (!state.handlers.has(event)) state.handlers.set(event, new Set());
      state.handlers.get(event)?.add(fn);
      return api;
    },
    off(event: string, fn: Handler) {
      state.handlers.get(event)?.delete(fn);
      return api;
    },
    emit(event: string) {
      state.handlers.get(event)?.forEach((fn) => fn(api)); // embla pasa su propia API a los manejadores
    },
    selectedScrollSnap: () => state.selected,
    canScrollPrev: () => state.selected > 0,
    canScrollNext: () => state.selected < state.count - 1,
    scrollTo: vi.fn((i: number, _jump?: boolean) => {
      state.selected = i;
      api.emit("select");
    }),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
  };
  return { state, api };
});

vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, embla.api],
}));

const image = (n: number, overrides: Partial<ProductImage> = {}): ProductImage => ({
  id: `img${n}`,
  colorId: null,
  path: `p/${n}.jpg`,
  alt: `Vista ${n}`,
  sortOrder: n,
  ...overrides,
});

beforeEach(() => {
  embla.state.selected = 0;
  embla.state.handlers.clear();
  embla.api.scrollTo.mockClear();
});

const setup = (images: ProductImage[]) => {
  embla.state.count = images.length;
  return render(<Gallery images={images} productName="Poncho andino" />);
};

const thumbs = () => within(screen.getByRole("group", { name: "Miniaturas" }));

describe("Gallery", () => {
  it("sin imágenes: baldosa provisional y ningún control", () => {
    setup([]);
    expect(screen.getByText("Sin imagen")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("una sola imagen: sin miniaturas, sin carrusel y sin flechas, pero se puede ampliar", () => {
    setup([image(1, { alt: null })]);
    expect(screen.queryByRole("group", { name: "Miniaturas" })).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("button", { name: "Anterior" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Siguiente" })).toBeNull();
    expect(screen.getByRole("img", { name: "Poncho andino" })).toHaveAttribute(
      "src",
      "https://img.test/p/1.jpg",
    );
    expect(screen.getByRole("button", { name: "Ampliar imagen" })).toBeInTheDocument();
  });

  it("varias imágenes: carrusel, flechas y miniaturas con nombre «Ver imagen n de total»", () => {
    setup([image(1), image(2), image(3)]);
    expect(screen.getByRole("region", { name: "Imágenes del producto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeInTheDocument();
    expect(
      thumbs()
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Ver imagen 1 de 3", "Ver imagen 2 de 3", "Ver imagen 3 de 3"]);
  });

  it("ordena por sortOrder", () => {
    setup([image(3), image(1), image(2)]);
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual([
      "Vista 1",
      "Vista 2",
      "Vista 3",
    ]);
  });

  it("alt de respaldo con el nombre del producto y la posición", () => {
    setup([image(1, { alt: null }), image(2, { alt: "  " })]);
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual([
      "Poncho andino (1/2)",
      "Poncho andino (2/2)",
    ]);
  });

  it("con «reducir movimiento» la miniatura salta sin animar (jump = true)", async () => {
    const user = userEvent.setup();
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
    })) as unknown as typeof window.matchMedia;
    try {
      setup([image(1), image(2), image(3)]);
      await user.click(thumbs().getByRole("button", { name: "Ver imagen 3 de 3" }));
      expect(embla.api.scrollTo).toHaveBeenCalledWith(2, true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("solo la miniatura activa lleva aria-current; las miniaturas son decorativas (alt vacío)", () => {
    setup([image(1), image(2), image(3)]);
    const buttons = thumbs().getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-current"))).toEqual(["true", null, null]);
    for (const button of buttons) {
      expect(button.querySelector("img")).toHaveAttribute("alt", "");
    }
  });

  it("clic en una miniatura mueve el visor y marca la miniatura", async () => {
    const user = userEvent.setup();
    setup([image(1), image(2), image(3)]);
    await user.click(thumbs().getByRole("button", { name: "Ver imagen 3 de 3" }));
    expect(embla.api.scrollTo).toHaveBeenCalledWith(2, false);
    expect(
      thumbs()
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-current")),
    ).toEqual([null, null, "true"]);
  });

  it("al deslizar el visor (evento select) la miniatura activa lo sigue", () => {
    setup([image(1), image(2), image(3)]);
    act(() => {
      embla.state.selected = 1;
      embla.api.emit("select");
    });
    expect(
      thumbs()
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-current")),
    ).toEqual([null, "true", null]);
  });

  it("si una imagen falla muestra la baldosa provisional en su lugar", () => {
    setup([image(1), image(2)]);
    const first = screen.getAllByRole("img")[0] as HTMLElement;
    fireEvent.error(first);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getAllByText("Sin imagen").length).toBeGreaterThanOrEqual(1);
  });

  describe("vista ampliada", () => {
    it("abre un diálogo con título, la imagen activa y el contador", async () => {
      const user = userEvent.setup();
      setup([image(1), image(2), image(3)]);
      await user.click(thumbs().getByRole("button", { name: "Ver imagen 2 de 3" }));
      await user.click(screen.getByRole("button", { name: "Ampliar imagen" }));
      const dialog = screen.getByRole("dialog", { name: "Imagen ampliada" });
      expect(within(dialog).getByRole("img", { name: "Vista 2" })).toHaveAttribute(
        "src",
        "https://img.test/p/2.jpg",
      );
      expect(within(dialog).getByText("Imagen 2 de 3")).toBeInTheDocument();
      expect(within(dialog).getByRole("img", { name: "Vista 2" })).toHaveClass("object-contain");
    });

    it("las flechas ← → del teclado cambian de imagen y se detienen en los extremos", async () => {
      const user = userEvent.setup();
      setup([image(1), image(2), image(3)]);
      await user.click(screen.getByRole("button", { name: "Ampliar imagen" }));
      const dialog = screen.getByRole("dialog");
      await user.keyboard("{ArrowRight}");
      expect(within(dialog).getByText("Imagen 2 de 3")).toBeInTheDocument();
      await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
      expect(within(dialog).getByText("Imagen 3 de 3")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Imagen siguiente" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
      expect(within(dialog).getByText("Imagen 1 de 3")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Imagen anterior" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    it("al llegar al final con el teclado el foco sigue dentro del diálogo (las flechas no dejan de funcionar)", async () => {
      const user = userEvent.setup();
      setup([image(1), image(2)]);
      await user.click(screen.getByRole("button", { name: "Ampliar imagen" }));
      const dialog = screen.getByRole("dialog");
      await user.keyboard("{ArrowRight}");
      expect(within(dialog).getByText("Imagen 2 de 2")).toBeInTheDocument();
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(document.body);
    });

    it("clic en un botón de extremo (aria-disabled) no pasa del límite", async () => {
      const user = userEvent.setup();
      setup([image(1), image(2)]);
      await user.click(screen.getByRole("button", { name: "Ampliar imagen" }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Imagen anterior" }));
      expect(within(dialog).getByText("Imagen 1 de 2")).toBeInTheDocument();
    });

    it("los botones anterior/siguiente cambian la imagen ampliada", async () => {
      const user = userEvent.setup();
      setup([image(1), image(2)]);
      await user.click(screen.getByRole("button", { name: "Ampliar imagen" }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Imagen siguiente" }));
      expect(within(dialog).getByRole("img", { name: "Vista 2" })).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Imagen anterior" }));
      expect(within(dialog).getByRole("img", { name: "Vista 1" })).toBeInTheDocument();
    });

    it("al cerrar con Esc el visor salta a la imagen vista y el foco vuelve al botón Ampliar", async () => {
      const user = userEvent.setup();
      setup([image(1), image(2), image(3)]);
      const open = screen.getByRole("button", { name: "Ampliar imagen" });
      await user.click(open);
      await user.keyboard("{ArrowRight}{ArrowRight}{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(embla.api.scrollTo).toHaveBeenCalledWith(2, false);
      expect(
        thumbs()
          .getAllByRole("button")
          .map((b) => b.getAttribute("aria-current")),
      ).toEqual([null, null, "true"]);
      expect(open).toHaveFocus();
    });

    it("si el clic no enfocó el botón (Safari/Firefox en macOS) el foco igualmente vuelve a «Ampliar» al cerrar", async () => {
      const user = userEvent.setup();
      setup([image(1), image(2)]);
      const open = screen.getByRole("button", { name: "Ampliar imagen" });
      expect(open).not.toHaveFocus();
      act(() => {
        fireEvent.click(open); // no mueve el foco: activeElement sigue siendo <body>
      });
      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(open).toHaveFocus());
    });

    it("con una sola imagen la ampliación no tiene flechas ni contador", async () => {
      const user = userEvent.setup();
      setup([image(1)]);
      await user.click(screen.getByRole("button", { name: "Ampliar imagen" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).queryByRole("button", { name: "Imagen siguiente" })).toBeNull();
      expect(within(dialog).queryByText(/Imagen 1 de/)).toBeNull();
    });

    it("si la imagen ampliada falla muestra la baldosa provisional", async () => {
      const user = userEvent.setup();
      setup([image(1), image(2)]);
      await user.click(screen.getByRole("button", { name: "Ampliar imagen" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.error(within(dialog).getByRole("img", { name: "Vista 1" }));
      expect(within(dialog).queryByRole("img")).toBeNull();
      expect(within(dialog).getByText("Sin imagen")).toBeInTheDocument();
    });
  });
});

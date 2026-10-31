import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// embla necesita medidas reales de layout (jsdom no las tiene): se sustituye por una API simulada
// para probar NUESTRO código (roles, nombres accesibles, teclado y estado de los botones).
const api = {
  canScrollPrev: vi.fn(() => false),
  canScrollNext: vi.fn(() => true),
  scrollPrev: vi.fn(),
  scrollNext: vi.fn(),
  on: vi.fn((_event: string, _handler: (embla: unknown) => void) => api),
  off: vi.fn((_event: string, _handler: (embla: unknown) => void) => api),
};
vi.mock("embla-carousel-react", () => ({ default: () => [vi.fn(), api] }));

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "./carousel";

function Example({ label }: { label?: string }) {
  return (
    <Carousel {...(label ? { label } : {})}>
      <CarouselContent>
        <CarouselItem>Uno</CarouselItem>
        <CarouselItem>Dos</CarouselItem>
        <CarouselItem>Tres</CarouselItem>
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.canScrollPrev.mockReturnValue(false);
  api.canScrollNext.mockReturnValue(true);
});

describe("Carousel", () => {
  it("es una región 'carrusel' con nombre y cada diapositiva dice cuál es («2 de 3»)", () => {
    render(<Example label="Novedades" />);
    const region = screen.getByRole("region", { name: "Novedades" });
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    const slides = screen.getAllByRole("group");
    expect(slides).toHaveLength(3);
    expect(slides.map((s) => s.getAttribute("aria-label"))).toEqual(["1 de 3", "2 de 3", "3 de 3"]);
    for (const slide of slides) expect(slide).toHaveAttribute("aria-roledescription", "slide");
  });

  it("sin nombre propio usa «Carrusel»", () => {
    render(<Example />);
    expect(screen.getByRole("region", { name: "Carrusel" })).toBeInTheDocument();
  });

  it("los botones se activan según lo que se pueda desplazar", () => {
    render(<Example />);
    expect(screen.getByRole("button", { name: "Anterior" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Siguiente" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("al final del recorrido «Siguiente» se desactiva y «Anterior» se activa", () => {
    api.canScrollPrev.mockReturnValue(true);
    api.canScrollNext.mockReturnValue(false);
    render(<Example />);
    expect(screen.getByRole("button", { name: "Anterior" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(screen.getByRole("button", { name: "Siguiente" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("al cambiar de diapositiva (evento select de embla) los botones se actualizan", () => {
    render(<Example />);
    expect(screen.getByRole("button", { name: "Anterior" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    const onSelect = api.on.mock.calls.find((call) => (call as unknown[])[0] === "select")?.[1] as
      ((embla: typeof api) => void) | undefined;
    expect(onSelect).toBeTypeOf("function");
    api.canScrollPrev.mockReturnValue(true);
    api.canScrollNext.mockReturnValue(false);
    act(() => onSelect!(api));
    expect(screen.getByRole("button", { name: "Anterior" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(screen.getByRole("button", { name: "Siguiente" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("los botones llaman a la API de embla", async () => {
    const user = userEvent.setup();
    api.canScrollPrev.mockReturnValue(true);
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(api.scrollNext).toHaveBeenCalledTimes(1);
    expect(api.scrollPrev).toHaveBeenCalledTimes(1);
  });

  it("un botón sin recorrido (aria-disabled) no llama a embla aunque se active con el teclado", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const prev = screen.getByRole("button", { name: "Anterior" });
    act(() => prev.focus());
    await user.keyboard("{Enter}");
    expect(api.scrollPrev).not.toHaveBeenCalled();
    // sigue enfocado: no se pierde el foco al estar desactivado
    expect(prev).toHaveFocus();
  });

  it("con «reducir movimiento» el desplazamiento salta sin animar (jump = true); sin esa preferencia anima", async () => {
    const user = userEvent.setup();
    api.canScrollPrev.mockReturnValue(true);
    const original = window.matchMedia;
    try {
      render(<Example />);
      await user.click(screen.getByRole("button", { name: "Siguiente" }));
      expect(api.scrollNext).toHaveBeenLastCalledWith(false);
      window.matchMedia = ((query: string) => ({
        matches: query.includes("reduce"),
      })) as unknown as typeof window.matchMedia;
      await user.click(screen.getByRole("button", { name: "Siguiente" }));
      await user.click(screen.getByRole("button", { name: "Anterior" }));
      expect(api.scrollNext).toHaveBeenLastCalledWith(true);
      expect(api.scrollPrev).toHaveBeenLastCalledWith(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("las flechas del teclado desplazan, cada una en su sentido", async () => {
    const user = userEvent.setup();
    render(<Example />);
    screen.getByRole("button", { name: "Siguiente" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(api.scrollNext).toHaveBeenCalledTimes(1);
    expect(api.scrollPrev).not.toHaveBeenCalled();
    await user.keyboard("{ArrowLeft}");
    expect(api.scrollPrev).toHaveBeenCalledTimes(1);
    expect(api.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("se suscribe a los cambios y se da de baja al desmontar (sin fugas)", () => {
    const { unmount } = render(<Example />);
    expect(api.on).toHaveBeenCalledWith("select", expect.any(Function));
    expect(api.on).toHaveBeenCalledWith("reInit", expect.any(Function));
    unmount();
    expect(api.off).toHaveBeenCalledWith("select", expect.any(Function));
    expect(api.off).toHaveBeenCalledWith("reInit", expect.any(Function));
  });

  it("los componentes sueltos fuera de <Carousel> fallan con un mensaje claro", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<CarouselNext />)).toThrow(/dentro de <Carousel>/);
    spy.mockRestore();
  });
});

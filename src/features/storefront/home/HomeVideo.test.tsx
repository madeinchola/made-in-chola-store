import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutVideo, HeroVideo } from "./HomeVideo";

const motion = vi.hoisted(() => ({
  reduced: false,
  saveData: false,
  listeners: new Set<(reduced: boolean) => void>(),
}));
vi.mock("@/lib/motion", () => ({
  prefersReducedMotion: () => motion.reduced,
  prefersSavingData: () => motion.saveData,
  onReducedMotionChange: (listener: (reduced: boolean) => void) => {
    motion.listeners.add(listener);
    return () => motion.listeners.delete(listener);
  },
}));

// jsdom no reproduce medios: se sustituyen play/pause para comprobar CUÁNDO y CUÁNTAS veces se llaman.
let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  motion.reduced = false;
  motion.saveData = false;
  motion.listeners.clear();
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const videoOf = (container: HTMLElement) => container.querySelector("video")!;

describe("HeroVideo", () => {
  it("es de fondo: mudo, en bucle, inline, oculto a los lectores y con el primer fotograma como póster", () => {
    const { container } = render(<HeroVideo src="https://v.test/hero.mp4" />);
    const el = videoOf(container);
    expect(el.muted).toBe(true);
    expect(el.loop).toBe(true);
    expect(el).toHaveAttribute("playsinline");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("preload", "metadata");
    expect(el.getAttribute("src")).toBe("https://v.test/hero.mp4#t=0.001");
    expect(el.controls).toBe(false);
  });

  it("arranca solo (una vez) y su botón ofrece PAUSAR", () => {
    render(<HeroVideo src="https://v.test/hero.mp4" />);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pausar video" })).toBeInTheDocument();
  });

  it("el botón pausa y vuelve a reproducir (WCAG 2.2.2)", () => {
    render(<HeroVideo src="https://v.test/hero.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Pausar video" }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reproducir video" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reproducir video" }));
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Pausar video" })).toBeInTheDocument();
  });

  it("con «reducir movimiento» NO arranca solo: queda en pausa y el botón ofrece reproducir", () => {
    motion.reduced = true;
    render(<HeroVideo src="https://v.test/hero.mp4" />);
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reproducir video" }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("con el ahorro de datos activado NO arranca solo (no descarga el video completo) y puede reproducirse a mano", () => {
    motion.saveData = true;
    render(<HeroVideo src="https://v.test/hero.mp4" />);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reproducir video" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reproducir video" }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("si «reducir movimiento» se activa con la página abierta, se pausa; si se desactiva, no arranca solo", () => {
    render(<HeroVideo src="https://v.test/hero.mp4" />);
    expect(play).toHaveBeenCalledTimes(1);
    act(() => motion.listeners.forEach((listener) => listener(true)));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reproducir video" })).toBeInTheDocument();
    act(() => motion.listeners.forEach((listener) => listener(false)));
    expect(play).toHaveBeenCalledTimes(1); // sigue pausado hasta que la persona lo pida
  });

  it("al desmontar se da de baja del aviso de «reducir movimiento»", () => {
    const { unmount } = render(<HeroVideo src="https://v.test/hero.mp4" />);
    expect(motion.listeners.size).toBe(1);
    unmount();
    expect(motion.listeners.size).toBe(0);
  });

  it("si el navegador bloquea la reproducción automática, queda en pausa y puede reproducirse a mano", async () => {
    play.mockRejectedValueOnce(new DOMException("bloqueado", "NotAllowedError"));
    render(<HeroVideo src="https://v.test/hero.mp4" />);
    expect(await screen.findByRole("button", { name: "Reproducir video" })).toBeInTheDocument();
    expect(pause).toHaveBeenCalled();
  });

  it("un navegador cuyo play() no devuelve promesa tampoco rompe nada", () => {
    play.mockReturnValue(undefined as unknown as Promise<void>);
    render(<HeroVideo src="https://v.test/hero.mp4" />);
    expect(screen.getByRole("button", { name: "Pausar video" })).toBeInTheDocument();
  });

  it("el botón es nativo y alcanzable por teclado (type=button, sin tabindex negativo)", () => {
    render(<HeroVideo src="https://v.test/hero.mp4" />);
    const button = screen.getByRole("button", { name: "Pausar video" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toHaveAttribute("tabindex");
  });
});

describe("AboutVideo", () => {
  it("empieza en pausa: sin controles del navegador, con el botón de reproducir y SIN forzar mudo ni bucle", () => {
    const { container } = render(<AboutVideo src="https://v.test/about.mp4" />);
    const el = videoOf(container);
    expect(el.controls).toBe(false);
    expect(el.muted).toBe(false);
    expect(el.loop).toBe(false);
    expect(el.getAttribute("src")).toBe("https://v.test/about.mp4#t=0.001");
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reproducir video" })).toBeInTheDocument();
  });

  it("al pulsar reproduce, muestra los controles del navegador y retira el botón", () => {
    const { container } = render(<AboutVideo src="https://v.test/about.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Reproducir video" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(videoOf(container).controls).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("si play() falla vuelve a su estado inicial (botón, sin controles)", async () => {
    play.mockRejectedValueOnce(new DOMException("sin soporte", "NotSupportedError"));
    const { container } = render(<AboutVideo src="https://v.test/about.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Reproducir video" }));
    expect(await screen.findByRole("button", { name: "Reproducir video" })).toBeInTheDocument();
    expect(videoOf(container).controls).toBe(false);
  });

  it("al terminar, el botón de reproducir vuelve (se puede ver otra vez)", async () => {
    const { container } = render(<AboutVideo src="https://v.test/about.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "Reproducir video" }));
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.ended(videoOf(container));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reproducir video" })).toBeInTheDocument(),
    );
    expect(videoOf(container).controls).toBe(false);
  });

  it("acepta clases extra sin perder las que lo llenan", () => {
    const { container } = render(
      <AboutVideo src="https://v.test/about.mp4" className="rounded-none" />,
    );
    expect(videoOf(container)).toHaveClass("absolute", "inset-0", "object-cover", "rounded-none");
  });
});

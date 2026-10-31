import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion } from "./motion";

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

describe("prefersReducedMotion", () => {
  it("true cuando el navegador pide reducir el movimiento", () => {
    window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduce") })) as never;
    expect(prefersReducedMotion()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });
  it("false cuando no", () => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as never;
    expect(prefersReducedMotion()).toBe(false);
  });
  it("false (sin lanzar) si el navegador no tiene matchMedia", () => {
    // @ts-expect-error simula un entorno sin matchMedia
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ url: "http://localhost:5173", fail: false }));
vi.mock("@/lib/env", () => ({
  getEnv: () => {
    if (state.fail) throw new Error("sin configuración");
    return { VITE_SITE_URL: state.url };
  },
}));

import { siteUrl } from "./siteUrl";

const originalLocation = window.location;
function servedFrom(origin: string) {
  Object.defineProperty(window, "location", { value: { origin }, configurable: true });
}

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true });
  state.url = "http://localhost:5173";
  state.fail = false;
});

describe("siteUrl", () => {
  it("devuelve el dominio configurado sin barra final", () => {
    state.url = "https://madeinchola.com/";
    expect(siteUrl()).toBe("https://madeinchola.com");
    state.url = "https://madeinchola.com///";
    expect(siteUrl()).toBe("https://madeinchola.com");
  });

  it("en desarrollo y pruebas localhost es un valor legítimo", () => {
    vi.stubEnv("PROD", false);
    expect(siteUrl()).toBe("http://localhost:5173");
  });

  it.each([
    "http://localhost:5173",
    "http://localhost",
    "http://127.0.0.1:4173",
    "https://localhost:3000",
  ])(
    "en producción, %s (sin configurar) se sustituye por el dominio real desde el que se sirve la página",
    (configured) => {
      vi.stubEnv("PROD", true);
      state.url = configured;
      servedFrom("https://tienda.example");
      expect(siteUrl()).toBe("https://tienda.example");
    },
  );

  it("en producción un dominio configurado de verdad se respeta aunque se sirva desde otro (previews)", () => {
    vi.stubEnv("PROD", true);
    state.url = "https://madeinchola.com";
    servedFrom("https://preview-abc.vercel.app");
    expect(siteUrl()).toBe("https://madeinchola.com");
  });

  it("un dominio que solo EMPIEZA como localhost no se confunde con localhost", () => {
    vi.stubEnv("PROD", true);
    state.url = "https://localhost.madeinchola.com";
    servedFrom("https://otro.example");
    expect(siteUrl()).toBe("https://localhost.madeinchola.com");
  });

  it("si la configuración no se puede leer, cae al origen de la página", () => {
    state.fail = true;
    servedFrom("https://respaldo.example");
    expect(siteUrl()).toBe("https://respaldo.example");
  });
});

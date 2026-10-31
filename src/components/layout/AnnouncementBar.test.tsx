import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNewsBanner } from "@/features/catalog/catalogService";
import type { NewsBanner } from "@/features/catalog/types";
import { AnnouncementBar } from "./AnnouncementBar";
import { renderWithApp } from "./layout-test-utils";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getNewsBanner: vi.fn(),
}));

const banner = (over: Partial<NewsBanner> = {}): NewsBanner => ({
  id: "b1",
  message: "Envíos a todo el país",
  linkUrl: null,
  ...over,
});

async function renderBar(value: NewsBanner | null) {
  vi.mocked(getNewsBanner).mockResolvedValue(value);
  const view = renderWithApp(<AnnouncementBar />);
  await waitFor(() => expect(getNewsBanner).toHaveBeenCalled());
  return view;
}

describe("AnnouncementBar", () => {
  beforeEach(() => {
    vi.mocked(getNewsBanner).mockReset();
  });

  it("sin aviso no pinta nada (ni región ni espacio reservado)", async () => {
    const { container } = await renderBar(null);
    await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
    // El único contenido es la sonda de ruta del arnés de pruebas.
    expect(container.querySelectorAll("[role=region]")).toHaveLength(0);
    expect(container.textContent).toBe("/");
    // Ni siquiera un contenedor vacío con altura: lo único en el DOM es la sonda de ruta del arnés.
    expect(container.children).toHaveLength(1);
  });

  it("mientras carga tampoco pinta nada (sin salto de maquetación)", () => {
    vi.mocked(getNewsBanner).mockReturnValue(new Promise(() => {}));
    const { container } = renderWithApp(<AnnouncementBar />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(container.textContent).toBe("/");
    expect(container.children).toHaveLength(1); // sin hueco reservado: la página no salta al llegar el dato
  });

  it("con error del servidor no pinta nada ni rompe", async () => {
    vi.mocked(getNewsBanner).mockRejectedValue(new Error("caído"));
    renderWithApp(<AnnouncementBar />);
    await waitFor(() => expect(getNewsBanner).toHaveBeenCalled());
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("aviso sin enlace: región con nombre y el texto, sin links", async () => {
    await renderBar(banner());
    const region = await screen.findByRole("region", { name: "Aviso de la tienda" });
    expect(region).toHaveTextContent("Envíos a todo el país");
    expect(region).toHaveClass("theme-inverse");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("mensaje en blanco no pinta barra vacía", async () => {
    await renderBar(banner({ message: "   " }));
    await waitFor(() => expect(getNewsBanner).toHaveBeenCalled());
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("ruta interna: enlace del router sin rel ni target", async () => {
    await renderBar(banner({ linkUrl: "/coleccion/verano" }));
    const link = await screen.findByRole("link", { name: "Envíos a todo el país" });
    expect(link).toHaveAttribute("href", "/coleccion/verano");
    expect(link).not.toHaveAttribute("rel");
    expect(link).not.toHaveAttribute("target");
  });

  it("URL externa https: enlace con rel noopener noreferrer", async () => {
    await renderBar(banner({ linkUrl: "https://example.com/promo" }));
    const link = await screen.findByRole("link", { name: "Envíos a todo el país" });
    expect(link).toHaveAttribute("href", "https://example.com/promo");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it.each([["javascript:alert(1)"], ["JAVASCRIPT:alert(1)"], ["//evil.com"], ["data:text/html,x"]])(
    "enlace peligroso %s: NO se convierte en enlace y el texto sigue visible",
    async (linkUrl) => {
      await renderBar(banner({ linkUrl }));
      const region = await screen.findByRole("region", { name: "Aviso de la tienda" });
      expect(region).toHaveTextContent("Envíos a todo el país");
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(region.innerHTML).not.toMatch(/javascript:|evil\.com|data:/i);
    },
  );

  it("un texto largo puede partirse en líneas (no se recorta ni desborda)", async () => {
    await renderBar(banner({ message: "Envío gratis ".repeat(30).trim() }));
    const region = await screen.findByRole("region", { name: "Aviso de la tienda" });
    expect(region.firstElementChild).toHaveClass("text-balance");
    expect(region.className).not.toMatch(/truncate|whitespace-nowrap/);
  });
});

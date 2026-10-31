import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AdminSidebar } from "./AdminSidebar";

const renderSidebar = (collapsed: boolean) =>
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AdminSidebar collapsed={collapsed} onToggleCollapsed={vi.fn()} />
    </MemoryRouter>,
  );

describe("AdminSidebar", () => {
  it("expandida: cada enlace muestra su texto", () => {
    renderSidebar(false);
    const label = screen.getByText("Productos");
    expect(label.className).not.toMatch(/sr-only/);
  });

  it("contraída: el texto solo se oculta en ESCRITORIO (md:), nunca en el cajón móvil", () => {
    renderSidebar(true);
    const label = screen.getByText("Productos");
    expect(label.className).toContain("md:sr-only");
    // sin el prefijo md:, el cajón móvil mostraría solo iconos y el botón para expandir está oculto bajo md
    expect(label.className.split(" ")).not.toContain("sr-only");
    const link = screen.getByRole("link", { name: "Productos" });
    expect(link.className.split(" ")).not.toContain("justify-center");
    expect(link.className).toContain("md:justify-center");
  });

  it("contraída, cada enlace sigue teniendo nombre accesible y título", () => {
    renderSidebar(true);
    for (const name of [
      "Resumen",
      "Productos",
      "Categorías",
      "Colecciones",
      "Monedas",
      "Ajustes",
      "Auditoría",
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Productos" })).toHaveAttribute("title", "Productos");
  });

  it("el botón de contraer/expandir refleja su estado", () => {
    renderSidebar(true);
    expect(screen.getByRole("button", { name: "Expandir menú" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

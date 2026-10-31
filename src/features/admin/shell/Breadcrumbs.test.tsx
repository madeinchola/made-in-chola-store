import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";
import { crumbsFor, pageTitleKey } from "./crumbs";

describe("crumbsFor", () => {
  it("el resumen no tiene migas", () => {
    expect(crumbsFor("/admin")).toEqual([]);
    expect(crumbsFor("/admin/")).toEqual([]);
  });
  it("una sección tiene una miga", () => {
    expect(crumbsFor("/admin/productos")).toEqual([
      { key: "admin.nav.products", to: "/admin/productos" },
    ]);
    expect(crumbsFor("/admin/ajustes")).toEqual([
      { key: "admin.nav.settings", to: "/admin/ajustes" },
    ]);
  });
  it("productos/nuevo y productos/:id añaden su miga", () => {
    expect(crumbsFor("/admin/productos/nuevo").map((c) => c.key)).toEqual([
      "admin.nav.products",
      "admin.products.create.title",
    ]);
    expect(crumbsFor("/admin/productos/abc-123").map((c) => c.key)).toEqual([
      "admin.nav.products",
      "admin.products.edit.crumb",
    ]);
    expect(crumbsFor("/admin/productos/abc-123")[1]?.to).toBe("/admin/productos/abc-123");
  });
  it("una sección desconocida no inventa migas", () => {
    expect(crumbsFor("/admin/pedidos")).toEqual([]);
  });
  it("las demás secciones no heredan la miga de detalle de productos", () => {
    expect(crumbsFor("/admin/categorias/algo")).toHaveLength(1);
  });
});

describe("<Breadcrumbs />", () => {
  const at = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Breadcrumbs />
      </MemoryRouter>,
    );

  it("no pinta nada en el resumen", () => {
    at("/admin");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
  it("la última miga es la página actual (no es un enlace) y las anteriores sí enlazan", () => {
    at("/admin/productos/nuevo");
    const nav = screen.getByRole("navigation", { name: "Ruta de navegación" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Panel" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Productos" })).toHaveAttribute(
      "href",
      "/admin/productos",
    );
    const current = screen.getByText("Nuevo producto");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Nuevo producto" })).not.toBeInTheDocument();
  });
});

describe("pageTitleKey (título de la pestaña)", () => {
  it("el resumen se llama 'Resumen'", () => {
    expect(pageTitleKey("/admin")).toBe("admin.nav.dashboard");
  });
  it("una sección usa su nombre", () => {
    expect(pageTitleKey("/admin/productos")).toBe("admin.nav.products");
    expect(pageTitleKey("/admin/auditoria")).toBe("admin.nav.audit");
  });
  it("una pantalla de detalle usa su propio nombre, no el de la sección", () => {
    expect(pageTitleKey("/admin/productos/nuevo")).toBe("admin.products.create.title");
    expect(pageTitleKey("/admin/productos/abc")).toBe("admin.products.edit.crumb");
  });
  it("una ruta desconocida cae al resumen (nunca queda sin título)", () => {
    expect(pageTitleKey("/admin/pedidos")).toBe("admin.nav.dashboard");
  });
});

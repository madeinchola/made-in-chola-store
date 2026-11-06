import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "../shell/nav";
import { crumbsFor } from "../shell/crumbs";
import { ShippingLayout } from "./ShippingLayout";
import { SHIPPING_TABS } from "./tabs";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/envios" element={<ShippingLayout />}>
          <Route index element={<p>contenido de tienda</p>} />
          <Route path="zonas" element={<p>contenido de zonas</p>} />
          <Route path="tarifas" element={<p>contenido de tarifas</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("ShippingLayout", () => {
  it("un único h1 y las 5 secciones como enlaces con su dirección", () => {
    renderAt("/admin/envios");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Envíos y entregas" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Secciones de envíos" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Tienda y métodos", "/admin/envios"],
      ["Zonas", "/admin/envios/zonas"],
      ["Tarifas", "/admin/envios/tarifas"],
      ["Entregas", "/admin/envios/entregas"],
      ["Simulador", "/admin/envios/simulador"],
    ]);
  });
  it("solo la sección actual está marcada (aria-current) y se pinta su contenido", () => {
    renderAt("/admin/envios/zonas");
    const nav = screen.getByRole("navigation", { name: "Secciones de envíos" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["Zonas"]);
    expect(screen.getByText("contenido de zonas")).toBeInTheDocument();
    expect(screen.queryByText("contenido de tienda")).not.toBeInTheDocument();
  });
  it("«Tienda y métodos» (la raíz) no queda marcada cuando se está en otra sección", () => {
    renderAt("/admin/envios/tarifas");
    expect(screen.getByRole("link", { name: "Tienda y métodos" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Tarifas" })).toHaveAttribute("aria-current", "page");
  });
  it("cada enlace mide al menos 44 px de alto (objetivo táctil)", () => {
    renderAt("/admin/envios");
    for (const link of screen.getAllByRole("link")) expect(link.className).toContain("min-h-11");
  });
});

describe("integración con el panel", () => {
  it("«Envíos» está en el menú lateral, apuntando a /admin/envios", () => {
    expect(ADMIN_NAV.find((n) => n.to === "/admin/envios")?.label).toBe("admin.nav.shipping");
  });
  it("las migas de pan de /admin/envios y de sus secciones", () => {
    expect(crumbsFor("/admin/envios").map((c) => c.key)).toEqual(["admin.nav.shipping"]);
    expect(crumbsFor("/admin/envios/tarifas").map((c) => c.key)).toEqual(["admin.nav.shipping"]);
  });
  it("las secciones del marco son exactamente las rutas que declara el enrutador", async () => {
    const { routes } = await import("@/app/router");
    const admin = routes.find((r) => r.path === "admin");
    const shipping = admin?.children?.[0]?.children?.find((r) => r.path === "envios");
    const paths = (shipping?.children ?? []).map((c) => (c.index ? "" : `/${c.path}`));
    expect(paths.sort()).toEqual(
      SHIPPING_TABS.map((t) => t.to.replace("/admin/envios", "")).sort(),
    );
  });
});

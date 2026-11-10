import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "../shell/nav";
import { crumbsFor } from "../shell/crumbs";
import { DiscountsLayout } from "./DiscountsLayout";
import { DISCOUNTS_TABS } from "./tabs";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/descuentos" element={<DiscountsLayout />}>
          <Route index element={<p>contenido de descuentos</p>} />
          <Route path="redenciones" element={<p>contenido de redenciones</p>} />
          <Route path="grupos" element={<p>contenido de grupos</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("DiscountsLayout", () => {
  it("un único h1 y las 3 secciones como enlaces con su dirección", () => {
    renderAt("/admin/descuentos");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Descuentos y cupones" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Secciones de descuentos" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => [l.textContent, l.getAttribute("href")]),
    ).toEqual([
      ["Descuentos", "/admin/descuentos"],
      ["Redenciones", "/admin/descuentos/redenciones"],
      ["Grupos de clientes", "/admin/descuentos/grupos"],
    ]);
  });
  it("solo la sección actual está marcada (aria-current) y se pinta su contenido", () => {
    renderAt("/admin/descuentos/grupos");
    const nav = screen.getByRole("navigation", { name: "Secciones de descuentos" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["Grupos de clientes"]);
    expect(screen.getByText("contenido de grupos")).toBeInTheDocument();
    expect(screen.queryByText("contenido de descuentos")).not.toBeInTheDocument();
  });
  it("«Descuentos» (la raíz) no queda marcada cuando se está en otra sección", () => {
    renderAt("/admin/descuentos/redenciones");
    expect(screen.getByRole("link", { name: "Descuentos" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Redenciones" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it("cada enlace mide al menos 44 px de alto (objetivo táctil)", () => {
    renderAt("/admin/descuentos");
    for (const link of screen.getAllByRole("link")) expect(link.className).toContain("min-h-11");
  });
});

describe("Descuentos en el menú y las migas", () => {
  it("el menú lleva «Descuentos» hacia /admin/descuentos, entre Envíos y Ajustes", () => {
    const labels = ADMIN_NAV.map((n) => n.to);
    expect(labels).toContain("/admin/descuentos");
    expect(labels.indexOf("/admin/descuentos")).toBe(labels.indexOf("/admin/envios") + 1);
    expect(labels.indexOf("/admin/descuentos")).toBeLessThan(labels.indexOf("/admin/ajustes"));
  });
  it("las migas de cualquier sección de descuentos empiezan por «Descuentos»", () => {
    for (const tab of DISCOUNTS_TABS) {
      expect(crumbsFor(tab.to)).toEqual([{ key: "admin.nav.discounts", to: "/admin/descuentos" }]);
    }
  });
});

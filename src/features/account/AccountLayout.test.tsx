import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { asCustomer, WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { AccountLayout } from "./AccountLayout";

function renderAt(path: string, auth: AuthContextValue = asCustomer()) {
  return render(
    <WithAuth value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/cuenta" element={<AccountLayout />}>
            <Route index element={<p>contenido del perfil</p>} />
            <Route path="direcciones" element={<p>contenido de direcciones</p>} />
            <Route path="datos-fiscales" element={<p>contenido fiscal</p>} />
            <Route path="pedidos" element={<p>contenido de pedidos</p>} />
            <Route path="pedidos/:orderId" element={<p>detalle de pedido</p>} />
            <Route path="seguridad" element={<p>contenido de seguridad</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </WithAuth>,
  );
}

const nav = () => screen.getByRole("navigation", { name: "Secciones de mi cuenta" });

describe("AccountLayout", () => {
  it("título (único h1), saludo con el nombre y el contenido de la sección", () => {
    renderAt("/cuenta");
    expect(screen.getByRole("heading", { level: 1, name: "Mi cuenta" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Hola, Ana Cliente")).toBeInTheDocument();
    expect(screen.getByText("contenido del perfil")).toBeInTheDocument();
  });

  it("sin nombre (perfil aún no cargado) no pinta un saludo vacío", () => {
    renderAt("/cuenta", asCustomer({ profile: null }));
    expect(screen.queryByText(/^Hola/)).not.toBeInTheDocument();
  });

  it("la navegación tiene las 5 secciones, en este orden y con estas rutas", () => {
    renderAt("/cuenta");
    const links = within(nav()).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Perfil", "/cuenta"],
      ["Direcciones", "/cuenta/direcciones"],
      ["Datos fiscales", "/cuenta/datos-fiscales"],
      ["Mis pedidos", "/cuenta/pedidos"],
      ["Seguridad", "/cuenta/seguridad"],
    ]);
  });

  it("marca como página actual SOLO la sección en la que estás (Perfil no queda marcado en las demás)", () => {
    renderAt("/cuenta/direcciones");
    const current = within(nav())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Direcciones"]);
  });

  it("en el detalle de un pedido sigue marcada «Mis pedidos»", () => {
    renderAt("/cuenta/pedidos/abc");
    expect(screen.getByText("detalle de pedido")).toBeInTheDocument();
    const current = within(nav())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Mis pedidos"]);
  });

  it("navegar con los enlaces cambia el contenido sin recargar y mueve la marca", async () => {
    const user = userEvent.setup();
    renderAt("/cuenta");
    await user.click(within(nav()).getByRole("link", { name: "Seguridad" }));
    expect(screen.getByText("contenido de seguridad")).toBeInTheDocument();
    expect(screen.queryByText("contenido del perfil")).not.toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: "Seguridad" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav()).getByRole("link", { name: "Perfil" })).not.toHaveAttribute("aria-current");
  });

  it("el nombre se pinta como texto (nunca como HTML)", () => {
    renderAt(
      "/cuenta",
      asCustomer({
        profile: { ...asCustomer().profile!, full_name: "<img src=x onerror=alert(1)>" },
      }),
    );
    expect(screen.getByText("Hola, <img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { OrderDetailPage, OrderDetailView } from "./OrderDetailPage";
import type { OrderDetail } from "./types";

const ORDER: OrderDetail = {
  id: "o-1",
  number: "MIC-000123",
  createdAt: "2026-10-30T15:30:00Z",
  status: "shipped",
  total: money(25100, "BOB"),
  items: [
    {
      id: "l-1",
      name: "Chaqueta de lana",
      variant: "Negro · M",
      quantity: 2,
      total: money(20000, "BOB"),
    },
    { id: "l-2", name: "Sombrero", variant: null, quantity: 1, total: money(5100, "BOB") },
  ],
  shipping: { label: "Entrega a domicilio", address: "Calle Uno 123, La Paz" },
  payment: { label: "Transferencia bancaria" },
};

const renderAt = (path: string, ui: React.ReactElement = <OrderDetailPage />) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/cuenta/pedidos/:orderId" element={ui} />
      </Routes>
    </MemoryRouter>,
  );

describe("OrderDetailPage (hoy: ningún pedido existe hasta S10)", () => {
  it.each(["abc", "o-1", "00000000-0000-0000-0000-000000000000", "%3Cscript%3E", "a%2Fb"])(
    "el id «%s» muestra «Pedido no encontrado» con camino de vuelta",
    (id) => {
      renderAt(`/cuenta/pedidos/${id}`);
      expect(screen.getByRole("status")).toHaveTextContent("Pedido no encontrado");
      expect(screen.getByRole("link", { name: "Volver a mis pedidos" })).toHaveAttribute(
        "href",
        "/cuenta/pedidos",
      );
    },
  );

  it("no repite el id de la URL en la pantalla", () => {
    renderAt("/cuenta/pedidos/secreto-123");
    expect(document.body).not.toHaveTextContent("secreto-123");
  });

  it("tiene migas: Mi cuenta › Mis pedidos › (página actual)", () => {
    renderAt("/cuenta/pedidos/abc");
    const nav = screen.getByRole("navigation", { name: "Ruta de tu pedido" });
    expect(within(nav).getByRole("link", { name: "Mi cuenta" })).toHaveAttribute("href", "/cuenta");
    expect(within(nav).getByRole("link", { name: "Mis pedidos" })).toHaveAttribute(
      "href",
      "/cuenta/pedidos",
    );
    expect(within(nav).getByText("Detalle del pedido")).toHaveAttribute("aria-current", "page");
  });
});

describe("OrderDetailView (estructura preparada para S10)", () => {
  it("cabecera: número, estado con texto y fecha", () => {
    renderAt("/cuenta/pedidos/o-1", <OrderDetailView order={ORDER} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Pedido MIC-000123" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Enviado")).toBeInTheDocument();
    expect(screen.getByText(/Realizado el/)).toHaveTextContent(/30.*oct.*2026/i);
  });

  it("migas con la página actual marcada", () => {
    renderAt("/cuenta/pedidos/o-1", <OrderDetailView order={ORDER} />);
    const nav = screen.getByRole("navigation", { name: "Ruta de tu pedido" });
    expect(within(nav).getByText("Pedido MIC-000123")).toHaveAttribute("aria-current", "page");
  });

  it("artículos con variante, cantidad y total; envío; pago; y el total del pedido", () => {
    renderAt("/cuenta/pedidos/o-1", <OrderDetailView order={ORDER} />);
    const items = screen
      .getAllByRole("listitem")
      .filter((li) => li.closest("ul") && li.textContent?.includes("Cantidad"));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Chaqueta de lana");
    expect(items[0]).toHaveTextContent("Negro · M");
    expect(items[0]).toHaveTextContent("Cantidad: 2");
    expect(items[0]).toHaveTextContent("Bs 200,00");
    expect(items[1]).toHaveTextContent("Sombrero");
    expect(items[1]).toHaveTextContent("Bs 51,00");
    expect(screen.getByText("Entrega a domicilio")).toBeInTheDocument();
    expect(screen.getByText("Calle Uno 123, La Paz")).toBeInTheDocument();
    expect(screen.getByText("Transferencia bancaria")).toBeInTheDocument();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("Bs 251,00");
  });

  it("secciones sin datos dicen que no hay información (no quedan vacías)", () => {
    renderAt(
      "/cuenta/pedidos/o-1",
      <OrderDetailView order={{ ...ORDER, items: [], shipping: null, payment: null }} />,
    );
    expect(screen.getByText("Este pedido no tiene artículos.")).toBeInTheDocument();
    expect(screen.getByText("Sin información de envío.")).toBeInTheDocument();
    expect(screen.getByText("Sin información de pago.")).toBeInTheDocument();
  });

  it("envío sin dirección no deja un hueco", () => {
    renderAt(
      "/cuenta/pedidos/o-1",
      <OrderDetailView
        order={{ ...ORDER, shipping: { label: "Recojo en tienda", address: null } }}
      />,
    );
    expect(screen.getByText("Recojo en tienda")).toBeInTheDocument();
    expect(screen.queryByText("Calle Uno 123, La Paz")).not.toBeInTheDocument();
  });
});

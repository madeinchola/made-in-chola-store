import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { OrderListItem } from "./OrderListItem";
import { ORDER_STATUSES, type OrderStatus, type OrderSummary } from "./types";

const ORDER_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  preparing: "En preparación",
  shipped: "Enviado",
  delivered: "Entregado",
  completed: "Completado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

const ORDER: OrderSummary = {
  id: "o-1",
  number: "MIC-000123",
  createdAt: "2026-10-30T15:30:00Z", // 11:30 en La Paz (UTC−4): el mismo día
  status: "paid",
  total: money(12550, "BOB"), // 125,50
};

function renderItem(order: OrderSummary) {
  return render(
    <MemoryRouter>
      <ul>
        <OrderListItem order={order} />
      </ul>
    </MemoryRouter>,
  );
}

describe("OrderListItem", () => {
  it("muestra número, fecha, estado y total, con un único enlace al detalle del pedido", () => {
    renderItem(ORDER);
    const link = screen.getByRole("link", { name: "Pedido MIC-000123" });
    expect(link).toHaveAttribute("href", "/cuenta/pedidos/o-1");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("Pagado")).toBeInTheDocument();
    // 12550 centavos → «Bs 125,50» (formato español: coma decimal)
    expect(screen.getByRole("listitem")).toHaveTextContent("Bs 125,50");
    expect(screen.getByText("Total:", { exact: false })).toBeInTheDocument();
  });

  it("la fecha está en hora de La Paz (UTC−4): a las 02:00 UTC todavía es el día anterior", () => {
    renderItem({ ...ORDER, createdAt: "2026-10-31T02:00:00Z" }); // 22:00 del 30 en La Paz
    const time = screen.getByRole("listitem").querySelector("time") as HTMLTimeElement;
    expect(time).toHaveAttribute("datetime", "2026-10-31T02:00:00Z");
    expect(time.textContent).toMatch(/^30\b.*\boct\b.*2026$/i);
  });

  it.each<[OrderStatus, string]>([
    ["pending_payment", "Pendiente de pago"],
    ["paid", "Pagado"],
    ["preparing", "En preparación"],
    ["shipped", "Enviado"],
    ["delivered", "Entregado"],
    ["completed", "Completado"],
    ["cancelled", "Cancelado"],
    ["refunded", "Reembolsado"],
  ])("el estado %s se escribe con texto: %s", (status, label) => {
    renderItem({ ...ORDER, status });
    expect(within(screen.getByRole("listitem")).getByText(label)).toBeInTheDocument();
  });

  it.each<[OrderStatus, string]>([
    ["pending_payment", "bg-warning-soft"],
    ["paid", "bg-info-soft"],
    ["preparing", "bg-info-soft"],
    ["shipped", "bg-info-soft"],
    ["delivered", "bg-success-soft"],
    ["completed", "bg-success-soft"],
    ["cancelled", "bg-destructive-soft"],
    ["refunded", "bg-muted"],
  ])(
    "el estado %s usa el tono %s (con tokens, y el texto sigue diciendo el estado)",
    (status, tone) => {
      renderItem({ ...ORDER, status });
      const badge = within(screen.getByRole("listitem")).getByText(ORDER_LABELS[status]);
      expect(badge.className).toContain(tone);
    },
  );

  it("cubre todos los estados de BR-ORD-01", () => {
    expect(ORDER_STATUSES).toHaveLength(8);
  });

  it("un estado que no se conoce se muestra como «Estado desconocido» (no se pinta el valor crudo)", () => {
    renderItem({ ...ORDER, status: "teletransportado" as OrderStatus });
    expect(screen.getByText("Estado desconocido")).toBeInTheDocument();
    expect(screen.queryByText("teletransportado")).not.toBeInTheDocument();
  });

  it("una fecha inválida o una moneda no soportada NO rompen la fila: se muestra «—»", () => {
    renderItem({ ...ORDER, createdAt: "no-es-fecha", total: { amount: 100, currency: "XXX" } });
    const item = screen.getByRole("listitem");
    expect(within(item).getByText(/Realizado el/)).toHaveTextContent("Realizado el —");
    expect(item).toHaveTextContent("Total: —");
  });

  it("el id va codificado en la URL (sin romper la ruta)", () => {
    renderItem({ ...ORDER, id: "a/b c?" });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/cuenta/pedidos/a%2Fb%20c%3F");
  });

  it("el texto de un número largo o con marcado se escribe como texto, no como HTML", () => {
    renderItem({ ...ORDER, number: "<img src=x onerror=alert(1)>" });
    expect(screen.getByRole("link")).toHaveTextContent("Pedido <img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
  });
});

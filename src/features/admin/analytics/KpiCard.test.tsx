import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiCard } from "./KpiCard";

const mount = (props: Parameters<typeof KpiCard>[0]) =>
  render(
    <dl>
      <KpiCard {...props} />
    </dl>,
  );
const delta = () => screen.getByText(/frente al período anterior/);

describe("KpiCard: el cambio se dice con signo y texto, y su color depende de qué sentido es bueno", () => {
  it("más ventas (bueno cuando sube) se pinta como bueno y lleva su signo", () => {
    mount({ label: "Ventas netas", value: "Bs 100,00", delta: { pct: 12.5, goodWhen: "up" } });
    expect(delta()).toHaveTextContent("+12,5 % frente al período anterior");
    expect(delta().className).toContain("text-success");
  });
  it("menos ventas se pinta como malo", () => {
    mount({ label: "Ventas netas", value: "Bs 100,00", delta: { pct: -3, goodWhen: "up" } });
    expect(delta()).toHaveTextContent("−3,0 % frente al período anterior");
    expect(delta().className).toContain("text-destructive");
  });
  it("más reembolsos (bueno cuando baja) se pinta como malo; menos, como bueno", () => {
    const { unmount } = mount({
      label: "Reembolsos",
      value: "Bs 10,00",
      delta: { pct: 20, goodWhen: "down" },
    });
    expect(delta().className).toContain("text-destructive");
    unmount();
    mount({ label: "Reembolsos", value: "Bs 10,00", delta: { pct: -20, goodWhen: "down" } });
    expect(delta().className).toContain("text-success");
  });
  it("lo neutro (descuentos) y lo que no cambió no se pintan ni de bueno ni de malo", () => {
    const { unmount } = mount({
      label: "Descuentos",
      value: "Bs 5,00",
      delta: { pct: 50, goodWhen: "neutral" },
    });
    expect(delta().className).toContain("text-muted-foreground");
    unmount();
    mount({ label: "Pedidos", value: "5", delta: { pct: 0, goodWhen: "up" } });
    expect(delta()).toHaveTextContent("0,0 % frente al período anterior");
    expect(delta().className).toContain("text-muted-foreground");
  });
  it("sin período anterior no inventa un porcentaje", () => {
    mount({ label: "Pedidos", value: "5", delta: { pct: null, goodWhen: "up" } });
    expect(screen.getByText("Sin datos del período anterior")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
  it("una advertencia sobre el número lo marca y se lee; la ayuda también", () => {
    const { container } = mount({
      label: "Margen",
      value: "Bs 50,00",
      tone: "warn",
      note: "Solo 4 de 5 pedidos tienen costo",
      hint: "49,1 % de las ventas",
    });
    expect(screen.getByText("Solo 4 de 5 pedidos tienen costo")).toBeInTheDocument();
    expect(screen.getByText("49,1 % de las ventas")).toBeInTheDocument();
    expect(container.firstElementChild?.firstElementChild?.className).toContain("bg-warning-soft");
  });
});

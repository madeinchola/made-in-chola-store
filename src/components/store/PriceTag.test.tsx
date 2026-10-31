import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { PriceTag } from "./PriceTag";

describe("PriceTag", () => {
  it("formatea el precio con símbolo y separadores en español", () => {
    render(<PriceTag price={money(123450, "BOB")} />);
    expect(screen.getByText("Bs 1.234,50")).toBeInTheDocument();
  });

  it("muestra 0 como Bs 0,00", () => {
    render(<PriceTag price={money(0, "BOB")} />);
    expect(screen.getByText("Bs 0,00")).toBeInTheDocument();
  });

  it("con símbolo ancho (AR$) y monto grande no parte la línea del importe", () => {
    render(<PriceTag price={money(99999999, "ARS")} />);
    const amount = screen.getByText("AR$ 999.999,99");
    expect(amount).toHaveClass("whitespace-nowrap");
    expect(amount.parentElement).toHaveClass("tabular-nums");
  });

  it("con precio anterior mayor: lo tacha y anuncia ambos precios", () => {
    const { container } = render(
      <PriceTag price={money(8000, "BOB")} compareAt={money(10000, "BOB")} />,
    );
    const struck = container.querySelector("s");
    expect(struck).toHaveTextContent("Bs 100,00");
    expect(screen.getByText(/Precio anterior:/)).toHaveClass("sr-only");
    expect(screen.getByText(/Precio actual:/)).toHaveClass("sr-only");
    expect(screen.getByText("Bs 80,00")).toBeInTheDocument();
  });

  it.each([
    ["igual al precio", money(8000, "BOB")],
    ["menor que el precio", money(5000, "BOB")],
  ])("ignora el precio anterior %s", (_name, compareAt) => {
    const { container } = render(<PriceTag price={money(8000, "BOB")} compareAt={compareAt} />);
    expect(container.querySelector("s")).toBeNull();
    expect(screen.queryByText(/Precio anterior/)).toBeNull();
    expect(screen.getByText("Bs 80,00")).toBeInTheDocument();
  });

  it("ignora (sin lanzar) un precio anterior de otra moneda", () => {
    const { container } = render(
      <PriceTag price={money(8000, "BOB")} compareAt={money(99900, "USD")} />,
    );
    expect(container.querySelector("s")).toBeNull();
    expect(screen.getByText("Bs 80,00")).toBeInTheDocument();
  });

  it("aplica el tamaño pedido", () => {
    const { rerender, container } = render(<PriceTag price={money(100, "BOB")} size="sm" />);
    expect(container.firstElementChild).toHaveClass("text-sm");
    rerender(<PriceTag price={money(100, "BOB")} size="lg" />);
    expect(container.firstElementChild).toHaveClass("text-xl");
    rerender(<PriceTag price={money(100, "BOB")} />);
    expect(container.firstElementChild).toHaveClass("text-base");
  });
});

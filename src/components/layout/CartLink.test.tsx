import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CartLink } from "./CartLink";
import { renderWithApp } from "./layout-test-utils";

describe("CartLink", () => {
  it("sin productos: enlace «Bolsa» a /carrito y el «(0)» visible del diseño", () => {
    renderWithApp(<CartLink count={0} />);
    const link = screen.getByRole("link", { name: "Bolsa" });
    expect(link).toHaveAttribute("href", "/carrito");
    expect(screen.getByTestId("cart-count")).toHaveTextContent(/^\(0\)$/);
  });

  it("un producto: nombre en singular y «(1)»", () => {
    renderWithApp(<CartLink count={1} />);
    expect(screen.getByRole("link", { name: "Bolsa, 1 producto" })).toBeInTheDocument();
    expect(screen.getByTestId("cart-count")).toHaveTextContent(/^\(1\)$/);
  });

  it("5 productos: «(5)» y nombre accesible con el número exacto", () => {
    renderWithApp(<CartLink count={5} />);
    expect(screen.getByRole("link", { name: "Bolsa, 5 productos" })).toBeInTheDocument();
    expect(screen.getByTestId("cart-count")).toHaveTextContent(/^\(5\)$/);
  });

  it("99 productos: aún muestra «(99)»", () => {
    renderWithApp(<CartLink count={99} />);
    expect(screen.getByTestId("cart-count")).toHaveTextContent(/^\(99\)$/);
    expect(screen.getByRole("link", { name: "Bolsa, 99 productos" })).toBeInTheDocument();
  });

  it("100 productos: lo visible dice «(99+)» pero el nombre accesible da el número exacto", () => {
    renderWithApp(<CartLink count={100} />);
    expect(screen.getByTestId("cart-count")).toHaveTextContent(/^\(99\+\)$/);
    expect(screen.getByRole("link", { name: "Bolsa, 100 productos" })).toBeInTheDocument();
  });

  it("124 productos: «(99+)» visible y «Bolsa, 124 productos» para lectores de pantalla", () => {
    renderWithApp(<CartLink count={124} />);
    expect(screen.getByTestId("cart-count")).toHaveTextContent(/^\(99\+\)$/);
    expect(screen.getByRole("link", { name: "Bolsa, 124 productos" })).toBeInTheDocument();
  });

  it("el contador visible es decorativo (aria-hidden: no se lee dos veces) y con cifras tabulares", () => {
    renderWithApp(<CartLink count={7} />);
    const counter = screen.getByTestId("cart-count");
    expect(counter).toHaveAttribute("aria-hidden", "true");
    expect(counter).toHaveClass("tabular-nums");
  });

  it("valores raros (NaN, negativos, infinito) cuentan como 0", () => {
    for (const bad of [Number.NaN, -3, Number.POSITIVE_INFINITY]) {
      const { unmount } = renderWithApp(<CartLink count={bad} />);
      expect(screen.getByTestId("cart-count")).toHaveTextContent(/^\(0\)$/);
      expect(screen.getByRole("link", { name: "Bolsa" })).toBeInTheDocument();
      unmount();
    }
  });
});

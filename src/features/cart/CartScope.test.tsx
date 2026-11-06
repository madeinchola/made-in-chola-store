import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeAuth, WithAuth } from "@/test/auth-test-utils";
import { useCart } from "./cart-context";
import { CartProvider } from "./CartProvider";
import { CartScope } from "./CartScope";
import { FakeCartServer } from "./cart-test-utils";
import { memoryCartStorage } from "./storage";

const seen: { name: string; store: unknown }[] = [];
function Probe({ name }: { name: string }) {
  const { store } = useCart();
  seen.push({ name, store });
  return <p>{name}: con carrito</p>;
}

describe("CartScope", () => {
  it("sin un carrito más arriba monta uno propio: lo de dentro puede usar useCart()", () => {
    seen.length = 0;
    render(
      <WithAuth value={fakeAuth()}>
        <CartScope>
          <Probe name="interno" />
        </CartScope>
      </WithAuth>,
    );
    expect(screen.getByText("interno: con carrito")).toBeInTheDocument();
  });

  it("con un carrito más arriba REUTILIZA ese (el mismo almacén), no crea un segundo", () => {
    seen.length = 0;
    const server = new FakeCartServer(null);
    render(
      <WithAuth value={fakeAuth()}>
        <CartProvider api={server.api} storage={memoryCartStorage()}>
          <Probe name="fuera" />
          <CartScope>
            <Probe name="dentro" />
          </CartScope>
        </CartProvider>
      </WithAuth>,
    );
    const outer = seen.find((s) => s.name === "fuera")!;
    const inner = seen.find((s) => s.name === "dentro")!;
    expect(inner.store).toBe(outer.store);
  });
});

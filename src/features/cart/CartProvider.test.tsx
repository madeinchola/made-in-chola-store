import type { ReactElement } from "react";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { subscribeToTracking, type TrackEvent } from "@/features/storefront/analytics/track";
import { WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { CartProvider } from "./CartProvider";
import type { CartContextValue } from "./cart-context";
import {
  CartSpy,
  failure,
  FakeCartServer,
  flush,
  makeLine,
  makeSnapshot,
  signedIn,
} from "./cart-test-utils";
import { memoryCartStorage } from "./storage";

const withToken = (accessToken: string): AuthContextValue =>
  signedIn({
    session: { user: { id: "user-1" }, access_token: accessToken } as unknown as Session,
  });

function mount() {
  const server = new FakeCartServer(null);
  const storage = memoryCartStorage();
  const cart: { current: CartContextValue | null } = { current: null };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (auth: AuthContextValue): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <WithAuth value={auth}>
        <MemoryRouter>
          <CartProvider api={server.api} storage={storage}>
            <CartSpy into={cart} />
          </CartProvider>
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>
  );
  const view = render(tree(withToken("tok-1")));
  return { server, cart: () => cart.current as CartContextValue, view, tree };
}

/** Como `mount()`, pero con el servidor de mentira que se le pase (ya con una bolsa). */
function mountWith(server: FakeCartServer) {
  const cart: { current: CartContextValue | null } = { current: null };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WithAuth value={withToken("tok-1")}>
        <MemoryRouter>
          <CartProvider api={server.api} storage={memoryCartStorage()}>
            <CartSpy into={cart} />
          </CartProvider>
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
  return { cart: () => cart.current as CartContextValue, view };
}

const setItems = (server: FakeCartServer) => server.calls.filter((c) => c.action === "set_item");

describe("CartProvider · sesión renovada", () => {
  it("lo que quedó esperando por una sesión vencida (401) se reenvía solo cuando se renueva el token de acceso", async () => {
    const { server, cart, view, tree } = mount();
    await flush();
    server.forced = failure(401, "invalid_session"); // el servidor rechaza la sesión
    act(() => cart().store.setQty("a", 2));
    await flush();
    expect(setItems(server)).toHaveLength(1);
    expect(cart().state.sync).toMatchObject({ state: "error", code: "session" });
    expect(cart().state.pending).toEqual({ a: 2 }); // el cambio no se perdió

    // Mismo usuario, token renovado por Auth, y el servidor ya acepta: se reintenta sin que la persona haga nada.
    server.forced = null;
    view.rerender(tree(withToken("tok-2")));
    await flush();
    expect(setItems(server)).toHaveLength(2);
    expect(setItems(server)[1]).toMatchObject({ action: "set_item", variant_id: "a", qty: 2 });
    expect(cart().state.pending).toEqual({});
    expect(cart().state.sync.state).toBe("idle");
  });

  it("si el token no cambia, repintar no dispara ninguna petición", async () => {
    const { server, cart, view, tree } = mount();
    await flush();
    server.forced = failure(401, "invalid_session");
    act(() => cart().store.setQty("a", 2));
    await flush();
    const before = server.calls.length;
    server.forced = null;
    view.rerender(tree(withToken("tok-1"))); // el mismo token
    await flush();
    expect(server.calls).toHaveLength(before);
  });
});

describe("CartProvider · evento remove_from_cart", () => {
  const events: TrackEvent[] = [];
  let off: () => void;
  beforeEach(() => {
    events.length = 0;
    off = subscribeToTracking((event) => events.push(event));
  });
  afterEach(() => off());

  it.each(["BOB", "USD"])(
    "lleva la moneda de la BOLSA (%s), no una fija, junto al precio y la cantidad de la línea",
    async (currency) => {
      const server = new FakeCartServer(
        makeSnapshot([makeLine("a", 3, { name: "Falda", unit_price: 250, line_total: 750 })], {
          currency,
        }),
      );
      const { cart } = mountWith(server);
      await flush();
      act(() => cart().store.remove("a"));
      await flush();
      expect(events.filter((event) => event.name === "remove_from_cart")).toEqual([
        {
          name: "remove_from_cart",
          quantity: 3,
          item: { id: "p-a", name: "Falda", price: 250, currency },
        },
      ]);
    },
  );
});

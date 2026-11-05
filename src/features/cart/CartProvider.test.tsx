import type { ReactElement } from "react";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { CartProvider } from "./CartProvider";
import type { CartContextValue } from "./cart-context";
import { CartSpy, failure, FakeCartServer, flush, signedIn } from "./cart-test-utils";
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

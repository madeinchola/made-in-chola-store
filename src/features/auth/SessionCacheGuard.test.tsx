import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { AuthContextValue } from "./auth-context";
import { SessionCacheGuard } from "./SessionCacheGuard";
import { fakeAuth, WithAuth } from "@/test/auth-test-utils";

const sessionOf = (id: string | null) =>
  (id ? { user: { id }, access_token: "t" } : null) as AuthContextValue["session"];

function Secret({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["account", id],
    queryFn: async () => `datos de ${id}`,
    staleTime: 60_000,
  });
  return <p data-testid="secret">{q.data ?? "—"}</p>;
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (userId: string | null) => (
    <QueryClientProvider client={client}>
      <WithAuth value={fakeAuth({ session: sessionOf(userId) })}>
        <SessionCacheGuard />
        {userId && <Secret id={userId} />}
      </WithAuth>
    </QueryClientProvider>
  );
  return { client, view };
}

describe("SessionCacheGuard", () => {
  it("al cerrar la sesión vacía los datos de la persona anterior", async () => {
    const { client, view } = setup();
    const { rerender, findByText } = render(view("u1"));
    await findByText("datos de u1");
    expect(client.getQueryData(["account", "u1"])).toBe("datos de u1");
    await act(async () => {
      rerender(view(null));
    });
    expect(client.getQueryData(["account", "u1"])).toBeUndefined();
  });

  it("al cambiar de usuario en la misma pestaña no queda nada del anterior: ni lo que se veía ni lo que estaba en caché", async () => {
    const { client, view } = setup();
    const { rerender, findByText, queryByText } = render(view("u1"));
    await findByText("datos de u1");
    client.setQueryData(["account", "pedidos"], "pedidos de u1"); // datos de una pantalla que ya no está abierta
    await act(async () => {
      rerender(view("u2"));
    });
    await findByText("datos de u2");
    expect(queryByText("datos de u1")).not.toBeInTheDocument();
    expect(client.getQueryData(["account", "pedidos"])).toBeUndefined();
    expect(client.getQueryData(["account", "u2"])).toBe("datos de u2");
  });

  it("el PRIMER inicio de sesión (de anónimo a usuario) no vacía la caché pública", async () => {
    const { client, view } = setup();
    client.setQueryData(["catalog", "banner"], "aviso público");
    const { rerender, findByText } = render(view(null));
    await act(async () => {
      rerender(view("u1"));
    });
    await findByText("datos de u1");
    expect(client.getQueryData(["catalog", "banner"])).toBe("aviso público");
  });

  it("mientras el usuario no cambia (refrescos de token, otros renders) no toca la caché", async () => {
    const { client, view } = setup();
    const { rerender, findByText } = render(view("u1"));
    await findByText("datos de u1");
    client.setQueryData(["account", "extra"], "persistente");
    await act(async () => {
      rerender(view("u1"));
    });
    expect(client.getQueryData(["account", "extra"])).toBe("persistente");
  });
});

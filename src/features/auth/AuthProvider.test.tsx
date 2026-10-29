import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./useAuth";

type Listener = (event: string, session: unknown) => void;

// Cliente Supabase falso, con control total del ciclo de vida de la sesión.
const fake = vi.hoisted(() => {
  const state = {
    session: null as unknown,
    profile: null as unknown,
    listener: null as unknown as (event: string, session: unknown) => void,
    signOut: undefined as unknown as ReturnType<typeof vi.fn>,
    setSession: undefined as unknown as ReturnType<typeof vi.fn>,
    unsubscribe: undefined as unknown as ReturnType<typeof vi.fn>,
    profileCalls: 0,
    filters: [] as (string | null)[],
  };
  return state;
});

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: fake.session } }),
      onAuthStateChange: (cb: Listener) => {
        fake.listener = cb;
        return { data: { subscription: { unsubscribe: fake.unsubscribe } } };
      },
      signOut: fake.signOut,
      setSession: fake.setSession,
    },
    from: () => ({
      select: () => {
        // Simula la RLS real: un ADMIN ve todas las filas. Sin filtro por id, maybeSingle() falla.
        let filteredById: string | null = null;
        const chain = {
          eq: (column: string, value: string) => {
            if (column === "id") filteredById = value;
            return chain;
          },
          maybeSingle: async () => {
            fake.profileCalls++;
            fake.filters.push(filteredById);
            const isAdmin = (fake.profile as { role?: string } | null)?.role === "admin";
            if (isAdmin && filteredById === null) {
              return {
                data: null,
                error: { code: "PGRST116", message: "multiple (or no) rows returned" },
              };
            }
            return { data: fake.profile, error: null };
          },
        };
        return chain;
      },
    }),
  }),
}));

const SESSION = { access_token: "tok", user: { id: "u1" } };
const PROFILE = {
  id: "u1",
  full_name: "Ana",
  email: "a@a.com",
  phone_e164: null,
  role: "customer",
};

function Probe() {
  const { status, profile, isAdmin } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="name">{profile?.full_name ?? "-"}</p>
      <p data-testid="admin">{String(isAdmin)}</p>
    </div>
  );
}

const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

beforeEach(() => {
  fake.session = null;
  fake.profile = null;
  fake.profileCalls = 0;
  fake.filters = [];
  fake.signOut = vi.fn(async () => ({ error: null }));
  fake.setSession = vi.fn(async () => ({ error: null }));
  fake.unsubscribe = vi.fn();
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key-de-prueba-suficientemente-larga");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("AuthProvider", () => {
  it("arranca en 'loading' y sin sesión pasa a 'anonymous'", async () => {
    mount();
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(fake.profileCalls).toBe(0);
  });

  it("con sesión carga el perfil y queda 'authenticated'", async () => {
    fake.session = SESSION;
    fake.profile = PROFILE;
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("name")).toHaveTextContent("Ana");
    expect(screen.getByTestId("admin")).toHaveTextContent("false");
  });

  it("isAdmin sale del rol del PERFIL (servidor), no de nada que el cliente pueda fijar", async () => {
    fake.session = { ...SESSION, user: { id: "u1", user_metadata: { role: "admin" } } };
    fake.profile = PROFILE; // rol real: customer
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("admin")).toHaveTextContent("false");
  });

  it("perfil admin → isAdmin = true (REGRESIÓN: la RLS de admin devuelve todas las filas, el perfil debe pedirse por id)", async () => {
    fake.session = SESSION;
    fake.profile = { ...PROFILE, role: "admin" };
    mount();
    await waitFor(() => expect(screen.getByTestId("admin")).toHaveTextContent("true"));
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(fake.signOut).not.toHaveBeenCalled();
    expect(fake.filters.every((f) => f === "u1")).toBe(true);
  });

  it("sesión SIN perfil visible (cuenta desactivada) → cierra la sesión local, no queda autenticado", async () => {
    fake.session = SESSION;
    fake.profile = null;
    mount();
    await waitFor(() => expect(fake.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(screen.getByTestId("status")).not.toHaveTextContent("authenticated");
  });

  it("evento SIGNED_OUT (p. ej. logout en otra pestaña) → anonymous y sin perfil", async () => {
    fake.session = SESSION;
    fake.profile = PROFILE;
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    act(() => fake.listener("SIGNED_OUT", null));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(screen.getByTestId("name")).toHaveTextContent("-");
  });

  it("login posterior (SIGNED_IN): pasa por 'loading' (NUNCA 'anonymous' con sesión) y luego 'authenticated'", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    fake.profile = PROFILE;
    act(() => fake.listener("SIGNED_IN", SESSION));
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
  });

  it("un refresco de token con el perfil ya cargado NO vuelve a 'loading' (sin parpadeos en los guards)", async () => {
    fake.session = SESSION;
    fake.profile = PROFILE;
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    act(() => fake.listener("TOKEN_REFRESHED", { ...SESSION, access_token: "nuevo" }));
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
  });

  it("si la sesión cambia de usuario mientras se consulta el perfil, se descarta la respuesta vieja", async () => {
    fake.session = SESSION;
    fake.profile = PROFILE;
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    act(() => fake.listener("SIGNED_OUT", null));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(screen.getByTestId("name")).toHaveTextContent("-");
  });

  it("degradación en vivo: al revalidar (cada minuto) un admin pasa a no-admin", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.session = SESSION;
    fake.profile = { ...PROFILE, role: "admin" };
    mount();
    await waitFor(() => expect(screen.getByTestId("admin")).toHaveTextContent("true"));
    fake.profile = { ...PROFILE, role: "customer" };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(screen.getByTestId("admin")).toHaveTextContent("false"));
  });

  it("al volver a la pestaña revalida el perfil", async () => {
    fake.session = SESSION;
    fake.profile = PROFILE;
    mount();
    await waitFor(() => expect(fake.profileCalls).toBe(1));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fake.profileCalls).toBe(2));
  });

  it("al desmontar se cancela la suscripción (sin fugas)", async () => {
    const view = mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    view.unmount();
    expect(fake.unsubscribe).toHaveBeenCalled();
  });

  it("useAuth fuera del provider lanza un error claro", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/dentro de <AuthProvider>/);
    spy.mockRestore();
  });
});

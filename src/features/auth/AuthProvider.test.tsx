import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { registerPostSignInHook } from "./postSignIn";
import { useAuth } from "./useAuth";

type Listener = (event: string, session: unknown) => void;

// Cliente Supabase falso, con control total del ciclo de vida de la sesión.
const fake = vi.hoisted(() => {
  const state = {
    session: null as unknown,
    profile: null as unknown,
    profileError: false,
    listener: null as unknown as (event: string, session: unknown) => void,
    signOut: undefined as unknown as ReturnType<typeof vi.fn>,
    setSession: undefined as unknown as ReturnType<typeof vi.fn>,
    unsubscribe: undefined as unknown as ReturnType<typeof vi.fn>,
    profileCalls: 0,
    filters: [] as (string | null)[],
  };
  return state;
});

const fn = vi.hoisted(() => ({ callFunction: vi.fn() }));
vi.mock("@/lib/functions", () => ({ callFunction: fn.callFunction }));

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
            if (fake.profileError) {
              return {
                data: null,
                error: { code: "PGRST000", message: "sin conexión con la base" },
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
  fake.profileError = false;
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

  it("un fallo de RED o un 5xx al revalidar el perfil NO cierra la sesión (no es una cuenta desactivada) y conserva el perfil", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.session = SESSION;
    fake.profile = PROFILE;
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    fake.profileError = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000); // la revalidación periódica
    });
    expect(fake.profileCalls).toBeGreaterThanOrEqual(2);
    expect(fake.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("name")).toHaveTextContent("Ana");
  });

  it("si el perfil aún no cargó y falla la red, reintenta (2 s) sin cerrar la sesión y termina autenticado", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.session = SESSION;
    fake.profile = PROFILE;
    fake.profileError = true;
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByTestId("status")).toHaveTextContent("loading"); // ni anónimo ni autenticado: los guards esperan
    expect(fake.signOut).not.toHaveBeenCalled();
    const afterFirst = fake.profileCalls;
    fake.profileError = false; // vuelve la red
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(fake.profileCalls).toBe(afterFirst + 1);
    expect(fake.signOut).not.toHaveBeenCalled();
  });

  it("los reintentos del primer perfil son 3 (2 s, 5 s, 15 s) y luego esperan a la revalidación de 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.session = SESSION;
    fake.profile = PROFILE;
    fake.profileError = true;
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fake.profileCalls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fake.profileCalls).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fake.profileCalls).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fake.profileCalls).toBe(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000); // sin más reintentos rápidos: aún no pasaron los 60 s del intervalo
    });
    expect(fake.profileCalls).toBe(4);
    expect(fake.signOut).not.toHaveBeenCalled();
  });

  it("tras cargar el perfil, un fallo posterior NO programa reintentos rápidos (solo manda la revalidación de 60 s)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.session = SESSION;
    fake.profile = PROFILE;
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    fake.profileError = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const afterRevalidation = fake.profileCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000); // si hubiera reintentos rápidos (2/5/15 s) ya habrían sonado
    });
    expect(fake.profileCalls).toBe(afterRevalidation);
  });

  it("el contador de reintentos se reinicia con otra cuenta: vuelve a empezar por 2 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.session = SESSION;
    fake.profile = PROFILE;
    fake.profileError = true;
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fake.profileCalls).toBe(1); // intento 1 (fallo)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000); // reintento a los 2 s (fallo): el siguiente sería a los 5 s
    });
    expect(fake.profileCalls).toBe(2);
    fake.profileError = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    // entra OTRA cuenta y la red falla de nuevo: el primer reintento debe ser a los 2 s, no a los 15 s
    fake.profileError = true;
    fake.profile = { ...PROFILE, id: "u2" };
    act(() => fake.listener("SIGNED_IN", { access_token: "tok2", user: { id: "u2" } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const before = fake.profileCalls;
    fake.profileError = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fake.profileCalls).toBe(before + 1);
  });

  it("al cerrar sesión el contador de reintentos también se reinicia (la siguiente cuenta vuelve a empezar por 2 s)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.session = SESSION;
    fake.profile = PROFILE;
    fake.profileError = true;
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    const before = fake.profileCalls; // 1 intento + 1 reintento a los 2 s (el siguiente sería a los 5 s)
    act(() => fake.listener("SIGNED_OUT", null));
    fake.session = SESSION;
    act(() => fake.listener("SIGNED_IN", { access_token: "tok2", user: { id: "u1" } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const afterLogin = fake.profileCalls;
    expect(afterLogin).toBe(before + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fake.profileCalls).toBe(afterLogin + 1);
  });

  it("«sin perfil visible» SÍ cierra la sesión incluso tras haber fallado antes por red (el contador de reintentos se reinicia)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.session = SESSION;
    fake.profile = null; // RLS no entrega fila: cuenta desactivada
    mount();
    await waitFor(() => expect(fake.signOut).toHaveBeenCalledWith({ scope: "local" }));
  });

  it("si en otra pestaña entra OTRA cuenta, el perfil y el rol del anterior se quitan al instante (no valen mientras llega el nuevo)", async () => {
    fake.session = SESSION;
    fake.profile = { ...PROFILE, role: "admin" };
    mount();
    await waitFor(() => expect(screen.getByTestId("admin")).toHaveTextContent("true"));
    fake.profile = { ...PROFILE, id: "u2", full_name: "Beto", role: "customer" };
    act(() => fake.listener("SIGNED_IN", { access_token: "tok2", user: { id: "u2" } }));
    // justo después del cambio, ANTES de que llegue el perfil nuevo, ya no hay perfil de admin
    expect(screen.getByTestId("admin")).toHaveTextContent("false");
    expect(screen.getByTestId("name")).toHaveTextContent("-");
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Beto"));
    expect(screen.getByTestId("admin")).toHaveTextContent("false");
  });

  it("un refresco de token del MISMO usuario no vacía el perfil", async () => {
    fake.session = SESSION;
    fake.profile = PROFILE;
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    act(() => fake.listener("TOKEN_REFRESHED", { access_token: "tok-nuevo", user: { id: "u1" } }));
    expect(screen.getByTestId("name")).toHaveTextContent("Ana");
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
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

describe("AuthProvider · ganchos tras iniciar sesión (contrato de la fusión del carrito, S7)", () => {
  const session = { access_token: "a", refresh_token: "r" };
  const offs: (() => void)[] = [];
  afterEach(() => offs.splice(0).forEach((off) => off()));

  function Actions({ onResult }: { onResult: (value: unknown) => void }) {
    const { signIn, signUp } = useAuth();
    return (
      <div>
        <button onClick={() => void signIn("ana@test.com", "clave").then(onResult)}>entrar</button>
        <button
          onClick={() =>
            void signUp({ fullName: "Ana", email: "ana@test.com", password: "clave" }).then(
              onResult,
            )
          }
        >
          registrar
        </button>
      </div>
    );
  }
  const setup = () => {
    const results: unknown[] = [];
    const view = render(
      <AuthProvider>
        <Actions onResult={(value) => results.push(value)} />
      </AuthProvider>,
    );
    return { results, ...view };
  };
  const click = async (name: string) => {
    await act(async () => {
      screen.getByRole("button", { name }).click();
    });
  };

  beforeEach(() => {
    fn.callFunction.mockReset();
    fake.setSession = vi.fn(async () => ({
      data: { session: { user: { id: "u1" } } },
      error: null,
    }));
  });

  it("al iniciar sesión con éxito se ejecuta cada gancho UNA vez con el id del usuario", async () => {
    fn.callFunction.mockResolvedValue({ ok: true, data: { session } });
    const hook = vi.fn();
    offs.push(registerPostSignInHook(hook));
    const { results } = setup();
    await click("entrar");
    expect(results).toEqual([{ ok: true }]);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({ userId: "u1" });
  });

  it("si el login falla (credenciales) NO se ejecuta ningún gancho", async () => {
    fn.callFunction.mockResolvedValue({
      ok: false,
      status: 401,
      code: "invalid_credentials",
      message: "x",
    });
    const hook = vi.fn();
    offs.push(registerPostSignInHook(hook));
    const { results } = setup();
    await click("entrar");
    expect(results).toEqual([{ ok: false, code: "invalid_credentials", retryAfter: undefined }]);
    expect(hook).not.toHaveBeenCalled();
  });

  it("si Supabase no acepta la sesión tampoco se ejecutan", async () => {
    fn.callFunction.mockResolvedValue({ ok: true, data: { session } });
    fake.setSession = vi.fn(async () => ({ data: { session: null }, error: { message: "mal" } }));
    const hook = vi.fn();
    offs.push(registerPostSignInHook(hook));
    const { results } = setup();
    await click("entrar");
    expect(results).toEqual([{ ok: false, code: "unknown" }]);
    expect(hook).not.toHaveBeenCalled();
  });

  it("un gancho que falla no rompe el inicio de sesión", async () => {
    fn.callFunction.mockResolvedValue({ ok: true, data: { session } });
    offs.push(
      registerPostSignInHook(() => {
        throw new Error("boom");
      }),
    );
    const { results } = setup();
    await click("entrar");
    expect(results).toEqual([{ ok: true }]);
  });

  it("registrarse con éxito también los ejecuta (una sola vez: el alta termina iniciando sesión)", async () => {
    fn.callFunction.mockImplementation(async (name: string) =>
      name === "register" ? { ok: true, data: {} } : { ok: true, data: { session } },
    );
    const hook = vi.fn();
    offs.push(registerPostSignInHook(hook));
    const { results } = setup();
    await click("registrar");
    expect(results).toEqual([{ ok: true }]);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("si el registro falla no se ejecutan", async () => {
    fn.callFunction.mockResolvedValue({
      ok: false,
      status: 409,
      code: "register_failed",
      message: "x",
    });
    const hook = vi.fn();
    offs.push(registerPostSignInHook(hook));
    setup();
    await click("registrar");
    expect(hook).not.toHaveBeenCalled();
  });
});

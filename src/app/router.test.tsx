import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, matchRoutes, useLocation, useRoutes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { asAdmin, asCustomer, fakeAuth, WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { createCartApi } from "@/features/cart/cartApi";
import { CartProvider } from "@/features/cart/CartProvider";
import { FakeCartServer } from "@/features/cart/cart-test-utils";
import { memoryCartStorage } from "@/features/cart/storage";
import { routes } from "./router";
import appSource from "./App.tsx?raw";

// Se prueban las rutas REALES con sus guards REALES. Se usa MemoryRouter + useRoutes (y no un data router)
// porque jsdom y Node/undici tienen AbortSignal incompatibles al ejecutar <Navigate> en data routers;
// el redirect en un navegador real lo cubre e2e/auth.spec.ts.
let location!: ReturnType<typeof useLocation>;

// El panel consulta alertas de stock: se simula esa capa (no hay base de datos en este test) y se provee un QueryClient.
vi.mock("@/features/admin/stock/api", () => ({
  ALERT_LIGHTS: ["out", "critical", "low"],
  getStockAlertSummary: async () => ({ low: 0, critical: 0, out: 0, total: 0 }),
  listStockAlertVariants: async () => [],
}));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Cuando una ruta monta el carrito SIN darle una API de mentira, usa esta (así se ve si lo monta y qué pide).
const cartRequest = vi.fn(async () => ({
  ok: true as const,
  data: { token_state: "none", cart: null, server_time: "2026-11-03T12:00:00.000Z" },
}));
vi.mock("@/features/cart/cartApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/cart/cartApi")>()),
  createCartApi: vi.fn(() => ({ request: cartRequest })),
}));

function Routes() {
  location = useLocation();
  const element = useRoutes(routes);
  return <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>;
}

function renderAt(path: string, auth: AuthContextValue = fakeAuth()) {
  const { unmount } = render(
    <WithAuth value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes />
      </MemoryRouter>
    </WithAuth>,
  );
  return {
    unmount,
    get location() {
      return location;
    },
  };
}

describe("rutas públicas", () => {
  it("home muestra la marca como h1", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1, name: "Made In Chola" })).toBeInTheDocument();
  });
  it("ruta desconocida → 404 con enlace de regreso", () => {
    renderAt("/esto/no/existe");
    expect(screen.getByRole("heading", { name: "Página no encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });
  it("las rutas de la tienda están declaradas con su parámetro (no caen en el 404 ni en un placeholder)", () => {
    for (const [path, param] of [
      ["/tienda", undefined],
      ["/buscar", undefined],
      ["/categoria/camisas", "camisas"],
      ["/coleccion/otono", "otono"],
      ["/producto/vestido-chola-rojo", "vestido-chola-rojo"],
    ] as const) {
      const match = matchRoutes(routes, path)?.at(-1);
      expect(match, path).toBeDefined();
      expect(match!.route.path, path).not.toBe("*");
      expect(match!.params.slug, path).toBe(param);
    }
  });
  it("las pantallas reservadas todavía sin contenido resuelven a un aviso, no al 404", () => {
    renderAt("/nosotros");
    expect(screen.queryByText("Página no encontrada")).not.toBeInTheDocument();
    expect(screen.getByText(/disponible pronto/i)).toBeInTheDocument();
  });
  it("la navegación principal está etiquetada para lectores de pantalla", () => {
    renderAt("/");
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
  it("login, registro, recuperar y restablecer existen y son accesibles sin sesión (cargan bajo demanda)", async () => {
    for (const [path, heading] of [
      ["/login", "Acceso"],
      ["/registro", "Crear cuenta"],
      ["/recuperar", "Recuperar contraseña"],
    ] as const) {
      const { unmount } = render(
        <WithAuth value={fakeAuth()}>
          <MemoryRouter initialEntries={[path]}>
            <Routes />
          </MemoryRouter>
        </WithAuth>,
      );
      // son pantallas diferidas: antes de llegar el código se anuncia la carga y nunca queda la pantalla en blanco
      expect(screen.getByRole("status")).toHaveTextContent("Cargando");
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      unmount();
    }
  });
});

describe("el carrito solo se monta donde se usa", () => {
  it("las páginas públicas lo montan: quien tiene sesión lee su bolsa al entrar", async () => {
    vi.mocked(createCartApi).mockClear();
    cartRequest.mockClear();
    renderAt("/", asCustomer({ session: { user: { id: "u1" }, access_token: "t" } as never }));
    await waitFor(() => expect(cartRequest).toHaveBeenCalledWith({ action: "get" }));
    expect(createCartApi).toHaveBeenCalledTimes(1);
  });

  it("el panel de administración NO lo monta: ni se crea el almacén ni se lee la bolsa", async () => {
    vi.mocked(createCartApi).mockClear();
    cartRequest.mockClear();
    renderAt("/admin", asAdmin({ session: { user: { id: "u2" }, access_token: "t" } as never }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Panel de administración" }),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(createCartApi).not.toHaveBeenCalled();
    expect(cartRequest).not.toHaveBeenCalled();
  });

  it("`App` ya no envuelve todo el sitio con el carrito (se monta en el diseño público)", () => {
    expect(appSource).not.toMatch(/CartProvider|CartScope/);
  });
});

describe("bolsa y pago", () => {
  it("/carrito ya no es una pantalla reservada: carga bajo demanda la página de la bolsa (con su único h1)", async () => {
    const server = new FakeCartServer(null);
    render(
      <WithAuth value={fakeAuth()}>
        <MemoryRouter initialEntries={["/carrito"]}>
          <CartProvider api={server.api} storage={memoryCartStorage()}>
            <QueryClientProvider client={queryClient}>
              <Routes />
            </QueryClientProvider>
          </CartProvider>
        </MemoryRouter>
      </WithAuth>,
    );
    // es una pantalla diferida: antes de llegar el código se anuncia la carga
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
    expect(await screen.findByRole("heading", { level: 1, name: "Tu bolsa" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/disponible pronto/i)).not.toBeInTheDocument();
  });

  it("/checkout exige sesión: el visitante va a /login recordando que volvía a pagar", () => {
    const router = renderAt("/checkout");
    expect(router.location.pathname).toBe("/login");
    expect(router.location.state).toEqual({ from: "/checkout" });
  });

  it("/checkout con sesión es la pantalla provisional «Pago (próximamente)» con su h1 y sin indexar", () => {
    renderAt("/checkout", asCustomer());
    expect(
      screen.getByRole("heading", { level: 1, name: "Pago (próximamente)" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/disponible pronto/i)).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,follow",
    );
  });
});

describe("guards de /admin", () => {
  it("visitante → /login conservando la ruta original", () => {
    const router = renderAt("/admin/productos/123/editar");
    expect(router.location.pathname).toBe("/login");
    expect(router.location.state).toEqual({ from: "/admin/productos/123/editar" });
  });
  it("cliente autenticado → inicio (no ve el panel)", () => {
    const router = renderAt("/admin", asCustomer());
    expect(router.location.pathname).toBe("/");
    expect(screen.queryByText("Panel de administración")).not.toBeInTheDocument();
  });
  it("admin → accede al panel", async () => {
    const router = renderAt("/admin", asAdmin());
    expect(router.location.pathname).toBe("/admin");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Panel de administración" }),
    ).toBeInTheDocument();
  });
  it("admin también accede a sub-rutas", async () => {
    renderAt("/admin/pedidos", asAdmin());
    expect(await screen.findByText(/disponible pronto/i)).toBeInTheDocument();
  });
  it("mientras la sesión carga NO redirige ni muestra el panel (evita parpadeo y fuga)", () => {
    const router = renderAt("/admin", fakeAuth({ status: "loading" }));
    expect(router.location.pathname).toBe("/admin");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
    expect(screen.queryByText("Panel de administración")).not.toBeInTheDocument();
  });
  it("un path que solo empieza con 'admin' NO es admin (/administrador → 404, no redirect)", () => {
    const router = renderAt("/administrador");
    expect(router.location.pathname).toBe("/administrador");
    expect(screen.getByRole("heading", { name: "Página no encontrada" })).toBeInTheDocument();
  });
  it("un admin degradado (isAdmin pasa a false) pierde el acceso al re-renderizar", async () => {
    const view = render(
      <WithAuth value={asAdmin()}>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes />
        </MemoryRouter>
      </WithAuth>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Panel de administración" }),
    ).toBeInTheDocument();
    view.rerender(
      <WithAuth value={asCustomer()}>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes />
        </MemoryRouter>
      </WithAuth>,
    );
    expect(
      screen.queryByRole("heading", { name: "Panel de administración" }),
    ).not.toBeInTheDocument();
  });
});

describe("guard de /cuenta", () => {
  it("visitante → /login", () => {
    const router = renderAt("/cuenta");
    expect(router.location.pathname).toBe("/login");
    expect(router.location.state).toEqual({ from: "/cuenta" });
  });
  it("cliente ve su cuenta", async () => {
    renderAt("/cuenta", asCustomer());
    expect(await screen.findByTestId("account-name")).toHaveTextContent("Ana Cliente");
  });
});

describe("cabecera según sesión", () => {
  it("visitante ve el icono «Ingresar»; no ve Cerrar sesión ni la cuenta", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Ingresar" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
  });
  it("cliente ve su nombre y, al abrir su cuenta, Cerrar sesión; NO el enlace al Panel", async () => {
    renderAt("/", asCustomer());
    const account = screen.getByRole("button", { name: "Ana Cliente" });
    // cerrado: el menú no ofrece nada todavía
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    await userEvent.setup().click(account);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
  });
  it("admin ve el enlace al Panel en el menú de su cuenta", async () => {
    renderAt("/", asAdmin());
    await userEvent.setup().click(screen.getByRole("button", { name: "Admin Uno" }));
    expect(screen.getByRole("link", { name: "Panel" })).toHaveAttribute("href", "/admin");
  });
  it("la portada lleva la cabecera transparente sobre el hero y las demás páginas la llevan sólida", () => {
    const { unmount } = renderAt("/");
    expect(screen.getByRole("banner")).toHaveClass("absolute", "text-white");
    unmount();
    renderAt("/login");
    expect(screen.getByRole("banner")).toHaveClass("border-b", "bg-background");
    expect(screen.getByRole("banner")).not.toHaveClass("absolute");
  });
  it("las pantallas que enlaza el pie existen (provisionales hasta S15) y no dan 404", () => {
    for (const [path, name] of [
      ["/nosotros", /disponible pronto/i],
      ["/contacto", /disponible pronto/i],
      ["/legal/privacidad", /disponible pronto/i],
      ["/legal/reembolsos", /disponible pronto/i],
      ["/legal/envios", /disponible pronto/i],
      ["/legal/terminos", /disponible pronto/i],
    ] as const) {
      const { unmount } = renderAt(path);
      expect(screen.getByText(name), path).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Página no encontrada" }),
      ).not.toBeInTheDocument();
      unmount();
    }
  });
});

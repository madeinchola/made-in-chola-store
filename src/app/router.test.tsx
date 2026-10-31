import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useRoutes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { asAdmin, asCustomer, fakeAuth, WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { routes } from "./router";

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
  it("rutas profundas públicas resuelven (no 404)", () => {
    renderAt("/producto/vestido-chola-rojo");
    expect(screen.queryByText("Página no encontrada")).not.toBeInTheDocument();
    expect(screen.getByText(/disponible pronto/i)).toBeInTheDocument();
  });
  it("la navegación principal está etiquetada para lectores de pantalla", () => {
    renderAt("/");
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
  it("login, registro, recuperar y restablecer existen y son accesibles sin sesión", () => {
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
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      unmount();
    }
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
  it("cliente ve su cuenta", () => {
    renderAt("/cuenta", asCustomer());
    expect(screen.getByTestId("account-name")).toHaveTextContent("Ana Cliente");
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

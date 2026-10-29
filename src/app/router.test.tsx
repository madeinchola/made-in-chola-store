import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { asAdmin, asCustomer, fakeAuth, WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { routes } from "./router";

// Se prueban las rutas REALES con sus guards REALES. Se usa MemoryRouter + useRoutes (y no un data router)
// porque jsdom y Node/undici tienen AbortSignal incompatibles al ejecutar <Navigate> en data routers;
// el redirect en un navegador real lo cubre e2e/auth.spec.ts.
let location!: ReturnType<typeof useLocation>;

function Routes() {
  location = useLocation();
  return useRoutes(routes);
}

function renderAt(path: string, auth: AuthContextValue = fakeAuth()) {
  render(
    <WithAuth value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes />
      </MemoryRouter>
    </WithAuth>,
  );
  return {
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
  it("admin → accede al panel", () => {
    const router = renderAt("/admin", asAdmin());
    expect(router.location.pathname).toBe("/admin");
    expect(screen.getByRole("heading", { name: "Panel de administración" })).toBeInTheDocument();
  });
  it("admin también accede a sub-rutas", () => {
    renderAt("/admin/pedidos", asAdmin());
    expect(screen.getByText(/disponible pronto/i)).toBeInTheDocument();
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
  it("un admin degradado (isAdmin pasa a false) pierde el acceso al re-renderizar", () => {
    const view = render(
      <WithAuth value={asAdmin()}>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes />
        </MemoryRouter>
      </WithAuth>,
    );
    expect(screen.getByRole("heading", { name: "Panel de administración" })).toBeInTheDocument();
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
  it("visitante ve Ingresar y Crear cuenta; no ve Cerrar sesión", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Ingresar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear cuenta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
  });
  it("cliente ve su nombre y Cerrar sesión, pero NO el enlace al Panel", () => {
    renderAt("/", asCustomer());
    expect(screen.getByRole("link", { name: "Ana Cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
  });
  it("admin ve el enlace al Panel", () => {
    renderAt("/", asAdmin());
    expect(screen.getByRole("link", { name: "Panel" })).toHaveAttribute("href", "/admin");
  });
});

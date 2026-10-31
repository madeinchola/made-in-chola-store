import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/app/router";
import { ErrorBoundary } from "./ErrorBoundary";
import { RouteError } from "./RouteError";

// React Router y React escriben el error en consola al atraparlo: se silencia para que el test sea legible.
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

function Boom(): never {
  throw new Error(
    "Failed to fetch dynamically imported module: https://x/assets/ProductEditPage-abc.js",
  );
}

const renderRoute = () =>
  render(
    <RouterProvider
      router={createMemoryRouter([{ path: "/", element: <Boom />, errorElement: <RouteError /> }])}
    />,
  );

describe("RouteError", () => {
  it("un fallo al cargar una pantalla muestra el aviso normal, con referencia y botón de recargar", async () => {
    renderRoute();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Algo salió mal");
    expect(alert).toHaveTextContent(/Referencia: \S+/);
    expect(screen.getByRole("button", { name: "Recargar página" })).toBeInTheDocument();
  });

  it("NO muestra el mensaje técnico ni la traza (nombres de archivos, URLs)", async () => {
    renderRoute();
    await screen.findByRole("alert");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(
      /dynamically imported|ProductEditPage|https:\/\/x|assets\/|at Boom|Error:/,
    );
  });

  it("recargar vuelve a pedir la página", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    renderRoute();
    (await screen.findByRole("button", { name: "Recargar página" })).click();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("ErrorBoundary comparte la misma pantalla", () => {
  it("un error de render fuera del router se ve igual (referencia y recarga)", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Algo salió mal[\s\S]*Referencia: \S+/);
    expect(screen.getByRole("button", { name: "Recargar página" })).toBeInTheDocument();
  });
});

describe("rutas de la app", () => {
  it("TODA ruta de primer nivel tiene errorElement (sin él, React Router muestra la traza técnica)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const route of routes)
      expect(route.errorElement, String(route.path ?? "(layout)")).toBeDefined();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asAdmin, WithAuth } from "@/test/auth-test-utils";
import { AdminShell } from "./AdminShell";

vi.mock("../stock/api", () => ({
  ALERT_LIGHTS: ["out", "critical", "low"],
  getStockAlertSummary: async () => ({ low: 0, critical: 0, out: 0, total: 0 }),
  listStockAlertVariants: async () => [],
}));

function renderShell(initial = "/admin") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <WithAuth value={asAdmin()}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/admin" element={<AdminShell />}>
              <Route index element={<p>resumen</p>} />
              <Route path="productos" element={<p>productos</p>} />
              <Route path="productos/nuevo" element={<p>nuevo</p>} />
            </Route>
            <Route path="/" element={<p>tienda</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </WithAuth>,
  );
}

beforeEach(() => {
  document.title = "Título original";
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe("AdminShell: cambio de pantalla (lectores de pantalla y teclado)", () => {
  it("el título de la pestaña nombra la pantalla actual", async () => {
    renderShell("/admin");
    await waitFor(() =>
      expect(document.title).toBe("Resumen · Panel de administración · Made In Chola"),
    );
  });

  it("al navegar, el título cambia y el foco pasa al contenido (se anuncia el cambio)", async () => {
    const user = userEvent.setup();
    renderShell("/admin");
    await user.click(screen.getByRole("link", { name: "Productos" }));
    await waitFor(() =>
      expect(document.title).toBe("Productos · Panel de administración · Made In Chola"),
    );
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });

  it("una pantalla de detalle usa su propio nombre en el título", async () => {
    renderShell("/admin/productos/nuevo");
    await waitFor(() =>
      expect(document.title).toBe("Nuevo producto · Panel de administración · Made In Chola"),
    );
  });

  it("la PRIMERA carga no roba el foco (el primer Tab sigue llegando al enlace 'Saltar al contenido')", async () => {
    const user = userEvent.setup();
    renderShell("/admin");
    expect(screen.getByRole("main")).not.toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveFocus();
  });

  it("al salir del panel se devuelve el título que había", () => {
    const view = renderShell("/admin");
    expect(document.title).not.toBe("Título original");
    view.unmount();
    expect(document.title).toBe("Título original");
  });
});

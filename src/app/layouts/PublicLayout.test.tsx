import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCategoryTree,
  getNewsBanner,
  getStoreSettings,
} from "@/features/catalog/catalogService";
import { renderWithApp } from "@/components/layout/layout-test-utils";
import { fakeAuth } from "@/test/auth-test-utils";
import { PublicLayout } from "./PublicLayout";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getCategoryTree: vi.fn(),
  getNewsBanner: vi.fn(),
  getStoreSettings: vi.fn(),
}));

function renderLayout() {
  return renderWithApp(
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<h1>Contenido de prueba</h1>} />
      </Route>
    </Routes>,
    { auth: fakeAuth() },
  );
}

describe("PublicLayout", () => {
  beforeEach(() => {
    vi.mocked(getCategoryTree).mockReset().mockResolvedValue([]);
    vi.mocked(getNewsBanner).mockReset().mockResolvedValue({
      id: "b",
      message: "Aviso con enlace",
      linkUrl: "/coleccion/verano",
    });
    vi.mocked(getStoreSettings).mockReset().mockResolvedValue({});
  });

  it("el PRIMER elemento enfocable es «Saltar al contenido», aunque haya aviso con enlace delante de la cabecera", async () => {
    renderLayout();
    await screen.findByRole("link", { name: "Aviso con enlace" });
    await userEvent.setup().tab();
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveFocus();
  });

  it("el enlace de salto va antes que el aviso y la cabecera en el orden del documento", async () => {
    renderLayout();
    const skip = screen.getByRole("link", { name: "Saltar al contenido" });
    const banner = screen.getByRole("banner");
    const announcement = await screen.findByRole("region", { name: "Aviso de la tienda" });
    expect(
      skip.compareDocumentPosition(announcement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(skip.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("<main id='contenido'> es enfocable por programa (tabIndex -1), no entra en el orden de Tab", () => {
    renderLayout();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "contenido");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveAttribute(
      "href",
      "#contenido",
    );
  });

  it("activar el enlace enfoca <main> SIN cambiar la URL (no añade #contenido al historial)", async () => {
    renderLayout();
    await userEvent.setup().click(screen.getByRole("link", { name: "Saltar al contenido" }));
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("un banner, un main y un contentinfo (puntos de referencia únicos)", async () => {
    renderLayout();
    await screen.findByRole("region", { name: "Aviso de la tienda" });
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Contenido de prueba" }),
    ).toBeInTheDocument();
  });

  it("estructura: min-h-screen en columna y el contenido ocupa el espacio sobrante (el pie queda abajo)", () => {
    const { container } = renderLayout();
    expect(container.firstElementChild).toHaveClass("flex", "min-h-screen", "flex-col");
    expect(screen.getByRole("main")).toHaveClass("flex-1");
  });

  it("sin aviso la página no reserva espacio para él", async () => {
    vi.mocked(getNewsBanner).mockResolvedValue(null);
    renderLayout();
    await waitFor(() => expect(getNewsBanner).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Aviso de la tienda" })).not.toBeInTheDocument();
  });
});

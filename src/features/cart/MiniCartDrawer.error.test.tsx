import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MiniCartDrawer } from "./MiniCartDrawer";
import { useCart } from "./cart-context";
import { flush, makeLine, makeSnapshot, renderWithCart } from "./cart-test-utils";

// El fragmento del cajón no se puede descargar (despliegue nuevo con hash viejo, red a medias…).
vi.mock("./miniCartLoader", () => ({
  loadMiniCartContent: () => Promise.reject(new Error("no se pudo descargar el fragmento")),
  preloadMiniCart: vi.fn(),
}));

function Opener() {
  const { setOpen } = useCart();
  return (
    <button type="button" onClick={() => setOpen(true)}>
      Abrir bolsa
    </button>
  );
}

describe("MiniCartDrawer · el fragmento no se puede descargar", () => {
  it("falla SOLO el cajón: el resto de la página sigue, y se ofrece ir a la bolsa o recargar", async () => {
    // React registra por consola el error que atrapó la red de seguridad: es ruido esperado de esta prueba.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const user = userEvent.setup();
      renderWithCart(
        <>
          <Opener />
          <p>contenido de la página</p>
          <MiniCartDrawer />
        </>,
        { snapshot: makeSnapshot([makeLine("a", 1)]), path: "/tienda" },
      );
      await flush();
      await user.click(screen.getByRole("button", { name: "Abrir bolsa" }));
      const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent("No pudimos mostrar tu bolsa aquí");
      expect(within(dialog).getByRole("link", { name: "Ver bolsa" })).toHaveAttribute(
        "href",
        "/carrito",
      );
      expect(
        within(dialog).getByRole("button", { name: "Recargar la página" }),
      ).toBeInTheDocument();
      // La página no se cayó: lo de fuera del cajón sigue ahí (no hay pantalla de error de ruta).
      expect(screen.getByText("contenido de la página")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryTree } from "@/features/catalog/catalogService";
import { asAdmin, asCustomer, fakeAuth } from "@/test/auth-test-utils";
import { CATEGORIES, renderWithApp } from "./layout-test-utils";
import { MobileMenu } from "./MobileMenu";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getCategoryTree: vi.fn(),
}));

async function openMenu(auth = fakeAuth(), path = "/") {
  const user = userEvent.setup();
  renderWithApp(<MobileMenu />, { auth, path });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // cerrado: solo existe el botón
  await user.click(screen.getByRole("button", { name: "Abrir menú" }));
  const dialog = await screen.findByRole("dialog", { name: "Menú" });
  return { user, dialog };
}

describe("MobileMenu", () => {
  beforeEach(() => {
    vi.mocked(getCategoryTree).mockReset();
    vi.mocked(getCategoryTree).mockResolvedValue(CATEGORIES);
  });

  it("al pulsar el botón se abre un diálogo «Menú» con Inicio", async () => {
    const { dialog } = await openMenu();
    expect(within(dialog).getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/");
  });

  it("visitante: Ingresar y Crear cuenta; sin Cerrar sesión, Mi cuenta ni Panel", async () => {
    const { dialog } = await openMenu();
    expect(within(dialog).getByRole("link", { name: "Ingresar" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(within(dialog).getByRole("link", { name: "Crear cuenta" })).toHaveAttribute(
      "href",
      "/registro",
    );
    expect(within(dialog).queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Mi cuenta" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("cliente: Mi cuenta y Cerrar sesión, pero NO Panel ni Ingresar", async () => {
    const { dialog } = await openMenu(asCustomer());
    expect(within(dialog).getByRole("link", { name: "Mi cuenta" })).toHaveAttribute(
      "href",
      "/cuenta",
    );
    expect(within(dialog).getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Ingresar" })).not.toBeInTheDocument();
  });

  it("administrador: además ve Panel", async () => {
    const { dialog } = await openMenu(asAdmin());
    expect(within(dialog).getByRole("link", { name: "Panel" })).toHaveAttribute("href", "/admin");
  });

  it("mientras la sesión carga no muestra enlaces de cuenta", async () => {
    const { dialog } = await openMenu(fakeAuth({ status: "loading" }));
    expect(within(dialog).queryByRole("link", { name: "Ingresar" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Tu cuenta")).not.toBeInTheDocument();
  });

  it("acordeón: Mujer se despliega con «Ver todo Mujer» y sus hijas; Hombre (sin hijas) es un enlace directo", async () => {
    const { user, dialog } = await openMenu();
    const mujer = await within(dialog).findByRole("button", { name: "Mujer" });
    expect(mujer).toHaveAttribute("aria-expanded", "false");
    await user.click(mujer);
    expect(mujer).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("link", { name: "Ver todo Mujer" })).toHaveAttribute(
      "href",
      "/categoria/mujer",
    );
    expect(within(dialog).getByRole("link", { name: "Vestidos" })).toHaveAttribute(
      "href",
      "/categoria/vestidos",
    );
    expect(within(dialog).getByRole("link", { name: "Hombre" })).toHaveAttribute(
      "href",
      "/categoria/hombre",
    );
    expect(within(dialog).queryByRole("button", { name: "Hombre" })).not.toBeInTheDocument();
  });

  it("elegir una categoría navega Y cierra el menú", async () => {
    const { user, dialog } = await openMenu();
    await user.click(await within(dialog).findByRole("link", { name: "Hombre" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/categoria/hombre");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("pulsar Inicio estando ya en «/» también cierra (la URL no cambia)", async () => {
    const { user, dialog } = await openMenu(fakeAuth(), "/");
    await user.click(within(dialog).getByRole("link", { name: "Inicio" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("Cerrar sesión llama a signOut y cierra el menú", async () => {
    const signOut = vi.fn(async () => {});
    const { user, dialog } = await openMenu(asCustomer({ signOut }));
    await user.click(within(dialog).getByRole("button", { name: "Cerrar sesión" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Esc cierra y el foco vuelve al botón que lo abrió", async () => {
    const { user } = await openMenu();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Abrir menú" })).toHaveFocus();
  });

  it("cargando categorías: aviso accesible y solo los enlaces fijos", async () => {
    vi.mocked(getCategoryTree).mockReturnValue(new Promise(() => {}));
    const { dialog } = await openMenu();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Cargando categorías…");
    expect(within(dialog).getByRole("link", { name: "Inicio" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Ingresar" })).toBeInTheDocument();
  });

  it("error o sin categorías: solo los enlaces fijos, sin romper", async () => {
    for (const result of [[], new Error("caído")]) {
      vi.mocked(getCategoryTree).mockReset();
      if (result instanceof Error) vi.mocked(getCategoryTree).mockRejectedValue(result);
      else vi.mocked(getCategoryTree).mockResolvedValue(result);
      const user = userEvent.setup();
      const view = renderWithApp(<MobileMenu />);
      await user.click(screen.getByRole("button", { name: "Abrir menú" }));
      const dialog = await screen.findByRole("dialog", { name: "Menú" });
      await waitFor(() => expect(getCategoryTree).toHaveBeenCalled());
      await waitFor(() => expect(within(dialog).queryByRole("status")).not.toBeInTheDocument());
      expect(within(dialog).getByRole("link", { name: "Inicio" })).toBeInTheDocument();
      expect(within(dialog).queryByRole("button", { name: "Mujer" })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryTree } from "@/features/catalog/catalogService";
import { CATEGORIES, renderWithApp } from "./layout-test-utils";
import { MegaMenu } from "./MegaMenu";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getCategoryTree: vi.fn(),
}));

const Menu = () => (
  <>
    <MegaMenu />
    <button type="button">Después</button>
  </>
);

async function setup() {
  vi.mocked(getCategoryTree).mockResolvedValue(CATEGORIES);
  const user = userEvent.setup();
  renderWithApp(<Menu />);
  const trigger = await screen.findByRole("button", { name: "Tienda" });
  // Un panel oculto no tiene nombre accesible calculado (por eso no se busca por rol+nombre sino por su etiqueta).
  const panel = () => screen.getByLabelText("Categorías de la tienda");
  return { user, trigger, panel };
}

describe("MegaMenu", () => {
  beforeEach(() => {
    vi.mocked(getCategoryTree).mockReset();
  });

  it("cerrado: botón con aria-expanded=false enlazado al panel, que está oculto", async () => {
    const { trigger, panel } = await setup();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", panel().id);
    expect(panel()).not.toBeVisible();
    expect(screen.queryByRole("link", { name: "Vestidos" })).not.toBeInTheDocument();
  });

  it("no usa roles de menú falsos (son enlaces de navegación)", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("aria-haspopup");
  });

  it("Intro abre el panel con las categorías y sus hijas como enlaces a /categoria/<slug>", async () => {
    const { user, trigger, panel } = await setup();
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel()).toBeVisible();
    expect(screen.getByRole("link", { name: "Mujer" })).toHaveAttribute("href", "/categoria/mujer");
    expect(screen.getByRole("link", { name: "Vestidos" })).toHaveAttribute(
      "href",
      "/categoria/vestidos",
    );
    expect(screen.getByRole("link", { name: "Hombre" })).toHaveAttribute(
      "href",
      "/categoria/hombre",
    );
    expect(screen.getByRole("link", { name: "Sombreros" })).toHaveAttribute(
      "href",
      "/categoria/sombreros",
    );
    // 3 categorías raíz + 3 hijas = 6 enlaces.
    expect(screen.getAllByRole("link")).toHaveLength(6);
  });

  it("Espacio también abre y vuelve a cerrar", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("flecha abajo abre y mueve el foco al primer enlace", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Mujer" })).toHaveFocus();
  });

  it("Esc con el foco en un enlace cierra y DEVUELVE el foco al botón", async () => {
    const { user, trigger, panel } = await setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    screen.getByRole("link", { name: "Faldas" }).focus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(panel()).not.toBeVisible();
    expect(trigger).toHaveFocus();
  });

  it("Tab hacia fuera del menú lo cierra", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    screen.getByRole("link", { name: "Sombreros" }).focus(); // último enlace del panel
    await user.tab();
    expect(screen.getByRole("button", { name: "Después" })).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("Tab dentro del panel NO lo cierra", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}"); // foco en «Mujer»
    await user.tab(); // → «Vestidos»
    expect(screen.getByRole("link", { name: "Vestidos" })).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("clic fuera cierra; clic en una zona del panel que no es un enlace no cierra", async () => {
    const { user, trigger, panel } = await setup();
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(panel());
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Después" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("pasar el ratón abre; el clic siguiente no lo cierra; al salir se cierra tras una pausa", async () => {
    const { user, trigger } = await setup();
    await user.hover(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.unhover(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"), {
      timeout: 1500,
    });
  });

  it("abierto con ↓ y el foco dentro: rozar y sacar el ratón NO lo cierra (el foco caería a <body>)", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const first = screen.getByRole("link", { name: "Mujer" });
    expect(first).toHaveFocus();
    await user.hover(trigger);
    await user.unhover(trigger);
    await new Promise((resolve) => setTimeout(resolve, 400)); // más que la pausa de cierre (150 ms)
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveFocus();
  });

  it("abierto con Intro (teclado) también resiste al ratón mientras el foco siga dentro", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.hover(trigger);
    await user.unhover(trigger);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("Esc cierra aunque se abriera con el ratón y el foco esté fuera (WCAG 1.4.13)", async () => {
    const { user, trigger } = await setup();
    await user.hover(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.body).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("elegir una categoría navega y cierra el panel", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("link", { name: "Vestidos" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/categoria/vestidos");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("la categoría raíz en la que ya estás también cierra el panel al pulsarla", async () => {
    const { user, trigger } = await setup();
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("link", { name: "Hombre" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Se vuelve a abrir y se pulsa la MISMA ruta (la URL no cambia): debe cerrarse igual.
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("link", { name: "Hombre" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("cargando: ni botón ni enlaces (solo un marcador)", () => {
    vi.mocked(getCategoryTree).mockReturnValue(new Promise(() => {}));
    renderWithApp(<MegaMenu />);
    expect(screen.queryByRole("button", { name: "Tienda" })).not.toBeInTheDocument();
  });

  it("sin categorías: no pinta el menú", async () => {
    vi.mocked(getCategoryTree).mockResolvedValue([]);
    renderWithApp(<MegaMenu />);
    await waitFor(() => expect(getCategoryTree).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Tienda" })).toBeNull());
  });

  it("con error del servidor no pinta el menú y no rompe la página", async () => {
    vi.mocked(getCategoryTree).mockRejectedValue(new Error("caído"));
    renderWithApp(<MegaMenu />);
    await waitFor(() => expect(getCategoryTree).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Tienda" })).toBeNull());
    expect(screen.getByTestId("location")).toBeInTheDocument();
  });
});

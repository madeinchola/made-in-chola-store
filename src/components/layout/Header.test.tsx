import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryTree } from "@/features/catalog/catalogService";
import { asAdmin, asCustomer, customerProfile, fakeAuth } from "@/test/auth-test-utils";
import { Header } from "./Header";
import { CATEGORIES, renderWithApp } from "./layout-test-utils";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getCategoryTree: vi.fn(),
}));

const nav = () => screen.getByRole("navigation", { name: "Principal" });

describe("Header", () => {
  beforeEach(() => {
    vi.mocked(getCategoryTree).mockReset();
    vi.mocked(getCategoryTree).mockResolvedValue(CATEGORIES);
  });

  it("es el banner de la página y contiene la navegación «Principal»", () => {
    renderWithApp(<Header />);
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("navigation", { name: "Principal" })).toBe(nav());
  });

  it("marca (logotipo disperso) como enlace a «/», bolsa «(0)» y selector de país «Bolivia»", () => {
    renderWithApp(<Header />);
    const brand = within(nav()).getByRole("link", { name: "Made In Chola" });
    expect(brand).toHaveAttribute("href", "/");
    // el logotipo son 11 letras sueltas decorativas: lo anuncia UNA etiqueta, no letra a letra
    expect(brand.querySelectorAll("[aria-hidden='true']")).toHaveLength(11);
    expect(within(nav()).getByRole("link", { name: "Bolsa" })).toHaveAttribute("href", "/carrito");
    expect(screen.getByTestId("cart-count")).toHaveTextContent("(0)");
    const country = within(nav()).getByRole("combobox", { name: "País" });
    expect(country).toHaveDisplayValue("Bolivia");
  });

  it("izquierda: «Tienda ⌄» y «Nosotros» (enlace a /nosotros); derecha: país, bolsa, cuenta y búsqueda, en ese orden", async () => {
    renderWithApp(<Header />);
    await within(nav()).findByRole("button", { name: "Tienda" });
    expect(within(nav()).getByRole("link", { name: "Nosotros" })).toHaveAttribute(
      "href",
      "/nosotros",
    );
    const order = [
      within(nav()).getByRole("combobox", { name: "País" }),
      within(nav()).getByRole("link", { name: "Bolsa" }),
      within(nav()).getByRole("link", { name: "Ingresar" }),
      within(nav()).getByRole("button", { name: "Buscar" }),
    ];
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i]!.compareDocumentPosition(order[i + 1]!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it("tiene botón de menú móvil y de búsqueda con nombre accesible", () => {
    renderWithApp(<Header />);
    expect(within(nav()).getByRole("button", { name: "Abrir menú" })).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "Buscar" })).toBeInTheDocument();
  });

  it("sesión cargando: no muestra Ingresar ni cuenta (sin parpadeo)", () => {
    renderWithApp(<Header />, { auth: fakeAuth({ status: "loading" }) });
    expect(screen.queryByRole("link", { name: "Ingresar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mi cuenta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("visitante: UN icono de usuario que lleva a /login («Ingresar»); sin «Crear cuenta», cuenta ni cerrar sesión en la cabecera", () => {
    renderWithApp(<Header />);
    const login = within(nav()).getByRole("link", { name: "Ingresar" });
    expect(login).toHaveAttribute("href", "/login");
    expect(login.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(login).toHaveTextContent(""); // solo icono: el nombre es la etiqueta accesible
    expect(screen.queryByRole("link", { name: "Crear cuenta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("cliente: icono con su nombre (cerrado) que despliega Mi cuenta y Cerrar sesión; NUNCA Panel ni Ingresar", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => {});
    renderWithApp(<Header />, { auth: asCustomer({ signOut }) });
    const account = within(nav()).getByRole("button", { name: "Ana Cliente" });
    expect(account).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Cuenta")).not.toBeVisible();
    expect(screen.queryByRole("link", { name: "Ingresar" })).not.toBeInTheDocument();
    await user.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Cuenta" });
    expect(within(panel).getByRole("link", { name: "Mi cuenta" })).toHaveAttribute(
      "href",
      "/cuenta",
    );
    expect(within(panel).queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Cerrar sesión" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("sesión iniciada pero perfil aún sin cargar: el botón se llama «Mi cuenta»", async () => {
    const user = userEvent.setup();
    renderWithApp(<Header />, { auth: asCustomer({ profile: null }) });
    const account = within(nav()).getByRole("button", { name: "Mi cuenta" });
    await user.click(account);
    expect(
      within(screen.getByRole("region", { name: "Cuenta" })).getByRole("link", {
        name: "Mi cuenta",
      }),
    ).toHaveAttribute("href", "/cuenta");
  });

  it("administrador: el menú de cuenta añade Panel (/admin)", async () => {
    const user = userEvent.setup();
    renderWithApp(<Header />, { auth: asAdmin() });
    await user.click(within(nav()).getByRole("button", { name: "Admin Uno" }));
    const panel = screen.getByRole("region", { name: "Cuenta" });
    expect(within(panel).getByRole("link", { name: "Panel" })).toHaveAttribute("href", "/admin");
    expect(within(panel).getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("un cliente cuyo flag isAdmin es falso no ve Panel aunque el perfil diga admin (manda isAdmin)", async () => {
    const user = userEvent.setup();
    renderWithApp(<Header />, {
      auth: asCustomer({ profile: { ...customerProfile, role: "admin" }, isAdmin: false }),
    });
    await user.click(within(nav()).getByRole("button", { name: /Ana Cliente|Mi cuenta/ }));
    expect(screen.queryByRole("link", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("menú de cuenta: Esc lo cierra y devuelve el foco al botón; un clic fuera también lo cierra", async () => {
    const user = userEvent.setup();
    renderWithApp(<Header />, { auth: asCustomer() });
    const account = within(nav()).getByRole("button", { name: "Ana Cliente" });
    await user.click(account);
    await user.tab(); // el foco entra en el panel
    expect(account).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(account).toHaveAttribute("aria-expanded", "false");
    expect(account).toHaveFocus();
    await user.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    await user.click(document.body);
    expect(account).toHaveAttribute("aria-expanded", "false");
  });

  it("menú de cuenta: tabular fuera del panel lo cierra", async () => {
    const user = userEvent.setup();
    renderWithApp(<Header />, { auth: asCustomer() });
    const account = within(nav()).getByRole("button", { name: "Ana Cliente" });
    await user.click(account);
    await user.tab(); // Mi cuenta
    await user.tab(); // Cerrar sesión
    await user.tab(); // fuera (la búsqueda va después en el DOM)
    expect(account).toHaveAttribute("aria-expanded", "false");
  });

  it("portada (overlay): transparente sobre el hero, texto blanco, sin borde y por debajo de los cajones (z-40 < z-50)", () => {
    renderWithApp(<Header overlay />);
    const banner = screen.getByRole("banner");
    expect(banner).toHaveClass("absolute", "inset-x-0", "top-0", "z-40", "text-white");
    expect(banner).not.toHaveClass("border-b");
    expect(banner).not.toHaveClass("bg-background");
  });

  it("páginas interiores: barra sólida con línea inferior, pegajosa en móvil y estática en escritorio", () => {
    renderWithApp(<Header />);
    const banner = screen.getByRole("banner");
    expect(banner).toHaveClass(
      "sticky",
      "top-0",
      "lg:relative",
      "z-40",
      "border-b",
      "bg-background",
    );
    expect(banner).toHaveClass("text-foreground");
    expect(banner).not.toHaveClass("absolute");
  });

  it("mide lo que el diseño: 130 px en escritorio (h-header con la variable --header-height)", () => {
    renderWithApp(<Header />);
    expect(nav()).toHaveClass("h-header");
    expect(
      readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8").replace(/\s+/g, " "),
    ).toMatch(/@media \(min-width: 1024px\) \{ :root \{ --header-height: 8\.125rem;/);
  });

  it("el menú «Tienda» de escritorio aparece cuando llegan categorías", async () => {
    renderWithApp(<Header />);
    expect(await within(nav()).findByRole("button", { name: "Tienda" })).toBeInTheDocument();
  });
});

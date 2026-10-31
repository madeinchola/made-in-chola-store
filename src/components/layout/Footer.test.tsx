import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryTree, getStoreSettings } from "@/features/catalog/catalogService";
import { Footer } from "./Footer";
import { CATEGORIES, renderWithApp } from "./layout-test-utils";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getCategoryTree: vi.fn(),
  getStoreSettings: vi.fn(),
}));

const SETTINGS = {
  business_name: "Made In Chola",
  contact_email: "info@madeinchola.com",
  contact_phone: "+541140893614",
  whatsapp_orders: "+59167528677",
  social_instagram: "https://www.instagram.com/madeinchola/",
  social_tiktok: "https://www.tiktok.com/@madeinchola",
  social_facebook: "https://www.facebook.com/MIC.MADEINCHOLA",
  social_youtube: "https://www.youtube.com/@madeinchola9876",
};

describe("Footer", () => {
  beforeEach(() => {
    vi.mocked(getCategoryTree).mockReset().mockResolvedValue(CATEGORIES);
    vi.mocked(getStoreSettings).mockReset().mockResolvedValue(SETTINGS);
  });

  const column = async (name: string) =>
    (await screen.findByRole("heading", { name, level: 2 })).parentElement as HTMLElement;

  it("es el contentinfo, con superficie invertida, símbolo de marca decorativo y zona segura inferior", async () => {
    renderWithApp(<Footer />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveClass("theme-inverse");
    expect(footer.className).toContain("pb-[env(safe-area-inset-bottom)]");
    const mark = footer.querySelector("svg");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    await within(footer).findByRole("link", { name: "Comprar ahora" });
  });

  it("las cuatro columnas del diseño con sus títulos: Índice del sitio, Síguenos, Contáctanos y Legal", async () => {
    renderWithApp(<Footer />);
    await screen.findByRole("heading", { name: "Síguenos" }); // llega con los ajustes públicos
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(["Índice del sitio", "Síguenos", "Contáctanos", "Legal"]);
    expect(screen.getByTestId("footer-columns").className).toContain(
      "lg:grid-cols-[1fr_1fr_1fr_0.62fr]",
    );
  });

  it("Índice del sitio: Comprar ahora (primera categoría), Inicio, Nosotros y Contáctanos", async () => {
    renderWithApp(<Footer />);
    const index = await column("Índice del sitio");
    expect(await within(index).findByRole("link", { name: "Comprar ahora" })).toHaveAttribute(
      "href",
      "/categoria/mujer",
    );
    expect(within(index).getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/");
    expect(within(index).getByRole("link", { name: "Nosotros" })).toHaveAttribute(
      "href",
      "/nosotros",
    );
    expect(within(index).getByRole("link", { name: "Contáctanos" })).toHaveAttribute(
      "href",
      "/contacto",
    );
    // el diseño no lista las categorías en el pie: solo el acceso a la tienda
    expect(within(index).queryByRole("link", { name: "Hombre" })).not.toBeInTheDocument();
  });

  it("Legal: privacidad, reembolsos, envíos y términos apuntan a sus pantallas", async () => {
    renderWithApp(<Footer />);
    const legal = await column("Legal");
    expect(
      within(legal)
        .getAllByRole("link")
        .map((l) => [l.textContent, l.getAttribute("href")]),
    ).toEqual([
      ["Política de privacidad", "/legal/privacidad"],
      ["Reembolsos", "/legal/reembolsos"],
      ["Envíos", "/legal/envios"],
      ["Términos de servicio", "/legal/terminos"],
    ]);
  });

  it("redes: enlaces https que abren pestaña nueva con noopener noreferrer y lo avisan a lectores de pantalla", async () => {
    renderWithApp(<Footer />);
    const follow = await column("Síguenos");
    const links = await within(follow).findAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "https://www.instagram.com/madeinchola/",
      "https://www.tiktok.com/@madeinchola",
      "https://www.facebook.com/MIC.MADEINCHOLA",
      "https://www.youtube.com/@madeinchola9876",
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(
      within(follow).getByRole("link", { name: "Instagram (se abre en una pestaña nueva)" }),
    ).toBeInTheDocument();
  });

  it("contacto: correo, teléfono y WhatsApp con los esquemas correctos", async () => {
    renderWithApp(<Footer />);
    const contact = await column("Contáctanos");
    expect(
      await within(contact).findByRole("link", { name: "info@madeinchola.com" }),
    ).toHaveAttribute("href", "mailto:info@madeinchola.com");
    expect(within(contact).getByRole("link", { name: "+541140893614" })).toHaveAttribute(
      "href",
      "tel:+541140893614",
    );
    const whatsapp = within(contact).getByRole("link", { name: /^WhatsApp/ });
    expect(whatsapp).toHaveAttribute("href", "https://wa.me/59167528677");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("estilo del diseño: títulos en serif subrayados y enlaces en mayúsculas pequeñas con espaciado", async () => {
    renderWithApp(<Footer />);
    const legal = await column("Legal");
    const heading = within(legal).getByRole("heading", { level: 2 });
    expect(heading).toHaveClass("font-display", "border-b");
    const link = within(legal).getByRole("link", { name: "Reembolsos" });
    expect(link).toHaveClass("uppercase", "text-xs");
    expect(link.className).toContain("tracking-[0.12em]");
  });

  it("SIN boletín ni cupón (decisión del dueño aunque el diseño lo muestre): no hay campos ni textos de newsletter/10 %", async () => {
    renderWithApp(<Footer />);
    const footer = screen.getByRole("contentinfo");
    await within(footer).findByRole("link", { name: "Comprar ahora" });
    expect(within(footer).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(footer).queryByRole("button")).not.toBeInTheDocument();
    expect(footer.querySelector("input, form")).toBeNull();
    expect(footer.textContent).not.toMatch(
      /cup[oó]n|10\s?%|newsletter|bolet[ií]n|suscr|primera compra/i,
    );
  });

  it("no incluye el crédito «Developed by VNS» del diseño (es de la agencia, no de esta tienda)", async () => {
    renderWithApp(<Footer />);
    await screen.findByRole("link", { name: "Comprar ahora" });
    expect(screen.getByRole("contentinfo").textContent).not.toMatch(/developed by|VNS/i);
  });

  it("fila inferior: «Copyright © año», Políticas de Privacidad y Términos y Condiciones enlazados", async () => {
    renderWithApp(<Footer />);
    await screen.findByRole("link", { name: "Comprar ahora" });
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(`Copyright © ${new Date().getFullYear()}`)).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Políticas de Privacidad" })).toHaveAttribute(
      "href",
      "/legal/privacidad",
    );
    expect(within(footer).getByRole("link", { name: "Términos y Condiciones" })).toHaveAttribute(
      "href",
      "/legal/terminos",
    );
  });

  it("sin redes configuradas no se pinta «Síguenos» vacío y el diseño pasa a tres columnas", async () => {
    vi.mocked(getStoreSettings).mockResolvedValue({
      contact_email: "info@madeinchola.com",
    });
    renderWithApp(<Footer />);
    await screen.findByRole("link", { name: "Comprar ahora" });
    await screen.findByRole("link", { name: "info@madeinchola.com" });
    expect(screen.queryByRole("heading", { name: "Síguenos" })).not.toBeInTheDocument();
    expect(screen.getByTestId("footer-columns").className).toContain(
      "lg:grid-cols-[1fr_1fr_0.62fr]",
    );
  });

  it("sin ajustes públicos: «Contáctanos» nunca queda vacío (enlaza a la pantalla de contacto)", async () => {
    vi.mocked(getStoreSettings).mockResolvedValue({});
    renderWithApp(<Footer />);
    await screen.findByRole("link", { name: "Comprar ahora" });
    await waitFor(() => expect(getStoreSettings).toHaveBeenCalled());
    const contact = await column("Contáctanos");
    expect(within(contact).getAllByRole("link")).toHaveLength(1);
    expect(within(contact).getByRole("link", { name: "Contáctanos" })).toHaveAttribute(
      "href",
      "/contacto",
    );
  });

  it("ajustes con datos peligrosos o inválidos se descartan", async () => {
    vi.mocked(getStoreSettings).mockResolvedValue({
      contact_email: "no-es-correo",
      contact_phone: "javascript:alert(1)",
      whatsapp_orders: "59167528677",
      social_instagram: "javascript:alert(1)",
      social_tiktok: "http://www.tiktok.com/@x",
    });
    renderWithApp(<Footer />);
    await screen.findByRole("link", { name: "Comprar ahora" });
    await waitFor(() => expect(getStoreSettings).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Síguenos" })).not.toBeInTheDocument();
    const contact = await column("Contáctanos");
    expect(within(contact).getAllByRole("link")).toHaveLength(1); // solo el enlace de respaldo
    expect(screen.getByRole("contentinfo").innerHTML).not.toMatch(/javascript:/i);
  });

  it("sin categorías (error del servidor) el pie sigue sin «Comprar ahora» pero con Inicio y el resto", async () => {
    vi.mocked(getCategoryTree).mockRejectedValue(new Error("caído"));
    renderWithApp(<Footer />);
    const index = await column("Índice del sitio");
    await waitFor(() => expect(getCategoryTree).toHaveBeenCalled());
    expect(within(index).getByRole("link", { name: "Inicio" })).toBeInTheDocument();
    expect(within(index).queryByRole("link", { name: "Comprar ahora" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Contáctanos" })).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ProductSummary } from "@/features/catalog/types";
import { money } from "@/lib/money";
import { ProductCard } from "./ProductCard";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://img.test/${path}`,
}));

const product = (overrides: Partial<ProductSummary> = {}): ProductSummary => ({
  id: "p1",
  slug: "poncho-andino",
  name: "Poncho andino",
  isNew: false,
  price: money(12000, "BOB"),
  colorsCount: 3,
  soldOut: false,
  coverPath: "p1/portada.jpg",
  coverAlt: "Poncho gris sobre fondo claro",
  createdAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

const renderCard = (props: Partial<React.ComponentProps<typeof ProductCard>> = {}) =>
  render(
    <MemoryRouter>
      <ProductCard product={product()} {...props} />
    </MemoryRouter>,
  );

describe("ProductCard", () => {
  it("tiene UN solo enlace, con el nombre del producto y destino /producto/{slug}", () => {
    renderCard();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Poncho andino");
    expect(links[0]).toHaveAttribute("href", "/producto/poncho-andino");
  });

  it("permite otro destino con `to`", () => {
    renderCard({ to: "/coleccion/invierno" });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/coleccion/invierno");
  });

  it("el enlace es estirado: cubre toda la tarjeta sin anidar controles", () => {
    const { container } = renderCard();
    const link = screen.getByRole("link");
    // de bloque: un <a> en línea con un hijo de bloque pierde el anillo de foco (solo se pintaban dos esquinas)
    expect(link).toHaveClass("block");
    expect(link.className).toContain("after:absolute");
    expect(link.className).toContain("after:inset-0");
    expect(container.querySelector("article")).toHaveClass("relative");
    expect(container.querySelectorAll("button, a")).toHaveLength(1);
  });

  it("el nombre es un encabezado h3 por defecto y se puede cambiar el nivel", () => {
    const { unmount } = renderCard();
    expect(screen.getByRole("heading", { level: 3, name: "Poncho andino" })).toBeInTheDocument();
    unmount();
    renderCard({ headingAs: "h2" });
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("la imagen usa la URL pública, el alt de la portada y carga diferida", () => {
    renderCard();
    const img = screen.getByRole("img", { name: "Poncho gris sobre fondo claro" });
    expect(img).toHaveAttribute("src", "https://img.test/p1/portada.jpg");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width", "600");
    expect(img).toHaveAttribute("height", "800");
  });

  it("`priority` carga la imagen sin diferir", () => {
    renderCard({ priority: true });
    expect(screen.getByRole("img")).toHaveAttribute("loading", "eager");
  });

  it.each([null, "", "   "])("sin alt útil (%j) usa el nombre del producto", (coverAlt) => {
    render(
      <MemoryRouter>
        <ProductCard product={product({ coverAlt })} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("img", { name: "Poncho andino" })).toBeInTheDocument();
  });

  it("muestra el precio formateado", () => {
    renderCard();
    expect(screen.getByText("Bs 120,00")).toBeInTheDocument();
  });

  it("chip «Nuevo» solo si es nuevo", () => {
    const { unmount } = renderCard();
    expect(screen.queryByText("Nuevo")).toBeNull();
    unmount();
    renderCard({ product: product({ isNew: true }) });
    const chip = screen.getByText("Nuevo");
    expect(chip).toBeVisible();
    expect(chip).toHaveClass("eyebrow", "bg-primary");
  });

  it("agotado: chip «Agotado» y la imagen atenuada", () => {
    renderCard({ product: product({ soldOut: true }) });
    expect(screen.getByText("Agotado")).toBeVisible();
    expect(screen.getByRole("img")).toHaveClass("opacity-60");
  });

  it("no agotado: ni chip ni imagen atenuada", () => {
    renderCard();
    expect(screen.queryByText("Agotado")).toBeNull();
    expect(screen.getByRole("img")).not.toHaveClass("opacity-60");
  });

  it.each([
    [5, "5 colores"],
    [2, "2 colores"],
    [1, "1 color"],
  ])("colorsCount %j → «%s» (rótulo en mayúsculas por estilo)", (colorsCount, text) => {
    renderCard({ product: product({ colorsCount }) });
    const label = screen.getByText(text);
    expect(label).toHaveClass("eyebrow", "text-muted-foreground");
  });

  it("con 0 colores no hay rótulo de colores", () => {
    renderCard({ product: product({ colorsCount: 0 }) });
    expect(screen.queryByText(/color/i)).toBeNull();
  });

  it("sin portada muestra la baldosa provisional, sin <img>", () => {
    renderCard({ product: product({ coverPath: null, coverAlt: null }) });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Sin imagen")).toHaveClass("sr-only");
    expect(document.querySelector("[data-placeholder]")).not.toBeNull();
  });

  it("si la imagen falla al cargar cambia a la baldosa provisional (no icono roto)", () => {
    renderCard();
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Sin imagen")).toBeInTheDocument();
  });

  it("un nombre larguísimo sin espacios se corta en 2 líneas y conserva el nombre completo", () => {
    const long =
      "SuperPonchoDeAlpacaBabyTejidoAManoEnLosAndesBolivianosEdiciónLimitadaInvierno2026";
    renderCard({ product: product({ name: long }) });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("title", long);
    const text = screen.getByText(long);
    expect(text).toHaveClass("line-clamp-2", "break-words");
    expect(document.querySelector("article")).toHaveClass("min-w-0");
  });
});

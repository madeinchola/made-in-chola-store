import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductMedia } from "./ProductMedia";
import { setViewport } from "./product-test-utils";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://cdn.test/${path}`,
}));
// embla necesita layout (jsdom no lo tiene); aquí se usa la Gallery REAL con un carrusel mínimo.
vi.mock("embla-carousel-react", () => ({ default: () => [() => {}, undefined] }));

const photo = (id: string, sortOrder: number, colorId: string | null) => ({
  id,
  colorId,
  path: `p/${id}.jpg`,
  alt: id,
  sortOrder,
});

describe("ProductMedia (móvil) con la Gallery real", () => {
  beforeEach(() => setViewport("mobile"));

  it("respeta el orden que recibe (las del color elegido primero) aunque su sortOrder sea mayor", () => {
    // A: general (orden 0) · B: del color rojo (orden 1). Con «rojo» elegido la ficha pasa [B, A]:
    // el carrusel móvil debe empezar por B, igual que la pila de escritorio.
    render(
      <ProductMedia
        images={[photo("b", 1, "rojo"), photo("a", 0, null)]}
        productName="Chaqueta"
        colorId="rojo"
      />,
    );
    const main = screen.getAllByRole("img").filter((img) => !img.closest("button"));
    expect(main.map((img) => img.getAttribute("src"))).toEqual([
      "https://cdn.test/p/b.jpg",
      "https://cdn.test/p/a.jpg",
    ]);
  });

  it("con tres imágenes en un orden distinto al de sortOrder, sale tal cual llegan", () => {
    render(
      <ProductMedia
        images={[photo("c", 2, null), photo("a", 0, null), photo("b", 1, null)]}
        productName="Chaqueta"
        colorId={null}
      />,
    );
    const main = screen.getAllByRole("img").filter((img) => !img.closest("button"));
    expect(main.map((img) => img.getAttribute("src"))).toEqual([
      "https://cdn.test/p/c.jpg",
      "https://cdn.test/p/a.jpg",
      "https://cdn.test/p/b.jpg",
    ]);
  });
});

import { render, screen } from "@testing-library/react";
import { SearchX } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("usa textos por defecto en español y role=status", () => {
    render(<EmptyState />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("No hay nada por aquí");
  });

  it("muestra título, descripción y acción propios", () => {
    render(
      <EmptyState
        title="Tu bolsa está vacía"
        description="Agrega productos para verlos aquí."
        action={<a href="/tienda">Ir a la tienda</a>}
      />,
    );
    expect(screen.getByText("Tu bolsa está vacía")).toBeVisible();
    expect(screen.getByText("Agrega productos para verlos aquí.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ir a la tienda" })).toBeVisible();
    expect(screen.queryByText("No hay nada por aquí")).toBeNull();
  });

  it("sin descripción ni acción no pinta contenedores vacíos", () => {
    const { container } = render(<EmptyState />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("a, button")).toBeNull();
  });

  it("el icono es decorativo (aria-hidden) y se puede cambiar", () => {
    const { container } = render(<EmptyState icon={SearchX} />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).toHaveClass("lucide-search-x");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("usa textos por defecto en español y role=alert", () => {
    render(<ErrorState />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar esto");
    expect(alert).toHaveTextContent("Revisa tu conexión e inténtalo de nuevo.");
  });

  it("sin onRetry no hay botón Reintentar", () => {
    render(<ErrorState />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("con onRetry muestra «Reintentar» y lo llama al hacer clic", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("acepta título, descripción y una acción adicional", () => {
    render(
      <ErrorState
        title="No encontramos el producto"
        description="Puede que ya no esté disponible."
        action={<a href="/">Volver al inicio</a>}
      />,
    );
    expect(screen.getByText("No encontramos el producto")).toBeVisible();
    expect(screen.getByText("Puede que ya no esté disponible.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toBeVisible();
    expect(screen.queryByText("No pudimos cargar esto")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull(); // acción propia ≠ reintento
  });

  it("el icono es decorativo", () => {
    const { container } = render(<ErrorState />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

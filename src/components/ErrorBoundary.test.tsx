import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("fallo de render");
}

describe("ErrorBoundary", () => {
  it("muestra fallback accesible con referencia y no deja pantalla en blanco", () => {
    // React escribe el error en consola; lo silenciamos solo dentro de este test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Algo salió mal/)).toBeInTheDocument();
    expect(screen.getByText(/Referencia: [\w-]{8,}/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recargar página" })).toBeInTheDocument();
    spy.mockRestore();
  });
  it("sin errores renderiza los hijos tal cual", () => {
    render(
      <ErrorBoundary>
        <p>todo bien</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("todo bien")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

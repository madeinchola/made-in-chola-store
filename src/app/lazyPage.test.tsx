import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { lazyPage } from "./lazyPage";

describe("lazyPage", () => {
  it("mientras llega el código anuncia la carga (role=status) y no pinta la pantalla", () => {
    render(lazyPage(() => new Promise<{ Pantalla: () => null }>(() => {}), "Pantalla"));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
  });

  it("cuando llega el código pinta EXACTAMENTE el componente pedido por nombre", async () => {
    const Otra = () => <p>otra pantalla</p>;
    const Pantalla = () => <p>la pantalla correcta</p>;
    render(lazyPage(async () => ({ Otra, Pantalla }), "Pantalla"));
    expect(await screen.findByText("la pantalla correcta")).toBeInTheDocument();
    expect(screen.queryByText("otra pantalla")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

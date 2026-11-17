import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";

const columns = [{ id: "a", header: "A", cell: (r: { a: string }) => r.a }];

describe("DataTable: accesibilidad de la tabla ancha", () => {
  it("la región que se desplaza se puede recorrer con el teclado y tiene nombre (WCAG 2.1.1)", () => {
    render(
      <DataTable caption="Ventas" columns={columns} rows={[{ a: "x" }]} getRowId={(r) => r.a} />,
    );
    const region = screen.getByRole("group", { name: "Ventas" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(screen.getByRole("table", { name: "Ventas" }));
  });
});

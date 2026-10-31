import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Container } from "./Container";
import { Section } from "./Section";

describe("Section / Container", () => {
  it("con título: <section> nombrada por su <h2> (aria-labelledby apunta al id del h2)", () => {
    render(
      <Section title="Lo nuevo" eyebrow="Colección">
        <p>contenido</p>
      </Section>,
    );
    const region = screen.getByRole("region", { name: "Lo nuevo" });
    const heading = screen.getByRole("heading", { level: 2, name: "Lo nuevo" });
    expect(region).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading).toHaveClass("font-display", "text-display-md");
    expect(screen.getByText("Colección")).toHaveClass("eyebrow");
    expect(region).toHaveClass("py-section");
  });

  it("sin título: no inventa nombre ni encabezado (no es un punto de referencia)", () => {
    render(<Section data-testid="s">x</Section>);
    expect(screen.getByTestId("s")).not.toHaveAttribute("aria-labelledby");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("`as` cambia la etiqueta y el className del llamador se mezcla sin perder py-section", () => {
    render(
      <Section as="div" className="bg-muted" data-testid="s">
        x
      </Section>,
    );
    const el = screen.getByTestId("s");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveClass("py-section", "bg-muted");
  });

  it("py-* del llamador gana a py-section (twMerge conoce el token)", () => {
    render(
      <Section className="py-4" data-testid="s">
        x
      </Section>,
    );
    const el = screen.getByTestId("s");
    expect(el).toHaveClass("py-4");
    expect(el).not.toHaveClass("py-section");
  });

  it("Container usa la clase container de Tailwind (gutter y ancho máximo de los tokens)", () => {
    render(<Container data-testid="c" className="mt-2" />);
    expect(screen.getByTestId("c")).toHaveClass("container", "mt-2");
  });
});

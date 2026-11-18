import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fillVariables, missingVariables, parseBlocks, renderLegal } from "./renderLegal";

const show = (body: string, vars: Record<string, string> = {}) =>
  render(<div>{renderLegal(body, vars)}</div>);

describe("renderLegal: el texto es TEXTO (nunca HTML)", () => {
  it("una etiqueta escrita en el texto se ve como texto, no se ejecuta ni se interpreta", () => {
    const { container } = show(
      'Hola <script>alert(1)</script> <img src=x onerror="alert(1)"> <b>no</b>',
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container).toHaveTextContent(
      '<script>alert(1)</script> <img src=x onerror="alert(1)"> <b>no</b>',
    );
  });

  it("un enlace javascript: o data: NO se vuelve enlace (queda como texto)", () => {
    const { container } = show(
      "[clic](javascript:alert(1)) y [otro](data:text/html,x) y [bien](https://madeinchola.com)",
    );
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://madeinchola.com");
    expect(container).toHaveTextContent("[clic](javascript:alert(1))");
  });

  it("los enlaces seguros abren aparte y sin dar pistas a la otra página", () => {
    show(
      "Escríbenos a [soporte](mailto:info@madeinchola.com) o [visítanos](http://madeinchola.com)",
    );
    for (const name of ["soporte", "visítanos"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
});

describe("renderLegal: estructura", () => {
  it("títulos desde <h2> (el <h1> es el de la página), párrafos, listas y negrita", () => {
    const { container } = show(
      "# Uno\nTexto **fuerte** aquí.\n\n## Dos\n- a\n- b\n\n1. x\n2. y\n\n---\n### Tres\nFin",
    );
    expect(container.querySelector("h1")).toBeNull();
    expect(
      [...container.querySelectorAll("h2,h3,h4")].map((h) => `${h.tagName}:${h.textContent}`),
    ).toEqual(["H2:Uno", "H3:Dos", "H4:Tres"]);
    expect(container.querySelector("strong")).toHaveTextContent("fuerte");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("las líneas seguidas forman un párrafo y una línea en blanco lo corta; saltos de línea de Windows", () => {
    expect(parseBlocks("a\nb\n\nc")).toEqual([
      { type: "p", text: "a b" },
      { type: "p", text: "c" },
    ]);
    expect(parseBlocks("a\r\nb\r\n\r\nc")).toEqual([
      { type: "p", text: "a b" },
      { type: "p", text: "c" },
    ]);
  });

  it("cambiar de lista con viñetas a numerada abre una lista nueva", () => {
    expect(parseBlocks("- a\n1. b")).toEqual([
      { type: "ul", items: ["a"] },
      { type: "ol", items: ["b"] },
    ]);
  });

  it("un texto vacío no produce nada", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n  \n")).toEqual([]);
  });
});

describe("variables del negocio", () => {
  const vars = { razon_social: "Made In Chola S.R.L.", nit: "123456", direccion: "" };
  it("se reemplazan; las vacías se marcan como pendientes; las desconocidas se quedan visibles", () => {
    expect(
      fillVariables(
        "{{razon_social}} (NIT {{nit}}) en {{direccion}} y {{otra}}",
        vars,
        "[por definir]",
      ),
    ).toBe("Made In Chola S.R.L. (NIT 123456) en [por definir] y {{otra}}");
  });
  it("con espacios dentro de las llaves también", () => {
    expect(fillVariables("{{ nit }}", vars)).toBe("123456");
  });
  it("un nombre heredado de Object NO cuenta como variable", () => {
    expect(fillVariables("{{constructor}} {{toString}}", vars)).toBe(
      "{{constructor}} {{toString}}",
    );
  });
  it("missingVariables dice cuáles faltan (vacías o inexistentes), sin repetir", () => {
    expect(missingVariables("{{nit}} {{direccion}} {{otra}} {{otra}}", vars).sort()).toEqual([
      "direccion",
      "otra",
    ]);
  });
  it("un valor con llaves o etiquetas no se vuelve a interpretar", () => {
    const { container } = show("{{razon_social}}", { razon_social: "<b>{{nit}}</b>" });
    expect(container.querySelector("b")).toBeNull();
    expect(container).toHaveTextContent("<b>{{nit}}</b>");
  });
});

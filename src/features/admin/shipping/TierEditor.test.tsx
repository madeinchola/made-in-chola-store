import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TierEditor } from "./TierEditor";
import { emptyDraft, MAX_TIERS, validateDistanceDraft, type DistanceDraft } from "./tierLogic";

/** Dueño del estado, como el formulario real: el editor es controlado. */
function Harness({
  initial = emptyDraft(),
  showErrors = false,
  onDraft,
  currency = "BOB",
}: {
  initial?: DistanceDraft;
  showErrors?: boolean;
  onDraft?: (d: DistanceDraft) => void;
  currency?: string;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <TierEditor
      draft={draft}
      onChange={(d) => {
        onDraft?.(d);
        setDraft(d);
      }}
      errors={showErrors ? validateDistanceDraft(draft).errors : null}
      currency={currency}
    />
  );
}

const filled = (n: number): DistanceDraft => ({
  tiers: Array.from({ length: n }, (_, i) => ({ upTo: String(i + 1), cost: String(10 + i) })),
  extraPerKm: "",
  minCost: "",
  maxCost: "",
});
const group = (n: number) => screen.getByRole("group", { name: `Tramo ${n}` });
/** Las filas (el propio <fieldset> también es un grupo, con el nombre «Tramos de distancia»). */
const rows = () => screen.queryAllByRole("group", { name: /^Tramo \d+$/ });

describe("TierEditor: filas", () => {
  it("cada fila es un grupo «Tramo N» con sus campos «Hasta (km)» y «Costo (Bs)»", () => {
    render(<Harness initial={filled(2)} />);
    expect(rows()).toHaveLength(2);
    expect(within(group(1)).getByLabelText("Hasta (km)")).toHaveValue("1");
    expect(within(group(1)).getByLabelText("Costo (Bs)")).toHaveValue("10");
    expect(within(group(2)).getByLabelText("Hasta (km)")).toHaveValue("2");
    expect(within(group(2)).getByLabelText("Costo (Bs)")).toHaveValue("11");
  });
  it("el símbolo sale de la moneda de la regla", () => {
    render(<Harness initial={filled(1)} currency="USD" />);
    expect(within(group(1)).getByLabelText("Costo ($)")).toBeInTheDocument();
    expect(screen.getByLabelText("Costo por km adicional ($)")).toBeInTheDocument();
    expect(screen.getByLabelText("Costo mínimo ($)")).toBeInTheDocument();
    expect(screen.getByLabelText("Costo máximo ($)")).toBeInTheDocument();
  });
  it("escribir en una fila cambia solo esa fila, tal cual se escribe (coma incluida)", async () => {
    const onDraft = vi.fn();
    render(<Harness initial={filled(2)} onDraft={onDraft} />);
    const upTo = within(group(2)).getByLabelText("Hasta (km)");
    await userEvent.clear(upTo);
    await userEvent.type(upTo, "2,5");
    const last = onDraft.mock.calls.at(-1)?.[0] as DistanceDraft;
    expect(last.tiers).toEqual([
      { upTo: "1", cost: "10" },
      { upTo: "2,5", cost: "11" },
    ]);
  });
  it("«Añadir tramo» agrega una fila vacía, enfoca su «Hasta» y lo anuncia", async () => {
    render(<Harness initial={filled(1)} />);
    await userEvent.click(screen.getByRole("button", { name: "Añadir tramo" }));
    expect(rows()).toHaveLength(2);
    expect(within(group(2)).getByLabelText("Hasta (km)")).toHaveValue("");
    expect(within(group(2)).getByLabelText("Hasta (km)")).toHaveFocus();
    expect(screen.getByText("Tramo 2 añadido.")).toBeInTheDocument();
    expect(screen.getByText("2 de 20 tramos")).toBeInTheDocument();
  });
  it("«Quitar» quita la fila elegida (no otra), anuncia y devuelve el foco a «Añadir tramo»", async () => {
    render(<Harness initial={filled(3)} />);
    await userEvent.click(screen.getByRole("button", { name: "Quitar el tramo 2" }));
    expect(rows()).toHaveLength(2);
    expect(within(group(1)).getByLabelText("Hasta (km)")).toHaveValue("1");
    // El antiguo tramo 3 ahora es el 2.
    expect(within(group(2)).getByLabelText("Hasta (km)")).toHaveValue("3");
    expect(screen.getByText("Tramo 2 quitado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir tramo" })).toHaveFocus();
  });
  it("se pueden quitar todas las filas (el problema se dice al guardar, no se impide)", async () => {
    render(<Harness initial={filled(1)} showErrors />);
    await userEvent.click(screen.getByRole("button", { name: "Quitar el tramo 1" }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Añade al menos un tramo.")).toBeInTheDocument();
  });
  it("hasta 20 tramos: con 20 el botón se deshabilita y se dice por qué", async () => {
    render(<Harness initial={filled(MAX_TIERS - 1)} />);
    const add = screen.getByRole("button", { name: "Añadir tramo" });
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(rows()).toHaveLength(20);
    expect(screen.getByRole("button", { name: "Añadir tramo" })).toBeDisabled();
    expect(screen.getByText("Llegaste al máximo de 20 tramos.")).toBeInTheDocument();
    // La fila 20 recibió el foco (no se pierde en <body> al deshabilitarse el botón).
    expect(within(group(20)).getByLabelText("Hasta (km)")).toHaveFocus();
    // Al quitar una, vuelve a poder añadir.
    await userEvent.click(screen.getByRole("button", { name: "Quitar el tramo 20" }));
    expect(screen.getByRole("button", { name: "Añadir tramo" })).toBeEnabled();
  });
  it("los botones de quitar y de añadir miden al menos 44 px de alto", () => {
    render(<Harness initial={filled(1)} />);
    expect(screen.getByRole("button", { name: "Quitar el tramo 1" }).className).toContain(
      "min-h-11",
    );
    expect(screen.getByRole("button", { name: "Añadir tramo" }).className).toContain("min-h-11");
    expect(within(group(1)).getByLabelText("Hasta (km)").className).toContain("min-h-11");
  });
});

describe("TierEditor: km adicional, mínimo y máximo", () => {
  it("escribir en cada campo lo guarda en su propio lugar", async () => {
    const onDraft = vi.fn();
    render(<Harness initial={filled(1)} onDraft={onDraft} />);
    await userEvent.type(screen.getByLabelText("Costo por km adicional (Bs)"), "3,5");
    await userEvent.type(screen.getByLabelText("Costo mínimo (Bs)"), "10");
    await userEvent.type(screen.getByLabelText("Costo máximo (Bs)"), "60");
    expect(onDraft.mock.calls.at(-1)?.[0]).toEqual({
      tiers: [{ upTo: "1", cost: "10" }],
      extraPerKm: "3,5",
      minCost: "10",
      maxCost: "60",
    });
  });
});

describe("TierEditor: problemas junto a cada campo", () => {
  it("no muestra ningún problema mientras no se intente guardar", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });
  it("cada problema aparece junto a SU campo, enlazado con aria-describedby y aria-invalid", () => {
    render(
      <Harness
        showErrors
        initial={{
          tiers: [
            { upTo: "5", cost: "10" },
            { upTo: "5", cost: "abc" },
            { upTo: "", cost: "-1" },
          ],
          extraPerKm: "x",
          minCost: "-2",
          maxCost: "1000000",
        }}
      />,
    );
    // Tramo 1 está bien.
    expect(within(group(1)).queryByRole("alert")).not.toBeInTheDocument();
    // Tramo 2: «hasta» repetido (orden) y costo no numérico.
    const up2 = within(group(2)).getByLabelText("Hasta (km)");
    expect(up2).toHaveAttribute("aria-invalid", "true");
    expect(up2).toHaveAccessibleDescription("Debe ser mayor que el «hasta» del tramo anterior.");
    const cost2 = within(group(2)).getByLabelText("Costo (Bs)");
    expect(cost2).toHaveAccessibleDescription("Escribe un número (por ejemplo 15 o 2,5).");
    // Tramo 3: «hasta» vacío y costo negativo.
    expect(within(group(3)).getByLabelText("Hasta (km)")).toHaveAccessibleDescription(
      "Escribe un valor.",
    );
    expect(within(group(3)).getByLabelText("Costo (Bs)")).toHaveAccessibleDescription(
      "No puede ser negativo.",
    );
    // Km adicional, mínimo y máximo.
    expect(screen.getByLabelText("Costo por km adicional (Bs)")).toHaveAccessibleDescription(
      "Escribe un número (por ejemplo 15 o 2,5).",
    );
    expect(screen.getByLabelText("Costo mínimo (Bs)")).toHaveAccessibleDescription(
      "No puede ser negativo.",
    );
    expect(screen.getByLabelText("Costo máximo (Bs)")).toHaveAccessibleDescription(
      "Debe ser menor que 1.000.000.",
    );
  });
  it("«hasta» pasa del tope de km: el mensaje habla de km, no de costo", () => {
    render(
      <Harness showErrors initial={{ ...filled(1), tiers: [{ upTo: "20001", cost: "10" }] }} />,
    );
    expect(within(group(1)).getByLabelText("Hasta (km)")).toHaveAccessibleDescription(
      "No puede pasar de 20.000 km.",
    );
  });
  it("mínimo mayor que máximo: el problema va en el campo del máximo", () => {
    render(<Harness showErrors initial={{ ...filled(1), minCost: "70", maxCost: "60" }} />);
    expect(screen.getByLabelText("Costo máximo (Bs)")).toHaveAccessibleDescription(
      "El costo mínimo no puede ser mayor que el máximo.",
    );
    expect(screen.getByLabelText("Costo mínimo (Bs)")).not.toHaveAttribute("aria-invalid");
  });
  it("los problemas se actualizan al corregir (y desaparecen)", async () => {
    render(<Harness showErrors initial={{ ...filled(1), tiers: [{ upTo: "x", cost: "10" }] }} />);
    const upTo = within(group(1)).getByLabelText("Hasta (km)");
    expect(upTo).toHaveAttribute("aria-invalid", "true");
    await userEvent.clear(upTo);
    await userEvent.type(upTo, "4");
    expect(upTo).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TierEditor: vista previa", () => {
  it("muestra cómo se leerá la regla cuando el borrador es válido, con todos los tramos", () => {
    render(
      <Harness
        initial={{
          tiers: [
            { upTo: "3", cost: "15" },
            { upTo: "6,5", cost: "20" },
          ],
          extraPerKm: "2,5",
          minCost: "",
          maxCost: "60",
        }}
      />,
    );
    expect(
      screen.getByText(
        "Así se leerá: Hasta 3 km: Bs 15 · 3–6,5 km: Bs 20 · Más allá: Bs 2,50 por km adicional · Máximo Bs 60",
      ),
    ).toBeInTheDocument();
  });
  it("no la muestra mientras el borrador tenga problemas", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(screen.queryByText(/Así se leerá/)).not.toBeInTheDocument();
  });
});

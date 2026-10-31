import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuantityStepper } from "./QuantityStepper";
import { clampQuantity, parseQuantityDraft, upperBound } from "./quantity";

describe("parseQuantityDraft", () => {
  it.each([
    ["12", "12"],
    ["  7 ", "7"],
    ["", ""],
    ["   ", ""],
    ["0", "0"],
    ["9999", "9999"],
    ["007", "007"],
  ])("%j → %j", (raw, expected) => expect(parseQuantityDraft(raw)).toBe(expected));

  it.each(["1e3", "-5", "٣", "12a", "1.5", "1,5", "+3", "99999", "NaN", "Infinity", "1 2"])(
    "%j se rechaza",
    (raw) => expect(parseQuantityDraft(raw)).toBeNull(),
  );
});

describe("clampQuantity / upperBound", () => {
  it.each<[number, number, number | undefined, number]>([
    [5, 1, 10, 5],
    [0, 1, 10, 1],
    [-3, 1, 10, 1],
    [11, 1, 10, 10],
    [3.9, 1, 10, 3],
    [Number.NaN, 2, 10, 2],
    [Number.POSITIVE_INFINITY, 2, 10, 2],
    [50000, 1, undefined, 9999],
    [7, 1, 3, 3],
    [1, 4, 2, 4], // max < min → max = min
  ])("clamp(%j, min %j, max %j) = %j", (n, min, max, expected) =>
    expect(clampQuantity(n, min, max)).toBe(expected),
  );

  it("upperBound ignora un max inválido", () => {
    expect(upperBound(1, Number.NaN)).toBe(9999);
    expect(upperBound(1, undefined)).toBe(9999);
    expect(upperBound(1, 12.7)).toBe(12);
    expect(upperBound(3, 0)).toBe(3);
  });
});

function Harness({
  start = 1,
  min,
  max,
  disabled,
  onChange,
}: {
  start?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange?: (n: number) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <QuantityStepper
      value={value}
      {...(min !== undefined ? { min } : {})}
      max={max}
      disabled={disabled ?? false}
      onChange={(n) => {
        setValue(n);
        onChange?.(n);
      }}
    />
  );
}

const field = () => screen.getByRole("textbox", { name: "Cantidad" }) as HTMLInputElement;
const minus = () => screen.getByRole("button", { name: "Disminuir cantidad" });
const plus = () => screen.getByRole("button", { name: "Aumentar cantidad" });

describe("QuantityStepper", () => {
  it("muestra el valor y lo anuncia en una región educada", () => {
    render(<Harness start={3} max={10} />);
    expect(field().value).toBe("3");
    const live = screen.getByText("Cantidad: 3");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("group", { name: "Selector de cantidad" })).toBeInTheDocument();
  });

  it("el campo es de texto con teclado numérico y patrón de dígitos (no type=number: evita 1e3 y flechas del navegador)", () => {
    render(<Harness start={3} max={10} />);
    expect(field()).toHaveAttribute("type", "text");
    expect(field()).toHaveAttribute("inputmode", "numeric");
    expect(field()).toHaveAttribute("pattern", "[0-9]*");
    expect(field()).toHaveAttribute("autocomplete", "off");
  });

  it("− y + cambian de uno en uno", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start={3} max={10} onChange={onChange} />);
    await user.click(plus());
    await user.click(plus());
    await user.click(minus());
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([4, 5, 4]);
    expect(field().value).toBe("4");
    expect(screen.getByText("Cantidad: 4")).toBeInTheDocument();
  });

  const blocked = (button: HTMLElement) => button.getAttribute("aria-disabled") === "true";

  it("en el mínimo bloquea − y en el máximo bloquea + (aria-disabled, no disabled)", () => {
    const { rerender } = render(<QuantityStepper value={1} onChange={() => {}} max={3} />);
    expect(blocked(minus())).toBe(true);
    expect(blocked(plus())).toBe(false);
    rerender(<QuantityStepper value={3} onChange={() => {}} max={3} />);
    expect(blocked(minus())).toBe(false);
    expect(blocked(plus())).toBe(true);
    // siguen siendo focables: llegar al tope con el teclado no puede soltar el foco
    expect(plus()).toBeEnabled();
  });

  it("un botón en su límite no emite cambios aunque se active con el teclado y conserva el foco", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityStepper value={3} onChange={onChange} max={3} />);
    plus().focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
    expect(plus()).toHaveFocus();
  });

  it("subir con Intro hasta el tope deja el foco en «+»", async () => {
    const user = userEvent.setup();
    render(<Harness start={1} max={3} />);
    plus().focus();
    await user.keyboard("{Enter}{Enter}{Enter}");
    expect(field().value).toBe("3");
    expect(blocked(plus())).toBe(true);
    expect(plus()).toHaveFocus();
  });

  it("sin max no hay tope práctico (hasta 9999)", () => {
    render(<QuantityStepper value={9998} onChange={() => {}} />);
    expect(blocked(plus())).toBe(false);
    render(<QuantityStepper value={9999} onChange={() => {}} />);
    expect(blocked(screen.getAllByRole("button", { name: "Aumentar cantidad" })[1]!)).toBe(true);
  });

  it("respeta un mínimo distinto de 1", () => {
    render(<QuantityStepper value={2} min={2} onChange={() => {}} max={5} />);
    expect(blocked(minus())).toBe(true);
  });

  it("max menor que min deja los dos botones bloqueados en min", () => {
    render(<QuantityStepper value={1} min={1} max={0} onChange={() => {}} />);
    expect(field().value).toBe("1");
    expect(blocked(minus())).toBe(true);
    expect(blocked(plus())).toBe(true);
  });

  it("deshabilitado bloquea botones y campo (esto sí es `disabled`)", () => {
    render(<Harness start={2} max={9} disabled />);
    expect(minus()).toBeDisabled();
    expect(plus()).toBeDisabled();
    expect(field()).toBeDisabled();
  });

  it("escribir un número válido lo emite en vivo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start={1} max={99} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("12");
    expect(onChange).toHaveBeenLastCalledWith(12);
    expect(field().value).toBe("12");
  });

  it.each(["1e3", "-5", "٣", "abc", "1.5", "12345"])(
    "pegar %j se rechaza: el campo y el valor no cambian y nunca se emite NaN",
    async (pasted) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Harness start={4} max={99} onChange={onChange} />);
      await user.click(field());
      await user.paste(pasted);
      expect(onChange).not.toHaveBeenCalled();
      expect(field().value).toBe("4");
    },
  );

  it("una tecla no numérica se ignora (la «e» de 1e3 no entra)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start={1} max={999} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("1e3");
    expect(field().value).toBe("13");
    for (const [n] of onChange.mock.calls) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
    }
  });

  it("vaciar el campo y salir vuelve al último valor válido, sin emitir", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start={3} max={10} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("{Backspace}");
    expect(field().value).toBe("");
    await user.tab();
    expect(field().value).toBe("3");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("escribir 0 y salir acota al mínimo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start={3} max={10} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("0");
    expect(onChange).not.toHaveBeenCalled(); // 0 nunca se emite en vivo
    await user.tab();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1);
    expect(field().value).toBe("1");
  });

  it("escribir más que el máximo y salir acota al máximo (sin emitir el exceso)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start={2} max={5} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("7");
    expect(onChange).not.toHaveBeenCalled();
    await user.tab();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(5);
    expect(field().value).toBe("5");
  });

  it("Intro confirma igual que salir del campo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start={2} max={5} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("9{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("nunca emite valores fuera de rango, NaN ni decimales en una secuencia mezclada", async () => {
    const user = userEvent.setup();
    const emitted: number[] = [];
    render(<Harness start={2} max={8} onChange={(n) => emitted.push(n)} />);
    await user.click(field());
    await user.keyboard("0{Backspace}9{Backspace}{Backspace}08{Enter}");
    await user.click(plus());
    await user.click(plus());
    await user.click(minus());
    expect(emitted.length).toBeGreaterThan(0);
    for (const n of emitted) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(8);
    }
  });

  it("un valor de entrada fuera de rango se muestra acotado", () => {
    render(<QuantityStepper value={42} max={5} onChange={() => {}} />);
    expect(field().value).toBe("5");
    expect(screen.getByText("Cantidad: 5")).toBeInTheDocument();
  });

  it("con 4 dígitos el campo no se desborda (w-12 + tabular-nums)", () => {
    render(<QuantityStepper value={9999} onChange={() => {}} />);
    expect(field().value).toBe("9999");
    expect(field()).toHaveClass("w-12", "tabular-nums");
  });
});

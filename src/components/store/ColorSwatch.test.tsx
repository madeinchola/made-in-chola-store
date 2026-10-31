import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColorSwatch, ColorSwatchGroup, type ColorOption } from "./ColorSwatch";
import { normalizeHex } from "./colorHex";
import { pressArrow } from "./testHelpers";

describe("normalizeHex", () => {
  it.each([
    ["#FFF", "#ffffff"],
    ["abc", "#aabbcc"],
    ["#A1B2C3", "#a1b2c3"],
    ["  #fff ", "#ffffff"],
    ["000000", "#000000"],
  ])("%j → %j", (input, expected) => expect(normalizeHex(input)).toBe(expected));

  it.each(["", "#ffff", "#gggggg", "#12345678", "rojo", "#12", "##fff"])(
    "%j no es un color válido",
    (input) => expect(normalizeHex(input)).toBeNull(),
  );
  it("null y undefined → null", () => {
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });
});

describe("ColorSwatch", () => {
  const swatchOf = (container: HTMLElement) =>
    container.querySelector("[data-swatch]") as HTMLElement;

  it("pinta el color y SIEMPRE lleva borde (un blanco se distingue del fondo)", () => {
    const { container } = render(<ColorSwatch hex="#FFFFFF" />);
    const swatch = swatchOf(container);
    expect(swatch.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(swatch).toHaveClass("border", "border-input");
  });

  it.each([null, "", "zzz", "#12"])("hex %j → patrón rayado neutro, sin color inline", (hex) => {
    const { container } = render(<ColorSwatch hex={hex} />);
    const swatch = swatchOf(container);
    expect(swatch.style.backgroundColor).toBe("");
    expect(swatch.className).toContain("repeating-linear-gradient");
    expect(swatch).toHaveClass("border-input");
  });

  it("es solo visual: oculto a lectores de pantalla", () => {
    const { container } = render(<ColorSwatch hex="#000" />);
    expect(swatchOf(container)).toHaveAttribute("aria-hidden", "true");
  });
});

const OPTIONS: ColorOption[] = [
  { id: "red", name: "Rojo", hex: "#B91C1C" },
  { id: "sand", name: "Arena", hex: "#E7D9C4", disabled: true },
  { id: "white", name: "Blanco", hex: "#FFFFFF" },
  { id: "none", name: "Sin hex", hex: null },
];

function Controlled({ initial, onChange }: { initial?: string; onChange?: (id: string) => void }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <ColorSwatchGroup
      options={OPTIONS}
      value={value}
      onValueChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

describe("ColorSwatchGroup", () => {
  it("cada color es un radio con su nombre accesible", () => {
    render(<Controlled />);
    const group = screen.getByRole("radiogroup", { name: "Color" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual([
      "Rojo",
      "Arena",
      "Blanco",
      "Sin hex",
    ]);
  });

  it("sin selección pide elegir; con selección muestra el nombre como texto", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    expect(screen.getByText("Elige un color")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "Blanco" }));
    expect(screen.getByText("Color: Blanco")).toBeVisible();
    expect(screen.queryByText("Elige un color")).toBeNull();
    expect(screen.getByRole("radio", { name: "Blanco" })).toBeChecked();
  });

  it("clic notifica el id (no el nombre)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Rojo" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("red");
  });

  it("un color deshabilitado no se puede elegir con clic", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const sand = screen.getByRole("radio", { name: "Arena" });
    expect(sand).toBeDisabled();
    await user.click(sand);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("las flechas mueven la selección y saltan el color deshabilitado", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="red" onChange={onChange} />);
    act(() => screen.getByRole("radio", { name: "Rojo" }).focus());
    await pressArrow(user, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("white"); // se salta «Arena»
    expect(screen.getByRole("radio", { name: "Blanco" })).toBeChecked();
    await pressArrow(user, "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith("red");
  });

  it("el swatch dentro de cada opción conserva su borde", () => {
    render(<Controlled />);
    const white = screen.getByRole("radio", { name: "Blanco" });
    expect(white.querySelector("[data-swatch]")).toHaveClass("border-input");
  });
});

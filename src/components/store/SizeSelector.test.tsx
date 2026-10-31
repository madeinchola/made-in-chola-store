import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SizeSelector, type SizeOption } from "./SizeSelector";
import { pressArrow } from "./testHelpers";

const OPTIONS: SizeOption[] = [
  { id: "s", label: "S", status: "in_stock" },
  { id: "m", label: "M", status: "out" },
  { id: "l", label: "L", status: "low" },
  { id: "xl", label: "XL", status: "out" },
];

function Controlled({ initial, onChange }: { initial?: string; onChange?: (id: string) => void }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <SizeSelector
      options={OPTIONS}
      value={value}
      onValueChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

describe("SizeSelector", () => {
  it("rotula el grupo como «Talla» y lista las tallas", () => {
    render(<Controlled />);
    const group = screen.getByRole("radiogroup", { name: "Talla" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });

  it("sin tallas (producto de talla única) no renderiza nada", () => {
    const { container } = render(
      <SizeSelector options={[]} value={undefined} onValueChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("las tallas agotadas están deshabilitadas, tachadas y se anuncian como «(agotada)»", () => {
    render(<Controlled />);
    const m = screen.getByRole("radio", { name: "M (agotada)" });
    expect(m).toBeDisabled();
    expect(m).toHaveClass("line-through");
    expect(screen.getByRole("radio", { name: "S" })).not.toHaveClass("line-through");
    expect(screen.getByRole("radio", { name: "L" })).toBeEnabled(); // «pocas unidades» sí se elige
  });

  it("una talla agotada no se puede elegir con clic", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "XL (agotada)" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("elegir notifica el id y marca la talla", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "L" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("l");
    expect(screen.getByRole("radio", { name: "L" })).toBeChecked();
  });

  it("las flechas saltan las tallas agotadas", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="s" onChange={onChange} />);
    act(() => screen.getByRole("radio", { name: "S" }).focus());
    await pressArrow(user, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("l"); // salta M (agotada)
    await pressArrow(user, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("s"); // XL agotada: da la vuelta a S
  });

  it("objetivo táctil de al menos 44 px (h-11 / min-w-11)", () => {
    render(<Controlled />);
    expect(screen.getByRole("radio", { name: "S" })).toHaveClass("h-11", "min-w-11");
  });
});

import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeliverySlotPicker } from "./DeliverySlotPicker";
import type { ScheduleChoice } from "./destination";
import type { QuoteSlot } from "./types";

const slot = (date: string, start: string, end: string, extra: Partial<QuoteSlot> = {}) => ({
  // el MISMO id de franja se repite cada semana: la elección es (fecha, id)
  slotId: `slot-${start}`,
  date,
  start,
  end,
  capacity: 3,
  remaining: 2,
  available: true,
  ...extra,
});

const SLOTS: QuoteSlot[] = [
  slot("2026-11-10", "09:00", "11:00"),
  slot("2026-11-09", "14:00", "16:00", { remaining: 0, available: false }),
  slot("2026-11-09", "09:00", "11:00"),
];

describe("DeliverySlotPicker", () => {
  it("un grupo por día («lun 9 nov», «mar 10 nov») con sus franjas por hora, dentro de un fieldset con su leyenda", () => {
    render(<DeliverySlotPicker slots={SLOTS} choice={null} onChoose={() => {}} />);
    const fieldset = screen.getByRole("group", { name: "Fecha y franja de entrega" });
    expect(fieldset).toHaveAccessibleDescription(/todavía no queda reservada/);
    const monday = within(fieldset).getByRole("group", { name: "lun 9 nov" });
    const tuesday = within(fieldset).getByRole("group", { name: "mar 10 nov" });
    expect(
      within(monday)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-label")),
    ).toEqual(["lun 9 nov, 09:00 a 11:00", "lun 9 nov, 14:00 a 16:00, llena"]);
    expect(within(tuesday).getAllByRole("radio")).toHaveLength(1);
  });

  it("las franjas llenas siguen en la lista, deshabilitadas y dicen «Llena»", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<DeliverySlotPicker slots={SLOTS} choice={null} onChoose={onChoose} />);
    const full = screen.getByRole("radio", { name: "lun 9 nov, 14:00 a 16:00, llena" });
    expect(full).toBeDisabled();
    expect(screen.getByText("Llena")).toBeInTheDocument();
    // las disponibles no dicen «Llena»
    expect(screen.getAllByText("Llena")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" })).toBeEnabled();
    await user.click(full);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("elegir una franja entrega fecha + id; el mismo id en otro día es OTRA elección", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<DeliverySlotPicker slots={SLOTS} choice={null} onChoose={onChoose} />);
    await user.click(screen.getByRole("radio", { name: "mar 10 nov, 09:00 a 11:00" }));
    expect(onChoose).toHaveBeenCalledWith({ date: "2026-11-10", slotId: "slot-09:00" });
    await user.click(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" }));
    expect(onChoose).toHaveBeenLastCalledWith({ date: "2026-11-09", slotId: "slot-09:00" });
  });

  it("solo está marcada la franja elegida (misma fecha Y mismo id)", () => {
    render(
      <DeliverySlotPicker
        slots={SLOTS}
        choice={{ date: "2026-11-10", slotId: "slot-09:00" }}
        onChoose={() => {}}
      />,
    );
    const checked = screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).checked);
    expect(checked.map((r) => r.getAttribute("aria-label"))).toEqual(["mar 10 nov, 09:00 a 11:00"]);
  });

  it("es un solo grupo de radios (las flechas recorren todas las franjas) y cada opción mide ≥ 44 px", () => {
    render(<DeliverySlotPicker slots={SLOTS} choice={null} onChoose={() => {}} />);
    const names = new Set(screen.getAllByRole("radio").map((r) => r.getAttribute("name")));
    expect(names.size).toBe(1);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.closest("label")).toHaveClass("min-h-11");
    }
  });

  it("controlado desde fuera: al elegir, se marca", async () => {
    function Harness() {
      const [choice, setChoice] = useState<ScheduleChoice | null>(null);
      return <DeliverySlotPicker slots={SLOTS} choice={choice} onChoose={setChoice} />;
    }
    const user = userEvent.setup();
    render(<Harness />);
    const option = screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" });
    expect(option).not.toBeChecked();
    await user.click(option);
    expect(option).toBeChecked();
  });

  it("sin franjas no pinta grupos de días", () => {
    render(<DeliverySlotPicker slots={[]} choice={null} onChoose={() => {}} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});

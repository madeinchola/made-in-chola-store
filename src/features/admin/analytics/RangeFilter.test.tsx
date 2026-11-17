import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RangeFilter } from "./RangeFilter";

const range = { from: "2026-10-18", to: "2026-11-16" };
const mount = (preset: "30d" | "custom" = "30d") => {
  const onPreset = vi.fn();
  const onCustom = vi.fn();
  render(<RangeFilter preset={preset} range={range} onPreset={onPreset} onCustom={onCustom} />);
  return { onPreset, onCustom };
};

describe("RangeFilter", () => {
  it("el período actual está marcado y cada atajo lo cambia", async () => {
    const user = userEvent.setup();
    const { onPreset } = mount();
    expect(screen.getByRole("button", { name: "Últimos 30 días" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Hoy" }));
    expect(onPreset).toHaveBeenCalledWith("today");
    await user.click(screen.getByRole("button", { name: "Mes pasado" }));
    expect(onPreset).toHaveBeenLastCalledWith("last_month");
  });

  it("un rango a medida al revés se rechaza AQUÍ, con su motivo y sin avisar al resto de la pantalla", async () => {
    const user = userEvent.setup();
    const { onCustom } = mount();
    await user.click(screen.getByRole("button", { name: "Otro período" }));
    await user.clear(screen.getByLabelText("Desde"));
    await user.type(screen.getByLabelText("Desde"), "2026-11-10");
    await user.clear(screen.getByLabelText("Hasta"));
    await user.type(screen.getByLabelText("Hasta"), "2026-11-01");
    await user.click(screen.getByRole("button", { name: "Ver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "«Desde» no puede ser posterior a «Hasta».",
    );
    expect(onCustom).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Desde")).toHaveAttribute("aria-invalid", "true");
  });

  it("fechas incompletas y un período de más de 731 días tienen cada uno su mensaje", async () => {
    const user = userEvent.setup();
    const { onCustom } = mount();
    await user.click(screen.getByRole("button", { name: "Otro período" }));
    await user.clear(screen.getByLabelText("Desde"));
    await user.click(screen.getByRole("button", { name: "Ver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe las dos fechas completas.");
    await user.type(screen.getByLabelText("Desde"), "2018-01-01");
    await user.click(screen.getByRole("button", { name: "Ver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("hasta 731 días");
    expect(onCustom).not.toHaveBeenCalled();
  });

  it("un rango válido se entrega y borra el aviso anterior", async () => {
    const user = userEvent.setup();
    const { onCustom } = mount();
    await user.click(screen.getByRole("button", { name: "Otro período" }));
    await user.clear(screen.getByLabelText("Desde"));
    await user.click(screen.getByRole("button", { name: "Ver" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Desde"), "2026-11-01");
    await user.click(screen.getByRole("button", { name: "Ver" }));
    expect(onCustom).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-16" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dice que las fechas son de La Paz", () => {
    mount();
    expect(screen.getByText("Las fechas son de La Paz (UTC−4).")).toBeInTheDocument();
  });
});

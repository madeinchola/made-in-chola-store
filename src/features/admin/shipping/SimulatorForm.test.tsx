import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quoteResult } from "@/features/shipping/shipping-test-utils";
import type { QuoteParams, QuoteSlot } from "@/features/shipping/types";
import { SimulatorForm } from "./SimulatorForm";
import type { ShippingMethod, StoreLocation } from "./types";

const quote = vi.hoisted(() => ({ quoteShipping: vi.fn() }));
vi.mock("@/features/shipping/quote", () => quote);
vi.mock("@/components/map/LeafletMap", () => ({ default: () => <div data-testid="fake-map" /> }));

const delivery: ShippingMethod = {
  id: "d",
  code: "delivery",
  name: "Entrega a domicilio",
  kind: "delivery",
  description: null,
  etaMinDays: null,
  etaMaxDays: null,
  pickupLocationId: null,
  isActive: true,
  sortOrder: 0,
  archived: false,
  updatedAt: "2026-11-01T00:00:00+00:00",
};
const origin: StoreLocation = {
  id: "o",
  name: "Taller",
  addressText: "Calle 1",
  city: "La Paz",
  lat: -16.5,
  lng: -68.15,
  pickupHours: null,
  isPrimary: true,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-01T00:00:00+00:00",
};

// El servidor devuelve la MISMA franja (mismo slotId) en cada lunes de la ventana: lo que las distingue es el día.
const slot = (date: string, extra: Partial<QuoteSlot> = {}): QuoteSlot => ({
  slotId: "s-lunes",
  date,
  start: "10:00",
  end: "12:00",
  capacity: 3,
  remaining: 3,
  available: true,
  ...extra,
});
const SLOTS = [slot("2026-11-09"), slot("2026-11-16"), slot("2026-11-23")];

beforeEach(() => {
  quote.quoteShipping.mockReset();
  quote.quoteShipping.mockResolvedValue(quoteResult({ cost: 15, slots: SLOTS }));
});

const lastParams = (): QuoteParams => quote.quoteShipping.mock.calls.at(-1)![0] as QuoteParams;

describe("simulador · franja de una fecha concreta", () => {
  it("elegir la franja del SEGUNDO lunes selecciona esa opción y pregunta por ese día (no por el primero)", async () => {
    const user = userEvent.setup();
    render(<SimulatorForm methods={[delivery]} origin={origin} />);
    await user.click(screen.getByRole("button", { name: "Calcular" }));
    await waitFor(() => expect(quote.quoteShipping).toHaveBeenCalledTimes(1));

    const select = await screen.findByRole("combobox", { name: /Franja horaria/ });
    await waitFor(() => expect(select).toBeEnabled());
    const options = Array.from(select.querySelectorAll("option")).filter((o) => o.value !== "");
    expect(options).toHaveLength(3); // una por lunes
    expect(new Set(options.map((o) => o.value)).size).toBe(3); // y con valores DISTINTOS

    await user.selectOptions(select, options[1]!);
    expect((select as HTMLSelectElement).value).toBe(options[1]!.value);
    expect(screen.getByLabelText(/Fecha de entrega/)).toHaveValue("2026-11-16");

    await user.click(screen.getByRole("button", { name: "Calcular" }));
    await waitFor(() => expect(quote.quoteShipping).toHaveBeenCalledTimes(2));
    expect(lastParams()).toMatchObject({
      deliveryDate: "2026-11-16",
      slotId: "s-lunes",
    });
  });

  it("la tercera opción también: cada día conserva su propia selección", async () => {
    const user = userEvent.setup();
    render(<SimulatorForm methods={[delivery]} origin={origin} />);
    await user.click(screen.getByRole("button", { name: "Calcular" }));
    const select = (await screen.findByRole("combobox", {
      name: /Franja horaria/,
    })) as HTMLSelectElement;
    await waitFor(() => expect(select).toBeEnabled());
    const options = Array.from(select.querySelectorAll("option")).filter((o) => o.value !== "");
    await user.selectOptions(select, options[2]!);
    expect(screen.getByLabelText(/Fecha de entrega/)).toHaveValue("2026-11-23");
    await user.selectOptions(select, options[0]!);
    expect(screen.getByLabelText(/Fecha de entrega/)).toHaveValue("2026-11-09");
  });
});

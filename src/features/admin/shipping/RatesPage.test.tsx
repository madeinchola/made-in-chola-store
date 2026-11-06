import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { ShippingRatesPage } from "./RatesPage";
import type { RateRule, ShippingMethod, ShippingZone } from "./types";

const api = vi.hoisted(() => ({
  listMethods: vi.fn(),
  listZones: vi.fn(),
  listRates: vi.fn(),
  createRate: vi.fn(),
  updateRate: vi.fn(),
  setRateArchived: vi.fn(),
}));
vi.mock("./api", () => api);
const configApi = vi.hoisted(() => ({ listCurrencies: vi.fn() }));
vi.mock("../config/api", () => configApi);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const method = (over: Partial<ShippingMethod> = {}): ShippingMethod => ({
  id: "m1",
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
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});
const zone = (over: Partial<ShippingZone> = {}): ShippingZone => ({
  id: "z1",
  name: "Centro",
  kind: "city",
  cities: ["La Paz"],
  centerLat: null,
  centerLng: null,
  radiusKm: null,
  allowed: true,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-05T10:00:00+00:00",
  ...over,
});
const rate = (over: Partial<RateRule> = {}): RateRule => ({
  id: "r1",
  methodId: "m1",
  zoneId: null,
  name: "Entrega fija",
  kind: "flat",
  params: { kind: "flat", cost: 10 },
  minOrderAmount: null,
  maxOrderAmount: null,
  currency: "BOB",
  priority: 100,
  isActive: true,
  validFrom: null,
  validUntil: null,
  archived: false,
  updatedAt: "2026-11-05T10:00:00.123456+00:00",
  ...over,
});
const distanceRate = (over: Partial<RateRule> = {}): RateRule =>
  rate({
    id: "r2",
    name: "Escala por km",
    kind: "distance",
    params: {
      kind: "distance",
      tiers: [
        { upToKm: 3, cost: 15 },
        { upToKm: 6, cost: 20 },
        { upToKm: 10, cost: 30 },
      ],
      extraPerKm: 3,
      minCost: 15,
      maxCost: 60,
    },
    ...over,
  });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ShippingRatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dialog = () => screen.getByRole("dialog");
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.listMethods.mockResolvedValue([method()]);
  api.listZones.mockResolvedValue([zone()]);
  api.listRates.mockResolvedValue([rate()]);
  api.createRate.mockResolvedValue(rate({ id: "nueva" }));
  api.updateRate.mockResolvedValue("2026-11-05T12:00:00.000001+00:00");
  api.setRateArchived.mockResolvedValue("2026-11-05T12:00:00.000001+00:00");
  configApi.listCurrencies.mockResolvedValue([
    { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2, enabled: true },
  ]);
});

describe("Tarifas: lista y estados", () => {
  it("muestra «Cargando…» mientras llegan los métodos", () => {
    api.listMethods.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("si falla la carga de las tarifas lo dice y «Reintentar» vuelve a pedirlas", async () => {
    api.listRates.mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    api.listRates.mockResolvedValueOnce([rate({ name: "Tras reintentar" })]);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Tras reintentar")).toBeInTheDocument();
    expect(api.listRates).toHaveBeenCalledTimes(2);
  });

  it("sin métodos de entrega a domicilio: explica y manda a «Tienda y métodos» (el recojo no lleva tarifas)", async () => {
    api.listMethods.mockResolvedValue([
      method({ id: "p", code: "recojo", name: "Recojo", kind: "pickup", pickupLocationId: "l1" }),
    ]);
    renderPage();
    expect(await screen.findByText(/No hay métodos de entrega a domicilio/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Tienda y métodos" })).toHaveAttribute(
      "href",
      "/admin/envios",
    );
    expect(screen.queryByRole("button", { name: "Nueva tarifa" })).not.toBeInTheDocument();
  });

  it("método sin tarifas: explica que no se puede cotizar y ofrece crear la primera (abre el diálogo)", async () => {
    api.listRates.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Este método todavía no tiene tarifas/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear la primera tarifa" }));
    expect(within(dialog()).getByRole("heading", { name: "Nueva tarifa" })).toBeInTheDocument();
  });

  it("cada tarifa con su resumen legible, zona, monto, vigencia, prioridad y estado; las archivadas al final", async () => {
    api.listRates.mockResolvedValue([
      rate({ id: "a", name: "Vieja", archived: true, priority: 900 }),
      rate({ id: "b", name: "Fija", priority: 100 }),
      distanceRate({ id: "c", name: "Distancia", priority: 200, zoneId: "z1" }),
      rate({
        id: "d",
        name: "Gratis desde 200",
        params: { kind: "flat", cost: 0 },
        minOrderAmount: 200,
        priority: 300,
      }),
      rate({ id: "e", name: "Apagada", isActive: false, priority: 50 }),
      rate({ id: "f", name: "Rota", params: null, priority: 40 }),
    ]);
    renderPage();
    await screen.findByText("Fija");
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0]?.querySelector("p")?.textContent);
    // mayor prioridad primero (como las evalúa el servidor); la archivada, aunque tenga 900, al final
    expect(names).toEqual(["Gratis desde 200", "Distancia", "Fija", "Apagada", "Rota", "Vieja"]);

    const dist = within(rowOf("Distancia"));
    expect(
      dist.getByText(
        "Hasta 3 km: Bs 15 · 3–6 km: Bs 20 · 6–10 km: Bs 30 · Más allá: Bs 3 por km adicional · Mínimo Bs 15 · Máximo Bs 60",
      ),
    ).toBeInTheDocument();
    expect(dist.getByText("Por distancia", { selector: "p.text-xs" })).toBeInTheDocument();
    expect(dist.getByText("Centro")).toBeInTheDocument();
    expect(dist.getByText("Vigente")).toBeInTheDocument();

    const gratis = within(rowOf("Gratis desde 200"));
    expect(gratis.getByText("Envío gratis")).toBeInTheDocument(); // costo 0 explícito
    expect(gratis.getByText("Desde Bs 200")).toBeInTheDocument();

    const fija = within(rowOf("Fija"));
    expect(fija.getByText("Bs 10 fijo")).toBeInTheDocument();
    expect(fija.getByText("Cualquier zona cubierta")).toBeInTheDocument();
    expect(fija.getByText("Cualquier monto")).toBeInTheDocument();
    expect(fija.getByText("Siempre")).toBeInTheDocument();

    expect(within(rowOf("Apagada")).getByText("Inactiva")).toBeInTheDocument();
    const rota = within(rowOf("Rota"));
    expect(rota.getByText("Formato inválido")).toBeInTheDocument();
    const vieja = within(rowOf("Vieja"));
    expect(vieja.getByText("Archivada")).toBeInTheDocument();
    expect(vieja.getByRole("button", { name: "Restaurar la tarifa «Vieja»" })).toBeInTheDocument();
    expect(vieja.queryByRole("button", { name: /Archivar/ })).not.toBeInTheDocument();
  });

  it("una zona archivada, inactiva o sin servicio avisa que la regla no se aplicará", async () => {
    api.listZones.mockResolvedValue([zone({ id: "z1", name: "Apagada", isActive: false })]);
    api.listRates.mockResolvedValue([rate({ zoneId: "z1" })]);
    renderPage();
    await screen.findByText("Entrega fija");
    expect(screen.getByText("Apagada (inactiva)")).toBeInTheDocument();
    expect(screen.getByText(/mientras tanto la regla no se aplicará/)).toBeInTheDocument();
  });

  it("varios métodos: solo los de domicilio entran en el selector, y cambiar de método muestra SUS tarifas", async () => {
    api.listMethods.mockResolvedValue([
      method(),
      method({ id: "m2", code: "moto", name: "Moto" }),
      method({ id: "p", code: "recojo", name: "Recojo", kind: "pickup", pickupLocationId: "l" }),
    ]);
    api.listRates.mockResolvedValue([
      rate({ name: "De domicilio" }),
      rate({ id: "x", methodId: "m2", name: "De moto" }),
    ]);
    renderPage();
    const select = await screen.findByRole("combobox", { name: "Método de envío" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Entrega a domicilio", "Moto"]);
    expect(screen.getByText("De domicilio")).toBeInTheDocument();
    expect(screen.queryByText("De moto")).not.toBeInTheDocument();
    await userEvent.selectOptions(select, "Moto");
    expect(screen.getByText("De moto")).toBeInTheDocument();
    expect(screen.queryByText("De domicilio")).not.toBeInTheDocument();
  });

  it("un h2 (el h1 es del marco), la frase de prioridades y botones de al menos 44 px", async () => {
    renderPage();
    await screen.findByText("Entrega fija");
    expect(screen.getByRole("heading", { level: 2, name: "Tarifas de envío" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText(/Gana la regla de mayor prioridad; si empatan/)).toBeInTheDocument();
    for (const name of [
      "Nueva tarifa",
      "Editar la tarifa «Entrega fija»",
      "Archivar la tarifa «Entrega fija»",
    ]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
  });
});

describe("Tarifas: crear", () => {
  const openCreate = async () => {
    await screen.findByText("Entrega fija");
    await userEvent.click(screen.getByRole("button", { name: "Nueva tarifa" }));
    return within(dialog());
  };

  it("tarifa fija: envía exactamente RateCreateInput (método, moneda y valores calculados)", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "  Entrega en ciudad ");
    await userEvent.selectOptions(d.getByLabelText("Tipo de tarifa"), "Tarifa fija");
    await userEvent.type(d.getByLabelText("Costo fijo (Bs)"), "12,5");
    await userEvent.type(d.getByLabelText("Monto mínimo del pedido (Bs)"), "100");
    await userEvent.type(d.getByLabelText("Monto máximo del pedido (Bs)"), "499,99");
    await userEvent.selectOptions(d.getByLabelText("Zona"), "Centro");
    await userEvent.clear(d.getByLabelText("Prioridad"));
    await userEvent.type(d.getByLabelText("Prioridad"), "250");
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));

    await waitFor(() => expect(api.createRate).toHaveBeenCalledTimes(1));
    expect(api.createRate).toHaveBeenCalledWith({
      methodId: "m1",
      zoneId: "z1",
      name: "Entrega en ciudad",
      params: { kind: "flat", cost: 12.5 },
      minOrderAmount: 100,
      maxOrderAmount: 499.99,
      currency: "BOB",
      priority: 250,
      isActive: true,
      validFrom: null,
      validUntil: null,
    });
    expect(api.updateRate).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Tarifa creada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("«envío gratis»: una tarifa fija de costo 0 con monto mínimo es válida y se envía con 0 explícito", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "Gratis desde 200");
    await userEvent.selectOptions(d.getByLabelText("Tipo de tarifa"), "Tarifa fija");
    await userEvent.type(d.getByLabelText("Costo fijo (Bs)"), "0");
    await userEvent.type(d.getByLabelText("Monto mínimo del pedido (Bs)"), "200");
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));
    await waitFor(() => expect(api.createRate).toHaveBeenCalledTimes(1));
    expect(api.createRate.mock.calls[0]![0]).toMatchObject({
      params: { kind: "flat", cost: 0 },
      minOrderAmount: 200,
      maxOrderAmount: null,
      zoneId: null,
    });
  });

  it("por distancia: arma los tramos, el costo por km adicional y los límites tal cual los escribió la persona", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "Por distancia nueva");
    // tipo por defecto: por distancia, con un tramo vacío
    const first = within(d.getByRole("group", { name: "Tramo 1" }));
    await userEvent.type(first.getByLabelText("Hasta (km)"), "3");
    await userEvent.type(first.getByLabelText("Costo (Bs)"), "15");
    await userEvent.click(d.getByRole("button", { name: "Añadir tramo" }));
    const second = within(d.getByRole("group", { name: "Tramo 2" }));
    await userEvent.type(second.getByLabelText("Hasta (km)"), "6,5");
    await userEvent.type(second.getByLabelText("Costo (Bs)"), "20");
    await userEvent.type(d.getByLabelText("Costo por km adicional (Bs)"), "3");
    await userEvent.type(d.getByLabelText("Costo mínimo (Bs)"), "15");
    await userEvent.type(d.getByLabelText("Costo máximo (Bs)"), "60");
    // la vista previa lee los bordes inclusivos
    expect(d.getByText(/Así se leerá: Hasta 3 km: Bs 15 · 3–6,5 km: Bs 20/)).toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));

    await waitFor(() => expect(api.createRate).toHaveBeenCalledTimes(1));
    expect(api.createRate).toHaveBeenCalledWith({
      methodId: "m1",
      zoneId: null,
      name: "Por distancia nueva",
      params: {
        kind: "distance",
        tiers: [
          { upToKm: 3, cost: 15 },
          { upToKm: 6.5, cost: 20 },
        ],
        extraPerKm: 3,
        minCost: 15,
        maxCost: 60,
      },
      minOrderAmount: null,
      maxOrderAmount: null,
      currency: "BOB",
      priority: 100,
      isActive: true,
      validFrom: null,
      validUntil: null,
    });
  });

  it("validación: nada se guarda, cada campo explica su problema y el foco va al primero", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Costo mínimo (Bs)"), "70");
    await userEvent.type(d.getByLabelText("Costo máximo (Bs)"), "60");
    await userEvent.clear(d.getByLabelText("Prioridad"));
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));

    expect(api.createRate).not.toHaveBeenCalled();
    expect(d.getByText("Escribe un nombre para la tarifa.")).toBeInTheDocument();
    expect(d.getByText("Escribe la prioridad.")).toBeInTheDocument();
    expect(d.getByText("El costo mínimo no puede ser mayor que el máximo.")).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveFocus();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("monto del pedido: mínimo mayor que máximo y más de 2 decimales se rechazan (no se redondea en silencio)", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "Con rango");
    await userEvent.selectOptions(d.getByLabelText("Tipo de tarifa"), "Tarifa fija");
    await userEvent.type(d.getByLabelText("Costo fijo (Bs)"), "5");
    await userEvent.type(d.getByLabelText("Monto mínimo del pedido (Bs)"), "500");
    await userEvent.type(d.getByLabelText("Monto máximo del pedido (Bs)"), "100");
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));
    expect(d.getByText("El monto mínimo no puede ser mayor que el máximo.")).toBeInTheDocument();

    await userEvent.clear(d.getByLabelText("Monto mínimo del pedido (Bs)"));
    await userEvent.type(d.getByLabelText("Monto mínimo del pedido (Bs)"), "99,99999");
    expect(d.getByText("Usa como máximo 2 decimales.")).toBeInTheDocument();
    expect(api.createRate).not.toHaveBeenCalled();
  });

  it("un error de la base al guardar se muestra en el diálogo, que sigue abierto con lo escrito", async () => {
    api.createRate.mockRejectedValue(new AppError("unknown", "No pudimos guardar la tarifa."));
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "Con error");
    await userEvent.selectOptions(d.getByLabelText("Tipo de tarifa"), "Tarifa fija");
    await userEvent.type(d.getByLabelText("Costo fijo (Bs)"), "5");
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));
    expect(await d.findByRole("alert")).toHaveTextContent("No pudimos guardar la tarifa.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveValue("Con error");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("la zona solo ofrece las zonas CON servicio y sin archivar", async () => {
    api.listZones.mockResolvedValue([
      zone(),
      zone({ id: "z2", name: "Bloqueada", allowed: false }),
      zone({ id: "z3", name: "Vieja", archived: true }),
    ]);
    renderPage();
    const d = await openCreate();
    expect(
      within(d.getByLabelText("Zona"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Cualquier zona cubierta", "Centro"]);
  });
});

describe("Tarifas: editar", () => {
  const openEdit = async (name: string) => {
    await screen.findByText(name);
    await userEvent.click(screen.getByRole("button", { name: `Editar la tarifa «${name}»` }));
    return within(dialog());
  };

  it("abre con los valores guardados; el tipo y la moneda no se cambian; guardar envía updateRate con la versión", async () => {
    api.listRates.mockResolvedValue([distanceRate({ minOrderAmount: 50 })]);
    renderPage();
    const d = await openEdit("Escala por km");
    expect(d.getByRole("heading", { name: "Editar tarifa" })).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveValue("Escala por km");
    expect(
      d.getByText(/Tipo de tarifa: Por distancia\. No se puede cambiar después de crearla\./),
    ).toBeInTheDocument();
    expect(
      d.getByText(/Moneda: BOB\. No se puede cambiar después de crearla\./),
    ).toBeInTheDocument();
    expect(d.queryByLabelText("Tipo de tarifa")).not.toBeInTheDocument();
    expect(
      within(d.getByRole("group", { name: "Tramo 2" })).getByLabelText("Hasta (km)"),
    ).toHaveValue("6");
    expect(d.getByLabelText("Monto mínimo del pedido (Bs)")).toHaveValue("50");

    await userEvent.type(d.getByLabelText("Nombre"), " v2");
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));

    await waitFor(() => expect(api.updateRate).toHaveBeenCalledTimes(1));
    const [id, version, payload] = api.updateRate.mock.calls[0]!;
    expect(id).toBe("r2");
    expect(version).toBe("2026-11-05T10:00:00.123456+00:00"); // la versión EXACTA que leyó (microsegundos incluidos)
    expect(payload).toEqual({
      zoneId: null,
      name: "Escala por km v2",
      params: {
        kind: "distance",
        tiers: [
          { upToKm: 3, cost: 15 },
          { upToKm: 6, cost: 20 },
          { upToKm: 10, cost: 30 },
        ],
        extraPerKm: 3,
        minCost: 15,
        maxCost: 60,
      },
      minOrderAmount: 50,
      maxOrderAmount: null,
      priority: 100,
      isActive: true,
      validFrom: null,
      validUntil: null,
    });
    expect(api.createRate).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Tarifa actualizada.");
  });

  it("una regla con parámetros ilegibles avisa y arranca con los tramos vacíos (hay que volver a ingresarlos)", async () => {
    api.listRates.mockResolvedValue([distanceRate({ name: "Rota", params: null })]);
    renderPage();
    const d = await openEdit("Rota");
    expect(d.getByText(/no tienen un formato válido: vuelve a ingresarlos/)).toBeInTheDocument();
    expect(
      within(d.getByRole("group", { name: "Tramo 1" })).getByLabelText("Hasta (km)"),
    ).toHaveValue("");
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));
    expect(api.updateRate).not.toHaveBeenCalled();
  });

  it("conflicto de edición: banner, no guarda, bloquea Guardar y «Recargar» cierra y refresca la lista", async () => {
    api.updateRate.mockRejectedValue(new StaleVersionError());
    renderPage();
    const d = await openEdit("Entrega fija");
    const callsBefore = api.listRates.mock.calls.length;
    await userEvent.type(d.getByLabelText("Nombre"), " editada");
    await userEvent.click(d.getByRole("button", { name: "Guardar tarifa" }));

    const banner = await d.findByText("Alguien más modificó esto");
    expect(banner.closest('[role="alert"]')).toHaveTextContent(/no se guardó nada tuyo/);
    expect(toast.success).not.toHaveBeenCalled();
    expect(d.getByRole("button", { name: "Guardar tarifa" })).toBeDisabled();
    await waitFor(() => expect(api.listRates.mock.calls.length).toBeGreaterThan(callsBefore));

    api.listRates.mockResolvedValue([rate({ name: "Tarifa de la otra persona" })]);
    await userEvent.click(d.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Tarifa de la otra persona")).toBeInTheDocument();
  });
});

describe("Tarifas: archivar y restaurar", () => {
  it("pide confirmar; si es la ÚNICA tarifa activa lo advierte; confirmar archiva con la versión leída", async () => {
    renderPage();
    await screen.findByText("Entrega fija");
    await userEvent.click(
      screen.getByRole("button", { name: "Archivar la tarifa «Entrega fija»" }),
    );
    const d = within(dialog());
    expect(
      d.getByRole("heading", { name: "¿Archivar la tarifa «Entrega fija»?" }),
    ).toBeInTheDocument();
    expect(d.getByText(/Es la única tarifa activa de este método/)).toBeInTheDocument();
    expect(api.setRateArchived).not.toHaveBeenCalled();

    await userEvent.click(d.getByRole("button", { name: "Archivar tarifa" }));
    await waitFor(() => expect(api.setRateArchived).toHaveBeenCalledTimes(1));
    expect(api.setRateArchived).toHaveBeenCalledWith(
      "r1",
      "2026-11-05T10:00:00.123456+00:00",
      true,
    );
    expect(toast.success).toHaveBeenCalledWith("Tarifa archivada.");
  });

  it("con otra tarifa activa NO advierte, y «Cancelar» no archiva nada", async () => {
    api.listRates.mockResolvedValue([rate(), rate({ id: "r9", name: "Otra", priority: 50 })]);
    renderPage();
    await screen.findByText("Otra");
    await userEvent.click(
      screen.getByRole("button", { name: "Archivar la tarifa «Entrega fija»" }),
    );
    const d = within(dialog());
    expect(d.queryByText(/Es la única tarifa activa/)).not.toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setRateArchived).not.toHaveBeenCalled();
  });

  it("restaurar una archivada no pide confirmación y manda archived=false", async () => {
    api.listRates.mockResolvedValue([rate({ name: "Vieja", archived: true })]);
    renderPage();
    await screen.findByText("Vieja");
    await userEvent.click(screen.getByRole("button", { name: "Restaurar la tarifa «Vieja»" }));
    await waitFor(() => expect(api.setRateArchived).toHaveBeenCalledTimes(1));
    expect(api.setRateArchived).toHaveBeenCalledWith(
      "r1",
      "2026-11-05T10:00:00.123456+00:00",
      false,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Tarifa restaurada.");
  });

  it("si alguien cambió la tarifa antes, avisa del conflicto, no archiva y refresca la lista", async () => {
    api.setRateArchived.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Entrega fija");
    const callsBefore = api.listRates.mock.calls.length;
    await userEvent.click(
      screen.getByRole("button", { name: "Archivar la tarifa «Entrega fija»" }),
    );
    await userEvent.click(within(dialog()).getByRole("button", { name: "Archivar tarifa" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Otra persona guardó cambios"),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listRates.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

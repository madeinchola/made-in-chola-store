import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { CurrenciesPage } from "./CurrenciesPage";
import type { RateRow } from "./rates";
import type { CountryRow, CurrencyRow, ImpactCandidates, RateHistoryRow } from "./types";

const api = vi.hoisted(() => ({
  listCurrencies: vi.fn(),
  listCountries: vi.fn(),
  getCurrentRates: vi.fn(),
  listRateHistory: vi.fn(),
  listImpactCandidates: vi.fn(),
  setCurrencyEnabled: vi.fn(),
  createExchangeRate: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Reloj fijo (solo Date, para que los temporizadores de las pruebas sigan andando): 30/10/2026 12:00 UTC = 08:00 en La Paz.
const NOW = "2026-10-30T12:00:00.000Z";

const cur = (
  code: string,
  name: string,
  enabled: boolean,
  decimals = 2,
  symbol = code,
): CurrencyRow => ({
  code,
  name,
  symbol,
  decimals,
  enabled,
  updatedAt: `2026-10-01T10:00:00.00000${code.length}+00:00`,
});
const BOB = cur("BOB", "Boliviano", true, 2, "Bs");
const USD = cur("USD", "Dólar estadounidense", true, 2, "$");
const EUR = cur("EUR", "Euro", false, 2, "€");
const CLP = cur("CLP", "Peso chileno", true, 0, "CLP$");

const rate = (
  id: number,
  to: string,
  value: string,
  validFrom: string,
  mode: "fixed" | "variable" = "fixed",
): RateRow => ({
  id,
  fromCurrency: "BOB",
  toCurrency: to,
  rate: value,
  mode,
  validFrom,
});
const USD_RATE = rate(7, "USD", "0.145", "2026-10-01T04:00:00+00:00");
const CLP_RATE = rate(9, "CLP", "130.5", "2026-10-15T04:00:00+00:00", "variable");

const country = (
  code: string,
  name: string,
  currencyCode: string,
  enabled: boolean,
): CountryRow => ({
  code,
  name,
  currencyCode,
  enabled,
});

const hist = (r: RateRow): RateHistoryRow => ({ ...r, createdAt: "2026-10-02T10:00:00+00:00" });

const impact = (over: Partial<ImpactCandidates> = {}): ImpactCandidates => ({
  products: [
    { id: "p1", code: "CHQ", name: "Chaqueta", priceBob: "125.5" },
    { id: "p2", code: "GOR", name: "Gorra", priceBob: "10.05" },
  ],
  total: 2,
  truncated: false,
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurrenciesPage />
    </QueryClientProvider>,
  );
}

const rowOfCurrency = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const openRateDialog = async (name: string) => {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: `Nuevo tipo de cambio para ${name}` }),
  );
  const dialog = await screen.findByRole("dialog", { name: /Nuevo tipo de cambio —/ });
  return { user, dialog: within(dialog) };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  api.listCurrencies.mockResolvedValue([BOB, CLP, EUR, USD]);
  api.listCountries.mockResolvedValue([
    country("BO", "Bolivia", "BOB", true),
    country("EC", "Ecuador", "USD", true),
    country("PA", "Panamá", "USD", false),
  ]);
  api.getCurrentRates.mockResolvedValue({ USD: USD_RATE, CLP: CLP_RATE, EUR: null });
  api.listRateHistory.mockResolvedValue({
    rows: [
      hist(CLP_RATE),
      hist(USD_RATE),
      hist(rate(3, "USD", "0.14", "2026-01-01T04:00:00+00:00")),
    ],
    total: 3,
  });
  api.listImpactCandidates.mockResolvedValue(impact());
  api.setCurrencyEnabled.mockResolvedValue("v2");
  api.createExchangeRate.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("CurrenciesPage: lista", () => {
  it("muestra cada moneda con su código, símbolo, nombre y decimales; BOB es la base y no se puede desactivar", async () => {
    renderPage();
    await screen.findByText("Dólar estadounidense");
    const bob = rowOfCurrency("Boliviano");
    expect(within(bob).getByText("Moneda base")).toBeInTheDocument();
    expect(within(bob).getByRole("switch", { name: "Moneda Boliviano" })).toBeDisabled();
    expect(within(bob).getByText("La moneda base no se puede desactivar.")).toBeInTheDocument();
    expect(
      within(bob).queryByRole("button", { name: /Nuevo tipo de cambio/ }),
    ).not.toBeInTheDocument();
    const clp = rowOfCurrency("Peso chileno");
    expect(within(clp).getByText("0")).toBeInTheDocument(); // decimales
  });

  it("el interruptor refleja si la moneda está activa y lo dice también con texto", async () => {
    renderPage();
    await screen.findByText("Euro");
    expect(within(rowOfCurrency("Euro")).getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(rowOfCurrency("Euro")).getByText("Desactivada")).toBeInTheDocument();
    expect(within(rowOfCurrency("Dólar estadounidense")).getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(rowOfCurrency("Dólar estadounidense")).getByText("Activa")).toBeInTheDocument();
  });

  it("muestra el tipo de cambio VIGENTE de cada moneda (tasa, desde cuándo, fijo/variable) o que no hay", async () => {
    renderPage();
    await screen.findByText("1 BOB = 0.145 USD");
    const usd = rowOfCurrency("Dólar estadounidense");
    expect(within(usd).getByText(/desde 1\/10\/26.*00:00/)).toBeInTheDocument(); // 04:00 UTC = 00:00 en La Paz
    expect(within(usd).getByText(/fijo/)).toBeInTheDocument();
    expect(
      within(rowOfCurrency("Peso chileno")).getByText("1 BOB = 130.5 CLP"),
    ).toBeInTheDocument();
    expect(within(rowOfCurrency("Peso chileno")).getByText(/variable/)).toBeInTheDocument();
    expect(within(rowOfCurrency("Euro")).getByText("Sin tipo de cambio")).toBeInTheDocument();
  });

  it("pide las tasas SOLO de las monedas que no son la base", async () => {
    renderPage();
    await screen.findByText("1 BOB = 0.145 USD");
    const codes = api.getCurrentRates.mock.lastCall?.[0] as string[];
    expect([...codes].sort()).toEqual(["CLP", "EUR", "USD"]);
  });

  it("error de carga con reintento", async () => {
    api.listCurrencies.mockRejectedValueOnce(new AppError("network", "x"));
    renderPage();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("No pudimos cargar los datos");
    const user = userEvent.setup();
    await user.click(within(alerts[0] as HTMLElement).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Euro")).toBeInTheDocument();
  });
});

describe("CurrenciesPage: activar y desactivar", () => {
  it("activar pide confirmación; al cancelar no se toca nada", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Euro");
    await user.click(within(rowOfCurrency("Euro")).getByRole("switch"));
    const dialog = await screen.findByRole("dialog", { name: "¿Activar Euro?" });
    expect(within(dialog).getByText(/empezarán a mostrarse/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setCurrencyEnabled).not.toHaveBeenCalled();
  });

  it("al confirmar activa con la versión leída y avisa", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Euro");
    await user.click(within(rowOfCurrency("Euro")).getByRole("switch"));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Activar moneda" }),
    );
    await waitFor(() => expect(api.setCurrencyEnabled).toHaveBeenCalledWith(EUR, true));
    expect(toast.success).toHaveBeenCalledWith("Moneda activada.");
  });

  it("desactivar advierte de los países ACTIVOS que la usan (no de los inactivos)", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Dólar estadounidense");
    await user.click(within(rowOfCurrency("Dólar estadounidense")).getByRole("switch"));
    const dialog = await screen.findByRole("dialog", { name: "¿Desactivar Dólar estadounidense?" });
    expect(
      within(dialog).getByText(/Países activos que usan esta moneda: Ecuador\./),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Panamá/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Desactivar moneda" }));
    await waitFor(() => expect(api.setCurrencyEnabled).toHaveBeenCalledWith(USD, false));
    expect(toast.success).toHaveBeenCalledWith("Moneda desactivada.");
  });

  it("si ningún país activo la usa, lo dice", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Peso chileno");
    await user.click(within(rowOfCurrency("Peso chileno")).getByRole("switch"));
    expect(await screen.findByText(/Ningún país activo usa esta moneda\./)).toBeInTheDocument();
  });

  it("si la base rechaza, avisa con el motivo y el diálogo queda abierto", async () => {
    api.setCurrencyEnabled.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Euro");
    await user.click(within(rowOfCurrency("Euro")).getByRole("switch"));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Activar moneda" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un conflicto de edición muestra el aviso de conflicto", async () => {
    api.setCurrencyEnabled.mockRejectedValue(new StaleVersionError());
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Euro");
    await user.click(within(rowOfCurrency("Euro")).getByRole("switch"));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Activar moneda" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Otra persona guardó cambios"),
      ),
    );
  });
});

describe("CurrenciesPage: historial", () => {
  it("lista todos los registros y marca como 'Vigente' solo los que rigen hoy", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Historial de tipos de cambio" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText("BOB → CLP")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("130.5")).toBeInTheDocument();
    // Las tasas vigentes llegan en otra consulta: el marcador aparece cuando están.
    await waitFor(() =>
      expect(within(rows[0] as HTMLElement).getByText("Vigente")).toBeInTheDocument(),
    ); // id 9
    expect(within(rows[1] as HTMLElement).getByText("Vigente")).toBeInTheDocument(); // id 7
    expect(within(rows[2] as HTMLElement).queryByText("Vigente")).not.toBeInTheDocument(); // id 3, ya superado
    expect(within(rows[2] as HTMLElement).getByText("0.14")).toBeInTheDocument();
  });

  it("pagina en el servidor: 25 registros a 10 por página son 3 páginas; 'Siguiente' pide la 2", async () => {
    api.listRateHistory.mockResolvedValue({ rows: [hist(USD_RATE)], total: 25 });
    renderPage();
    const user = userEvent.setup();
    const nav = await screen.findByRole("navigation", { name: "Paginación" });
    expect(within(nav).getByText("Página 1 de 3")).toBeInTheDocument();
    expect(api.listRateHistory).toHaveBeenLastCalledWith(1, 10);
    await user.click(within(nav).getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(api.listRateHistory).toHaveBeenLastCalledWith(2, 10));
  });

  it("sin registros lo dice y no muestra paginación", async () => {
    api.listRateHistory.mockResolvedValue({ rows: [], total: 0 });
    renderPage();
    expect(
      await screen.findByText("Todavía no hay tipos de cambio registrados."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Paginación" })).not.toBeInTheDocument();
  });
});

describe("CurrenciesPage: nuevo tipo de cambio", () => {
  const rateInput = (dialog: ReturnType<typeof within>) =>
    dialog.getByLabelText(/Tasa \(1 BOB = \?/);
  const submit = (dialog: ReturnType<typeof within>) =>
    dialog.getByRole("button", { name: "Guardar tipo de cambio" });

  it("explica que el registro es inmutable, muestra la tasa vigente y arranca vigente desde AHORA (hora de La Paz)", async () => {
    renderPage();
    const { dialog } = await openRateDialog("Dólar estadounidense");
    expect(screen.getByText(/NO se puede editar ni borrar después/)).toBeInTheDocument();
    expect(dialog.getByText(/Tasa vigente: 0\.145 \(desde 1\/10\/26/)).toBeInTheDocument();
    expect(dialog.getByLabelText("Vigente desde (hora de La Paz)")).toHaveValue("2026-10-30T08:00");
    expect(dialog.getByLabelText("Tipo")).toHaveValue("fixed");
  });

  it("sin tasa vigente lo dice", async () => {
    renderPage();
    const { dialog } = await openRateDialog("Euro");
    expect(dialog.getByText("Todavía no hay tasa vigente para esta moneda.")).toBeInTheDocument();
  });

  it("una moneda desactivada avisa que los precios no se mostrarán hasta activarla", async () => {
    renderPage();
    const { dialog } = await openRateDialog("Euro");
    expect(dialog.getByText(/Euro está desactivada/)).toBeInTheDocument();
  });

  it("vista previa con tasa vacía o inválida: pide escribir una tasa válida", async () => {
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    expect(
      await dialog.findByText("Escribe una tasa válida para ver el impacto."),
    ).toBeInTheDocument();
    await user.type(rateInput(dialog), "abc");
    expect(dialog.getByText("Escribe una tasa válida para ver el impacto.")).toBeInTheDocument();
  });

  it("vista previa en vivo: precio de ahora vs. nuevo, redondeo como la base (125.50 × 0.15 = 18.825 → 18.83)", async () => {
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0,15");
    const table = await dialog.findByRole("table", { name: "Vista previa de impacto" });
    const rows = within(table).getAllByRole("row").slice(1);
    const cells = (i: number) =>
      within(rows[i] as HTMLElement)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(within(rows[0] as HTMLElement).getByRole("rowheader")).toHaveTextContent("Chaqueta");
    expect(cells(0)).toEqual(["125.5", "18.20 USD", "18.83 USD"]); // 18.1975 → 18.20 · 18.825 → 18.83
    expect(within(rows[1] as HTMLElement).getByRole("rowheader")).toHaveTextContent("Gorra");
    expect(cells(1)).toEqual(["10.05", "1.46 USD", "1.51 USD"]); // 1.45725 → 1.46 · 1.5075 → 1.51
    expect(dialog.getByText("Mostrando 2 de 2 productos.")).toBeInTheDocument();
  });

  it("la vista previa se recalcula al cambiar la tasa", async () => {
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0.15");
    await dialog.findByText("18.83 USD");
    await user.clear(rateInput(dialog));
    await user.type(rateInput(dialog), "0.14");
    expect(await dialog.findByText("17.57 USD")).toBeInTheDocument(); // 125.50 × 0.14 = 17.57
    expect(dialog.queryByText("18.83 USD")).not.toBeInTheDocument();
  });

  it("monedas sin decimales (CLP): redondea a enteros como la base (16377.75 → 16378; 17570)", async () => {
    api.listImpactCandidates.mockResolvedValue(impact());
    renderPage();
    const { user, dialog } = await openRateDialog("Peso chileno");
    await user.type(rateInput(dialog), "140");
    const table = await dialog.findByRole("table", { name: "Vista previa de impacto" });
    const rows = within(table).getAllByRole("row").slice(1);
    const cells = (i: number) =>
      within(rows[i] as HTMLElement)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(cells(0)).toEqual(["125.5", "16378 CLP", "17570 CLP"]);
    expect(cells(1)).toEqual(["10.05", "1312 CLP", "1407 CLP"]); // 1311.525 → 1312
  });

  it("sin tasa vigente, la columna 'Ahora' muestra un guion", async () => {
    renderPage();
    const { user, dialog } = await openRateDialog("Euro");
    await user.type(rateInput(dialog), "0.14");
    const table = await dialog.findByRole("table", { name: "Vista previa de impacto" });
    const cells = within(within(table).getAllByRole("row")[1] as HTMLElement)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells).toEqual(["125.5", "—", "17.57 EUR"]);
  });

  it("sin productos que calculen su precio desde bolivianos, lo dice", async () => {
    api.listImpactCandidates.mockResolvedValue(impact({ products: [], total: 0 }));
    renderPage();
    const { dialog } = await openRateDialog("Dólar estadounidense");
    expect(
      await dialog.findByText(
        /Ningún producto publicado calcula su precio en USD desde bolivianos/,
      ),
    ).toBeInTheDocument();
  });

  it("si hay más de 100 candidatos avisa que el total es un mínimo", async () => {
    api.listImpactCandidates.mockResolvedValue(impact({ total: 100, truncated: true }));
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0.15");
    expect(await dialog.findByText("Mostrando 2 de al menos 100 productos.")).toBeInTheDocument();
  });

  it("una fecha futura avisa que la tasa nueva aún no rige", async () => {
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0.15");
    fireEvent.change(dialog.getByLabelText("Vigente desde (hora de La Paz)"), {
      target: { value: "2026-11-02T10:00" },
    });
    expect(
      await dialog.findByText(/Esta tasa empieza a regir el 2\/11\/26.*10:00/),
    ).toBeInTheDocument();
  });

  it.each([
    ["", "Escribe la tasa."],
    ["abc", "Escribe un número como 6,96 o 0.145"],
    ["0", "La tasa debe ser mayor que 0."],
    ["0,00", "La tasa debe ser mayor que 0."],
    ["0.123456789", "Máximo 8 decimales."],
    ["12345678901", "La tasa es demasiado grande"],
    ["-1", "Escribe un número como 6,96 o 0.145"],
  ])("tasa «%s» → «%s» y NO se llama a la base", async (text, message) => {
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    if (text) await user.type(rateInput(dialog), text);
    await user.click(submit(dialog));
    expect(
      await dialog.findByText(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();
    expect(api.createExchangeRate).not.toHaveBeenCalled();
    expect(rateInput(dialog)).toHaveAttribute("aria-invalid", "true");
  });

  it("un cambio normal se guarda directo: tasa normalizada, moneda, tipo y fecha en UTC; avisa y cierra", async () => {
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0,15"); // +3.4 %
    await user.click(submit(dialog));
    await waitFor(() => expect(api.createExchangeRate).toHaveBeenCalledTimes(1));
    expect(api.createExchangeRate).toHaveBeenCalledWith({
      toCurrency: "USD",
      rate: "0.15",
      mode: "fixed",
      validFrom: "2026-10-30T12:00:00.000Z", // 08:00 en La Paz
    });
    expect(toast.success).toHaveBeenCalledWith("Tipo de cambio guardado.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listRateHistory.mock.calls.length).toBeGreaterThan(1); // el historial se volvió a pedir
  });

  it("manda el tipo 'variable' y una fecha futura cercana sin pedir confirmación", async () => {
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0.15");
    await user.selectOptions(dialog.getByLabelText("Tipo"), "Variable");
    fireEvent.change(dialog.getByLabelText("Vigente desde (hora de La Paz)"), {
      target: { value: "2026-11-02T10:00" },
    });
    await user.click(submit(dialog));
    await waitFor(() => expect(api.createExchangeRate).toHaveBeenCalled());
    expect(api.createExchangeRate).toHaveBeenCalledWith({
      toCurrency: "USD",
      rate: "0.15",
      mode: "variable",
      validFrom: "2026-11-02T14:00:00.000Z",
    });
  });

  it("borrar la fecha deja que la base ponga 'ahora' (validFrom null)", async () => {
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0.15");
    fireEvent.change(dialog.getByLabelText("Vigente desde (hora de La Paz)"), {
      target: { value: "" },
    });
    await user.click(submit(dialog));
    await waitFor(() => expect(api.createExchangeRate).toHaveBeenCalled());
    expect(api.createExchangeRate.mock.lastCall?.[0].validFrom).toBeNull();
  });

  describe("confirmación (el libro es inmutable)", () => {
    it("una variación de EXACTAMENTE +25 % no pide confirmación", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "0.18125"); // 0.145 × 1.25
      await user.click(submit(dialog));
      await waitFor(() => expect(api.createExchangeRate).toHaveBeenCalledTimes(1));
      expect(
        screen.queryByRole("dialog", { name: "Revisa antes de guardar" }),
      ).not.toBeInTheDocument();
    });

    it("un poco más de +25 % SÍ la pide, con el porcentaje y la tasa anterior", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "0.1812501");
      await user.click(submit(dialog));
      const confirm = within(
        await screen.findByRole("dialog", { name: "Revisa antes de guardar" }),
      );
      expect(confirm.getByText(/no se puede editar ni borrar/)).toBeInTheDocument();
      expect(
        confirm.getByText(/cambia \+25\.0 % respecto de la vigente \(0\.145\)/),
      ).toBeInTheDocument();
      expect(api.createExchangeRate).not.toHaveBeenCalled();
    });

    it("el error de tipeo típico (0.145 → 1.45, +900 %) pide confirmar; 'Volver a revisar' NO guarda", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "1.45");
      await user.click(submit(dialog));
      const confirm = within(
        await screen.findByRole("dialog", { name: "Revisa antes de guardar" }),
      );
      expect(confirm.getByText(/cambia \+900\.0 %/)).toBeInTheDocument();
      await user.click(confirm.getByRole("button", { name: "Volver a revisar" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Revisa antes de guardar" }),
        ).not.toBeInTheDocument(),
      );
      expect(api.createExchangeRate).not.toHaveBeenCalled();
      expect(rateInput(dialog)).toHaveValue("1.45"); // lo escrito sigue ahí para corregirlo
    });

    it("'Sí, guardar' guarda con la tasa escrita", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "1.45");
      await user.click(submit(dialog));
      await user.click(
        within(await screen.findByRole("dialog", { name: "Revisa antes de guardar" })).getByRole(
          "button",
          { name: "Sí, guardar" },
        ),
      );
      await waitFor(() => expect(api.createExchangeRate).toHaveBeenCalledTimes(1));
      expect(api.createExchangeRate.mock.lastCall?.[0]).toMatchObject({
        toCurrency: "USD",
        rate: "1.45",
      });
    });

    it("una bajada de más de 25 % también la pide (0.145 → 0.1)", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "0.1");
      await user.click(submit(dialog));
      expect(await screen.findByText(/cambia -31\.0 %/)).toBeInTheDocument();
    });

    it("fecha a EXACTAMENTE 7 días: sin confirmación; un minuto más: con confirmación", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "0.15");
      fireEvent.change(dialog.getByLabelText("Vigente desde (hora de La Paz)"), {
        target: { value: "2026-11-06T08:00" },
      });
      await user.click(submit(dialog));
      await waitFor(() => expect(api.createExchangeRate).toHaveBeenCalledTimes(1));
    });

    it("fecha a más de 7 días (futuro) pide confirmación y la nombra", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "0.15");
      fireEvent.change(dialog.getByLabelText("Vigente desde (hora de La Paz)"), {
        target: { value: "2026-11-06T08:01" },
      });
      await user.click(submit(dialog));
      const confirm = within(
        await screen.findByRole("dialog", { name: "Revisa antes de guardar" }),
      );
      expect(confirm.getByText(/\(6\/11\/26.*08:01\) queda a más de 7 días/)).toBeInTheDocument();
      expect(confirm.queryByText(/cambia/)).not.toBeInTheDocument();
      expect(api.createExchangeRate).not.toHaveBeenCalled();
    });

    it("fecha a más de 7 días en el PASADO también pide confirmación", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "0.15");
      fireEvent.change(dialog.getByLabelText("Vigente desde (hora de La Paz)"), {
        target: { value: "2026-10-01T08:00" },
      });
      await user.click(submit(dialog));
      expect(
        await screen.findByRole("dialog", { name: "Revisa antes de guardar" }),
      ).toBeInTheDocument();
    });

    it("cambio brusco Y fecha lejana: lista las dos razones", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Dólar estadounidense");
      await user.type(rateInput(dialog), "1.45");
      fireEvent.change(dialog.getByLabelText("Vigente desde (hora de La Paz)"), {
        target: { value: "2027-01-01T08:00" },
      });
      await user.click(submit(dialog));
      const confirm = within(
        await screen.findByRole("dialog", { name: "Revisa antes de guardar" }),
      );
      expect(confirm.getAllByRole("listitem")).toHaveLength(2);
    });

    it("sin tasa vigente no hay con qué comparar: solo la fecha puede pedir confirmación", async () => {
      renderPage();
      const { user, dialog } = await openRateDialog("Euro");
      await user.type(rateInput(dialog), "9999");
      await user.click(submit(dialog));
      await waitFor(() => expect(api.createExchangeRate).toHaveBeenCalledTimes(1));
    });
  });

  it("si la base rechaza, muestra el motivo en el diálogo y NO lo cierra", async () => {
    api.createExchangeRate.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0.15");
    await user.click(submit(dialog));
    expect(await dialog.findByRole("alert")).toHaveTextContent("No tienes permiso");
    expect(screen.getByRole("dialog", { name: /Nuevo tipo de cambio —/ })).toBeInTheDocument();
    expect(rateInput(dialog)).toHaveValue("0.15");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un doble clic en guardar crea un solo registro (el botón se bloquea)", async () => {
    let finish: (v?: unknown) => void = () => {};
    api.createExchangeRate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    const { user, dialog } = await openRateDialog("Dólar estadounidense");
    await user.type(rateInput(dialog), "0.15");
    await user.click(submit(dialog));
    const busy = await dialog.findByRole("button", { name: "Guardando…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(api.createExchangeRate).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancelar no guarda, y al reabrir el formulario está en blanco", async () => {
    renderPage();
    const first = await openRateDialog("Dólar estadounidense");
    await first.user.type(rateInput(first.dialog), "0.15");
    await first.user.click(first.dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createExchangeRate).not.toHaveBeenCalled();
    const again = await openRateDialog("Dólar estadounidense");
    expect(rateInput(again.dialog)).toHaveValue("");
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { SettingRow } from "../config/types";
import { StaleVersionError } from "../lib/versioned";
import { ShippingDeliveryPage } from "./SlotsPage";
import type { DeliverySlot, ShippingMethod } from "./types";

const api = vi.hoisted(() => ({
  listLocations: vi.fn(),
  listMethods: vi.fn(),
  listZones: vi.fn(),
  listRates: vi.fn(),
  listSlots: vi.fn(),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  setSlotArchived: vi.fn(),
  listBlockedDates: vi.fn(),
  createBlockedDate: vi.fn(),
  updateBlockedDateReason: vi.fn(),
  setBlockedDateArchived: vi.fn(),
}));
vi.mock("./api", () => api);
const settingsApi = vi.hoisted(() => ({ listSettings: vi.fn() }));
vi.mock("../config/api", () => settingsApi);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const setting = (key: string, value: unknown): SettingRow => ({
  key,
  value,
  valueType: "int",
  isPublic: false,
  description: null,
  updatedAt: "2026-11-01T10:00:00+00:00",
});

const method = (over: Partial<ShippingMethod> = {}): ShippingMethod => ({
  id: "m1",
  code: "delivery",
  name: "Entrega a domicilio",
  kind: "delivery",
  description: null,
  etaMinDays: 1,
  etaMaxDays: 2,
  pickupLocationId: null,
  isActive: true,
  sortOrder: 1,
  archived: false,
  updatedAt: "2026-11-01T10:00:00.111111+00:00",
  ...over,
});

let seq = 0;
const slot = (over: Partial<DeliverySlot> = {}): DeliverySlot => ({
  id: `s${++seq}`,
  methodId: "m1",
  weekday: 1,
  startTime: "09:00",
  endTime: "12:00",
  capacity: 5,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-01T10:00:00.123456+00:00",
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ShippingDeliveryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const slotsSection = () => screen.getByRole("region", { name: "Franjas por día de la semana" });
const rulesSection = () => screen.getByRole("region", { name: "Reglas del calendario" });
const dayBlock = (name: string) =>
  screen.getByRole("heading", { level: 3, name }).closest("section") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  settingsApi.listSettings.mockResolvedValue([
    setting("delivery_min_lead_hours", 36),
    setting("delivery_max_days_ahead", 45),
  ]);
  api.listMethods.mockResolvedValue([method()]);
  api.listSlots.mockResolvedValue([]);
  api.listBlockedDates.mockResolvedValue([]);
  api.createSlot.mockResolvedValue(slot());
  api.updateSlot.mockResolvedValue("v2");
  api.setSlotArchived.mockResolvedValue("v2");
});

describe("Entregas: reglas del calendario (solo lectura, vienen de Ajustes)", () => {
  it("muestra la antelación y los días hacia adelante LEÍDOS de los ajustes, con enlace a Ajustes", async () => {
    renderPage();
    const rules = within(rulesSection());
    expect(await rules.findByText("Antelación mínima: 36 horas")).toBeInTheDocument();
    expect(rules.getByText("Se puede programar hasta 45 días adelante")).toBeInTheDocument();
    const link = rules.getByRole("link", { name: /Cambiar en Ajustes/ });
    expect(link).toHaveAttribute("href", "/admin/ajustes#settings-shipping");
    // y no tiene controles para editarlos aquí
    expect(rules.queryByRole("textbox")).not.toBeInTheDocument();
    expect(rules.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("en singular: «1 hora» y «1 día»", async () => {
    settingsApi.listSettings.mockResolvedValue([
      setting("delivery_min_lead_hours", 1),
      setting("delivery_max_days_ahead", 1),
    ]);
    renderPage();
    expect(await screen.findByText("Antelación mínima: 1 hora")).toBeInTheDocument();
    expect(screen.getByText("Se puede programar hasta 1 día adelante")).toBeInTheDocument();
  });

  it("avisa si la antelación llega más allá del último día permitido (ninguna franja podría ofrecerse)", async () => {
    settingsApi.listSettings.mockResolvedValue([
      setting("delivery_min_lead_hours", 720),
      setting("delivery_max_days_ahead", 5),
    ]);
    renderPage();
    const alert = await within(rulesSection()).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Con una antelación de 720 horas y un tope de 5 días, ninguna franja podrá ofrecerse",
    );
  });

  it("el borde exacto avisa: 144 h con 5 días (= 6 × 24) ya no deja ninguna franja", async () => {
    settingsApi.listSettings.mockResolvedValue([
      setting("delivery_min_lead_hours", 144),
      setting("delivery_max_days_ahead", 5),
    ]);
    renderPage();
    expect(await within(rulesSection()).findByRole("alert")).toBeInTheDocument();
  });

  it("sin contradicción no avisa: el borde es 24 h por día permitido + 1 día (143 h con 5 días SÍ alcanza; 144 no)", async () => {
    settingsApi.listSettings.mockResolvedValue([
      setting("delivery_min_lead_hours", 143),
      setting("delivery_max_days_ahead", 5),
    ]);
    renderPage();
    await screen.findByText("Antelación mínima: 143 horas");
    expect(within(rulesSection()).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("con antelación 0 dice «0 horas»", async () => {
    settingsApi.listSettings.mockResolvedValue([
      setting("delivery_min_lead_hours", 0),
      setting("delivery_max_days_ahead", 30),
    ]);
    renderPage();
    expect(await screen.findByText("Antelación mínima: 0 horas")).toBeInTheDocument();
  });

  it("si un ajuste no está, lo dice en vez de inventar un valor", async () => {
    settingsApi.listSettings.mockResolvedValue([setting("delivery_min_lead_hours", 24)]);
    renderPage();
    expect(await screen.findByText("Antelación mínima: 24 horas")).toBeInTheDocument();
    expect(
      screen.getByText(/Hasta cuántos días adelante se puede programar: sin dato/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hasta 30 días/)).not.toBeInTheDocument();
  });

  it("cargando: avisa; con error: ofrece reintentar y luego muestra los valores", async () => {
    settingsApi.listSettings.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = renderPage();
    expect(within(rulesSection()).getByRole("status")).toHaveTextContent("Cargando…");
    unmount();

    settingsApi.listSettings.mockReset();
    settingsApi.listSettings
      .mockRejectedValueOnce(new AppError("network", "x"))
      .mockResolvedValue([
        setting("delivery_min_lead_hours", 12),
        setting("delivery_max_days_ahead", 20),
      ]);
    renderPage();
    const rules = within(rulesSection());
    expect(await rules.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    await userEvent.setup().click(rules.getByRole("button", { name: "Reintentar" }));
    expect(await rules.findByText("Antelación mínima: 12 horas")).toBeInTheDocument();
    expect(settingsApi.listSettings).toHaveBeenCalledTimes(2);
  });
});

describe("Entregas: franjas por día de la semana", () => {
  it("lista los siete días de lunes a domingo, cada uno con «Sin franjas» si está vacío", async () => {
    renderPage();
    await within(slotsSection()).findByText("Método: Entrega a domicilio");
    const days = within(slotsSection())
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(days).toEqual([
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
      "Domingo",
    ]);
    expect(within(slotsSection()).getAllByText("Sin franjas")).toHaveLength(7);
  });

  it("pone cada franja en su día, ordenada por hora, con cupo y estado", async () => {
    api.listSlots.mockResolvedValue([
      slot({ weekday: 3, startTime: "14:00", endTime: "16:30", capacity: 8 }),
      slot({ weekday: 3, startTime: "08:00", endTime: "10:00", capacity: 3, isActive: false }),
      slot({ weekday: 7, startTime: "10:00", endTime: "12:00", capacity: 1 }),
    ]);
    renderPage();
    await screen.findByText("Cupo: 3 por día");
    const wednesday = within(dayBlock("Miércoles"));
    const items = wednesday.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("08:00–10:00");
    expect(items[0]).toContain("Cupo: 3 por día");
    expect(items[0]).toContain("Inactiva");
    expect(items[1]).toContain("14:00–16:30");
    expect(items[1]).toContain("Cupo: 8 por día");
    expect(items[1]).toContain("Activa");
    expect(within(dayBlock("Domingo")).getByText("10:00–12:00")).toBeInTheDocument();
    expect(within(dayBlock("Lunes")).getByText("Sin franjas")).toBeInTheDocument();
  });

  it("las archivadas no se ven hasta marcar «Mostrar franjas archivadas»", async () => {
    api.listSlots.mockResolvedValue([
      slot({ weekday: 2, startTime: "09:00", endTime: "10:00" }),
      slot({ weekday: 2, startTime: "11:00", endTime: "12:00", archived: true }),
    ]);
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("09:00–10:00");
    expect(screen.queryByText("11:00–12:00")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Mostrar franjas archivadas (1)" }));
    const archived = within(dayBlock("Martes"))
      .getByText("11:00–12:00")
      .closest("li") as HTMLElement;
    expect(within(archived).getByText("Archivada")).toBeInTheDocument();
    expect(
      within(archived).getByRole("button", { name: /Restaurar la franja/ }),
    ).toBeInTheDocument();
    expect(within(archived).queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
  });

  it("con UN método de domicilio no hay selector; con varios sí, y cambia las franjas mostradas", async () => {
    api.listMethods.mockResolvedValue([
      method({ id: "m1", name: "Moto" }),
      method({ id: "m2", name: "Camioneta", sortOrder: 2 }),
      method({ id: "m3", name: "Recojo", kind: "pickup", sortOrder: 3 }),
      method({ id: "m4", name: "Inactivo", isActive: false, sortOrder: 4 }),
      method({ id: "m5", name: "Archivado", archived: true, sortOrder: 5 }),
    ]);
    api.listSlots.mockResolvedValue([
      slot({ methodId: "m1", weekday: 1, startTime: "09:00", endTime: "10:00" }),
      slot({ methodId: "m2", weekday: 1, startTime: "15:00", endTime: "17:00" }),
    ]);
    renderPage();
    const user = userEvent.setup();
    const select = await within(slotsSection()).findByLabelText("Método de entrega");
    expect([...(select as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      "Moto",
      "Camioneta",
    ]);
    expect(screen.getByText("09:00–10:00")).toBeInTheDocument();
    expect(screen.queryByText("15:00–17:00")).not.toBeInTheDocument();
    await user.selectOptions(select, "m2");
    expect(screen.getByText("15:00–17:00")).toBeInTheDocument();
    expect(screen.queryByText("09:00–10:00")).not.toBeInTheDocument();
  });

  it("con un solo método lo nombra y no ofrece selector", async () => {
    renderPage();
    expect(
      await within(slotsSection()).findByText("Método: Entrega a domicilio"),
    ).toBeInTheDocument();
    expect(within(slotsSection()).queryByLabelText("Método de entrega")).not.toBeInTheDocument();
  });

  it("sin ningún método de domicilio activo: lo explica, ofrece ir a Tienda y métodos y no deja crear", async () => {
    api.listMethods.mockResolvedValue([
      method({ kind: "pickup" }),
      method({ id: "x", isActive: false }),
    ]);
    renderPage();
    const section = within(slotsSection());
    expect(
      await section.findByText(/No hay ningún método de entrega a domicilio activo/),
    ).toBeInTheDocument();
    expect(section.getByRole("link", { name: "Ir a Tienda y métodos" })).toHaveAttribute(
      "href",
      "/admin/envios",
    );
    expect(section.queryByRole("button", { name: "Nueva franja" })).not.toBeInTheDocument();
  });

  it("cargando: avisa; con error: ofrece reintentar y se recupera", async () => {
    api.listSlots.mockReturnValueOnce(new Promise(() => {}));
    const first = renderPage();
    expect(within(slotsSection()).getByRole("status")).toHaveTextContent("Cargando…");
    first.unmount();

    api.listSlots.mockReset();
    api.listSlots
      .mockRejectedValueOnce(new AppError("network", "x"))
      .mockResolvedValue([slot({ weekday: 4 })]);
    renderPage();
    const section = within(slotsSection());
    expect(await section.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    await userEvent.setup().click(section.getByRole("button", { name: "Reintentar" }));
    expect(await section.findByText("09:00–12:00")).toBeInTheDocument();
  });

  it("todos los botones de la sección miden al menos 44 px (h-11)", async () => {
    api.listSlots.mockResolvedValue([slot()]);
    renderPage();
    await screen.findByText("09:00–12:00");
    for (const button of within(slotsSection()).getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("h-11");
    }
  });
});

describe("Entregas: crear una franja", () => {
  const openCreate = async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nueva franja" }));
    return { user, dialog: within(await screen.findByRole("dialog", { name: "Nueva franja" })) };
  };
  const fill = (
    dialog: ReturnType<typeof within>,
    values: { start?: string; end?: string; capacity?: string },
  ) => {
    if (values.start !== undefined)
      fireEvent.change(dialog.getByLabelText("Hora de inicio"), {
        target: { value: values.start },
      });
    if (values.end !== undefined)
      fireEvent.change(dialog.getByLabelText("Hora de fin"), { target: { value: values.end } });
    if (values.capacity !== undefined)
      fireEvent.change(dialog.getByLabelText("Cupo por día"), {
        target: { value: values.capacity },
      });
  };

  it("manda a la API EXACTAMENTE un SlotCreateInput; avisa, cierra y vuelve a leer la lista", async () => {
    const { user, dialog } = await openCreate();
    await user.selectOptions(dialog.getByLabelText("Día de la semana"), "3");
    fill(dialog, { start: "09:00", end: "11:00", capacity: " 5 " });
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    await waitFor(() => expect(api.createSlot).toHaveBeenCalledTimes(1));
    expect(api.createSlot).toHaveBeenCalledWith({
      methodId: "m1",
      weekday: 3,
      startTime: "09:00",
      endTime: "11:00",
      capacity: 5,
      isActive: true,
    });
    expect(toast.success).toHaveBeenCalledWith("Franja creada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listSlots.mock.calls.length).toBeGreaterThan(1);
  });

  it("«Activa» desmarcada se guarda como isActive: false", async () => {
    const { user, dialog } = await openCreate();
    fill(dialog, { start: "09:00", end: "11:00", capacity: "2" });
    await user.click(dialog.getByRole("checkbox", { name: /Activa/ }));
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    await waitFor(() => expect(api.createSlot).toHaveBeenCalled());
    expect(api.createSlot.mock.calls[0]?.[0]).toMatchObject({ isActive: false });
  });

  it("el botón «Agregar franja» de un día abre el formulario con ESE día elegido", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar franja (Viernes)" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Nueva franja" }));
    expect(dialog.getByLabelText("Día de la semana")).toHaveValue("5");
    fill(dialog, { start: "10:00", end: "12:00", capacity: "4" });
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    await waitFor(() => expect(api.createSlot).toHaveBeenCalled());
    expect(api.createSlot.mock.calls[0]?.[0]).toMatchObject({ weekday: 5 });
  });

  it("sin llenar nada: un mensaje junto a CADA campo, campos marcados y la API sin tocar", async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    expect(await dialog.findByText("Elige una hora de inicio válida.")).toBeInTheDocument();
    expect(dialog.getByText("Elige una hora de fin válida.")).toBeInTheDocument();
    expect(dialog.getByText("Escribe el cupo por día.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Hora de inicio")).toHaveAttribute("aria-invalid", "true");
    expect(dialog.getByLabelText("Hora de fin")).toHaveAttribute("aria-invalid", "true");
    expect(dialog.getByLabelText("Cupo por día")).toHaveAttribute("aria-invalid", "true");
    expect(api.createSlot).not.toHaveBeenCalled();
  });

  it("el fin debe ser posterior al inicio (igual y anterior se rechazan; un minuto después se acepta)", async () => {
    const { user, dialog } = await openCreate();
    fill(dialog, { start: "10:00", end: "10:00", capacity: "2" });
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    expect(
      await dialog.findByText("La hora de fin debe ser posterior a la de inicio."),
    ).toBeInTheDocument();
    fill(dialog, { end: "09:30" });
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    expect(
      dialog.getByText("La hora de fin debe ser posterior a la de inicio."),
    ).toBeInTheDocument();
    expect(api.createSlot).not.toHaveBeenCalled();
    fill(dialog, { end: "10:01" });
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    await waitFor(() => expect(api.createSlot).toHaveBeenCalledTimes(1));
  });

  it("cada cupo inválido tiene su mensaje: no entero, fuera de rango y los bordes 1 y 1000 sí pasan", async () => {
    const { user, dialog } = await openCreate();
    fill(dialog, { start: "09:00", end: "10:00" });
    const submit = () => user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    for (const [capacity, message] of [
      ["2.5", "El cupo debe ser un número entero (sin decimales ni letras)."],
      ["abc", "El cupo debe ser un número entero (sin decimales ni letras)."],
      ["0", "El cupo va de 1 a 1000."],
      ["1001", "El cupo va de 1 a 1000."],
    ] as const) {
      fill(dialog, { capacity });
      await submit();
      expect(await dialog.findByText(message), capacity).toBeInTheDocument();
    }
    expect(api.createSlot).not.toHaveBeenCalled();
    fill(dialog, { capacity: "1000" });
    await submit();
    await waitFor(() => expect(api.createSlot).toHaveBeenCalledTimes(1));
    expect(api.createSlot.mock.calls[0]?.[0]).toMatchObject({ capacity: 1000 });
  });

  it("AVISA (sin bloquear) si se solapa con otra franja del mismo día, y deja guardar", async () => {
    api.listSlots.mockResolvedValue([slot({ weekday: 1, startTime: "09:00", endTime: "12:00" })]);
    const { user, dialog } = await openCreate();
    await screen.findByText("09:00–12:00");
    fill(dialog, { start: "11:00", end: "13:00", capacity: "3" });
    expect(
      await dialog.findByText(/Se solapa con otra franja de ese día \(09:00–12:00\)/),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    await waitFor(() => expect(api.createSlot).toHaveBeenCalledTimes(1));
  });

  it("BORDE: empezar justo cuando otra termina (12:00) NO avisa de solape", async () => {
    api.listSlots.mockResolvedValue([slot({ weekday: 1, startTime: "09:00", endTime: "12:00" })]);
    const { dialog } = await openCreate();
    await screen.findByText("09:00–12:00");
    fill(dialog, { start: "12:00", end: "14:00", capacity: "3" });
    expect(dialog.queryByText(/Se solapa/)).not.toBeInTheDocument();
  });

  it("solo avisa por las franjas del MISMO día", async () => {
    api.listSlots.mockResolvedValue([slot({ weekday: 2, startTime: "09:00", endTime: "12:00" })]);
    const { dialog } = await openCreate();
    await screen.findByText("09:00–12:00");
    fill(dialog, { start: "10:00", end: "11:00", capacity: "3" }); // el diálogo abre en lunes
    expect(dialog.queryByText(/Se solapa/)).not.toBeInTheDocument();
  });

  it("empezar a la MISMA hora que otra del día NO se puede (la base lo rechaza): error junto al inicio", async () => {
    api.listSlots.mockResolvedValue([slot({ weekday: 1, startTime: "09:00", endTime: "12:00" })]);
    const { user, dialog } = await openCreate();
    await screen.findByText("09:00–12:00");
    fill(dialog, { start: "09:00", end: "10:00", capacity: "3" });
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    expect(
      await dialog.findByText(
        "Ya hay una franja que empieza a esa hora ese día. Elige otra hora de inicio.",
      ),
    ).toBeInTheDocument();
    expect(dialog.getByLabelText("Hora de inicio")).toHaveAttribute("aria-invalid", "true");
    expect(api.createSlot).not.toHaveBeenCalled();
  });

  it("si la base rechaza, el diálogo sigue abierto con el motivo y lo escrito intacto", async () => {
    api.createSlot.mockRejectedValue(
      new AppError("validation", "Ya hay una franja que empieza a esa hora ese día de la semana."),
    );
    const { user, dialog } = await openCreate();
    fill(dialog, { start: "09:00", end: "10:00", capacity: "3" });
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Ya hay una franja que empieza");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.getByLabelText("Hora de inicio")).toHaveValue("09:00");
    expect(dialog.getByLabelText("Cupo por día")).toHaveValue("3");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un doble clic en Guardar crea UNA sola franja", async () => {
    let finish: (v: unknown) => void = () => {};
    api.createSlot.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, dialog } = await openCreate();
    fill(dialog, { start: "09:00", end: "10:00", capacity: "3" });
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    const busy = await dialog.findByRole("button", { name: "Guardando…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    await user.click(busy);
    expect(api.createSlot).toHaveBeenCalledTimes(1);
    finish(slot());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("al reabrir queda en blanco (no arrastra lo escrito antes)", async () => {
    const { user, dialog } = await openCreate();
    fill(dialog, { start: "09:00", end: "10:00", capacity: "3" });
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Nueva franja" }));
    const again = within(await screen.findByRole("dialog", { name: "Nueva franja" }));
    expect(again.getByLabelText("Hora de inicio")).toHaveValue("");
    expect(again.getByLabelText("Cupo por día")).toHaveValue("");
  });
});

describe("Entregas: diálogo accesible (foco y teclado)", () => {
  it("Escape cierra el diálogo y el foco vuelve al botón que lo abrió", async () => {
    renderPage();
    const user = userEvent.setup();
    const opener = await screen.findByRole("button", { name: "Nueva franja" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Nueva franja" });
    expect(dialog.contains(document.activeElement)).toBe(true); // el foco entra al diálogo
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("Tab se queda dentro del diálogo (foco atrapado)", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nueva franja" }));
    const dialog = await screen.findByRole("dialog", { name: "Nueva franja" });
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `tab ${i + 1}`).toBe(true);
    }
  });

  it("los controles del formulario miden al menos 44 px", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nueva franja" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Nueva franja" }));
    for (const label of ["Día de la semana", "Hora de inicio", "Hora de fin", "Cupo por día"]) {
      expect(dialog.getByLabelText(label).className, label).toContain("h-11");
    }
    for (const name of ["Guardar franja", "Cancelar"]) {
      expect(dialog.getByRole("button", { name }).className, name).toContain("h-11");
    }
    expect(dialog.getByRole("checkbox", { name: /Activa/ }).closest("label")?.className).toContain(
      "min-h-11",
    );
  });
});

describe("Entregas: editar una franja", () => {
  const existing = () =>
    slot({
      id: "e1",
      weekday: 4,
      startTime: "09:00",
      endTime: "11:00",
      capacity: 6,
      isActive: true,
      updatedAt: "2026-11-01T10:00:00.654321+00:00",
    });
  const openEdit = async () => {
    api.listSlots.mockResolvedValue([existing()]);
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Editar la franja 09:00–11:00 (Jueves)" }),
    );
    return { user, dialog: within(await screen.findByRole("dialog", { name: "Editar franja" })) };
  };

  it("trae los datos de la franja; el día NO se puede cambiar (se muestra como texto)", async () => {
    const { dialog } = await openEdit();
    expect(dialog.getByLabelText("Hora de inicio")).toHaveValue("09:00");
    expect(dialog.getByLabelText("Hora de fin")).toHaveValue("11:00");
    expect(dialog.getByLabelText("Cupo por día")).toHaveValue("6");
    expect(dialog.getByRole("checkbox", { name: /Activa/ })).toBeChecked();
    expect(dialog.getByText("Día: Jueves")).toBeInTheDocument();
    expect(dialog.queryByLabelText("Día de la semana")).not.toBeInTheDocument();
  });

  it("actualiza con SU versión y manda EXACTAMENTE un SlotUpdateInput (sin método ni día)", async () => {
    const { user, dialog } = await openEdit();
    fireEvent.change(dialog.getByLabelText("Hora de fin"), { target: { value: "12:30" } });
    fireEvent.change(dialog.getByLabelText("Cupo por día"), { target: { value: "10" } });
    await user.click(dialog.getByRole("checkbox", { name: /Activa/ }));
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    await waitFor(() => expect(api.updateSlot).toHaveBeenCalledTimes(1));
    expect(api.updateSlot).toHaveBeenCalledWith("e1", "2026-11-01T10:00:00.654321+00:00", {
      startTime: "09:00",
      endTime: "12:30",
      capacity: 10,
      isActive: false,
    });
    expect(toast.success).toHaveBeenCalledWith("Franja actualizada.");
    expect(api.createSlot).not.toHaveBeenCalled();
  });

  it("al editar NO choca consigo misma (mantener la misma hora de inicio es válido)", async () => {
    const { user, dialog } = await openEdit();
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    await waitFor(() => expect(api.updateSlot).toHaveBeenCalledTimes(1));
  });

  it("CONFLICTO: si otra persona la editó antes, muestra el aviso y NO pisa su cambio; recargar cierra y vuelve a leer", async () => {
    api.updateSlot.mockRejectedValue(new StaleVersionError());
    const { user, dialog } = await openEdit();
    await user.click(dialog.getByRole("button", { name: "Guardar franja" }));
    const alert = await dialog.findByRole("alert");
    expect(alert).toHaveTextContent("Alguien más modificó esto");
    expect(alert).toHaveTextContent("Otra persona guardó cambios mientras editabas");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    const before = api.listSlots.mock.calls.length;
    await user.click(dialog.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(api.listSlots.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("Entregas: archivar y restaurar una franja", () => {
  const OPEN_NAME = "Archivar la franja 09:00–12:00 (Lunes)";
  const one = () => slot({ id: "a1", weekday: 1, updatedAt: "2026-11-01T10:00:00.999999+00:00" });

  it("archivar pide confirmación y solo archiva al confirmar, con la versión de la franja", async () => {
    api.listSlots.mockResolvedValue([one()]);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: OPEN_NAME }));
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar esta franja?" });
    expect(within(dialog).getByText(/No se borra: podrás restaurarla/)).toBeInTheDocument();
    expect(api.setSlotArchived).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Archivar franja" }));
    await waitFor(() => expect(api.setSlotArchived).toHaveBeenCalledTimes(1));
    expect(api.setSlotArchived).toHaveBeenCalledWith(
      "a1",
      "2026-11-01T10:00:00.999999+00:00",
      true,
    );
    expect(toast.success).toHaveBeenCalledWith("Franja archivada.");
  });

  it("cancelar NO archiva", async () => {
    api.listSlots.mockResolvedValue([one()]);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: OPEN_NAME }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setSlotArchived).not.toHaveBeenCalled();
  });

  it("restaurar es inmediato y manda archived=false con la versión", async () => {
    api.listSlots.mockResolvedValue([
      slot({ id: "r1", weekday: 1, archived: true, updatedAt: "2026-11-02T08:00:00.5+00:00" }),
    ]);
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("checkbox", { name: "Mostrar franjas archivadas (1)" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Restaurar la franja 09:00–12:00 (Lunes)" }),
    );
    await waitFor(() =>
      expect(api.setSlotArchived).toHaveBeenCalledWith("r1", "2026-11-02T08:00:00.5+00:00", false),
    );
    expect(toast.success).toHaveBeenCalledWith("Franja restaurada.");
  });

  it("CONFLICTO al archivar: cierra la confirmación y muestra el aviso de conflicto en la página", async () => {
    api.listSlots.mockResolvedValue([one()]);
    api.setSlotArchived.mockRejectedValue(new StaleVersionError());
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: OPEN_NAME }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar franja" }),
    );
    expect(
      await within(slotsSection()).findByText("Alguien más modificó esto"),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).not.toHaveBeenCalled();
    const before = api.listSlots.mock.calls.length;
    await user.click(
      within(slotsSection()).getByRole("button", { name: "Recargar la versión actual" }),
    );
    await waitFor(() => expect(api.listSlots.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() =>
      expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument(),
    );
  });

  it("otro fallo al archivar: avisa con el motivo y deja la confirmación abierta para reintentar", async () => {
    api.listSlots.mockResolvedValue([one()]);
    api.setSlotArchived.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: OPEN_NAME }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar franja" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

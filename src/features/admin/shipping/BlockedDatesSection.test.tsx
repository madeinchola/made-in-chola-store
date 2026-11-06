import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { BlockedDatesSection } from "./BlockedDatesSection";
import type { BlockedDate } from "./types";

const api = vi.hoisted(() => ({
  listLocations: vi.fn(),
  listMethods: vi.fn(),
  listZones: vi.fn(),
  listRates: vi.fn(),
  listSlots: vi.fn(),
  listBlockedDates: vi.fn(),
  createBlockedDate: vi.fn(),
  updateBlockedDateReason: vi.fn(),
  setBlockedDateArchived: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// 02:00 UTC del 10 de noviembre = 22:00 del 9 en La Paz: ahí «hoy» es el 9 (en UTC sería el 10).
const NOW = new Date("2026-11-10T02:00:00Z");

let seq = 0;
const blocked = (blockedOn: string, over: Partial<BlockedDate> = {}): BlockedDate => ({
  id: `b${++seq}`,
  blockedOn,
  reason: null,
  archived: false,
  updatedAt: "2026-11-01T10:00:00.123456+00:00",
  ...over,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BlockedDatesSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const section = () => screen.getByRole("region", { name: "Fechas bloqueadas" });
const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  // Solo se simula el reloj de FECHAS: los temporizadores reales siguen (Testing Library y React Query los usan).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  api.listBlockedDates.mockResolvedValue([blocked("2026-12-25", { reason: "Navidad" })]);
  api.createBlockedDate.mockResolvedValue(blocked("2026-12-25"));
  api.updateBlockedDateReason.mockResolvedValue("v2");
  api.setBlockedDateArchived.mockResolvedValue("v2");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Fechas bloqueadas: lista", () => {
  it("futuras primero, luego pasadas, y las archivadas en un bloque aparte (cada bloque con su título)", async () => {
    api.listBlockedDates.mockResolvedValue([
      blocked("2026-01-01", { reason: "Año nuevo" }),
      blocked("2026-12-25", { reason: "Navidad" }),
      blocked("2026-11-05", { reason: "Hace días" }),
      blocked("2026-11-20", { reason: "Pronto" }),
      blocked("2026-03-03", { reason: "Archivada vieja", archived: true }),
    ]);
    renderSection();
    await screen.findByText("Pronto");
    const headings = within(section())
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Próximas", "Pasadas", "Archivadas"]);
    const groupItems = (title: string) =>
      within(
        screen.getByRole("heading", { level: 3, name: title }).closest("section") as HTMLElement,
      )
        .getAllByRole("listitem")
        .map((li) => li.querySelector("time")?.getAttribute("datetime"));
    expect(groupItems("Próximas")).toEqual(["2026-11-20", "2026-12-25"]);
    expect(groupItems("Pasadas")).toEqual(["2026-11-05", "2026-01-01"]);
    expect(groupItems("Archivadas")).toEqual(["2026-03-03"]);
  });

  it("«hoy» es el día de LA PAZ: a las 22:00 del 9 en La Paz, el 9 todavía es próxima y el 8 es pasada", async () => {
    api.listBlockedDates.mockResolvedValue([
      blocked("2026-11-09", { reason: "Es hoy en La Paz" }),
      blocked("2026-11-08", { reason: "Ayer en La Paz" }),
    ]);
    renderSection();
    await screen.findByText("Es hoy en La Paz");
    const upcoming = screen.getByRole("heading", { level: 3, name: "Próximas" }).closest("section");
    const past = screen.getByRole("heading", { level: 3, name: "Pasadas" }).closest("section");
    expect(within(upcoming as HTMLElement).getByText("Es hoy en La Paz")).toBeInTheDocument();
    expect(within(past as HTMLElement).getByText("Ayer en La Paz")).toBeInTheDocument();
    expect(within(rowOf("Ayer en La Paz")).getByText("Ya pasó")).toBeInTheDocument();
    expect(within(rowOf("Es hoy en La Paz")).queryByText("Ya pasó")).not.toBeInTheDocument();
  });

  it("muestra la fecha legible (sin desfase de zona horaria) y el motivo, o «Sin motivo»", async () => {
    api.listBlockedDates.mockResolvedValue([
      blocked("2026-12-25", { reason: "Navidad" }),
      blocked("2026-12-26"),
    ]);
    renderSection();
    await screen.findByText("Navidad");
    expect(within(rowOf("Navidad")).getByText("vie 25 dic 2026")).toBeInTheDocument();
    expect(within(rowOf("Navidad")).getByText("vie 25 dic 2026")).toHaveAttribute(
      "datetime",
      "2026-12-25",
    );
    expect(screen.getByText("sáb 26 dic 2026")).toBeInTheDocument();
    expect(screen.getByText("Sin motivo")).toBeInTheDocument();
  });

  it("sin fechas: estado vacío con la acción de bloquear una (abre el formulario)", async () => {
    api.listBlockedDates.mockResolvedValue([]);
    renderSection();
    const user = userEvent.setup();
    expect(await screen.findByText(/No hay fechas bloqueadas/)).toBeInTheDocument();
    await user.click(within(section()).getByRole("button", { name: "Bloquear una fecha" }));
    expect(await screen.findByRole("dialog", { name: "Bloquear una fecha" })).toBeInTheDocument();
  });

  it("cargando: avisa; con error: ofrece reintentar y se recupera", async () => {
    api.listBlockedDates.mockReturnValueOnce(new Promise(() => {}));
    const first = renderSection();
    expect(within(section()).getByRole("status")).toHaveTextContent("Cargando…");
    first.unmount();

    api.listBlockedDates.mockReset();
    api.listBlockedDates
      .mockRejectedValueOnce(new AppError("network", "x"))
      .mockResolvedValue([blocked("2026-12-25", { reason: "Navidad" })]);
    renderSection();
    expect(await within(section()).findByRole("alert")).toHaveTextContent(
      "No pudimos cargar los datos",
    );
    await userEvent.setup().click(within(section()).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Navidad")).toBeInTheDocument();
  });

  it("los botones de la lista miden al menos 44 px", async () => {
    renderSection();
    await screen.findByText("Navidad");
    for (const button of within(section()).getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("h-11");
    }
  });
});

describe("Fechas bloqueadas: añadir una fecha", () => {
  const openCreate = async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Bloquear una fecha" }));
    return {
      user,
      dialog: within(await screen.findByRole("dialog", { name: "Bloquear una fecha" })),
    };
  };
  const pickDate = (dialog: ReturnType<typeof within>, value: string) =>
    fireEvent.change(dialog.getByLabelText("Fecha"), { target: { value } });

  it("manda la fecha AAAA-MM-DD y el motivo recortado; avisa, cierra y vuelve a leer", async () => {
    const { user, dialog } = await openCreate();
    pickDate(dialog, "2027-01-01");
    await user.type(dialog.getByLabelText(/Motivo/), "  Año nuevo  ");
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    await waitFor(() => expect(api.createBlockedDate).toHaveBeenCalledTimes(1));
    expect(api.createBlockedDate).toHaveBeenCalledWith("2027-01-01", "Año nuevo");
    expect(toast.success).toHaveBeenCalledWith("Fecha bloqueada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listBlockedDates.mock.calls.length).toBeGreaterThan(1);
  });

  it("el motivo es opcional: vacío se manda como null", async () => {
    const { user, dialog } = await openCreate();
    pickDate(dialog, "2027-01-01");
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    await waitFor(() => expect(api.createBlockedDate).toHaveBeenCalled());
    expect(api.createBlockedDate).toHaveBeenCalledWith("2027-01-01", null);
  });

  it("sin fecha: mensaje junto al campo y la API sin tocar", async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    expect(await dialog.findByText("Elige la fecha que quieres bloquear.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Fecha")).toHaveAttribute("aria-invalid", "true");
    expect(api.createBlockedDate).not.toHaveBeenCalled();
  });

  it("no se bloquea el mismo día dos veces: lo dice y no llama a la API", async () => {
    const { user, dialog } = await openCreate();
    pickDate(dialog, "2026-12-25"); // ya está bloqueada («Navidad»)
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    expect(await dialog.findByText("Esa fecha ya está bloqueada.")).toBeInTheDocument();
    expect(api.createBlockedDate).not.toHaveBeenCalled();
  });

  it("el motivo admite 120 caracteres y no 121", async () => {
    const { user, dialog } = await openCreate();
    pickDate(dialog, "2027-01-01");
    fireEvent.change(dialog.getByLabelText(/Motivo/), { target: { value: "a".repeat(121) } });
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    expect(await dialog.findByText("El motivo admite hasta 120 caracteres.")).toBeInTheDocument();
    expect(api.createBlockedDate).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText(/Motivo/), { target: { value: "a".repeat(120) } });
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    await waitFor(() => expect(api.createBlockedDate).toHaveBeenCalledTimes(1));
  });

  it("una fecha PASADA se puede registrar, pero se avisa; hoy y las futuras no llevan aviso", async () => {
    const { user, dialog } = await openCreate();
    pickDate(dialog, "2026-11-08"); // ayer en La Paz
    expect(await dialog.findByText(/Esa fecha ya pasó/)).toBeInTheDocument();
    pickDate(dialog, "2026-11-09"); // hoy en La Paz (aunque en UTC ya sea el 10)
    expect(dialog.queryByText(/Esa fecha ya pasó/)).not.toBeInTheDocument();
    pickDate(dialog, "2026-11-08");
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    await waitFor(() => expect(api.createBlockedDate).toHaveBeenCalledWith("2026-11-08", null));
  });

  it("si la base rechaza, el diálogo queda abierto con el motivo y lo escrito intacto", async () => {
    api.createBlockedDate.mockRejectedValue(
      new AppError("validation", "Esa fecha ya está bloqueada."),
    );
    const { user, dialog } = await openCreate();
    pickDate(dialog, "2027-01-01");
    await user.type(dialog.getByLabelText(/Motivo/), "Año nuevo");
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Esa fecha ya está bloqueada.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.getByLabelText("Fecha")).toHaveValue("2027-01-01");
    expect(dialog.getByLabelText(/Motivo/)).toHaveValue("Año nuevo");
  });

  it("un doble clic en Guardar bloquea UNA sola fecha", async () => {
    let finish: (v: unknown) => void = () => {};
    api.createBlockedDate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, dialog } = await openCreate();
    pickDate(dialog, "2027-01-01");
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    await user.click(await dialog.findByRole("button", { name: "Guardando…" }));
    expect(api.createBlockedDate).toHaveBeenCalledTimes(1);
    finish(blocked("2027-01-01"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Escape cierra y el foco vuelve al botón que abrió el diálogo", async () => {
    renderSection();
    const user = userEvent.setup();
    const opener = await screen.findByRole("button", { name: "Bloquear una fecha" });
    await user.click(opener);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("los controles del formulario miden al menos 44 px", async () => {
    const { dialog } = await openCreate();
    expect(dialog.getByLabelText("Fecha").className).toContain("h-11");
    expect(dialog.getByLabelText(/Motivo/).className).toContain("h-11");
    for (const name of ["Guardar fecha", "Cancelar"]) {
      expect(dialog.getByRole("button", { name }).className, name).toContain("h-11");
    }
  });
});

describe("Fechas bloqueadas: editar el motivo", () => {
  const openEdit = async (over: Partial<BlockedDate> = {}) => {
    api.listBlockedDates.mockResolvedValue([
      blocked("2026-12-25", {
        id: "e1",
        reason: "Navidad",
        updatedAt: "2026-11-01T10:00:00.777777+00:00",
        ...over,
      }),
    ]);
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Editar el motivo de la fecha vie 25 dic 2026" }),
    );
    return { user, dialog: within(await screen.findByRole("dialog", { name: "Editar motivo" })) };
  };

  it("la fecha NO se cambia (texto, sin campo de fecha) y se actualiza solo el motivo con SU versión", async () => {
    const { user, dialog } = await openEdit();
    expect(dialog.getByText("Fecha: vie 25 dic 2026")).toBeInTheDocument();
    expect(dialog.queryByLabelText("Fecha")).not.toBeInTheDocument();
    expect(dialog.getByLabelText(/Motivo/)).toHaveValue("Navidad");
    await user.clear(dialog.getByLabelText(/Motivo/));
    await user.type(dialog.getByLabelText(/Motivo/), "Feriado");
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    await waitFor(() => expect(api.updateBlockedDateReason).toHaveBeenCalledTimes(1));
    expect(api.updateBlockedDateReason).toHaveBeenCalledWith(
      "e1",
      "2026-11-01T10:00:00.777777+00:00",
      "Feriado",
    );
    expect(toast.success).toHaveBeenCalledWith("Motivo actualizado.");
    expect(api.createBlockedDate).not.toHaveBeenCalled();
  });

  it("vaciar el motivo lo deja en null (sin motivo)", async () => {
    const { user, dialog } = await openEdit();
    await user.clear(dialog.getByLabelText(/Motivo/));
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    await waitFor(() => expect(api.updateBlockedDateReason).toHaveBeenCalled());
    expect(api.updateBlockedDateReason.mock.calls[0]?.[2]).toBeNull();
  });

  it("CONFLICTO: si otra persona la editó antes, muestra el aviso y no pisa su cambio", async () => {
    api.updateBlockedDateReason.mockRejectedValue(new StaleVersionError());
    const { user, dialog } = await openEdit();
    await user.click(dialog.getByRole("button", { name: "Guardar fecha" }));
    const alert = await dialog.findByRole("alert");
    expect(alert).toHaveTextContent("Alguien más modificó esto");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    const before = api.listBlockedDates.mock.calls.length;
    await user.click(dialog.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(api.listBlockedDates.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("Fechas bloqueadas: archivar y restaurar", () => {
  const ARCHIVE = "Archivar la fecha vie 25 dic 2026";

  it("archivar pide confirmación (diciendo que el día vuelve a estar disponible) y archiva con la versión", async () => {
    api.listBlockedDates.mockResolvedValue([
      blocked("2026-12-25", { id: "a1", updatedAt: "2026-11-01T10:00:00.999999+00:00" }),
    ]);
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: ARCHIVE }));
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar esta fecha bloqueada?" });
    expect(
      within(dialog).getByText(/vie 25 dic 2026 volverá a estar disponible/),
    ).toBeInTheDocument();
    expect(api.setBlockedDateArchived).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Archivar fecha" }));
    await waitFor(() => expect(api.setBlockedDateArchived).toHaveBeenCalledTimes(1));
    expect(api.setBlockedDateArchived).toHaveBeenCalledWith(
      "a1",
      "2026-11-01T10:00:00.999999+00:00",
      true,
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Fecha archivada: ese día vuelve a estar disponible.",
    );
  });

  it("cancelar NO archiva", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: ARCHIVE }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setBlockedDateArchived).not.toHaveBeenCalled();
  });

  it("una archivada ofrece «Restaurar» (inmediato, archived=false) y no ofrece editar ni archivar", async () => {
    api.listBlockedDates.mockResolvedValue([
      blocked("2026-12-25", {
        id: "r1",
        archived: true,
        updatedAt: "2026-11-02T09:00:00.5+00:00",
      }),
    ]);
    renderSection();
    const user = userEvent.setup();
    const restore = await screen.findByRole("button", {
      name: "Restaurar la fecha vie 25 dic 2026",
    });
    expect(screen.queryByRole("button", { name: /Editar|Archivar/ })).not.toBeInTheDocument();
    await user.click(restore);
    await waitFor(() =>
      expect(api.setBlockedDateArchived).toHaveBeenCalledWith(
        "r1",
        "2026-11-02T09:00:00.5+00:00",
        false,
      ),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Fecha restaurada: ese día vuelve a estar bloqueado.",
    );
  });

  it("CONFLICTO: cierra la confirmación y muestra el aviso en la página; recargar vuelve a leer", async () => {
    api.setBlockedDateArchived.mockRejectedValue(new StaleVersionError());
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: ARCHIVE }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar fecha" }),
    );
    expect(await within(section()).findByText("Alguien más modificó esto")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const before = api.listBlockedDates.mock.calls.length;
    await user.click(within(section()).getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(api.listBlockedDates.mock.calls.length).toBeGreaterThan(before));
  });

  it("restaurar puede fallar (ya hay otra fecha igual): avisa con el motivo de la base", async () => {
    api.listBlockedDates.mockResolvedValue([blocked("2026-12-25", { archived: true })]);
    api.setBlockedDateArchived.mockRejectedValue(
      new AppError("validation", "Esa fecha ya está bloqueada."),
    );
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Restaurar la fecha/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Esa fecha ya está bloqueada."));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

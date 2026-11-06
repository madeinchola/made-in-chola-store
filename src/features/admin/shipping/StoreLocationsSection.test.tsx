import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { StoreLocationsSection } from "./StoreLocationsSection";
import type { ShippingMethod, StoreLocation } from "./types";

const api = vi.hoisted(() => ({
  listLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  setLocationArchived: vi.fn(),
  setPrimaryLocation: vi.fn(),
  listMethods: vi.fn(),
  createMethod: vi.fn(),
  updateMethod: vi.fn(),
  setMethodArchived: vi.fn(),
  listZones: vi.fn(),
  listRates: vi.fn(),
  listSlots: vi.fn(),
  listBlockedDates: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// El mapa real (Leaflet) no se necesita aquí: se prueba aparte.
vi.mock("@/components/map/LeafletMap", () => ({
  default: () => <div data-testid="fake-map" />,
}));

const location = (over: Partial<StoreLocation> = {}): StoreLocation => ({
  id: "l1",
  name: "Casa central",
  addressText: "Calle 21 de Calacoto 123",
  city: "La Paz",
  lat: -16.5,
  lng: -68.15,
  pickupHours: "Lun–Vie 10:00–18:00",
  isPrimary: false,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-01T10:00:00.123456+00:00",
  ...over,
});

const method = (over: Partial<ShippingMethod> = {}): ShippingMethod => ({
  id: "m1",
  code: "recojo",
  name: "Recojo en tienda",
  kind: "pickup",
  description: null,
  etaMinDays: null,
  etaMaxDays: null,
  pickupLocationId: "l1",
  isActive: true,
  sortOrder: 0,
  archived: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});

const PRIMARY = location({ id: "p", name: "Taller Sopocachi", isPrimary: true });
const SECOND = location({
  id: "s",
  name: "Tienda Calacoto",
  updatedAt: "2026-11-02T08:00:00.654321+00:00",
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StoreLocationsSection />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const origin = (name: string) =>
  screen.getByRole("button", { name: `Usar como origen del envío: «${name}»` });

beforeEach(() => {
  vi.clearAllMocks();
  api.listLocations.mockResolvedValue([PRIMARY, SECOND]);
  api.listMethods.mockResolvedValue([]);
  api.createLocation.mockResolvedValue(location({ id: "nueva" }));
  api.updateLocation.mockResolvedValue("v2");
  api.setLocationArchived.mockResolvedValue("v2");
  api.setPrimaryLocation.mockResolvedValue(undefined);
});

describe("StoreLocationsSection: lista y estados", () => {
  it("muestra nombre, dirección, ciudad, horario y estado de cada ubicación; las archivadas van al final", async () => {
    api.listLocations.mockResolvedValue([
      location({ id: "a", name: "Archivada vieja", archived: true }),
      location({
        id: "b",
        name: "Bodega",
        isActive: false,
        pickupHours: null,
        city: "El Alto",
        addressText: "Av. 6 de Marzo",
      }),
      PRIMARY,
    ]);
    renderSection();
    await screen.findByText("Bodega");
    const bodega = within(rowOf("Bodega"));
    expect(bodega.getByText("Av. 6 de Marzo")).toBeInTheDocument();
    expect(bodega.getByText("El Alto")).toBeInTheDocument();
    expect(bodega.getByText("Sin horario")).toBeInTheDocument();
    expect(bodega.getByText("Inactiva")).toBeInTheDocument();
    const taller = within(rowOf("Taller Sopocachi"));
    expect(taller.getByText("Lun–Vie 10:00–18:00")).toBeInTheDocument();
    expect(taller.getByText("Activa")).toBeInTheDocument();
    expect(within(rowOf("Archivada vieja")).getByText("Archivada")).toBeInTheDocument();
    const names = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.querySelector("td p")?.textContent);
    expect(names).toEqual(["Bodega", "Taller Sopocachi", "Archivada vieja"]);
  });

  it("la insignia «Origen del envío» está SOLO en la principal", async () => {
    renderSection();
    await screen.findByText("Taller Sopocachi");
    expect(within(rowOf("Taller Sopocachi")).getByText("Origen del envío")).toBeInTheDocument();
    expect(
      within(rowOf("Tienda Calacoto")).queryByText("Origen del envío"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Origen del envío")).toHaveLength(1);
  });

  it("carga: avisa «Cargando…» sin mostrar la tabla", async () => {
    api.listLocations.mockReturnValue(new Promise(() => {}));
    renderSection();
    const section = within(await screen.findByRole("region", { name: "Ubicaciones de la tienda" }));
    expect(section.getByRole("status")).toHaveTextContent("Cargando…");
    expect(section.queryByRole("table")).not.toBeInTheDocument();
  });

  it("error: lo dice y «Reintentar» vuelve a pedir la lista", async () => {
    api.listLocations.mockRejectedValueOnce(new AppError("network", "x"));
    renderSection();
    const section = within(await screen.findByRole("region", { name: "Ubicaciones de la tienda" }));
    expect(await section.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    await userEvent.setup().click(section.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Taller Sopocachi")).toBeInTheDocument();
    expect(api.listLocations).toHaveBeenCalledTimes(2);
  });

  it("vacío: dice que no hay ubicaciones y ofrece agregar la primera (abre el diálogo de alta)", async () => {
    api.listLocations.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText("Todavía no hay ubicaciones.")).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Agregar la primera ubicación" }));
    expect(await screen.findByRole("dialog", { name: "Nueva ubicación" })).toBeInTheDocument();
  });

  it("los botones de las filas tienen nombre propio con la ubicación y miden al menos 44 px (min-h-11)", async () => {
    renderSection();
    await screen.findByText("Tienda Calacoto");
    const row = within(rowOf("Tienda Calacoto"));
    for (const name of [
      "Editar: «Tienda Calacoto»",
      "Usar como origen del envío: «Tienda Calacoto»",
      "Archivar: «Tienda Calacoto»",
    ]) {
      expect(row.getByRole("button", { name }).className).toContain("min-h-11");
    }
    expect(screen.getByRole("button", { name: "Nueva ubicación" }).className).toContain("min-h-11");
  });
});

describe("StoreLocationsSection: aviso de que no hay origen", () => {
  it("con origen no hay aviso", async () => {
    renderSection();
    await screen.findByText("Taller Sopocachi");
    expect(screen.queryByText("No hay un origen del envío")).not.toBeInTheDocument();
  });

  it("sin ninguna principal pero con ubicaciones elegibles: dice que NO se cotiza y cómo arreglarlo", async () => {
    api.listLocations.mockResolvedValue([location({ id: "s", name: "Tienda Calacoto" })]);
    renderSection();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No hay un origen del envío");
    expect(alert).toHaveTextContent(
      "Ninguna ubicación es el origen del envío, así que NO se puede cotizar ningún envío a domicilio. Elige una con «Usar como origen del envío».",
    );
  });

  it("sin principal y sin ninguna elegible (inactivas o archivadas): pide agregar una activa", async () => {
    api.listLocations.mockResolvedValue([
      location({ id: "x", name: "Inactiva", isActive: false }),
      location({ id: "y", name: "Vieja", archived: true }),
    ]);
    renderSection();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "No hay ninguna ubicación activa que pueda ser el origen del envío, así que NO se puede cotizar ningún envío a domicilio. Agrega una ubicación activa y márcala como origen del envío.",
    );
  });

  it("sin ninguna ubicación también avisa (la lista vacía no lo oculta)", async () => {
    api.listLocations.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("NO se puede cotizar ningún envío");
  });

  it("mientras carga o si falla la carga NO afirma que falta el origen", async () => {
    api.listLocations.mockRejectedValue(new AppError("network", "x"));
    renderSection();
    await screen.findByText("No pudimos cargar los datos");
    expect(screen.queryByText("No hay un origen del envío")).not.toBeInTheDocument();
  });
});

describe("StoreLocationsSection: usar como origen del envío", () => {
  it("solo se ofrece en ubicaciones activas, sin archivar y que todavía no son el origen", async () => {
    api.listLocations.mockResolvedValue([
      PRIMARY,
      SECOND,
      location({ id: "i", name: "Inactiva", isActive: false }),
      location({ id: "a", name: "Archivada", archived: true }),
    ]);
    renderSection();
    await screen.findByText("Tienda Calacoto");
    expect(screen.getAllByRole("button", { name: /^Usar como origen del envío: / })).toHaveLength(
      1,
    );
    expect(origin("Tienda Calacoto")).toBeInTheDocument();
  });

  it("si ya hay un origen, pide confirmación y dice cuál deja de serlo; cancelar NO cambia nada", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^Usar como origen del envío: «Tienda Calacoto»/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "¿Usar «Tienda Calacoto» como origen del envío?",
    });
    expect(dialog).toHaveTextContent("«Taller Sopocachi» deja de ser el origen");
    expect(api.setPrimaryLocation).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setPrimaryLocation).not.toHaveBeenCalled();
  });

  it("al confirmar envía el id de ESA ubicación, avisa y vuelve a leer la lista", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^Usar como origen del envío: «Tienda Calacoto»/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Usar como origen" }));
    await waitFor(() => expect(api.setPrimaryLocation).toHaveBeenCalledTimes(1));
    expect(api.setPrimaryLocation).toHaveBeenCalledWith("s");
    expect(toast.success).toHaveBeenCalledWith("«Tienda Calacoto» es ahora el origen del envío.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listLocations.mock.calls.length).toBeGreaterThan(1);
  });

  it("si todavía no hay origen se aplica de inmediato (sin confirmación) con el id correcto", async () => {
    api.listLocations.mockResolvedValue([
      location({ id: "uno", name: "Uno" }),
      location({ id: "dos", name: "Dos" }),
    ]);
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Usar como origen del envío: «Dos»" }),
    );
    await waitFor(() => expect(api.setPrimaryLocation).toHaveBeenCalledTimes(1));
    expect(api.setPrimaryLocation).toHaveBeenCalledWith("dos");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("«Dos» es ahora el origen del envío.");
  });

  it("si la base lo rechaza, muestra el motivo y deja abierta la confirmación", async () => {
    api.setPrimaryLocation.mockRejectedValue(
      new AppError("not_found", "ubicación inexistente, inactiva o archivada"),
    );
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^Usar como origen del envío: «Tienda Calacoto»/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Usar como origen" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("ubicación inexistente, inactiva o archivada"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("StoreLocationsSection: archivar y restaurar", () => {
  it("la principal NO se puede archivar: el botón queda marcado como no disponible, explicado y no abre nada", async () => {
    renderSection();
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Archivar: «Taller Sopocachi»" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(
      "Es el origen del envío: para archivarla o desactivarla, antes elige otra ubicación como origen.",
    );
    await user.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.setLocationArchived).not.toHaveBeenCalled();
  });

  it("una ubicación que no es el origen se puede archivar (el botón NO está bloqueado)", async () => {
    renderSection();
    const button = await screen.findByRole("button", { name: "Archivar: «Tienda Calacoto»" });
    expect(button).not.toHaveAttribute("aria-disabled");
  });

  it("archivar pide confirmación y solo archiva al confirmar, con SU id y SU versión", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archivar: «Tienda Calacoto»" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar esta ubicación?" });
    expect(dialog).toHaveTextContent("No se borra: podrás restaurarla cuando quieras.");
    expect(api.setLocationArchived).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Archivar ubicación" }));
    await waitFor(() => expect(api.setLocationArchived).toHaveBeenCalledTimes(1));
    expect(api.setLocationArchived).toHaveBeenCalledWith(
      "s",
      "2026-11-02T08:00:00.654321+00:00",
      true,
    );
    expect(toast.success).toHaveBeenCalledWith("Ubicación archivada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancelar la confirmación NO archiva", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archivar: «Tienda Calacoto»" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setLocationArchived).not.toHaveBeenCalled();
  });

  it("avisa qué métodos de recojo dejarán de poder cotizarse (solo los que usan esa ubicación)", async () => {
    api.listMethods.mockResolvedValue([
      method({ id: "m1", name: "Recojo Calacoto", pickupLocationId: "s" }),
      method({ id: "m2", name: "Recojo Sopocachi", pickupLocationId: "p" }),
      method({ id: "m3", name: "Recojo viejo", pickupLocationId: "s", archived: true }),
    ]);
    renderSection();
    const user = userEvent.setup();
    // los métodos llegan después de la lista: se espera a verlos usados en el aviso
    await screen.findByText("Tienda Calacoto");
    await user.click(screen.getByRole("button", { name: "Archivar: «Tienda Calacoto»" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Estos métodos de recojo la usan y dejarán de poder cotizarse mientras esté archivada: Recojo Calacoto.",
      ),
    );
    expect(dialog).not.toHaveTextContent("Recojo Sopocachi");
    expect(dialog).not.toHaveTextContent("Recojo viejo");
  });

  it("sin métodos que la usen no hay aviso de métodos", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archivar: «Tienda Calacoto»" }));
    expect(await screen.findByRole("dialog")).not.toHaveTextContent("Estos métodos de recojo");
  });

  it("una archivada ofrece «Restaurar» (inmediato, con su versión) y ni «Archivar» ni «Usar como origen»", async () => {
    api.listLocations.mockResolvedValue([
      PRIMARY,
      location({
        id: "v",
        name: "Vieja",
        archived: true,
        updatedAt: "2026-10-01T00:00:00.111111+00:00",
      }),
    ]);
    renderSection();
    const user = userEvent.setup();
    await screen.findByText("Vieja");
    const row = within(rowOf("Vieja"));
    expect(row.queryByRole("button", { name: /^Archivar: / })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: /^Usar como origen/ })).not.toBeInTheDocument();
    await user.click(row.getByRole("button", { name: "Restaurar: «Vieja»" }));
    await waitFor(() => expect(api.setLocationArchived).toHaveBeenCalledTimes(1));
    expect(api.setLocationArchived).toHaveBeenCalledWith(
      "v",
      "2026-10-01T00:00:00.111111+00:00",
      false,
    );
    expect(toast.success).toHaveBeenCalledWith("Ubicación restaurada.");
  });

  it("si archivar falla por otra razón, muestra el motivo y la confirmación sigue abierta", async () => {
    api.setLocationArchived.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archivar: «Tienda Calacoto»" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar ubicación" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("si otra persona la cambió antes: aviso de conflicto (no un error genérico) y «Recargar» vuelve a leer", async () => {
    api.setLocationArchived.mockRejectedValue(new StaleVersionError());
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archivar: «Tienda Calacoto»" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar ubicación" }),
    );
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
    expect(screen.getByText(/Otra persona guardó cambios mientras editabas/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const before = api.listLocations.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(api.listLocations.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument();
  });

  it("el conflicto también se avisa al restaurar", async () => {
    api.listLocations.mockResolvedValue([
      PRIMARY,
      location({ id: "v", name: "Vieja", archived: true }),
    ]);
    api.setLocationArchived.mockRejectedValue(new StaleVersionError());
    renderSection();
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Restaurar: «Vieja»" }));
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
  });
});

describe("StoreLocationsSection: crear", () => {
  const openCreate = async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nueva ubicación" }));
    return { user, dialog: within(await screen.findByRole("dialog", { name: "Nueva ubicación" })) };
  };
  const fillValid = async (
    user: ReturnType<typeof userEvent.setup>,
    dialog: ReturnType<typeof within>,
  ) => {
    await user.type(dialog.getByLabelText("Nombre"), "  Taller Obrajes ");
    await user.type(dialog.getByLabelText("Dirección"), "Calle 3 #45");
    await user.type(dialog.getByLabelText("Ciudad"), "La Paz");
    await user.type(dialog.getByLabelText("Latitud"), "-16,5");
    await user.type(dialog.getByLabelText("Longitud"), "-68.15");
  };

  it("crea con la forma exacta de LocationInput (textos recortados, horario vacío = null, coma decimal)", async () => {
    const { user, dialog } = await openCreate();
    await fillValid(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    await waitFor(() => expect(api.createLocation).toHaveBeenCalledTimes(1));
    expect(api.createLocation).toHaveBeenCalledWith({
      name: "Taller Obrajes",
      addressText: "Calle 3 #45",
      city: "La Paz",
      lat: -16.5,
      lng: -68.15,
      pickupHours: null,
      isActive: true,
    });
    expect(toast.success).toHaveBeenCalledWith("Ubicación creada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listLocations.mock.calls.length).toBeGreaterThan(1); // la lista se volvió a pedir
  });

  it("manda el horario y «inactiva» cuando se rellenan", async () => {
    const { user, dialog } = await openCreate();
    await fillValid(user, dialog);
    await user.type(dialog.getByLabelText("Horario de recojo (opcional)"), "Lun–Vie 10:00–18:00");
    await user.click(dialog.getByRole("checkbox", { name: "Ubicación activa" }));
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    await waitFor(() => expect(api.createLocation).toHaveBeenCalled());
    expect(api.createLocation).toHaveBeenCalledWith({
      name: "Taller Obrajes",
      addressText: "Calle 3 #45",
      city: "La Paz",
      lat: -16.5,
      lng: -68.15,
      pickupHours: "Lun–Vie 10:00–18:00",
      isActive: false,
    });
  });

  it("al abrir el alta NO hay errores todavía: aparecen solo después de intentar guardar", async () => {
    const { dialog } = await openCreate();
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    for (const label of ["Nombre", "Dirección", "Ciudad", "Latitud", "Longitud"]) {
      expect(dialog.getByLabelText(label), label).not.toHaveAttribute("aria-invalid");
    }
    expect(dialog.queryByText(/Escribe el nombre/)).not.toBeInTheDocument();
  });

  it("valida cada campo con su mensaje, asociado al campo; el foco va al primero inválido; no llama a la base", async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    const cases: [string, string][] = [
      ["Nombre", "Escribe el nombre de la ubicación."],
      ["Dirección", "Escribe la dirección."],
      ["Ciudad", "Escribe la ciudad."],
      ["Latitud", "Falta la latitud: elige el punto en el mapa o escríbela."],
      ["Longitud", "Falta la longitud: elige el punto en el mapa o escríbela."],
    ];
    for (const [label, message] of cases) {
      const field = dialog.getByLabelText(label);
      expect(field, label).toHaveAttribute("aria-invalid", "true");
      expect(field, label).toHaveAccessibleDescription(message);
    }
    await waitFor(() => expect(dialog.getByLabelText("Nombre")).toHaveFocus());
    expect(api.createLocation).not.toHaveBeenCalled();
  });

  it("el error desaparece en cuanto se corrige el campo (no queda un mensaje viejo)", async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    expect(dialog.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true");
    await user.type(dialog.getByLabelText("Nombre"), "Taller");
    expect(dialog.getByLabelText("Nombre")).not.toHaveAttribute("aria-invalid");
    expect(dialog.queryByText("Escribe el nombre de la ubicación.")).not.toBeInTheDocument();
    expect(dialog.getByLabelText("Dirección")).toHaveAttribute("aria-invalid", "true");
  });

  it("latitud y longitud fuera de rango, y horario demasiado largo", async () => {
    const { user, dialog } = await openCreate();
    await fillValid(user, dialog);
    await user.clear(dialog.getByLabelText("Latitud"));
    await user.type(dialog.getByLabelText("Latitud"), "91");
    await user.clear(dialog.getByLabelText("Longitud"));
    await user.type(dialog.getByLabelText("Longitud"), "-181");
    fireEvent.change(dialog.getByLabelText("Horario de recojo (opcional)"), {
      target: { value: "a".repeat(301) },
    });
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    expect(await dialog.findByText("La latitud debe estar entre -90 y 90.")).toBeInTheDocument();
    expect(dialog.getByText("La longitud debe estar entre -180 y 180.")).toBeInTheDocument();
    expect(dialog.getByText("El horario admite hasta 300 caracteres.")).toBeInTheDocument();
    expect(api.createLocation).not.toHaveBeenCalled();
  });

  it("el pin es obligatorio: sin él no guarda aunque lo demás esté bien, y el diálogo lo dice", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Nombre"), "Taller");
    await user.type(dialog.getByLabelText("Dirección"), "Calle 3");
    await user.type(dialog.getByLabelText("Ciudad"), "La Paz");
    expect(dialog.getByText(/el punto en el mapa es OBLIGATORIO/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    expect(await dialog.findByText(/Falta la latitud/)).toBeInTheDocument();
    expect(api.createLocation).not.toHaveBeenCalled();
  });

  it("si la base rechaza, el diálogo queda abierto con el motivo y no se pierde lo escrito", async () => {
    api.createLocation.mockRejectedValue(
      new AppError("validation", "Algún dato no cumple las reglas"),
    );
    const { user, dialog } = await openCreate();
    await fillValid(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Algún dato no cumple las reglas");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.getByLabelText("Ciudad")).toHaveValue("La Paz");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("mientras guarda el botón queda ocupado: un doble clic crea UNA sola ubicación; al terminar se cierra", async () => {
    let finish: (v: unknown) => void = () => {};
    api.createLocation.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, dialog } = await openCreate();
    await fillValid(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    const busy = await dialog.findByRole("button", { name: "Guardando…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    await user.click(busy);
    expect(api.createLocation).toHaveBeenCalledTimes(1);
    finish(location());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("mientras guarda no se cierra con Esc", async () => {
    let finish: (v: unknown) => void = () => {};
    api.createLocation.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, dialog } = await openCreate();
    await fillValid(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    await dialog.findByRole("button", { name: "Guardando…" });
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    finish(location());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("el foco entra al diálogo al abrir y vuelve al botón que lo abrió al cerrar", async () => {
    renderSection();
    const user = userEvent.setup();
    const opener = await screen.findByRole("button", { name: "Nueva ubicación" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Nueva ubicación" });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("Esc cierra el diálogo sin guardar", async () => {
    const { user } = await openCreate();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createLocation).not.toHaveBeenCalled();
  });

  it("reabrir el alta la deja en blanco (no arrastra lo escrito antes)", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Nombre"), "borrador");
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Nueva ubicación" }));
    expect(
      within(await screen.findByRole("dialog", { name: "Nueva ubicación" })).getByLabelText(
        "Nombre",
      ),
    ).toHaveValue("");
  });

  it("incluye el mapa del selector de ubicación", async () => {
    await openCreate();
    expect(await screen.findByTestId("fake-map")).toBeInTheDocument();
  });
});

describe("StoreLocationsSection: editar", () => {
  const openEdit = async (name: string) => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Editar: «${name}»` }));
    return {
      user,
      dialog: within(await screen.findByRole("dialog", { name: "Editar ubicación" })),
    };
  };

  it("trae los datos de la ubicación y actualiza con SU id y SU versión, con la forma exacta de LocationInput", async () => {
    api.listLocations.mockResolvedValue([
      location({
        id: "e1",
        name: "Original",
        addressText: "Av. Uno 1",
        city: "El Alto",
        lat: -16.51,
        lng: -68.2,
        pickupHours: "9 a 5",
        isActive: false,
        updatedAt: "2026-11-01T10:00:00.654321+00:00",
      }),
    ]);
    const { user, dialog } = await openEdit("Original");
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Original");
    expect(dialog.getByLabelText("Dirección")).toHaveValue("Av. Uno 1");
    expect(dialog.getByLabelText("Ciudad")).toHaveValue("El Alto");
    expect(dialog.getByLabelText("Horario de recojo (opcional)")).toHaveValue("9 a 5");
    expect(dialog.getByLabelText("Latitud")).toHaveValue("-16.51");
    expect(dialog.getByLabelText("Longitud")).toHaveValue("-68.2");
    expect(dialog.getByRole("checkbox", { name: "Ubicación activa" })).not.toBeChecked();

    await user.clear(dialog.getByLabelText("Nombre"));
    await user.type(dialog.getByLabelText("Nombre"), "Editado");
    await user.clear(dialog.getByLabelText("Horario de recojo (opcional)"));
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    await waitFor(() => expect(api.updateLocation).toHaveBeenCalledTimes(1));
    expect(api.updateLocation).toHaveBeenCalledWith("e1", "2026-11-01T10:00:00.654321+00:00", {
      name: "Editado",
      addressText: "Av. Uno 1",
      city: "El Alto",
      lat: -16.51,
      lng: -68.2,
      pickupHours: null,
      isActive: false,
    });
    expect(api.createLocation).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Ubicación actualizada.");
  });

  it("la ubicación que es el origen NO se puede desactivar desde el formulario, y lo explica", async () => {
    const { dialog } = await openEdit("Taller Sopocachi");
    const box = dialog.getByRole("checkbox", { name: "Ubicación activa" });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription(
      "Es el origen del envío: no se puede desactivar hasta que elijas otra ubicación como origen.",
    );
  });

  it("una que no es el origen sí se puede desactivar", async () => {
    const { user, dialog } = await openEdit("Tienda Calacoto");
    const box = dialog.getByRole("checkbox", { name: "Ubicación activa" });
    expect(box).toBeEnabled();
    await user.click(box);
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    await waitFor(() => expect(api.updateLocation).toHaveBeenCalled());
    expect(api.updateLocation.mock.calls[0]?.[2]).toMatchObject({ isActive: false });
  });

  it("al desactivar avisa qué métodos de recojo dejarán de cotizarse (solo los que la usan)", async () => {
    api.listMethods.mockResolvedValue([
      method({ id: "m1", name: "Recojo Calacoto", pickupLocationId: "s" }),
      method({ id: "m2", name: "Recojo Sopocachi", pickupLocationId: "p" }),
    ]);
    const { user, dialog } = await openEdit("Tienda Calacoto");
    expect(dialog.queryByText(/Si la desactivas/)).not.toBeInTheDocument(); // activa: sin aviso
    await user.click(dialog.getByRole("checkbox", { name: "Ubicación activa" }));
    // el aviso sigue a los datos: aparece en cuanto los métodos están leídos
    expect(await dialog.findByText(/Si la desactivas/)).toHaveTextContent(
      "Si la desactivas, estos métodos de recojo dejarán de poder cotizarse: Recojo Calacoto.",
    );
  });

  it("al desactivar una ubicación que ningún método usa no hay aviso", async () => {
    const { user, dialog } = await openEdit("Tienda Calacoto");
    await user.click(dialog.getByRole("checkbox", { name: "Ubicación activa" }));
    expect(dialog.getByRole("checkbox", { name: "Ubicación activa" })).not.toBeChecked();
    expect(dialog.queryByText(/Si la desactivas/)).not.toBeInTheDocument();
  });

  it("si otra persona la editó antes: aviso de conflicto en el diálogo, no se guarda y «Recargar» cierra y vuelve a leer", async () => {
    api.updateLocation.mockRejectedValue(new StaleVersionError());
    const { user, dialog } = await openEdit("Tienda Calacoto");
    await user.click(dialog.getByRole("button", { name: "Guardar ubicación" }));
    expect(await dialog.findByText("Alguien más modificó esto")).toBeInTheDocument();
    expect(dialog.getByText(/no se guardó nada tuyo/)).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const before = api.listLocations.mock.calls.length;
    await user.click(dialog.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listLocations.mock.calls.length).toBeGreaterThan(before);
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { ShippingZonesPage } from "./ZonesPage";
import type { RateRule, ShippingZone, StoreLocation } from "./types";

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
  createZone: vi.fn(),
  updateZone: vi.fn(),
  setZoneArchived: vi.fn(),
  listRates: vi.fn(),
  createRate: vi.fn(),
  updateRate: vi.fn(),
  setRateArchived: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// El mapa real (Leaflet) no corre en jsdom: se sustituye por uno de mentira. El selector de ubicación SÍ es el real, con sus
// campos de latitud y longitud.
vi.mock("@/components/map/LeafletMap", () => ({ default: () => <div data-testid="fake-map" /> }));

const zone = (over: Partial<ShippingZone> = {}): ShippingZone => ({
  id: "z1",
  name: "Centro",
  kind: "city",
  cities: ["La Paz", "El Alto"],
  centerLat: null,
  centerLng: null,
  radiusKm: null,
  allowed: true,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-05T10:00:00.123456+00:00",
  ...over,
});
const radiusZone = (over: Partial<ShippingZone> = {}): ShippingZone =>
  zone({
    id: "z2",
    name: "Radio sur",
    kind: "radius",
    cities: null,
    centerLat: -16.5,
    centerLng: -68.15,
    radiusKm: 7.5,
    updatedAt: "2026-11-05T11:00:00.654321+00:00",
    ...over,
  });
const location = (over: Partial<StoreLocation> = {}): StoreLocation => ({
  id: "l1",
  name: "Taller",
  addressText: "Calle 1",
  city: "La Paz",
  lat: -16.5,
  lng: -68.15,
  pickupHours: null,
  isPrimary: true,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});
const rate = (over: Partial<RateRule> = {}): RateRule => ({
  id: "r1",
  methodId: "m1",
  zoneId: "z1",
  name: "Regla",
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
  updatedAt: "2026-11-05T10:00:00+00:00",
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShippingZonesPage />
    </QueryClientProvider>,
  );
}
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const dialog = () => screen.getByRole("dialog");

beforeEach(() => {
  vi.clearAllMocks();
  api.listZones.mockResolvedValue([zone()]);
  api.listRates.mockResolvedValue([]);
  api.listLocations.mockResolvedValue([location()]);
  api.createZone.mockResolvedValue(zone({ id: "nueva" }));
  api.updateZone.mockResolvedValue("2026-11-05T12:00:00.000001+00:00");
  api.setZoneArchived.mockResolvedValue("2026-11-05T12:00:00.000001+00:00");
});

describe("Zonas: lista y estados", () => {
  it("muestra «Cargando…» mientras llegan las zonas", () => {
    api.listZones.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("si falla la carga lo dice y «Reintentar» vuelve a pedirlo", async () => {
    api.listZones.mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    api.listZones.mockResolvedValueOnce([zone({ name: "Tras reintentar" })]);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Tras reintentar")).toBeInTheDocument();
    expect(api.listZones).toHaveBeenCalledTimes(2);
  });

  it("vacío: explica y ofrece crear la primera zona (abre el diálogo)", async () => {
    api.listZones.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Todavía no hay zonas/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear la primera zona" }));
    expect(within(dialog()).getByRole("heading", { name: "Nueva zona" })).toBeInTheDocument();
  });

  it("un título h2 (el h1 es del marco) y la frase de cómo se combinan las zonas", async () => {
    renderPage();
    await screen.findByText("Centro");
    expect(screen.getByRole("heading", { level: 2, name: "Zonas de entrega" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /una zona sin servicio gana siempre, aunque otra zona con servicio también cubra ese punto/,
      ),
    ).toBeInTheDocument();
  });

  it("cada zona con su tipo, cobertura, servicio y estado; las archivadas al final", async () => {
    api.listZones.mockResolvedValue([
      zone({ id: "z0", name: "Vieja", archived: true }),
      zone(),
      radiusZone({ allowed: false }),
      zone({ id: "z3", name: "Apagada", isActive: false, cities: ["Sucre"] }),
    ]);
    renderPage();
    await screen.findByText("Centro");
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0]?.querySelector("p")?.textContent);
    expect(names).toEqual(["Centro", "Radio sur", "Apagada", "Vieja"]);

    const centro = within(rowOf("Centro"));
    expect(centro.getByText("Por ciudades")).toBeInTheDocument();
    expect(centro.getByText("La Paz y El Alto")).toBeInTheDocument();
    expect(centro.getByText("Con servicio")).toBeInTheDocument();
    expect(centro.getByText("Activa")).toBeInTheDocument();

    const sur = within(rowOf("Radio sur"));
    expect(sur.getByText("Por radio")).toBeInTheDocument();
    expect(sur.getByText("Radio de 7,5 km (centro: -16.5, -68.15)")).toBeInTheDocument();
    expect(sur.getByText("Sin servicio")).toBeInTheDocument();

    expect(within(rowOf("Apagada")).getByText("Inactiva")).toBeInTheDocument();
    const vieja = within(rowOf("Vieja"));
    expect(vieja.getByText("Archivada")).toBeInTheDocument();
    expect(vieja.getByRole("button", { name: "Restaurar la zona «Vieja»" })).toBeInTheDocument();
    expect(vieja.queryByRole("button", { name: /Archivar/ })).not.toBeInTheDocument();
  });

  it("avisa cuando ninguna zona con servicio está activa (cobertura sin configurar)", async () => {
    api.listZones.mockResolvedValue([
      zone({ allowed: false }),
      zone({ id: "z2", isActive: false }),
    ]);
    renderPage();
    expect(await screen.findByText(/Ninguna zona con servicio está activa/)).toBeInTheDocument();
  });

  it("no avisa si hay una zona con servicio activa, ni cuando no hay zonas", async () => {
    renderPage();
    await screen.findByText("Centro");
    expect(screen.queryByText(/Ninguna zona con servicio está activa/)).not.toBeInTheDocument();
  });

  it("los botones miden al menos 44 px de alto", async () => {
    renderPage();
    await screen.findByText("Centro");
    for (const name of ["Nueva zona", "Editar la zona «Centro»", "Archivar la zona «Centro»"]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
  });
});

describe("Zonas: crear", () => {
  const openCreate = async () => {
    await screen.findByText("Centro");
    await userEvent.click(screen.getByRole("button", { name: "Nueva zona" }));
    return dialog();
  };

  it("zona de ciudades: envía exactamente ZoneCreateInput (ciudades sin repetir, sin centro ni radio)", async () => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "  Ciudades principales ");
    await userEvent.type(d.getByLabelText("Ciudades de la zona"), "La Paz, el alto, LA PAZ");
    await userEvent.click(d.getByRole("button", { name: "Añadir" }));
    // Las repetidas (sin tildes ni mayúsculas) se ignoran y se dice cuál.
    expect(
      d.getByText("Añadidas 2 ciudades: La Paz y el alto. Ya estaba en la lista: LA PAZ."),
    ).toBeInTheDocument();
    const list = d.getByRole("list", { name: "Ciudades añadidas" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["La Paz", "el alto"]);
    expect(d.getByText("2 de 200 ciudades")).toBeInTheDocument();

    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));

    await waitFor(() => expect(api.createZone).toHaveBeenCalledTimes(1));
    expect(api.createZone).toHaveBeenCalledWith({
      name: "Ciudades principales",
      kind: "city",
      cities: ["La Paz", "el alto"],
      centerLat: null,
      centerLng: null,
      radiusKm: null,
      allowed: true,
      isActive: true,
    });
    expect(api.updateZone).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Zona creada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // La lista se refresca tras guardar.
    expect(api.listZones.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("Intro en la entrada de ciudades añade la ciudad y NO guarda la zona", async () => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "Sur");
    await userEvent.type(d.getByLabelText("Ciudades de la zona"), "Oruro{Enter}");
    expect(d.getByRole("list", { name: "Ciudades añadidas" })).toHaveTextContent("Oruro");
    expect(d.getByLabelText("Ciudades de la zona")).toHaveValue("");
    expect(api.createZone).not.toHaveBeenCalled();
  });

  it("quitar una ciudad la saca de la lista y devuelve el foco a la entrada", async () => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Ciudades de la zona"), "La Paz, Oruro, Sucre{Enter}");
    await userEvent.click(d.getByRole("button", { name: "Quitar Oruro" }));
    const list = d.getByRole("list", { name: "Ciudades añadidas" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["La Paz", "Sucre"]);
    expect(d.getByLabelText("Ciudades de la zona")).toHaveFocus();
    expect(d.queryByRole("button", { name: "Quitar Oruro" })).not.toBeInTheDocument();
  });

  it("una ciudad de más de 80 caracteres no se añade y se deja en el campo para corregirla", async () => {
    renderPage();
    const d = within(await openCreate());
    const long = "x".repeat(81);
    await userEvent.type(d.getByLabelText("Ciudades de la zona"), `${long}{Enter}`);
    expect(d.getByText(`No se añadió por pasar de 80 caracteres: ${long}.`)).toBeInTheDocument();
    expect(d.getByLabelText("Ciudades de la zona")).toHaveValue(long);
    expect(d.getByText("Todavía no añadiste ninguna ciudad.")).toBeInTheDocument();
  });

  it("zona de radio: el centro arranca en el origen (ubicación principal) y envía radio con coma decimal", async () => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "Radio norte");
    await userEvent.selectOptions(d.getByLabelText("Tipo de zona"), "radius");
    await screen.findByTestId("fake-map");
    expect(d.getByLabelText("Latitud")).toHaveValue("-16.5");
    expect(d.getByLabelText("Longitud")).toHaveValue("-68.15");
    expect(d.getByText(/Por defecto es el origen de los envíos/)).toBeInTheDocument();
    // Cambiar a otro punto escribiendo las coordenadas (también con coma).
    await userEvent.clear(d.getByLabelText("Latitud"));
    await userEvent.type(d.getByLabelText("Latitud"), "-16,52");
    await userEvent.type(d.getByLabelText("Radio (km)"), "7,5");
    await userEvent.click(d.getByRole("checkbox", { name: "Zona sin servicio" }));
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));

    await waitFor(() => expect(api.createZone).toHaveBeenCalledTimes(1));
    expect(api.createZone).toHaveBeenCalledWith({
      name: "Radio norte",
      kind: "radius",
      cities: null,
      centerLat: -16.52,
      centerLng: -68.15,
      radiusKm: 7.5,
      allowed: false,
      isActive: true,
    });
  });

  it("zona de radio con el origen sin tocar: se envía el origen tal cual", async () => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "Radio");
    await userEvent.selectOptions(d.getByLabelText("Tipo de zona"), "radius");
    await userEvent.type(d.getByLabelText("Radio (km)"), "3");
    await userEvent.click(d.getByRole("checkbox", { name: "Activa" }));
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    await waitFor(() => expect(api.createZone).toHaveBeenCalledTimes(1));
    expect(api.createZone).toHaveBeenCalledWith(
      expect.objectContaining({
        centerLat: -16.5,
        centerLng: -68.15,
        radiusKm: 3,
        isActive: false,
      }),
    );
  });

  it("sin ubicación principal no hay centro por defecto: lo dice y pide marcarlo", async () => {
    api.listLocations.mockResolvedValue([location({ isPrimary: false })]);
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "Radio");
    await userEvent.selectOptions(d.getByLabelText("Tipo de zona"), "radius");
    expect(d.getByLabelText("Latitud")).toHaveValue("");
    expect(d.getByText(/Todavía no hay una ubicación principal/)).toBeInTheDocument();
    await userEvent.type(d.getByLabelText("Radio (km)"), "3");
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    expect(
      d.getByText("Marca el centro de la zona en el mapa o escribe sus coordenadas."),
    ).toBeInTheDocument();
    expect(api.createZone).not.toHaveBeenCalled();
  });

  it("un origen archivado o inactivo no se usa como centro", async () => {
    api.listLocations.mockResolvedValue([
      location({ archived: true }),
      location({ id: "l2", isActive: false }),
    ]);
    renderPage();
    const d = within(await openCreate());
    await userEvent.selectOptions(d.getByLabelText("Tipo de zona"), "radius");
    expect(d.getByLabelText("Latitud")).toHaveValue("");
  });

  it("validaciones de una zona de ciudades: cada mensaje junto a su campo y el foco al primero; no se envía", async () => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    expect(d.getByLabelText("Nombre")).toHaveAccessibleDescription(
      "Escribe un nombre para la zona.",
    );
    expect(d.getByLabelText("Ciudades de la zona")).toHaveAccessibleDescription(
      expect.stringContaining("Añade al menos una ciudad."),
    );
    expect(d.getByLabelText("Nombre")).toHaveFocus();
    expect(api.createZone).not.toHaveBeenCalled();

    // Se corrigen y los avisos se van.
    await userEvent.type(d.getByLabelText("Nombre"), "a".repeat(81));
    expect(d.getByText("El nombre admite hasta 80 caracteres.")).toBeInTheDocument();
    await userEvent.clear(d.getByLabelText("Nombre"));
    await userEvent.type(d.getByLabelText("Nombre"), "Ok");
    await userEvent.type(d.getByLabelText("Ciudades de la zona"), "Sucre{Enter}");
    expect(screen.queryByText(/Escribe un nombre para la zona/)).not.toBeInTheDocument();
    expect(screen.queryByText("Añade al menos una ciudad.")).not.toBeInTheDocument();
  });

  it.each([
    ["", "Escribe el radio en kilómetros."],
    ["abc", "El radio debe ser un número (por ejemplo 5 o 7,5)."],
    ["0", "El radio debe ser mayor que 0."],
    ["-2", "El radio debe ser mayor que 0."],
    ["20001", "El radio no puede pasar de 20.000 km."],
    ["1,234", "Usa como máximo 2 decimales."],
  ])("zona de radio: el radio %j dice «%s» y no se envía", async (text, message) => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "R");
    await userEvent.selectOptions(d.getByLabelText("Tipo de zona"), "radius");
    if (text) await userEvent.type(d.getByLabelText("Radio (km)"), text);
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    expect(d.getByLabelText("Radio (km)")).toHaveAccessibleDescription(message);
    expect(d.getByLabelText("Radio (km)")).toHaveFocus();
    expect(api.createZone).not.toHaveBeenCalled();
  });

  it("zona de radio: coordenadas mal escritas o fuera de rango se dicen en su campo", async () => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "R");
    await userEvent.selectOptions(d.getByLabelText("Tipo de zona"), "radius");
    await userEvent.type(d.getByLabelText("Radio (km)"), "3");
    await userEvent.clear(d.getByLabelText("Latitud"));
    await userEvent.type(d.getByLabelText("Latitud"), "abc");
    await userEvent.clear(d.getByLabelText("Longitud"));
    await userEvent.type(d.getByLabelText("Longitud"), "181");
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    expect(d.getByLabelText("Latitud")).toHaveAccessibleDescription(
      "La latitud debe ser un número (por ejemplo -16,5).",
    );
    expect(d.getByLabelText("Longitud")).toHaveAccessibleDescription(
      "La longitud debe estar entre -180 y 180.",
    );
    expect(api.createZone).not.toHaveBeenCalled();
  });

  it("un error de la base se muestra con su mensaje y el diálogo sigue abierto con lo escrito", async () => {
    api.createZone.mockRejectedValue(
      new AppError("conflict", "Ya existe una zona con ese nombre."),
    );
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "Repetida");
    await userEvent.type(d.getByLabelText("Ciudades de la zona"), "Sucre{Enter}");
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    expect(await d.findByText("Ya existe una zona con ese nombre.")).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveValue("Repetida");
    expect(toast.success).not.toHaveBeenCalled();
    // Y se puede volver a intentar.
    api.createZone.mockResolvedValue(zone({ id: "nueva" }));
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    await waitFor(() => expect(api.createZone).toHaveBeenCalledTimes(2));
  });

  it("un doble clic en Guardar envía una sola vez", async () => {
    let resolve: (z: ShippingZone) => void = () => undefined;
    api.createZone.mockReturnValue(new Promise<ShippingZone>((r) => (resolve = r)));
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "Una");
    await userEvent.type(d.getByLabelText("Ciudades de la zona"), "Sucre{Enter}");
    const save = d.getByRole("button", { name: "Guardar zona" });
    await userEvent.dblClick(save);
    expect(api.createZone).toHaveBeenCalledTimes(1);
    expect(d.getByRole("button", { name: "Guardando…" })).toHaveAttribute("aria-busy", "true");
    resolve(zone({ id: "nueva" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("un clic fuera del diálogo no lo cierra (no se pierde lo escrito); Cancelar y Esc sí", async () => {
    renderPage();
    const d = within(await openCreate());
    await userEvent.type(d.getByLabelText("Nombre"), "Borrador");
    // Con el diálogo abierto Radix deja el <body> con `pointer-events: none`: se hace el clic sobre <html>, que sí lo recibe
    // y queda fuera del diálogo. (Radix empieza a escuchar el clic fuera un instante después de abrirse.)
    await new Promise((r) => setTimeout(r, 20));
    await userEvent.click(document.documentElement);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveValue("Borrador");
    await userEvent.click(d.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Al reabrir, el formulario parte de cero.
    await userEvent.click(screen.getByRole("button", { name: "Nueva zona" }));
    expect(within(dialog()).getByLabelText("Nombre")).toHaveValue("");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("el foco vuelve al botón que abrió el diálogo", async () => {
    renderPage();
    await screen.findByText("Centro");
    const button = screen.getByRole("button", { name: "Nueva zona" });
    await userEvent.click(button);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("los campos del diálogo miden al menos 44 px de alto", async () => {
    renderPage();
    const d = within(await openCreate());
    expect(d.getByLabelText("Nombre").className).toContain("min-h-11");
    expect(d.getByLabelText("Tipo de zona").className).toContain("min-h-11");
    expect(d.getByRole("button", { name: "Guardar zona" }).className).toContain("min-h-11");
    expect(d.getByRole("button", { name: "Añadir" }).className).toContain("min-h-11");
  });
});

describe("Zonas: editar", () => {
  const openEdit = async (name: string) => {
    await screen.findByText(name);
    await userEvent.click(screen.getByRole("button", { name: `Editar la zona «${name}»` }));
    return within(dialog());
  };

  it("el tipo no se cambia: se dice y no hay selector; los datos vienen cargados", async () => {
    renderPage();
    const d = await openEdit("Centro");
    expect(d.queryByLabelText("Tipo de zona")).not.toBeInTheDocument();
    expect(
      d.getByText("Tipo de zona: Por ciudades. No se puede cambiar después de crearla."),
    ).toBeInTheDocument();
    expect(d.getByRole("heading", { name: "Editar zona" })).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveValue("Centro");
    expect(
      within(d.getByRole("list", { name: "Ciudades añadidas" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["La Paz", "El Alto"]);
    expect(d.getByRole("checkbox", { name: "Zona sin servicio" })).not.toBeChecked();
    expect(d.getByRole("checkbox", { name: "Activa" })).toBeChecked();
  });

  it("envía ZoneUpdateInput (sin el tipo) con la versión leída", async () => {
    renderPage();
    const d = await openEdit("Centro");
    await userEvent.clear(d.getByLabelText("Nombre"));
    await userEvent.type(d.getByLabelText("Nombre"), "Centro y sur");
    await userEvent.click(d.getByRole("button", { name: "Quitar El Alto" }));
    await userEvent.type(d.getByLabelText("Ciudades de la zona"), "Achumani{Enter}");
    await userEvent.click(d.getByRole("checkbox", { name: "Zona sin servicio" }));
    await userEvent.click(d.getByRole("checkbox", { name: "Activa" }));
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));

    await waitFor(() => expect(api.updateZone).toHaveBeenCalledTimes(1));
    expect(api.updateZone).toHaveBeenCalledWith("z1", "2026-11-05T10:00:00.123456+00:00", {
      name: "Centro y sur",
      cities: ["La Paz", "Achumani"],
      centerLat: null,
      centerLng: null,
      radiusKm: null,
      allowed: false,
      isActive: false,
    });
    expect(api.createZone).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Zona actualizada.");
  });

  it("zona de radio: trae centro y radio, y solo cambia lo que se tocó", async () => {
    api.listZones.mockResolvedValue([radiusZone()]);
    renderPage();
    const d = await openEdit("Radio sur");
    await screen.findByTestId("fake-map");
    expect(d.getByLabelText("Latitud")).toHaveValue("-16.5");
    expect(d.getByLabelText("Longitud")).toHaveValue("-68.15");
    expect(d.getByLabelText("Radio (km)")).toHaveValue("7.5");
    await userEvent.clear(d.getByLabelText("Radio (km)"));
    await userEvent.type(d.getByLabelText("Radio (km)"), "9");
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    await waitFor(() => expect(api.updateZone).toHaveBeenCalledTimes(1));
    expect(api.updateZone).toHaveBeenCalledWith("z2", "2026-11-05T11:00:00.654321+00:00", {
      name: "Radio sur",
      cities: null,
      centerLat: -16.5,
      centerLng: -68.15,
      radiusKm: 9,
      allowed: true,
      isActive: true,
    });
  });

  it("al editar una zona de radio NO se usa el origen: se respeta su centro aunque cambie la ubicación principal", async () => {
    api.listLocations.mockResolvedValue([location({ lat: 10, lng: 20 })]);
    api.listZones.mockResolvedValue([radiusZone()]);
    renderPage();
    const d = await openEdit("Radio sur");
    expect(d.getByLabelText("Latitud")).toHaveValue("-16.5");
  });

  it("conflicto de edición: avisa con el banner, no guarda, bloquea Guardar y «Recargar» cierra y refresca", async () => {
    api.updateZone.mockRejectedValue(new StaleVersionError());
    renderPage();
    const d = await openEdit("Centro");
    const callsBefore = api.listZones.mock.calls.length;
    await userEvent.type(d.getByLabelText("Nombre"), " editado");
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));

    const banner = await d.findByText("Alguien más modificó esto");
    expect(banner.closest('[role="alert"]')).toHaveTextContent(/no se guardó nada tuyo/);
    expect(toast.success).not.toHaveBeenCalled();
    expect(d.getByRole("button", { name: "Guardar zona" })).toBeDisabled();

    // La lista de detrás ya se refrescó con la versión de la otra persona.
    await waitFor(() => expect(api.listZones.mock.calls.length).toBeGreaterThan(callsBefore));
    api.listZones.mockResolvedValue([zone({ name: "Centro (de la otra persona)" })]);
    await userEvent.click(d.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Centro (de la otra persona)")).toBeInTheDocument();
  });

  it("si la zona ya no existe (otra persona la borró) lo dice con el mensaje de la base", async () => {
    api.updateZone.mockRejectedValue(new AppError("not_found", "No encontramos ese registro."));
    renderPage();
    const d = await openEdit("Centro");
    await userEvent.click(d.getByRole("button", { name: "Guardar zona" }));
    expect(await d.findByText("No encontramos ese registro.")).toBeInTheDocument();
  });
});

describe("Zonas: archivar y restaurar", () => {
  it("archivar pide confirmación y envía la versión leída", async () => {
    api.listZones.mockResolvedValue([zone(), zone({ id: "z5", name: "Otra" })]);
    renderPage();
    await screen.findByText("Centro");
    await userEvent.click(screen.getByRole("button", { name: "Archivar la zona «Centro»" }));
    const d = within(dialog());
    expect(d.getByRole("heading", { name: "¿Archivar la zona «Centro»?" })).toBeInTheDocument();
    expect(api.setZoneArchived).not.toHaveBeenCalled();
    await userEvent.click(d.getByRole("button", { name: "Archivar zona" }));
    await waitFor(() =>
      expect(api.setZoneArchived).toHaveBeenCalledWith(
        "z1",
        "2026-11-05T10:00:00.123456+00:00",
        true,
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Zona archivada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancelar no archiva nada", async () => {
    renderPage();
    await screen.findByText("Centro");
    await userEvent.click(screen.getByRole("button", { name: "Archivar la zona «Centro»" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
    expect(api.setZoneArchived).not.toHaveBeenCalled();
  });

  it("advierte cuántas tarifas activas dejarán de aplicarse y si es la única zona con servicio", async () => {
    api.listRates.mockResolvedValue([
      rate({ id: "a" }),
      rate({ id: "b" }),
      rate({ id: "c", isActive: false }),
      rate({ id: "d", archived: true }),
      rate({ id: "e", zoneId: "otra" }),
    ]);
    renderPage();
    await screen.findByText("Centro");
    await waitFor(() => expect(api.listRates).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Archivar la zona «Centro»" }));
    const text = dialog().textContent ?? "";
    expect(text).toContain("2 tarifas activas usan esta zona y dejarán de aplicarse.");
    expect(text).toContain(
      "Es la única zona con servicio activa: sin ella la tienda no podrá calcular envíos a domicilio.",
    );
  });

  it("con una sola tarifa dice «1 tarifa activa usa…»; sin tarifas ni cobertura en juego no advierte de más", async () => {
    api.listZones.mockResolvedValue([zone(), zone({ id: "z5", name: "Otra" })]);
    api.listRates.mockResolvedValue([rate()]);
    renderPage();
    await screen.findByText("Centro");
    await waitFor(() => expect(api.listRates).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Archivar la zona «Centro»" }));
    const text = dialog().textContent ?? "";
    expect(text).toContain("1 tarifa activa usa esta zona y dejará de aplicarse.");
    expect(text).not.toContain("única zona con servicio");
  });

  it("restaurar es directo (sin confirmación) y envía archived=false", async () => {
    api.listZones.mockResolvedValue([zone({ id: "z9", name: "Vieja", archived: true })]);
    renderPage();
    await screen.findByText("Vieja");
    await userEvent.click(screen.getByRole("button", { name: "Restaurar la zona «Vieja»" }));
    await waitFor(() =>
      expect(api.setZoneArchived).toHaveBeenCalledWith(
        "z9",
        "2026-11-05T10:00:00.123456+00:00",
        false,
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Zona restaurada.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("si alguien cambió la zona antes, avisa del conflicto, no archiva y refresca la lista", async () => {
    api.setZoneArchived.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Centro");
    const callsBefore = api.listZones.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Archivar la zona «Centro»" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Archivar zona" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Otra persona guardó cambios"),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listZones.mock.calls.length).toBeGreaterThan(callsBefore));
    // El diálogo sigue abierto para reintentar o cancelar.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("un error de la base al archivar se muestra con su mensaje", async () => {
    api.setZoneArchived.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderPage();
    await screen.findByText("Centro");
    await userEvent.click(screen.getByRole("button", { name: "Archivar la zona «Centro»" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Archivar zona" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
  });
});

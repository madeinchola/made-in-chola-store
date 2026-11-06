import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShippingStorePage } from "./StorePage";
import type { LocationInput, MethodCreateInput, ShippingMethod, StoreLocation } from "./types";

// Una «base» en memoria: lo que se crea o cambia aparece en las lecturas siguientes, como en la base real.
const db = vi.hoisted(() => ({
  locations: [] as StoreLocation[],
  methods: [] as ShippingMethod[],
}));
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
vi.mock("@/components/map/LeafletMap", () => ({
  default: () => <div data-testid="fake-map" />,
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  db.locations = [];
  db.methods = [delivery];
  api.listLocations.mockImplementation(async () => structuredClone(db.locations));
  api.listMethods.mockImplementation(async () => structuredClone(db.methods));
  api.createLocation.mockImplementation(async (input: LocationInput) => {
    const row: StoreLocation = {
      id: `loc-${db.locations.length + 1}`,
      ...input,
      isPrimary: false,
      archived: false,
      updatedAt: "2026-11-05T10:00:00+00:00",
    };
    db.locations.push(row);
    return row;
  });
  api.setPrimaryLocation.mockImplementation(async (id: string) => {
    db.locations = db.locations.map((l) => ({ ...l, isPrimary: l.id === id }));
  });
  api.createMethod.mockImplementation(async (input: MethodCreateInput) => {
    const row: ShippingMethod = {
      id: `met-${db.methods.length + 1}`,
      ...input,
      archived: false,
      updatedAt: "2026-11-05T10:00:00+00:00",
    };
    db.methods.push(row);
    return row;
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShippingStorePage />
    </QueryClientProvider>,
  );
}

describe("ShippingStorePage", () => {
  it("pinta las dos secciones con encabezados h2 y NINGÚN h1 (el h1 es del marco)", async () => {
    renderPage();
    await screen.findByText("Entrega a domicilio");
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Ubicaciones de la tienda",
      "Métodos de envío",
    ]);
  });

  it("flujo completo: crear la primera ubicación, marcarla como origen, y crear un método de recojo en ella", async () => {
    renderPage();
    const user = userEvent.setup();
    const locations = within(
      await screen.findByRole("region", { name: "Ubicaciones de la tienda" }),
    );
    const methods = within(screen.getByRole("region", { name: "Métodos de envío" }));

    // 1) sin ubicaciones: el aviso de que no se puede cotizar
    expect(await locations.findByText("No hay un origen del envío")).toBeInTheDocument();

    // 2) crear la ubicación
    await user.click(locations.getByRole("button", { name: "Agregar la primera ubicación" }));
    const form = within(await screen.findByRole("dialog", { name: "Nueva ubicación" }));
    await user.type(form.getByLabelText("Nombre"), "Taller Sopocachi");
    await user.type(form.getByLabelText("Dirección"), "Av. Sánchez Lima 2345");
    await user.type(form.getByLabelText("Ciudad"), "La Paz");
    await user.type(form.getByLabelText("Latitud"), "-16.5");
    await user.type(form.getByLabelText("Longitud"), "-68.15");
    await user.click(form.getByRole("button", { name: "Guardar ubicación" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await locations.findByText("Taller Sopocachi")).toBeInTheDocument();
    // sigue sin origen: ahora el aviso manda a elegir una
    expect(
      await locations.findByText(/Elige una con «Usar como origen del envío»/),
    ).toBeInTheDocument();

    // 3) marcarla como origen: el aviso desaparece y aparece la insignia
    await user.click(
      locations.getByRole("button", { name: "Usar como origen del envío: «Taller Sopocachi»" }),
    );
    await waitFor(() => expect(api.setPrimaryLocation).toHaveBeenCalledWith("loc-1"));
    expect(await locations.findByText("Origen del envío")).toBeInTheDocument();
    expect(locations.queryByText("No hay un origen del envío")).not.toBeInTheDocument();

    // 4) un método de recojo en esa ubicación; la lista de métodos la nombra
    await user.click(methods.getByRole("button", { name: "Nuevo método" }));
    const methodForm = within(await screen.findByRole("dialog", { name: "Nuevo método de envío" }));
    await user.type(methodForm.getByLabelText("Código"), "recojo_taller");
    await user.type(methodForm.getByLabelText("Nombre"), "Recojo en el taller");
    await user.selectOptions(methodForm.getByLabelText("Tipo"), "pickup");
    await user.selectOptions(await methodForm.findByLabelText("Ubicación de recojo"), "loc-1");
    await user.click(methodForm.getByRole("button", { name: "Guardar método" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createMethod).toHaveBeenCalledWith({
      code: "recojo_taller",
      name: "Recojo en el taller",
      kind: "pickup",
      description: null,
      etaMinDays: null,
      etaMaxDays: null,
      pickupLocationId: "loc-1",
      isActive: true,
      sortOrder: 0,
    });
    expect(await methods.findByText("Se recoge en: Taller Sopocachi")).toBeInTheDocument();
  });
});

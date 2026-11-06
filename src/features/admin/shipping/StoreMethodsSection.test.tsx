import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { StoreMethodsSection } from "./StoreMethodsSection";
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

const location = (over: Partial<StoreLocation> = {}): StoreLocation => ({
  id: "l1",
  name: "Casa central",
  addressText: "Calle 1",
  city: "La Paz",
  lat: -16.5,
  lng: -68.15,
  pickupHours: null,
  isPrimary: false,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});

const method = (over: Partial<ShippingMethod> = {}): ShippingMethod => ({
  id: "m1",
  code: "express",
  name: "Entrega express",
  kind: "delivery",
  description: null,
  etaMinDays: null,
  etaMaxDays: null,
  pickupLocationId: null,
  isActive: true,
  sortOrder: 0,
  archived: false,
  updatedAt: "2026-11-01T10:00:00.123456+00:00",
  ...over,
});

const BASE = method({
  id: "d",
  code: "delivery",
  name: "Entrega a domicilio",
  etaMinDays: 2,
  etaMaxDays: 4,
  sortOrder: 0,
  updatedAt: "2026-11-01T09:00:00.111111+00:00",
});
const PICKUP = method({
  id: "r",
  code: "recojo",
  name: "Retiro Sopocachi",
  kind: "pickup",
  pickupLocationId: "l1",
  etaMinDays: 0,
  etaMaxDays: 1,
  description: "Pasa por tu pedido",
  sortOrder: 10,
  updatedAt: "2026-11-02T09:00:00.222222+00:00",
});
const LOCATIONS = [
  location(),
  location({ id: "l2", name: "Bodega", isActive: false }),
  location({ id: "l3", name: "Vieja", archived: true, isActive: false }),
  location({ id: "l4", name: "Taller" }),
];

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StoreMethodsSection />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((o) => o.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  api.listMethods.mockResolvedValue([BASE, PICKUP]);
  api.listLocations.mockResolvedValue(LOCATIONS);
  api.createMethod.mockResolvedValue(method({ id: "nuevo" }));
  api.updateMethod.mockResolvedValue("v2");
  api.setMethodArchived.mockResolvedValue("v2");
});

describe("StoreMethodsSection: lista y estados", () => {
  it("muestra tipo, código, plazo, orden y estado de cada método; el recojo dice dónde", async () => {
    renderSection();
    await screen.findByText("Entrega a domicilio");
    const base = within(rowOf("Entrega a domicilio"));
    expect(base.getByText("Domicilio")).toBeInTheDocument();
    expect(base.getByText("delivery")).toBeInTheDocument();
    expect(base.getByText("2–4 días")).toBeInTheDocument();
    expect(base.getByText("Activo")).toBeInTheDocument();
    expect(base.queryByText(/Se recoge en/)).not.toBeInTheDocument();
    const pickup = within(rowOf("Retiro Sopocachi"));
    expect(pickup.getByText("Recojo en tienda")).toBeInTheDocument(); // el tipo
    expect(pickup.getByText("recojo")).toBeInTheDocument();
    expect(pickup.getByText("0–1 días")).toBeInTheDocument();
    expect(pickup.getByText("10")).toBeInTheDocument();
    expect(pickup.getByText("Pasa por tu pedido")).toBeInTheDocument();
    expect(await pickup.findByText("Se recoge en: Casa central")).toBeInTheDocument();
  });

  it("los estados: activo, inactivo y archivado (este al final de la lista)", async () => {
    api.listMethods.mockResolvedValue([
      method({ id: "a", code: "viejo", name: "Viejo", archived: true }),
      method({ id: "b", code: "pausa", name: "En pausa", isActive: false }),
      BASE,
    ]);
    renderSection();
    await screen.findByText("En pausa");
    expect(within(rowOf("En pausa")).getByText("Inactivo")).toBeInTheDocument();
    expect(within(rowOf("Viejo")).getByText("Archivado")).toBeInTheDocument();
    expect(within(rowOf("Entrega a domicilio")).getByText("Activo")).toBeInTheDocument();
    const names = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.querySelector("td p")?.textContent);
    expect(names).toEqual(["En pausa", "Entrega a domicilio", "Viejo"]);
  });

  it("un recojo cuya ubicación está inactiva o archivada lo advierte (no se puede cotizar)", async () => {
    api.listMethods.mockResolvedValue([
      method({ id: "a", code: "ra", name: "Recojo A", kind: "pickup", pickupLocationId: "l2" }),
      method({ id: "b", code: "rb", name: "Recojo B", kind: "pickup", pickupLocationId: "l3" }),
      method({ id: "c", code: "rc", name: "Recojo C", kind: "pickup", pickupLocationId: "l1" }),
    ]);
    renderSection();
    await screen.findByText("Recojo A");
    expect(
      await within(rowOf("Recojo A")).findByText(
        "Su ubicación de recojo está inactiva: este método no se puede cotizar.",
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Recojo B")).getByText(
        "Su ubicación de recojo está archivada: este método no se puede cotizar.",
      ),
    ).toBeInTheDocument();
    expect(within(rowOf("Recojo C")).queryByText(/no se puede cotizar/)).not.toBeInTheDocument();
  });

  it("si las ubicaciones no se pudieron leer, NO marca ningún recojo como sin ubicación (no lo sabe)", async () => {
    api.listLocations.mockRejectedValue(new AppError("network", "x"));
    renderSection();
    await screen.findByText("Retiro Sopocachi");
    await waitFor(() => expect(api.listLocations).toHaveBeenCalled());
    // se da tiempo a que la lectura fallida se asiente antes de afirmar la ausencia
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/no se puede cotizar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Se recoge en/)).not.toBeInTheDocument();
  });

  it("carga: avisa «Cargando…»", async () => {
    api.listMethods.mockReturnValue(new Promise(() => {}));
    renderSection();
    const section = within(await screen.findByRole("region", { name: "Métodos de envío" }));
    expect(section.getByRole("status")).toHaveTextContent("Cargando…");
    expect(section.queryByRole("table")).not.toBeInTheDocument();
  });

  it("error: lo dice y «Reintentar» vuelve a pedir la lista", async () => {
    api.listMethods.mockRejectedValueOnce(new AppError("network", "x"));
    renderSection();
    const section = within(await screen.findByRole("region", { name: "Métodos de envío" }));
    expect(await section.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    await userEvent.setup().click(section.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Entrega a domicilio")).toBeInTheDocument();
    expect(api.listMethods).toHaveBeenCalledTimes(2);
  });

  it("vacío: dice que no hay métodos y ofrece agregar el primero", async () => {
    api.listMethods.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText("Todavía no hay métodos de envío.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Agregar el primer método" }));
    expect(
      await screen.findByRole("dialog", { name: "Nuevo método de envío" }),
    ).toBeInTheDocument();
  });

  it("los botones de las filas tienen nombre propio y miden al menos 44 px (min-h-11)", async () => {
    renderSection();
    await screen.findByText("Entrega a domicilio");
    for (const name of ["Editar: «Retiro Sopocachi»", "Archivar: «Retiro Sopocachi»"]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
    expect(screen.getByRole("button", { name: "Nuevo método" }).className).toContain("min-h-11");
  });
});

describe("StoreMethodsSection: crear", () => {
  const openCreate = async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo método" }));
    return {
      user,
      dialog: within(await screen.findByRole("dialog", { name: "Nuevo método de envío" })),
    };
  };

  it("crea un método de domicilio con la forma exacta de MethodCreateInput", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Código"), "  express_2 ");
    await user.type(dialog.getByLabelText("Nombre"), " Entrega express ");
    await user.type(dialog.getByLabelText("Plazo mínimo (días)"), "1");
    await user.type(dialog.getByLabelText("Plazo máximo (días)"), "3");
    await user.clear(dialog.getByLabelText("Orden"));
    await user.type(dialog.getByLabelText("Orden"), "20");
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    await waitFor(() => expect(api.createMethod).toHaveBeenCalledTimes(1));
    expect(api.createMethod).toHaveBeenCalledWith({
      code: "express_2",
      name: "Entrega express",
      kind: "delivery",
      description: null,
      etaMinDays: 1,
      etaMaxDays: 3,
      pickupLocationId: null,
      isActive: true,
      sortOrder: 20,
    });
    expect(api.updateMethod).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Método creado.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listMethods.mock.calls.length).toBeGreaterThan(1); // la lista se volvió a pedir
  });

  it("al abrir el alta NO hay errores todavía: aparecen solo después de intentar guardar", async () => {
    const { dialog } = await openCreate();
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    for (const label of ["Código", "Nombre"]) {
      expect(dialog.getByLabelText(label), label).not.toHaveAttribute("aria-invalid");
    }
  });

  it("un método de domicilio NO muestra el selector de ubicación", async () => {
    const { dialog } = await openCreate();
    expect(dialog.queryByLabelText("Ubicación de recojo")).not.toBeInTheDocument();
  });

  it("un método «recojo» pide ubicación y solo ofrece las ACTIVAS (no las inactivas ni las archivadas)", async () => {
    const { user, dialog } = await openCreate();
    await user.selectOptions(dialog.getByLabelText("Tipo"), "pickup");
    const select = await dialog.findByLabelText("Ubicación de recojo");
    expect(optionTexts(select)).toEqual(["Elige una ubicación", "Casa central", "Taller"]);
  });

  it("crea un recojo con la ubicación ELEGIDA (su id), descripción y plazo de 0 días", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Código"), "recojo_taller");
    await user.type(dialog.getByLabelText("Nombre"), "Recojo en el taller");
    await user.selectOptions(dialog.getByLabelText("Tipo"), "pickup");
    await user.selectOptions(await dialog.findByLabelText("Ubicación de recojo"), "l4");
    await user.type(dialog.getByLabelText("Descripción (opcional)"), "  Pasa por tu pedido ");
    await user.type(dialog.getByLabelText("Plazo mínimo (días)"), "0");
    await user.type(dialog.getByLabelText("Plazo máximo (días)"), "0");
    await user.click(dialog.getByRole("checkbox", { name: "Método activo" }));
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    await waitFor(() => expect(api.createMethod).toHaveBeenCalledTimes(1));
    expect(api.createMethod).toHaveBeenCalledWith({
      code: "recojo_taller",
      name: "Recojo en el taller",
      kind: "pickup",
      description: "Pasa por tu pedido",
      etaMinDays: 0,
      etaMaxDays: 0,
      pickupLocationId: "l4",
      isActive: false,
      sortOrder: 0,
    });
  });

  it("un recojo sin ubicación NO se guarda: error en el selector, con foco, y no llama a la base", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Código"), "recojo_x");
    await user.type(dialog.getByLabelText("Nombre"), "Recojo X");
    await user.selectOptions(dialog.getByLabelText("Tipo"), "pickup");
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    const select = await dialog.findByLabelText("Ubicación de recojo");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription("Elige la ubicación donde se recoge el pedido.");
    await waitFor(() => expect(select).toHaveFocus());
    expect(api.createMethod).not.toHaveBeenCalled();
  });

  it("si se elige una ubicación y luego se cambia a «domicilio», se envía SIN ubicación", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Código"), "mixto");
    await user.type(dialog.getByLabelText("Nombre"), "Mixto");
    await user.selectOptions(dialog.getByLabelText("Tipo"), "pickup");
    await user.selectOptions(await dialog.findByLabelText("Ubicación de recojo"), "l1");
    await user.selectOptions(dialog.getByLabelText("Tipo"), "delivery");
    expect(dialog.queryByLabelText("Ubicación de recojo")).not.toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    await waitFor(() => expect(api.createMethod).toHaveBeenCalledTimes(1));
    expect(api.createMethod.mock.calls[0]?.[0]).toMatchObject({
      kind: "delivery",
      pickupLocationId: null,
    });
  });

  it("sin ubicaciones activas lo dice (y el recojo no se podrá guardar)", async () => {
    api.listLocations.mockResolvedValue([location({ id: "x", isActive: false })]);
    const { user, dialog } = await openCreate();
    await user.selectOptions(dialog.getByLabelText("Tipo"), "pickup");
    expect(await dialog.findByText(/No hay ubicaciones activas/)).toBeInTheDocument();
  });

  it("si las ubicaciones no se pudieron leer, lo dice distinto a «no hay»", async () => {
    api.listLocations.mockRejectedValue(new AppError("network", "x"));
    const { user, dialog } = await openCreate();
    await user.selectOptions(dialog.getByLabelText("Tipo"), "pickup");
    expect(await dialog.findByText(/No pudimos cargar las ubicaciones/)).toBeInTheDocument();
    expect(dialog.queryByText(/No hay ubicaciones activas/)).not.toBeInTheDocument();
  });

  it("valida el código: vacío, formato (cada regla) y repetido (también de un archivado)", async () => {
    api.listMethods.mockResolvedValue([
      BASE,
      method({ id: "z", code: "viejo", name: "Viejo", archived: true }),
    ]);
    const { user, dialog } = await openCreate();
    const code = dialog.getByLabelText("Código");
    const submit = () => user.click(dialog.getByRole("button", { name: "Guardar método" }));
    const format =
      "El código debe tener de 2 a 32 caracteres: minúsculas, dígitos o guion bajo (_), y empezar con una letra.";

    await submit();
    expect(code).toHaveAccessibleDescription("Escribe el código del método.");
    for (const bad of ["a", "1ab", "Ab", "a-b", "a b"]) {
      await user.clear(code);
      await user.type(code, bad);
      expect(code, bad).toHaveAttribute("aria-invalid", "true");
      expect(code, bad).toHaveAccessibleDescription(format);
    }
    await user.clear(code);
    await user.type(code, "viejo");
    expect(code).toHaveAccessibleDescription(
      "Ya existe un método con ese código (puede estar archivado).",
    );
    await user.clear(code);
    await user.type(code, "delivery");
    expect(code).toHaveAccessibleDescription(
      "Ya existe un método con ese código (puede estar archivado).",
    );
    await user.clear(code);
    await user.type(code, "nuevo_1");
    expect(code).not.toHaveAttribute("aria-invalid");
    expect(api.createMethod).not.toHaveBeenCalled();
  });

  it("valida nombre, plazos (0–90, enteros, mínimo ≤ máximo) y orden, cada uno con su mensaje", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Código"), "ok_code");
    await user.type(dialog.getByLabelText("Plazo mínimo (días)"), "91");
    await user.type(dialog.getByLabelText("Plazo máximo (días)"), "2.5");
    await user.clear(dialog.getByLabelText("Orden"));
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    // el foco va al primer campo inválido en orden de pantalla (el nombre: el código ya era válido)
    await waitFor(() => expect(dialog.getByLabelText("Nombre")).toHaveFocus());
    expect(dialog.getByLabelText("Nombre")).toHaveAccessibleDescription(
      "Escribe el nombre del método.",
    );
    expect(dialog.getByLabelText("Plazo mínimo (días)")).toHaveAccessibleDescription(
      "Escribe un número entero de días, de 0 a 90.",
    );
    expect(dialog.getByLabelText("Plazo máximo (días)")).toHaveAccessibleDescription(
      "Escribe un número entero de días, de 0 a 90.",
    );
    expect(dialog.getByLabelText("Orden")).toHaveAccessibleDescription(
      "Escribe un número entero, por ejemplo 0.",
    );
    // mínimo mayor que máximo
    await user.clear(dialog.getByLabelText("Plazo mínimo (días)"));
    await user.type(dialog.getByLabelText("Plazo mínimo (días)"), "5");
    await user.clear(dialog.getByLabelText("Plazo máximo (días)"));
    await user.type(dialog.getByLabelText("Plazo máximo (días)"), "3");
    expect(dialog.getByLabelText("Plazo máximo (días)")).toHaveAccessibleDescription(
      "El plazo máximo no puede ser menor que el mínimo.",
    );
    expect(api.createMethod).not.toHaveBeenCalled();
  });

  it("si la base rechaza (p. ej. código repetido por una carrera), queda abierto con el motivo y lo escrito", async () => {
    api.createMethod.mockRejectedValue(
      new AppError("conflict", "Ya existe un método de envío con ese código."),
    );
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Código"), "express");
    await user.type(dialog.getByLabelText("Nombre"), "Express");
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Ya existe un método de envío con ese código.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Express");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un doble clic crea UN solo método", async () => {
    let finish: (v: unknown) => void = () => {};
    api.createMethod.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Código"), "express");
    await user.type(dialog.getByLabelText("Nombre"), "Express");
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    const busy = await dialog.findByRole("button", { name: "Guardando…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    await user.click(busy);
    expect(api.createMethod).toHaveBeenCalledTimes(1);
    finish(method());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("reabrir el alta la deja en blanco", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Código"), "borrador");
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Nuevo método" }));
    expect(
      within(await screen.findByRole("dialog", { name: "Nuevo método de envío" })).getByLabelText(
        "Código",
      ),
    ).toHaveValue("");
  });

  it("el foco entra al diálogo y, al cerrar, vuelve al botón que lo abrió", async () => {
    renderSection();
    const user = userEvent.setup();
    const opener = await screen.findByRole("button", { name: "Nuevo método" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Nuevo método de envío" });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("StoreMethodsSection: editar", () => {
  const openEdit = async (name: string) => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Editar: «${name}»` }));
    return {
      user,
      dialog: within(await screen.findByRole("dialog", { name: "Editar método de envío" })),
    };
  };

  it("el código y el tipo se MUESTRAN pero no se pueden editar", async () => {
    const { dialog } = await openEdit("Retiro Sopocachi");
    expect(dialog.queryByLabelText("Código")).not.toBeInTheDocument();
    expect(dialog.queryByRole("textbox", { name: "Código" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("combobox", { name: "Tipo" })).not.toBeInTheDocument();
    expect(dialog.getByText("recojo")).toBeInTheDocument();
    expect(dialog.getByText("Recojo en tienda", { selector: "dd" })).toBeInTheDocument();
    expect(
      dialog.getByText("No se pueden cambiar después de crear el método."),
    ).toBeInTheDocument();
  });

  it("trae los datos y actualiza con SU id y SU versión; el MethodUpdateInput no lleva código ni tipo", async () => {
    const { user, dialog } = await openEdit("Retiro Sopocachi");
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Retiro Sopocachi");
    expect(dialog.getByLabelText("Descripción (opcional)")).toHaveValue("Pasa por tu pedido");
    expect(dialog.getByLabelText("Plazo mínimo (días)")).toHaveValue("0");
    expect(dialog.getByLabelText("Plazo máximo (días)")).toHaveValue("1");
    expect(dialog.getByLabelText("Orden")).toHaveValue("10");
    expect(dialog.getByLabelText("Ubicación de recojo")).toHaveValue("l1");
    expect(dialog.getByRole("checkbox", { name: "Método activo" })).toBeChecked();

    await user.clear(dialog.getByLabelText("Nombre"));
    await user.type(dialog.getByLabelText("Nombre"), "Recojo hoy");
    await user.clear(dialog.getByLabelText("Descripción (opcional)"));
    await user.clear(dialog.getByLabelText("Plazo máximo (días)"));
    await user.type(dialog.getByLabelText("Plazo máximo (días)"), "2");
    await user.selectOptions(dialog.getByLabelText("Ubicación de recojo"), "l4");
    await user.click(dialog.getByRole("checkbox", { name: "Método activo" }));
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    await waitFor(() => expect(api.updateMethod).toHaveBeenCalledTimes(1));
    const [id, version, input] = api.updateMethod.mock.calls[0] as [string, string, object];
    expect(id).toBe("r");
    expect(version).toBe("2026-11-02T09:00:00.222222+00:00");
    expect(input).toEqual({
      name: "Recojo hoy",
      description: null,
      etaMinDays: 0,
      etaMaxDays: 2,
      pickupLocationId: "l4",
      isActive: false,
      sortOrder: 10,
    });
    expect(Object.keys(input).sort()).toEqual([
      "description",
      "etaMaxDays",
      "etaMinDays",
      "isActive",
      "name",
      "pickupLocationId",
      "sortOrder",
    ]);
    expect(api.createMethod).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Método actualizado.");
  });

  it("editar un domicilio lo guarda SIN ubicación", async () => {
    const { user, dialog } = await openEdit("Entrega a domicilio");
    expect(dialog.queryByLabelText("Ubicación de recojo")).not.toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    await waitFor(() => expect(api.updateMethod).toHaveBeenCalledTimes(1));
    expect(api.updateMethod).toHaveBeenCalledWith("d", "2026-11-01T09:00:00.111111+00:00", {
      name: "Entrega a domicilio",
      description: null,
      etaMinDays: 2,
      etaMaxDays: 4,
      pickupLocationId: null,
      isActive: true,
      sortOrder: 0,
    });
  });

  it("si su ubicación de recojo ya no está activa, se conserva (marcada) y se avisa; al elegir otra el aviso se va", async () => {
    api.listMethods.mockResolvedValue([
      method({
        id: "r2",
        code: "r2",
        name: "Recojo bodega",
        kind: "pickup",
        pickupLocationId: "l2",
      }),
    ]);
    const { user, dialog } = await openEdit("Recojo bodega");
    const select = await dialog.findByLabelText("Ubicación de recojo");
    await waitFor(() =>
      expect(optionTexts(select)).toEqual([
        "Elige una ubicación",
        "Casa central",
        "Taller",
        "Bodega (inactiva)",
      ]),
    );
    expect(select).toHaveValue("l2");
    expect(
      dialog.getByText("Su ubicación de recojo está inactiva: este método no se puede cotizar."),
    ).toBeInTheDocument();
    await user.selectOptions(select, "l1");
    expect(dialog.queryByText(/no se puede cotizar/)).not.toBeInTheDocument();
  });

  it("al editar un recojo no se puede dejar sin ubicación", async () => {
    const { user, dialog } = await openEdit("Retiro Sopocachi");
    await user.selectOptions(dialog.getByLabelText("Ubicación de recojo"), "");
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    expect(
      await dialog.findByText("Elige la ubicación donde se recoge el pedido."),
    ).toBeInTheDocument();
    expect(api.updateMethod).not.toHaveBeenCalled();
  });

  it("desactivar el método BASE de domicilio avisa de que no habrá envíos a domicilio; otro método no", async () => {
    const base = await openEdit("Entrega a domicilio");
    await base.user.click(base.dialog.getByRole("checkbox", { name: "Método activo" }));
    expect(
      base.dialog.getByText(
        "Es el método base de los envíos a domicilio: si lo desactivas, NO habrá envíos a domicilio.",
      ),
    ).toBeInTheDocument();
  });

  it("desactivar un método que no es el base no muestra ese aviso", async () => {
    const { user, dialog } = await openEdit("Retiro Sopocachi");
    await user.click(dialog.getByRole("checkbox", { name: "Método activo" }));
    expect(dialog.queryByText(/método base/)).not.toBeInTheDocument();
  });

  it("si otra persona lo editó antes: aviso de conflicto en el diálogo, no se guarda y «Recargar» cierra y vuelve a leer", async () => {
    api.updateMethod.mockRejectedValue(new StaleVersionError());
    const { user, dialog } = await openEdit("Retiro Sopocachi");
    await user.click(dialog.getByRole("button", { name: "Guardar método" }));
    expect(await dialog.findByText("Alguien más modificó esto")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    const before = api.listMethods.mock.calls.length;
    await user.click(dialog.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listMethods.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("StoreMethodsSection: archivar y restaurar", () => {
  it("archivar un método pide confirmación y solo archiva al confirmar, con SU id y SU versión", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archivar: «Retiro Sopocachi»" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar este método?" });
    expect(dialog).toHaveTextContent("No se borra: podrás restaurarlo cuando quieras.");
    expect(api.setMethodArchived).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Archivar método" }));
    await waitFor(() => expect(api.setMethodArchived).toHaveBeenCalledTimes(1));
    expect(api.setMethodArchived).toHaveBeenCalledWith(
      "r",
      "2026-11-02T09:00:00.222222+00:00",
      true,
    );
    expect(toast.success).toHaveBeenCalledWith("Método archivado.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("archivar el método BASE «delivery» avisa de que sin él no hay envíos a domicilio", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Archivar: «Entrega a domicilio»" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "¿Archivar el método base de envío a domicilio?",
    });
    expect(dialog).toHaveTextContent("sin él NO hay envíos a domicilio");
    expect(dialog).toHaveTextContent("«Entrega a domicilio»");
    expect(api.setMethodArchived).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Archivar de todos modos" }));
    await waitFor(() => expect(api.setMethodArchived).toHaveBeenCalledTimes(1));
    expect(api.setMethodArchived).toHaveBeenCalledWith(
      "d",
      "2026-11-01T09:00:00.111111+00:00",
      true,
    );
  });

  it("cancelar la confirmación (también la del método base) NO archiva", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Archivar: «Entrega a domicilio»" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setMethodArchived).not.toHaveBeenCalled();
  });

  it("restaurar es inmediato, con su versión, y la archivada no ofrece «Archivar»", async () => {
    api.listMethods.mockResolvedValue([
      BASE,
      method({
        id: "v",
        code: "viejo",
        name: "Viejo",
        archived: true,
        updatedAt: "2026-10-01T00:00:00.5+00:00",
      }),
    ]);
    renderSection();
    const user = userEvent.setup();
    await screen.findByText("Viejo");
    expect(
      within(rowOf("Viejo")).queryByRole("button", { name: /^Archivar/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restaurar: «Viejo»" }));
    await waitFor(() => expect(api.setMethodArchived).toHaveBeenCalledTimes(1));
    expect(api.setMethodArchived).toHaveBeenCalledWith("v", "2026-10-01T00:00:00.5+00:00", false);
    expect(toast.success).toHaveBeenCalledWith("Método restaurado.");
  });

  it("si la acción falla por otra razón, avisa el motivo y la confirmación sigue abierta", async () => {
    api.setMethodArchived.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archivar: «Retiro Sopocachi»" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar método" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("conflicto de edición al archivar: aviso de conflicto y «Recargar» vuelve a leer", async () => {
    api.setMethodArchived.mockRejectedValue(new StaleVersionError());
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archivar: «Retiro Sopocachi»" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Archivar método" }),
    );
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const before = api.listMethods.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(api.listMethods.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument();
  });

  it("conflicto al restaurar", async () => {
    api.listMethods.mockResolvedValue([
      method({ id: "v", code: "viejo", name: "Viejo", archived: true }),
    ]);
    api.setMethodArchived.mockRejectedValue(new StaleVersionError());
    renderSection();
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Restaurar: «Viejo»" }));
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { CollectionsPage } from "./CollectionsPage";
import type { AdminCollection } from "./types";

const api = vi.hoisted(() => ({
  listAdminCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  setCategoryArchived: vi.fn(),
  saveCategoryOrder: vi.fn(),
  isCategorySlugAvailable: vi.fn(),
  listAdminCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  setCollectionArchived: vi.fn(),
  saveCollectionOrder: vi.fn(),
  isCollectionSlugAvailable: vi.fn(),
}));
vi.mock("./api", () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const col = (
  id: string,
  sortOrder: number,
  name: string,
  o: Partial<AdminCollection> = {},
): AdminCollection => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  description: null,
  startsAt: null,
  endsAt: null,
  sortOrder,
  archived: false,
  updatedAt: `2026-10-29T10:00:0${sortOrder}.654321+00:00`,
  ...o,
});

// Siempre vigente · vigente con ventana · programada (2099) · vencida (2020) · archivada
const FIXTURE: AdminCollection[] = [
  col("siempre", 1, "Básicos"),
  col("ventana", 2, "Verano", { startsAt: "2020-01-01T04:00:00Z", endsAt: "2099-12-31T04:00:00Z" }),
  col("futura", 3, "Navidad", { startsAt: "2099-01-01T12:00:00Z" }),
  col("vencida", 4, "Invierno", { endsAt: "2020-06-01T00:00:00Z" }),
  col("vieja", 5, "Outlet", { archived: true }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CollectionsPage />
    </QueryClientProvider>,
  );
}
const dialog = () => screen.getByRole("dialog");
const setDate = (label: string, value: string) =>
  fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  api.listAdminCollections.mockResolvedValue(FIXTURE);
  api.isCollectionSlugAvailable.mockResolvedValue(true);
  api.createCollection.mockResolvedValue(col("n", 9, "Nueva"));
  api.updateCollection.mockResolvedValue("2026-10-29T11:00:00.000000+00:00");
  api.setCollectionArchived.mockResolvedValue("2026-10-29T11:00:00.000000+00:00");
  api.saveCollectionOrder.mockResolvedValue(undefined);
});

describe("CollectionsPage · lista", () => {
  it("muestra título, lista accesible y el estado de cada colección según su vigencia", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Colecciones" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Lista de colecciones" });
    const item = (name: string) => within(list).getByText(name).closest("li") as HTMLElement;
    expect(within(item("Básicos")).getByText("Vigente")).toBeInTheDocument();
    expect(within(item("Verano")).getByText("Vigente")).toBeInTheDocument();
    expect(within(item("Navidad")).getByText("Programada")).toBeInTheDocument();
    expect(within(item("Invierno")).getByText("Vencida")).toBeInTheDocument();
  });

  it("respeta el orden guardado", async () => {
    renderPage();
    const list = await screen.findByRole("list", { name: "Lista de colecciones" });
    const names = within(list)
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p.font-medium")?.textContent);
    expect(names).toEqual(["Básicos", "Verano", "Navidad", "Invierno"]);
  });

  it("muestra la vigencia en hora de La Paz (2099-01-01 12:00 UTC = 08:00)", async () => {
    renderPage();
    await screen.findByText("Navidad");
    const navidad = screen.getByText("Navidad").closest("li") as HTMLElement;
    expect(navidad.textContent).toMatch(/Desde .*08:00/);
    expect((screen.getByText("Básicos").closest("li") as HTMLElement).textContent).toContain(
      "Siempre",
    );
    expect((screen.getByText("Invierno").closest("li") as HTMLElement).textContent).toMatch(
      /Hasta /,
    );
    expect((screen.getByText("Verano").closest("li") as HTMLElement).textContent).toContain("→");
  });

  it("las archivadas se ocultan salvo que se pidan, y se marcan 'Archivada'", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    expect(screen.queryByText("Outlet")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Mostrar archivadas" }));
    const outlet = screen.getByText("Outlet").closest("li") as HTMLElement;
    expect(within(outlet).getByText("Archivada")).toBeInTheDocument();
  });

  it("sin colecciones: invita a crear la primera", async () => {
    api.listAdminCollections.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText("Todavía no hay colecciones. Crea la primera."),
    ).toBeInTheDocument();
  });

  it("todas archivadas: lo dice", async () => {
    api.listAdminCollections.mockResolvedValue([col("a", 1, "Sola", { archived: true })]);
    renderPage();
    expect(await screen.findByText(/Todas las colecciones están archivadas/)).toBeInTheDocument();
  });

  it("error de carga con reintento", async () => {
    const user = userEvent.setup();
    api.listAdminCollections.mockRejectedValueOnce(new AppError("network", "x"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Básicos")).toBeInTheDocument();
  });

  it("mientras carga anuncia el estado", () => {
    api.listAdminCollections.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
  });

  it("los botones de cada fila tienen nombre accesible", async () => {
    renderPage();
    await screen.findByText("Básicos");
    for (const name of [
      "Arrastrar Básicos para reordenar",
      "Subir Básicos",
      "Bajar Básicos",
      "Editar Básicos",
      "Archivar Básicos",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("CollectionsPage · crear", () => {
  it("crea con la vigencia convertida de hora de La Paz a UTC", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Otoño 2027");
    expect(within(dialog()).getByLabelText("Dirección web (slug)")).toHaveValue("otono-2027");
    setDate("Inicio de la vigencia", "2026-10-29T08:00");
    setDate("Fin de la vigencia", "2026-12-01T00:00");
    await within(dialog()).findByText("Disponible");
    await user.click(within(dialog()).getByRole("button", { name: "Crear colección" }));
    await waitFor(() =>
      expect(api.createCollection).toHaveBeenCalledWith({
        name: "Otoño 2027",
        slug: "otono-2027",
        description: null,
        startsAt: "2026-10-29T12:00:00.000Z",
        endsAt: "2026-12-01T04:00:00.000Z",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Colección creada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sin fechas la colección no tiene inicio ni fin", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Sin fechas");
    await within(dialog()).findByText("Disponible");
    await user.click(within(dialog()).getByRole("button", { name: "Crear colección" }));
    await waitFor(() =>
      expect(api.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ startsAt: null, endsAt: null }),
      ),
    );
  });

  it("fin ANTERIOR al inicio se rechaza en el cliente y no llama a la base", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Mal");
    setDate("Inicio de la vigencia", "2026-11-01T00:00");
    setDate("Fin de la vigencia", "2026-10-01T00:00");
    await user.click(within(dialog()).getByRole("button", { name: "Crear colección" }));
    expect(
      await within(dialog()).findByText("El fin de la vigencia debe ser posterior al inicio."),
    ).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Fin de la vigencia")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(api.createCollection).not.toHaveBeenCalled();
  });

  it("fin IGUAL al inicio también se rechaza (la base exige fin > inicio)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Igual");
    setDate("Inicio de la vigencia", "2026-11-01T10:00");
    setDate("Fin de la vigencia", "2026-11-01T10:00");
    await user.click(within(dialog()).getByRole("button", { name: "Crear colección" }));
    expect(await within(dialog()).findByText(/posterior al inicio/)).toBeInTheDocument();
    expect(api.createCollection).not.toHaveBeenCalled();
  });

  it("un minuto de diferencia basta para que sea válida", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Mínima");
    setDate("Inicio de la vigencia", "2026-11-01T10:00");
    setDate("Fin de la vigencia", "2026-11-01T10:01");
    await within(dialog()).findByText("Disponible");
    await user.click(within(dialog()).getByRole("button", { name: "Crear colección" }));
    await waitFor(() => expect(api.createCollection).toHaveBeenCalled());
  });

  it("nombre vacío: error accesible y sin llamada a la base", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.click(within(dialog()).getByRole("button", { name: "Crear colección" }));
    expect(await within(dialog()).findByText("Escribe el nombre.")).toBeInTheDocument();
    expect(api.createCollection).not.toHaveBeenCalled();
  });

  it("un slug ocupado se marca y no deja guardar", async () => {
    const user = userEvent.setup();
    api.isCollectionSlugAvailable.mockResolvedValue(false);
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Verano");
    expect(await within(dialog()).findByText("Esa dirección ya está en uso.")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Crear colección" }));
    expect(api.createCollection).not.toHaveBeenCalled();
  });

  it("editar el slug a mano lo desvincula del nombre", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    const d = within(dialog());
    await user.type(d.getByLabelText("Nombre"), "Primavera");
    const slug = d.getByLabelText("Dirección web (slug)");
    await user.clear(slug);
    await user.type(slug, "spring");
    await user.type(d.getByLabelText("Nombre"), " 2027");
    expect(slug).toHaveValue("spring");
  });

  it("un error de la base se muestra en el diálogo y no cierra", async () => {
    const user = userEvent.setup();
    api.createCollection.mockRejectedValue(
      new AppError(
        "validation",
        "Algún dato no cumple las reglas permitidas. Revisa los valores ingresados.",
      ),
    );
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Rota");
    await within(dialog()).findByText("Disponible");
    await user.click(within(dialog()).getByRole("button", { name: "Crear colección" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Algún dato no cumple las reglas",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un doble clic en 'Crear' no crea dos veces", async () => {
    const user = userEvent.setup();
    let release!: (c: AdminCollection) => void;
    api.createCollection.mockReturnValue(new Promise<AdminCollection>((r) => (release = r)));
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("button", { name: "Nueva colección" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Doble");
    await within(dialog()).findByText("Disponible");
    await user.dblClick(within(dialog()).getByRole("button", { name: "Crear colección" }));
    expect(api.createCollection).toHaveBeenCalledTimes(1);
    release(col("d", 9, "Doble"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("CollectionsPage · editar", () => {
  it("muestra las fechas guardadas en hora de La Paz (2020-01-01 04:00 UTC = 2020-01-01 00:00)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Verano");
    await user.click(screen.getByRole("button", { name: "Editar Verano" }));
    const d = within(dialog());
    expect(d.getByRole("heading", { name: "Editar colección" })).toBeInTheDocument();
    expect(d.getByLabelText("Inicio de la vigencia")).toHaveValue("2020-01-01T00:00");
    expect(d.getByLabelText("Fin de la vigencia")).toHaveValue("2099-12-31T00:00");
  });

  it("guardar sin tocar las fechas devuelve exactamente los mismos instantes y pasa la versión leída", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Verano");
    await user.click(screen.getByRole("button", { name: "Editar Verano" }));
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(api.updateCollection).toHaveBeenCalledTimes(1));
    const [collection, input] = api.updateCollection.mock.calls[0] as [
      AdminCollection,
      Record<string, unknown>,
    ];
    expect(collection.id).toBe("ventana");
    expect(collection.updatedAt).toBe("2026-10-29T10:00:02.654321+00:00");
    expect(input).toEqual({
      name: "Verano",
      slug: "verano",
      description: null,
      startsAt: "2020-01-01T04:00:00.000Z",
      endsAt: "2099-12-31T04:00:00.000Z",
    });
    expect(toast.success).toHaveBeenCalledWith("Cambios guardados.");
  });

  it("vaciar las fechas las quita (null)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Verano");
    await user.click(screen.getByRole("button", { name: "Editar Verano" }));
    setDate("Inicio de la vigencia", "");
    setDate("Fin de la vigencia", "");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(api.updateCollection).toHaveBeenCalled());
    expect(api.updateCollection.mock.calls[0]?.[1]).toMatchObject({ startsAt: null, endsAt: null });
  });

  it("al editar, el slug no cambia solo al cambiar el nombre", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Verano");
    await user.click(screen.getByRole("button", { name: "Editar Verano" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), " 2027");
    expect(within(dialog()).getByLabelText("Dirección web (slug)")).toHaveValue("verano");
  });

  it("CONFLICTO de versión: cierra el diálogo, avisa y 'Recargar' vuelve a pedir los datos", async () => {
    const user = userEvent.setup();
    api.updateCollection.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Verano");
    await user.click(screen.getByRole("button", { name: "Editar Verano" }));
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Alguien más modificó esto");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    const calls = api.listAdminCollections.mock.calls.length;
    await user.click(within(banner).getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(api.listAdminCollections.mock.calls.length).toBeGreaterThan(calls));
    expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument();
  });
});

describe("CollectionsPage · archivar y restaurar", () => {
  it("archivar pide confirmación y archiva la fila correcta", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Navidad");
    await user.click(screen.getByRole("button", { name: "Archivar Navidad" }));
    const confirm = screen.getByRole("dialog");
    expect(within(confirm).getByText("¿Archivar «Navidad»?")).toBeInTheDocument();
    expect(api.setCollectionArchived).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Archivar colección" }));
    await waitFor(() => expect(api.setCollectionArchived).toHaveBeenCalledTimes(1));
    const [collection, archived] = api.setCollectionArchived.mock.calls[0] as [
      AdminCollection,
      boolean,
    ];
    expect(collection.id).toBe("futura");
    expect(archived).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Colección archivada.");
  });

  it("cancelar no archiva nada", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Navidad");
    await user.click(screen.getByRole("button", { name: "Archivar Navidad" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(api.setCollectionArchived).not.toHaveBeenCalled();
  });

  it("restaurar usa archived=false", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Básicos");
    await user.click(screen.getByRole("checkbox", { name: "Mostrar archivadas" }));
    await user.click(screen.getByRole("button", { name: "Restaurar Outlet" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Restaurar colección" }),
    );
    await waitFor(() => expect(api.setCollectionArchived).toHaveBeenCalledTimes(1));
    expect((api.setCollectionArchived.mock.calls[0] as [AdminCollection, boolean])[1]).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Colección restaurada.");
  });

  it("si la base lo rechaza, muestra el motivo y mantiene la confirmación abierta", async () => {
    const user = userEvent.setup();
    api.setCollectionArchived.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderPage();
    await screen.findByText("Navidad");
    await user.click(screen.getByRole("button", { name: "Archivar Navidad" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Archivar colección" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("conflicto al archivar: cierra la confirmación y avisa", async () => {
    const user = userEvent.setup();
    api.setCollectionArchived.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Navidad");
    await user.click(screen.getByRole("button", { name: "Archivar Navidad" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Archivar colección" }),
    );
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("CollectionsPage · reordenar con botones (alternativa de teclado)", () => {
  it("en los bordes los botones están deshabilitados", async () => {
    renderPage();
    await screen.findByText("Básicos");
    expect(screen.getByRole("button", { name: "Subir Básicos" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Básicos" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Bajar Invierno" })).toBeDisabled(); // última visible (Outlet está archivada)
  });

  it("bajar 'Verano' intercambia con 'Navidad' y escribe solo esas dos filas con su versión", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Verano");
    await user.click(screen.getByRole("button", { name: "Bajar Verano" }));
    await waitFor(() => expect(api.saveCollectionOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCollectionOrder).toHaveBeenCalledWith([
      { id: "futura", sortOrder: 2, updatedAt: "2026-10-29T10:00:03.654321+00:00" },
      { id: "ventana", sortOrder: 3, updatedAt: "2026-10-29T10:00:02.654321+00:00" },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Orden guardado.");
  });

  it("subir la última visible la intercambia con la anterior", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Invierno");
    await user.click(screen.getByRole("button", { name: "Subir Invierno" }));
    await waitFor(() => expect(api.saveCollectionOrder).toHaveBeenCalledTimes(1));
    const ids = (api.saveCollectionOrder.mock.calls[0]?.[0] as { id: string }[]).map((c) => c.id);
    expect(ids).toEqual(["vencida", "futura"]);
  });

  it("si guardar el orden falla muestra el motivo", async () => {
    const user = userEvent.setup();
    api.saveCollectionOrder.mockRejectedValue(new AppError("unknown", "sin conexión"));
    renderPage();
    await screen.findByText("Verano");
    await user.click(screen.getByRole("button", { name: "Bajar Verano" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No se pudo guardar el nuevo orden: sin conexión"),
    );
  });

  it("conflicto al reordenar: muestra el aviso", async () => {
    const user = userEvent.setup();
    api.saveCollectionOrder.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Verano");
    await user.click(screen.getByRole("button", { name: "Bajar Verano" }));
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
  });
});

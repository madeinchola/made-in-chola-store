import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { CategoriesPage } from "./CategoriesPage";
import type { AdminCategory } from "./types";

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

const cat = (
  id: string,
  parentId: string | null,
  sortOrder: number,
  name: string,
  o: Partial<AdminCategory> = {},
): AdminCategory => ({
  id,
  parentId,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  description: null,
  sortOrder,
  archived: false,
  updatedAt: `2026-10-29T10:00:0${sortOrder}.123456+00:00`,
  ...o,
});

// Ropa (1) → Chaquetas (1), Vestidos (2) · Accesorios (2) · Vieja (3, archivada)
const FIXTURE: AdminCategory[] = [
  cat("ropa", null, 1, "Ropa"),
  cat("chaquetas", "ropa", 1, "Chaquetas"),
  cat("vestidos", "ropa", 2, "Vestidos"),
  cat("accesorios", null, 2, "Accesorios"),
  cat("vieja", null, 3, "Vieja", { archived: true }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CategoriesPage />
    </QueryClientProvider>,
  );
}

const dialog = () => screen.getByRole("dialog");

beforeEach(() => {
  vi.clearAllMocks();
  api.listAdminCategories.mockResolvedValue(FIXTURE);
  api.isCategorySlugAvailable.mockResolvedValue(true);
  api.createCategory.mockResolvedValue(cat("nueva", null, 9, "Nueva"));
  api.updateCategory.mockResolvedValue("2026-10-29T11:00:00.000000+00:00");
  api.setCategoryArchived.mockResolvedValue("2026-10-29T11:00:00.000000+00:00");
  api.saveCategoryOrder.mockResolvedValue(undefined);
});

describe("CategoriesPage · árbol", () => {
  it("muestra el árbol anidado en orden, con su título y navegación accesibles", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Categorías" })).toBeInTheDocument();
    const nav = await screen.findByRole("navigation", { name: "Árbol de categorías" });
    const text = nav.textContent ?? "";
    expect(text.indexOf("Ropa")).toBeLessThan(text.indexOf("Chaquetas"));
    expect(text.indexOf("Chaquetas")).toBeLessThan(text.indexOf("Vestidos"));
    expect(text.indexOf("Vestidos")).toBeLessThan(text.indexOf("Accesorios"));
    // Chaquetas y Vestidos están en una lista anidada dentro del elemento de Ropa
    const ropaItem = screen.getByText("Ropa").closest("li") as HTMLElement;
    expect(within(ropaItem).getByText("Chaquetas")).toBeInTheDocument();
    expect(within(ropaItem).queryByText("Accesorios")).not.toBeInTheDocument();
    expect(screen.getByText(/2 subcategorías/)).toBeInTheDocument();
  });

  it("las archivadas están ocultas por defecto y 'Mostrar archivadas' las revela con su etiqueta", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    expect(screen.queryByText("Vieja")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Mostrar archivadas" }));
    expect(screen.getByText("Vieja")).toBeInTheDocument();
    expect(screen.getByText("archivada")).toBeInTheDocument();
  });

  it("cada fila tiene botones con nombre accesible (asa, subir, bajar, subcategoría, editar, archivar)", async () => {
    renderPage();
    await screen.findByText("Ropa");
    for (const name of [
      "Arrastrar Ropa para reordenar",
      "Subir Ropa",
      "Bajar Ropa",
      "Agregar subcategoría a Ropa",
      "Editar Ropa",
      "Archivar Ropa",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("sin categorías: invita a crear la primera", async () => {
    api.listAdminCategories.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText("Todavía no hay categorías. Crea la primera."),
    ).toBeInTheDocument();
  });

  it("si todas están archivadas lo dice y explica cómo verlas", async () => {
    api.listAdminCategories.mockResolvedValue([cat("a", null, 1, "Sola", { archived: true })]);
    renderPage();
    expect(await screen.findByText(/Todas las categorías están archivadas/)).toBeInTheDocument();
  });

  it("si la carga falla muestra el error con reintento y reintentar vuelve a pedir", async () => {
    const user = userEvent.setup();
    api.listAdminCategories.mockRejectedValueOnce(new AppError("network", "x"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Ropa")).toBeInTheDocument();
  });

  it("mientras carga anuncia el estado", () => {
    api.listAdminCategories.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
  });
});

describe("CategoriesPage · crear", () => {
  it("crea con el slug generado del nombre, sin descripción ni padre, y avisa", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Zapatos y Botas");
    expect(within(dialog()).getByLabelText("Dirección web (slug)")).toHaveValue("zapatos-y-botas");
    await within(dialog()).findByText("Disponible");
    await user.click(within(dialog()).getByRole("button", { name: "Crear categoría" }));
    await waitFor(() =>
      expect(api.createCategory).toHaveBeenCalledWith({
        name: "Zapatos y Botas",
        slug: "zapatos-y-botas",
        description: null,
        parentId: null,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Categoría creada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // refresca la lista
    await waitFor(() => expect(api.listAdminCategories.mock.calls.length).toBeGreaterThan(1));
  });

  it("acentos y ñ en el nombre producen un slug válido", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Ñandú — Edición 2027");
    expect(within(dialog()).getByLabelText("Dirección web (slug)")).toHaveValue(
      "nandu-edicion-2027",
    );
  });

  it("si se edita el slug a mano, deja de seguir al nombre; 'Generar del nombre' lo recupera", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    const d = within(dialog());
    await user.type(d.getByLabelText("Nombre"), "Zapatos");
    const slug = d.getByLabelText("Dirección web (slug)");
    await user.clear(slug);
    await user.type(slug, "calzado");
    await user.type(d.getByLabelText("Nombre"), " finos");
    expect(slug).toHaveValue("calzado");
    await user.click(d.getByRole("button", { name: "Generar del nombre" }));
    expect(slug).toHaveValue("zapatos-finos");
    await user.type(d.getByLabelText("Nombre"), " 2");
    expect(slug).toHaveValue("zapatos-finos-2");
  });

  it("un slug ocupado se marca en vivo y NO deja guardar", async () => {
    const user = userEvent.setup();
    api.isCategorySlugAvailable.mockResolvedValue(false);
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Ropa");
    expect(await within(dialog()).findByText("Esa dirección ya está en uso.")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Crear categoría" }));
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it("consulta la disponibilidad con el slug final y sin excluir ninguna fila al crear", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Botas");
    await waitFor(() =>
      expect(api.isCategorySlugAvailable).toHaveBeenCalledWith("botas", undefined),
    );
  });

  it("nombre vacío: muestra el error, enfoca el aviso y no llama a la base", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    await user.click(within(dialog()).getByRole("button", { name: "Crear categoría" }));
    expect(await within(dialog()).findByText("Escribe el nombre.")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true");
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it("slug con formato inválido (espacios, mayúsculas) se rechaza en el cliente", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    const d = within(dialog());
    await user.type(d.getByLabelText("Nombre"), "Zapatos");
    const slug = d.getByLabelText("Dirección web (slug)");
    await user.clear(slug);
    await user.type(slug, "Con Espacios");
    await user.click(d.getByRole("button", { name: "Crear categoría" }));
    expect(await d.findByText(/Usa solo minúsculas, números y guiones/)).toBeInTheDocument();
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it("un error de la base se muestra en el diálogo (en español) y el diálogo sigue abierto", async () => {
    const user = userEvent.setup();
    api.createCategory.mockRejectedValue(
      new AppError("conflict", "Ya existe una categoría con esa dirección (slug)."),
    );
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Botas");
    await within(dialog()).findByText("Disponible");
    await user.click(within(dialog()).getByRole("button", { name: "Crear categoría" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Ya existe una categoría con esa dirección (slug).",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un doble clic en 'Crear' no crea dos veces", async () => {
    const user = userEvent.setup();
    let release!: (c: AdminCategory) => void;
    api.createCategory.mockReturnValue(new Promise<AdminCategory>((r) => (release = r)));
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Botas");
    await within(dialog()).findByText("Disponible");
    await user.dblClick(within(dialog()).getByRole("button", { name: "Crear categoría" }));
    expect(api.createCategory).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("button", { name: "Guardando…" })).toBeDisabled();
    release(cat("n", null, 9, "Botas"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("'Agregar subcategoría' abre el diálogo con el padre ya elegido y lo envía", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Agregar subcategoría a Ropa" }));
    expect(within(dialog()).getByLabelText("Categoría padre")).toHaveValue("ropa");
    await user.type(within(dialog()).getByLabelText("Nombre"), "Faldas");
    await within(dialog()).findByText("Disponible");
    await user.click(within(dialog()).getByRole("button", { name: "Crear categoría" }));
    await waitFor(() =>
      expect(api.createCategory).toHaveBeenCalledWith({
        name: "Faldas",
        slug: "faldas",
        description: null,
        parentId: "ropa",
      }),
    );
  });

  it("la descripción se envía recortada", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    await user.type(within(dialog()).getByLabelText("Nombre"), "Botas");
    await user.type(within(dialog()).getByLabelText("Descripción (opcional)"), "  Para el frío  ");
    await within(dialog()).findByText("Disponible");
    await user.click(within(dialog()).getByRole("button", { name: "Crear categoría" }));
    await waitFor(() =>
      expect(api.createCategory).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Para el frío" }),
      ),
    );
  });
});

describe("CategoriesPage · editar y selector de padre", () => {
  it("abre con los datos de la categoría y guarda pasando la fila (con su versión) y los nuevos valores", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Editar Chaquetas" }));
    const d = within(dialog());
    expect(d.getByRole("heading", { name: "Editar categoría" })).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveValue("Chaquetas");
    expect(d.getByLabelText("Dirección web (slug)")).toHaveValue("chaquetas");
    expect(d.getByLabelText("Categoría padre")).toHaveValue("ropa");
    await user.clear(d.getByLabelText("Nombre"));
    await user.type(d.getByLabelText("Nombre"), "Chaquetas de cuero");
    // al editar, el slug NO cambia solo (rompería los enlaces existentes)
    expect(d.getByLabelText("Dirección web (slug)")).toHaveValue("chaquetas");
    await user.click(d.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenCalledTimes(1));
    const [category, input] = api.updateCategory.mock.calls[0] as [AdminCategory, unknown];
    expect(category.id).toBe("chaquetas");
    expect(category.updatedAt).toBe("2026-10-29T10:00:01.123456+00:00"); // la versión leída, tal cual
    expect(input).toEqual({
      name: "Chaquetas de cuero",
      slug: "chaquetas",
      description: null,
      parentId: "ropa",
    });
    expect(toast.success).toHaveBeenCalledWith("Cambios guardados.");
  });

  it("al editar su propio slug no lo marca como ocupado ni consulta la base", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Editar Ropa" }));
    expect(await within(dialog()).findByText("Disponible")).toBeInTheDocument();
    expect(api.isCategorySlugAvailable).not.toHaveBeenCalled();
  });

  it("al editar 'Ropa' el selector NO ofrece ni a Ropa ni a sus subcategorías (ciclo imposible)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Editar Ropa" }));
    const options = within(within(dialog()).getByLabelText("Categoría padre"))
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());
    expect(options).toEqual(["Ninguna (categoría principal)", "Accesorios"]);
  });

  it("al editar 'Chaquetas' ofrece Ropa, Vestidos y Accesorios, pero no ella misma ni la archivada", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Editar Chaquetas" }));
    const options = within(within(dialog()).getByLabelText("Categoría padre"))
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());
    expect(options).toEqual(["Ninguna (categoría principal)", "Ropa", "Vestidos", "Accesorios"]);
  });

  it("al crear, el selector ofrece todas las activas con sangría por nivel, sin las archivadas", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    const options = within(within(dialog()).getByLabelText("Categoría padre")).getAllByRole(
      "option",
    );
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      "Ninguna (categoría principal)",
      "Ropa",
      "Chaquetas",
      "Vestidos",
      "Accesorios",
    ]);
    expect(options[2]?.textContent?.startsWith("  ")).toBe(true);
    expect(options[1]?.textContent?.startsWith(" ")).toBe(false);
  });

  it("mover a otro padre manda el nuevo parentId", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Editar Vestidos" }));
    await user.selectOptions(within(dialog()).getByLabelText("Categoría padre"), "Accesorios");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenCalled());
    expect(
      (api.updateCategory.mock.calls[0] as [AdminCategory, { parentId: string }])[1].parentId,
    ).toBe("accesorios");
  });

  it("un error de la base al editar (ciclo, padre archivado…) se muestra tal cual", async () => {
    const user = userEvent.setup();
    api.updateCategory.mockRejectedValue(
      new AppError(
        "validation",
        "la categoría padre está archivada: desarchívala primero o elige otro padre",
      ),
    );
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Editar Vestidos" }));
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "la categoría padre está archivada",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("CONFLICTO de versión: cierra el diálogo, avisa que no se guardó nada y 'Recargar' trae la versión actual", async () => {
    const user = userEvent.setup();
    api.updateCategory.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Editar Ropa" }));
    await user.click(within(dialog()).getByRole("button", { name: "Guardar cambios" }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Alguien más modificó esto");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    const calls = api.listAdminCategories.mock.calls.length;
    await user.click(within(banner).getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(api.listAdminCategories.mock.calls.length).toBeGreaterThan(calls));
    expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument();
  });
});

describe("CategoriesPage · archivar y restaurar", () => {
  it("archivar pide confirmación explicando el efecto y luego archiva la fila correcta", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Archivar Accesorios" }));
    const confirm = screen.getByRole("dialog");
    expect(within(confirm).getByText("¿Archivar «Accesorios»?")).toBeInTheDocument();
    expect(within(confirm).getByText(/Dejará de mostrarse en la tienda/)).toBeInTheDocument();
    expect(api.setCategoryArchived).not.toHaveBeenCalled(); // nada ocurre sin confirmar
    await user.click(within(confirm).getByRole("button", { name: "Archivar categoría" }));
    await waitFor(() => expect(api.setCategoryArchived).toHaveBeenCalledTimes(1));
    const [category, archived] = api.setCategoryArchived.mock.calls[0] as [AdminCategory, boolean];
    expect(category.id).toBe("accesorios");
    expect(archived).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Categoría archivada.");
  });

  it("cancelar la confirmación no archiva nada", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Archivar Accesorios" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(api.setCategoryArchived).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("si la base lo rechaza (subcategorías activas) se muestra el motivo y la confirmación sigue abierta", async () => {
    const user = userEvent.setup();
    api.setCategoryArchived.mockRejectedValue(
      new AppError(
        "validation",
        "no se puede archivar una categoría con subcategorías activas: archívalas o muévelas primero",
      ),
    );
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Archivar Ropa" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Archivar categoría" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("subcategorías activas")),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("restaurar una archivada la restaura con archived=false", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("checkbox", { name: "Mostrar archivadas" }));
    await user.click(screen.getByRole("button", { name: "Restaurar Vieja" }));
    expect(within(screen.getByRole("dialog")).getByText("¿Restaurar «Vieja»?")).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Restaurar categoría" }),
    );
    await waitFor(() => expect(api.setCategoryArchived).toHaveBeenCalledTimes(1));
    expect((api.setCategoryArchived.mock.calls[0] as [AdminCategory, boolean])[1]).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Categoría restaurada.");
  });

  it("una archivada no ofrece 'agregar subcategoría'", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("checkbox", { name: "Mostrar archivadas" }));
    expect(
      screen.queryByRole("button", { name: "Agregar subcategoría a Vieja" }),
    ).not.toBeInTheDocument();
  });

  it("conflicto al archivar: cierra la confirmación y muestra el aviso", async () => {
    const user = userEvent.setup();
    api.setCategoryArchived.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Archivar Accesorios" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Archivar categoría" }),
    );
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("CategoriesPage · reordenar con botones (alternativa de teclado)", () => {
  it("en los bordes los botones están deshabilitados", async () => {
    renderPage();
    await screen.findByText("Ropa");
    expect(screen.getByRole("button", { name: "Subir Ropa" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Ropa" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Bajar Accesorios" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Subir Chaquetas" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Vestidos" })).toBeDisabled();
  });

  it("bajar 'Ropa' intercambia con 'Accesorios' y escribe solo esas dos filas, con su versión", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Bajar Ropa" }));
    await waitFor(() => expect(api.saveCategoryOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCategoryOrder).toHaveBeenCalledWith([
      { id: "accesorios", sortOrder: 1, updatedAt: "2026-10-29T10:00:02.123456+00:00" },
      { id: "ropa", sortOrder: 2, updatedAt: "2026-10-29T10:00:01.123456+00:00" },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Orden guardado.");
  });

  it("solo reordena entre hermanas: bajar 'Chaquetas' no toca a las categorías principales", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Bajar Chaquetas" }));
    await waitFor(() => expect(api.saveCategoryOrder).toHaveBeenCalledTimes(1));
    const ids = (api.saveCategoryOrder.mock.calls[0]?.[0] as { id: string }[]).map((c) => c.id);
    expect(ids).toEqual(["vestidos", "chaquetas"]);
  });

  it("con 3 hermanas, mover la primera una posición escribe 2 filas (la tercera no cambia)", async () => {
    const user = userEvent.setup();
    api.listAdminCategories.mockResolvedValue([
      cat("x1", null, 1, "Uno"),
      cat("x2", null, 2, "Dos"),
      cat("x3", null, 3, "Tres"),
    ]);
    renderPage();
    await screen.findByText("Uno");
    await user.click(screen.getByRole("button", { name: "Bajar Uno" }));
    await waitFor(() => expect(api.saveCategoryOrder).toHaveBeenCalledTimes(1));
    const changes = api.saveCategoryOrder.mock.calls[0]?.[0] as { id: string; sortOrder: number }[];
    expect(changes.map((c) => `${c.id}:${c.sortOrder}`)).toEqual(["x2:1", "x1:2"]);
  });

  it("si guardar el orden falla muestra el motivo", async () => {
    const user = userEvent.setup();
    api.saveCategoryOrder.mockRejectedValue(new AppError("unknown", "sin conexión"));
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Bajar Ropa" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No se pudo guardar el nuevo orden: sin conexión"),
    );
  });

  it("conflicto al reordenar: muestra el aviso de edición concurrente", async () => {
    const user = userEvent.setup();
    api.saveCategoryOrder.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Bajar Ropa" }));
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
  });

  it("ocultas las archivadas, el orden se calcula solo entre las visibles", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ropa");
    await user.click(screen.getByRole("button", { name: "Bajar Ropa" }));
    await waitFor(() => expect(api.saveCategoryOrder).toHaveBeenCalled());
    const ids = (api.saveCategoryOrder.mock.calls[0]?.[0] as { id: string }[]).map((c) => c.id);
    expect(ids).not.toContain("vieja");
  });
});

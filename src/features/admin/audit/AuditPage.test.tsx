import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { AuditPage } from "./AuditPage";
import type { AuditListParams } from "./listParams";
import type { AuditRow } from "./types";

const api = vi.hoisted(() => ({ listAuditLog: vi.fn(), listAdminActors: vi.fn() }));
vi.mock("./api", () => api);

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 101,
  occurredAt: "2026-10-30T02:00:00+00:00", // 29/10 22:00 en La Paz
  actorId: ADMIN,
  actorName: "Ana Admin",
  actorRole: "authenticated",
  tableName: "products",
  recordId: "b3000000-0000-4000-8000-000000000001",
  action: "UPDATE",
  diff: {
    name: { old: "Camisa", new: "Camisa Chola" },
    slug: { old: "camisa", new: "camisa-chola" },
  },
  ...over,
});

let search = "";
function Probe() {
  search = useLocation().search;
  return null;
}
function renderPage(url = "/admin/auditoria") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <AuditPage />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const lastParams = (): AuditListParams => api.listAuditLog.mock.lastCall?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
  api.listAuditLog.mockResolvedValue({ rows: [row()], total: 1 });
  api.listAdminActors.mockResolvedValue([
    { id: ADMIN, name: "Ana Admin" },
    { id: OTHER, name: "Beto Admin" },
  ]);
});

describe("AuditPage", () => {
  it("si la página pedida no existe (más allá del final) salta a la última válida en vez de mostrar una tabla vacía", async () => {
    api.listAuditLog.mockImplementation(async (p: AuditListParams) =>
      p.page > 3 ? { rows: [], total: 60 } : { rows: [row()], total: 60 },
    );
    renderPage("/admin/auditoria?pagina=99");
    await waitFor(() => expect(search).toBe("?pagina=3")); // 60 registros / 25 por página = 3 páginas
    await screen.findByText("Página 3 de 3");
    expect(lastParams().page).toBe(3);
  });

  it("muestra fecha en hora de La Paz, quién, qué (nombre amigable y acción), registro y resumen del cambio", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Auditoría" });
    const view = within(table);
    expect(view.getByText(/29\/10\/26.*22:00/)).toBeInTheDocument();
    expect(view.getByText("Ana Admin")).toBeInTheDocument();
    expect(view.getByText("Productos")).toBeInTheDocument();
    expect(view.getByText("Modificado")).toBeInTheDocument();
    expect(view.getByText("b3000000-0000-4000-8000-000000000001")).toBeInTheDocument();
    expect(view.getByText("Cambió: name, slug")).toBeInTheDocument();
  });

  it("la tabla se llama por su nombre amigable, no por el técnico", async () => {
    api.listAuditLog.mockResolvedValue({
      rows: [
        row({ tableName: "store_settings", action: "UPDATE", recordId: "stock_low_threshold" }),
      ],
      total: 1,
    });
    renderPage();
    expect(await screen.findByText("Ajustes de la tienda")).toBeInTheDocument();
    expect(screen.queryByText("store_settings")).not.toBeInTheDocument();
  });

  it("el detalle empieza cerrado y al abrirlo muestra cada columna con su valor anterior y el nuevo", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Auditoría" });
    const details = document.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await user.click(screen.getByText("Ver detalle", { exact: false }));
    expect(details.open).toBe(true);
    const inner = within(screen.getByRole("table", { name: "Detalle del cambio" }));
    expect(inner.getByRole("columnheader", { name: "Antes" })).toBeInTheDocument();
    expect(inner.getByRole("columnheader", { name: "Después" })).toBeInTheDocument();
    expect(inner.getByRole("rowheader", { name: "name" })).toBeInTheDocument();
    expect(inner.getByText("Camisa")).toBeInTheDocument();
    expect(inner.getByText("Camisa Chola")).toBeInTheDocument();
    expect(inner.getByText("camisa-chola")).toBeInTheDocument();
  });

  it("el botón de detalle es único para lectores de pantalla (incluye el número de cambio)", async () => {
    api.listAuditLog.mockResolvedValue({ rows: [row({ id: 1 }), row({ id: 2 })], total: 2 });
    renderPage();
    await screen.findByRole("table", { name: "Auditoría" });
    const summaries = screen.getAllByText("Ver detalle", { exact: false });
    expect(summaries[0]?.textContent).toContain("(cambio 1)");
    expect(summaries[1]?.textContent).toContain("(cambio 2)");
  });

  it("un dato personal NO muestra valor: solo que cambió (no se inventa nada)", async () => {
    const user = userEvent.setup();
    api.listAuditLog.mockResolvedValue({
      rows: [
        row({
          tableName: "profiles",
          diff: { email: { changed: true }, full_name: { changed: true } },
        }),
      ],
      total: 1,
    });
    renderPage();
    await screen.findByRole("table", { name: "Auditoría" });
    await user.click(screen.getByText("Ver detalle", { exact: false }));
    expect(screen.getAllByText("cambió (dato personal: no se guarda su valor)")).toHaveLength(2);
  });

  it("un alta muestra «Creado: nombre» y el detalle lista los valores", async () => {
    const user = userEvent.setup();
    api.listAuditLog.mockResolvedValue({
      rows: [
        row({
          action: "INSERT",
          tableName: "categories",
          diff: { name: "Chaquetas", sort_order: 3 },
        }),
      ],
      total: 1,
    });
    renderPage();
    expect(await screen.findByText("Creado: «Chaquetas»")).toBeInTheDocument();
    await user.click(screen.getByText("Ver detalle", { exact: false }));
    const inner = within(screen.getByRole("table", { name: "Detalle del cambio" }));
    expect(inner.getByRole("columnheader", { name: "Valor" })).toBeInTheDocument();
    expect(inner.getByText("3")).toBeInTheDocument();
  });

  it("sin actor es el Sistema; con actor que ya no se encuentra, 'Persona desconocida'", async () => {
    api.listAuditLog.mockResolvedValue({
      rows: [
        row({ id: 1, actorId: null, actorName: null, actorRole: "postgres" }),
        row({ id: 2, actorId: OTHER, actorName: null }),
      ],
      total: 2,
    });
    renderPage();
    const table = await screen.findByRole("table", { name: "Auditoría" });
    expect(within(table).getByText("Sistema")).toBeInTheDocument();
    expect(within(table).getByText("Persona desconocida")).toBeInTheDocument();
  });

  it("registro sin id muestra un guion; un diff mal formado no rompe la pantalla", async () => {
    const user = userEvent.setup();
    api.listAuditLog.mockResolvedValue({
      rows: [row({ recordId: null, diff: "basura" })],
      total: 1,
    });
    renderPage();
    const table = await screen.findByRole("table", { name: "Auditoría" });
    // «Modificado» sale dos veces: la etiqueta de la acción y el resumen (sin detalle que resumir).
    expect(within(table).getAllByText("Modificado")).toHaveLength(2);
    expect(within(table).getByText("—")).toBeInTheDocument();
    await user.click(screen.getByText("Ver detalle", { exact: false }));
    expect(screen.getByText("Este registro no trae detalle.")).toBeInTheDocument();
  });

  it("pide al servidor la página 1 de 25 sin filtros", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Auditoría" });
    expect(lastParams()).toEqual({ page: 1, pageSize: 25 });
  });

  it("lee los filtros de la URL y los manda al servidor", async () => {
    renderPage(
      `/admin/auditoria?tabla=products&accion=editado&actor=${ADMIN}&desde=2026-10-01&hasta=2026-10-30&pagina=2`,
    );
    await screen.findByRole("table", { name: "Auditoría" });
    expect(lastParams()).toEqual({
      table: "products",
      action: "UPDATE",
      actorId: ADMIN,
      from: "2026-10-01",
      to: "2026-10-30",
      page: 2,
      pageSize: 25,
    });
  });

  it("valores inválidos en la URL se ignoran (no se manda texto libre al servidor)", async () => {
    renderPage("/admin/auditoria?tabla=users&accion=INSERT&actor=x&desde=2026-02-30&pagina=-4");
    await screen.findByRole("table", { name: "Auditoría" });
    expect(lastParams()).toEqual({ page: 1, pageSize: 25 });
  });

  it("elegir una tabla filtra en el servidor, escribe la URL y vuelve a la página 1", async () => {
    const user = userEvent.setup();
    renderPage("/admin/auditoria?pagina=3");
    await screen.findByRole("table", { name: "Auditoría" });
    await user.selectOptions(screen.getByLabelText("Qué cambió"), "Banners de noticias");
    await waitFor(() => expect(lastParams()).toMatchObject({ table: "news_banners", page: 1 }));
    expect(search).toBe("?tabla=news_banners");
  });

  it("filtra por acción y por quién (administradores)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Auditoría" });
    await user.selectOptions(screen.getByLabelText("Acción"), "Eliminado");
    await waitFor(() => expect(lastParams().action).toBe("DELETE"));
    await screen.findByRole("option", { name: "Beto Admin" });
    await user.selectOptions(screen.getByLabelText("Quién"), "Beto Admin");
    await waitFor(() => expect(lastParams().actorId).toBe(OTHER));
    expect(lastParams().action).toBe("DELETE");
    expect(search).toBe(`?accion=eliminado&actor=${OTHER}`);
  });

  it("quitar un filtro con 'Cualquiera' lo elimina de la consulta y de la URL", async () => {
    const user = userEvent.setup();
    renderPage("/admin/auditoria?tabla=products&accion=creado");
    await screen.findByRole("table", { name: "Auditoría" });
    await user.selectOptions(screen.getByLabelText("Qué cambió"), "Todo");
    await waitFor(() => expect(lastParams().table).toBeUndefined());
    expect(lastParams().action).toBe("INSERT");
    expect(search).toBe("?accion=creado");
  });

  it("el rango de fechas llega al servidor, y cada campo limita al otro (no se puede invertir)", async () => {
    const user = userEvent.setup();
    renderPage("/admin/auditoria?desde=2026-10-05&hasta=2026-10-20");
    await screen.findByRole("table", { name: "Auditoría" });
    expect(screen.getByLabelText("Desde")).toHaveAttribute("max", "2026-10-20");
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("min", "2026-10-05");
    await user.clear(screen.getByLabelText("Desde"));
    await waitFor(() => expect(lastParams().from).toBeUndefined());
    expect(lastParams().to).toBe("2026-10-20");
    expect(screen.getByText("Fechas en hora de La Paz.")).toBeInTheDocument();
  });

  it("paginación: 60 cambios con 25 por página son 3 páginas; 'Siguiente' pide la 2", async () => {
    const user = userEvent.setup();
    api.listAuditLog.mockResolvedValue({ rows: [row()], total: 60 });
    renderPage();
    await screen.findByText("Página 1 de 3");
    expect(screen.getByText("60 resultados")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(lastParams().page).toBe(2));
    expect(search).toBe("?pagina=2");
  });

  it("sin cambios registrados y sin filtros: lo dice", async () => {
    api.listAuditLog.mockResolvedValue({ rows: [], total: 0 });
    renderPage();
    expect(await screen.findByText("Todavía no hay cambios registrados.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Paginación" })).not.toBeInTheDocument();
  });

  it("sin resultados con filtros: lo dice y 'Quitar filtros' los limpia", async () => {
    const user = userEvent.setup();
    api.listAuditLog.mockResolvedValue({ rows: [], total: 0 });
    renderPage("/admin/auditoria?tabla=products&desde=2026-10-01");
    expect(await screen.findByText("Ningún cambio coincide con los filtros.")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Quitar filtros" })[0] as HTMLElement);
    await waitFor(() => expect(search).toBe(""));
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, pageSize: 25 }));
  });

  it("si el servidor falla muestra el error con reintento", async () => {
    const user = userEvent.setup();
    api.listAuditLog.mockRejectedValueOnce(new AppError("network", "x"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table", { name: "Auditoría" })).toBeInTheDocument();
  });

  it("tiene un único h1 y el formulario de filtros está etiquetado", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Auditoría" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("search", { name: "Filtros de auditoría" })).toBeInTheDocument();
  });
});

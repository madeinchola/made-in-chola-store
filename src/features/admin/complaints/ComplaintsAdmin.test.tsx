import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { ComplaintsPage } from "./ComplaintsPage";
import type { ComplaintRow } from "./types";

const api = vi.hoisted(() => ({
  listComplaints: vi.fn(),
  complaintSummary: vi.fn(),
  updateComplaint: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const row = (over: Partial<ComplaintRow> = {}): ComplaintRow => ({
  id: "c1",
  number: "REC-000001",
  createdAt: "2026-11-10T12:00:00Z",
  kind: "product",
  status: "new",
  contactName: "Ana Pérez",
  contactEmail: "ana@example.com",
  contactPhone: "+59171234567",
  orderNumber: "MIC-000123",
  detail: "La prenda llegó con una costura abierta.\nSegunda línea.",
  response: null,
  dueAt: "2026-11-20T12:00:00Z",
  answeredAt: null,
  overdue: false,
  hasAccount: true,
  ...over,
});
const ROWS = [
  row(),
  row({
    id: "c2",
    number: "REC-000002",
    contactName: "Luis",
    status: "in_review",
    overdue: true,
    hasAccount: false,
    contactPhone: null,
    orderNumber: null,
  }),
  row({
    id: "c3",
    number: "REC-000003",
    contactName: "Rosa",
    status: "answered",
    response: "Ya lo resolvimos.",
    answeredAt: "2026-11-12T12:00:00Z",
  }),
];

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComplaintsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listComplaints.mockResolvedValue({ rows: ROWS, total: 3 });
  api.complaintSummary.mockResolvedValue({ new: 1, inReview: 1, overdue: 1, total: 3 });
  api.updateComplaint.mockResolvedValue(undefined);
});

describe("ComplaintsPage", () => {
  it("muestra el resumen y la bandeja con estado, tipo, quién reclama, y marca lo vencido con texto (no solo color)", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "Reclamos" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Reclamos" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("REC-000001");
    expect(rows[1]).toHaveTextContent("Ana Pérez");
    expect(rows[1]).toHaveTextContent("Con cuenta");
    expect(rows[1]).toHaveTextContent("Nuevo");
    expect(rows[2]).toHaveTextContent("En revisión");
    expect(rows[2]).toHaveTextContent("Vencido");
    expect(rows[3]).toHaveTextContent("Respondido");
    expect(rows[3]).not.toHaveTextContent("Vencido");
    // el resumen de arriba: nuevos, en revisión, vencidos y total
    expect(screen.getByText("Vencidos")).toBeInTheDocument();
  });

  it("por omisión pide los ABIERTOS y cada filtro pide su estado (y vuelve a la página 1)", async () => {
    mount();
    await screen.findByRole("table");
    expect(api.listComplaints).toHaveBeenLastCalledWith("open", 1);
    await userEvent.click(screen.getByRole("button", { name: "Respondidos" }));
    await waitFor(() => expect(api.listComplaints).toHaveBeenLastCalledWith("answered", 1));
    await userEvent.click(screen.getByRole("button", { name: "Todos" }));
    await waitFor(() => expect(api.listComplaints).toHaveBeenLastCalledWith("all", 1));
    expect(screen.getByRole("button", { name: "Todos" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sin reclamos lo dice y no pinta la paginación", async () => {
    api.listComplaints.mockResolvedValue({ rows: [], total: 0 });
    mount();
    expect(await screen.findByText("No hay reclamos en esta vista.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /paginación/i })).not.toBeInTheDocument();
  });

  it("un error de carga se puede reintentar", async () => {
    api.listComplaints.mockRejectedValueOnce(new Error("boom"));
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("el detalle muestra el texto con sus saltos de línea COMO TEXTO (un <script> no se ejecuta ni se interpreta)", async () => {
    api.listComplaints.mockResolvedValue({
      rows: [
        row({
          detail: "Hola <script>window.__pwned = 1</script> <img src=x onerror=alert(1)>\nlínea 2",
        }),
      ],
      total: 1,
    });
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "Abrir el reclamo REC-000001" }),
    );
    const detail = await screen.findByTestId("complaint-detail");
    expect(detail.textContent).toContain("<script>window.__pwned = 1</script>");
    expect(detail.querySelector("script, img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("el detalle da los medios para contestar: correo con el número en el asunto, WhatsApp y llamada, solo con lo que hay", async () => {
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "Abrir el reclamo REC-000001" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Reclamo REC-000001" });
    expect(within(dialog).getByRole("link", { name: "Escribir un correo" })).toHaveAttribute(
      "href",
      "mailto:ana@example.com?subject=Tu%20reclamo%20REC-000001",
    );
    const wa = within(dialog).getByRole("link", { name: "Abrir WhatsApp" });
    expect(wa).toHaveAttribute("href", "https://wa.me/59171234567");
    expect(wa).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).getByRole("link", { name: "Llamar" })).toHaveAttribute(
      "href",
      "tel:+59171234567",
    );
    expect(dialog).toHaveTextContent("MIC-000123");
    expect(dialog).toHaveTextContent("Tiene cuenta en la tienda.");
  });

  it("sin teléfono no hay WhatsApp ni llamada; sin pedido lo dice; sin cuenta lo dice", async () => {
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "Abrir el reclamo REC-000002" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Reclamo REC-000002" });
    expect(within(dialog).queryByRole("link", { name: "Abrir WhatsApp" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Llamar" })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("No indicó pedido");
    expect(dialog).toHaveTextContent("No tiene cuenta");
  });

  it("guardar manda el estado y la respuesta (recortada); sin cambios el botón está inactivo", async () => {
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "Abrir el reclamo REC-000001" }),
    );
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Guardar" });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText("Estado"), "answered");
    await userEvent.type(
      within(dialog).getByLabelText("Lo que respondiste"),
      "  Le enviamos otra prenda.  ",
    );
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() =>
      expect(api.updateComplaint).toHaveBeenCalledWith(
        "c1",
        "answered",
        "Le enviamos otra prenda.",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("solo cambiar el estado manda la respuesta vacía como nula (la base conserva la que había)", async () => {
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "Abrir el reclamo REC-000001" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Estado"), "in_review");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateComplaint).toHaveBeenCalledWith("c1", "in_review", null));
  });

  it.each([
    ["response_required", "Escribe qué le respondiste para marcar el reclamo como respondido."],
    ["not_found", "Ese reclamo ya no existe. Recarga la lista."],
    ["select * from secretos", "No se pudo guardar. Inténtalo de nuevo."],
  ])(
    "si la base rechaza (%s) lo explica en español, deja el diálogo abierto y no filtra su mensaje",
    async (message, shown) => {
      api.updateComplaint.mockRejectedValue(new AppError("validation", message));
      mount();
      await userEvent.click(
        await screen.findByRole("button", { name: "Abrir el reclamo REC-000001" }),
      );
      const dialog = await screen.findByRole("dialog");
      await userEvent.selectOptions(within(dialog).getByLabelText("Estado"), "answered");
      await userEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(shown);
      expect(dialog).not.toHaveTextContent("secretos");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
  );
});

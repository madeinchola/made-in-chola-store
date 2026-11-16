import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "./api";
import { LogPage } from "./LogPage";
import { NotificationDetailDialog } from "./NotificationDetailDialog";
import type { NotificationRow } from "./types";

vi.mock("./api", async () => (await import("./apiMock")).createApiMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
const api = vi.mocked(apiModule);

function mount(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 1,
  type: "order_shipped",
  channel: "email",
  recipient: "ana@correo.test",
  status: "sent",
  attempts: 1,
  nextRetryAt: "2026-11-16T14:00:00Z",
  sentAt: "2026-11-16T14:01:00Z",
  lastError: null,
  provider: "resend",
  providerMessageId: "re_123",
  orderId: "o-1",
  orderNumber: "MIC-000123",
  profileId: "p-1",
  resentOf: null,
  renderedSubject: "Tu pedido MIC-000123 va en camino",
  renderedBody: "Hola Ana, tu pedido salió.",
  createdAt: "2026-11-16T14:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.notificationCounts.mockResolvedValue({ sent: 5, pending: 2, dead: 1, manual: 3 });
  api.listThread.mockResolvedValue([]);
});

describe("LogPage: el registro de avisos", () => {
  it("lista cada aviso con su tipo, canal, destinatario, pedido y estado en palabras", async () => {
    api.listNotifications.mockResolvedValue({
      rows: [
        row(),
        row({
          id: 2,
          type: "order_new",
          channel: "email",
          recipient: null,
          status: "pending",
          orderNumber: "MIC-000124",
          renderedBody: null,
        }),
        row({ id: 3, status: "dead", lastError: "provider_config" }),
      ],
      total: 3,
    });
    mount(<LogPage />);
    const table = await screen.findByRole("table", { name: "Registro de avisos" });
    expect(within(table).getAllByText("Pedido enviado")).toHaveLength(2);
    expect(within(table).getByText("Nuevo pedido (alerta)")).toBeInTheDocument();
    expect(within(table).getByText("Administradores")).toBeInTheDocument();
    expect(within(table).getByText("En cola")).toBeInTheDocument();
    expect(within(table).getByText("Perdido")).toBeInTheDocument();
    expect(within(table).getByText(/dominio esté verificado/)).toBeInTheDocument();
    expect(within(table).getByText("MIC-000124")).toBeInTheDocument();
  });

  it("los filtros por estado muestran su cuenta y piden ese estado al servidor, volviendo a la primera página", async () => {
    api.listNotifications.mockResolvedValue({ rows: [row()], total: 80 });
    mount(<LogPage />);
    const group = await screen.findByRole("group", { name: "Filtrar por estado" });
    expect(await within(group).findByRole("button", { name: /Todos\s*11/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Perdido\s*1/ })).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: /Por enviar a mano\s*3/ }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() =>
      expect(api.listNotifications).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
    );
    await userEvent.click(within(group).getByRole("button", { name: /Perdido/ }));
    await waitFor(() =>
      expect(api.listNotifications).toHaveBeenLastCalledWith({
        status: "dead",
        channel: "all",
        type: "all",
        search: "",
        page: 0,
      }),
    );
    expect(within(group).getByRole("button", { name: /Perdido/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("buscar, filtrar por tipo y por canal; «Limpiar» lo deja todo como estaba", async () => {
    api.listNotifications.mockResolvedValue({ rows: [row()], total: 1 });
    mount(<LogPage />);
    await screen.findByRole("table", { name: "Registro de avisos" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar" }), "MIC-000123");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() =>
      expect(api.listNotifications).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "MIC-000123" }),
      ),
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Tipo de aviso" }),
      "order_shipped",
    );
    await waitFor(() =>
      expect(api.listNotifications).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "MIC-000123", type: "order_shipped" }),
      ),
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Canal" }), "whatsapp");
    await waitFor(() =>
      expect(api.listNotifications).toHaveBeenLastCalledWith(
        expect.objectContaining({ channel: "whatsapp", type: "order_shipped" }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    await waitFor(() =>
      expect(api.listNotifications).toHaveBeenLastCalledWith({
        status: "all",
        channel: "all",
        type: "all",
        search: "",
        page: 0,
      }),
    );
    expect(screen.getByRole("searchbox", { name: "Buscar" })).toHaveValue("");
  });

  it("sin avisos, lo dice; con un fallo de carga, ofrece reintentar", async () => {
    api.listNotifications.mockResolvedValueOnce({ rows: [], total: 0 });
    const first = mount(<LogPage />);
    expect(await screen.findByText("No hay avisos con esos filtros.")).toBeInTheDocument();
    first.unmount();

    api.listNotifications
      .mockRejectedValueOnce(new Error("caído"))
      .mockResolvedValueOnce({ rows: [row()], total: 1 });
    mount(<LogPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table", { name: "Registro de avisos" })).toBeInTheDocument();
  });

  it("«Ver» abre el detalle del aviso", async () => {
    api.listNotifications.mockResolvedValue({ rows: [row()], total: 1 });
    mount(<LogPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Ver el aviso 1 (Pedido enviado)" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Aviso n.º 1 · Correo")).toBeInTheDocument();
    expect(within(dialog).getByText("Hola Ana, tu pedido salió.")).toBeInTheDocument();
  });
});

describe("NotificationDetailDialog", () => {
  const open = (r: NotificationRow, onClose = vi.fn()) => {
    mount(<NotificationDetailDialog row={r} onClose={onClose} />);
    return onClose;
  };

  it("muestra a quién, cuándo, el proveedor, el pedido (con enlace) y lo que se envió", async () => {
    open(row());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("ana@correo.test")).toBeInTheDocument();
    expect(within(dialog).getByText("re_123", { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "MIC-000123" })).toHaveAttribute(
      "href",
      "/admin/pedidos/o-1",
    );
    expect(within(dialog).getByText("Tu pedido MIC-000123 va en camino")).toBeInTheDocument();
    expect(within(dialog).getByText("Enviado", { selector: "div,span" })).toBeInTheDocument();
  });

  it("un aviso sin mensaje armado lo explica; una alerta interna dice «Administradores»", async () => {
    open(
      row({
        recipient: null,
        renderedBody: null,
        renderedSubject: null,
        status: "pending",
        provider: null,
        sentAt: null,
        orderId: null,
        orderNumber: null,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Todavía no se armó el mensaje/)).toBeInTheDocument();
    expect(within(dialog).getByText("Administradores")).toBeInTheDocument();
    expect(within(dialog).getByText("Próximo intento")).toBeInTheDocument();
    expect(within(dialog).queryByText("Enviado", { selector: "dt" })).not.toBeInTheDocument();
  });

  it("WhatsApp manual: abre wa.me con el mensaje ya escrito y permite marcarlo enviado", async () => {
    open(
      row({
        channel: "whatsapp",
        status: "manual",
        recipient: "+59170000001",
        renderedSubject: null,
        renderedBody: "Hola Ana ¡tu pedido salió!",
        provider: "whatsapp_manual",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    const link = within(dialog).getByRole("link", { name: /Abrir WhatsApp con el mensaje/ });
    expect(link).toHaveAttribute(
      "href",
      "https://wa.me/59170000001?text=Hola%20Ana%20%C2%A1tu%20pedido%20sali%C3%B3!",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).getByRole("button", { name: "Ya lo envié" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Descartar" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Reenviar" })).toBeInTheDocument();
    expect(within(dialog).getByText(/modo manual/)).toBeInTheDocument();
  });

  it("un correo enviado solo se puede reenviar", async () => {
    open(row());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Reenviar" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Ya lo envié" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it("un aviso en cola solo se puede descartar", async () => {
    open(row({ status: "pending", renderedBody: null }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Descartar" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Reenviar" })).not.toBeInTheDocument();
  });

  it("«Ya lo envié» llama a la base, avisa y cierra", async () => {
    api.markNotificationSent.mockResolvedValue({ outcome: "sent" });
    const onClose = open(row({ channel: "whatsapp", status: "manual", recipient: "+59170000001" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ya lo envié" }));
    await waitFor(() => expect(api.markNotificationSent).toHaveBeenCalledWith(1));
    expect(toast.success).toHaveBeenCalledWith("Marcado como enviado.");
    expect(onClose).toHaveBeenCalled();
  });

  it("«Reenviar» deja el diálogo abierto (se ve el hilo) y avisa que sale en menos de un minuto", async () => {
    api.resendNotification.mockResolvedValue({ outcome: "queued", id: 9 });
    const onClose = open(row({ status: "dead" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(api.resendNotification).toHaveBeenCalledWith(1));
    expect(toast.success).toHaveBeenCalledWith("Se reenviará en menos de un minuto.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("«Descartar» avisa y cierra", async () => {
    api.cancelNotification.mockResolvedValue({ outcome: "cancelled" });
    const onClose = open(row({ status: "pending" }));
    await userEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(api.cancelNotification).toHaveBeenCalledWith(1));
    expect(toast.success).toHaveBeenCalledWith("Aviso descartado.");
    expect(onClose).toHaveBeenCalled();
  });

  it("si la base lo rechaza (otro administrador ya lo cambió), lo dice con claridad y no finge éxito", async () => {
    api.markNotificationSent.mockResolvedValue({ outcome: "not_manual", status: "sent" });
    open(row({ channel: "whatsapp", status: "manual", recipient: "+59170000001" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ya lo envié" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Ese aviso no estaba esperando un envío a mano."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("si la llamada falla, muestra el error", async () => {
    api.resendNotification.mockRejectedValue(new Error("sin conexión"));
    open(row({ status: "failed" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("sin conexión"));
  });

  it("mientras trabaja, los botones se bloquean (un doble clic no reenvía dos veces)", async () => {
    let finish: (value: { outcome: string }) => void = () => undefined;
    api.resendNotification.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    open(row({ status: "sent" }));
    const button = await screen.findByRole("button", { name: "Reenviar" });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(api.resendNotification).toHaveBeenCalledTimes(1);
    finish({ outcome: "queued" });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("muestra los otros envíos del mismo aviso (el hilo de reenvíos)", async () => {
    api.listThread.mockResolvedValue([
      row({ id: 1 }),
      row({ id: 7, resentOf: 1, status: "failed" }),
    ]);
    open(row({ id: 1 }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Aviso n\.º 7/)).toBeInTheDocument();
    expect(within(dialog).getByText("Otros envíos de este aviso")).toBeInTheDocument();
    expect(within(dialog).getByText("Falló")).toBeInTheDocument();
  });

  it("sin fila, no muestra nada", () => {
    mount(<NotificationDetailDialog row={null} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

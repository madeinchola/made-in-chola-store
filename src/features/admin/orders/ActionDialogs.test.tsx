import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AddBlacklistDialog,
  CodCollectDialog,
  CodRejectDialog,
  LiftBlacklistDialog,
  OpenIncidentDialog,
  RejectRefundDialog,
  UpdateIncidentDialog,
} from "./ActionDialogs";
import * as apiModule from "./api";
import { CloseReturnDialog, OpenReturnDialog } from "./ReturnDialogs";
import type { IncidentRow, OrderDetail, ReturnRow } from "./types";

vi.mock("./api", async () => (await import("./apiMock")).createApiMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const api = vi.mocked(apiModule);

const order = {
  id: "o-1",
  number: "MIC-000123",
  currency: "BOB",
  shippingCost: 15,
  shippingDiscount: 0,
  items: [
    { id: "i-1", name: "Camiseta", qty: 2 },
    { id: "i-2", name: "Gorra", qty: 1 },
  ],
} as unknown as OrderDetail;

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const base = () => ({ onOpenChange: vi.fn(), onDone: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe("contra entrega", () => {
  it("cobro: vacío = el monto esperado; manda monto y nota", async () => {
    api.codCollect.mockResolvedValue({ outcome: "collected", amount: 55, short: false });
    const props = base();
    wrap(<CodCollectDialog order={order} expected={55} {...props} />);
    expect(screen.getByText(/Esperado: Bs 55,00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(api.codCollect).toHaveBeenCalledWith("o-1", null, null));
    expect(props.onDone).toHaveBeenCalledWith("Cobro registrado.");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("un cobro corto lo dice (queda un saldo por cobrar)", async () => {
    api.codCollect.mockResolvedValue({ outcome: "collected", amount: 50, short: true });
    const props = base();
    wrap(<CodCollectDialog order={order} expected={55} {...props} />);
    await userEvent.type(screen.getByLabelText("Monto cobrado (opcional)"), "50");
    await userEvent.type(screen.getByLabelText("Nota (opcional)"), "Dio menos");
    await userEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(api.codCollect).toHaveBeenCalledWith("o-1", 50, "Dio menos"));
    expect(props.onDone).toHaveBeenCalledWith(expect.stringContaining("por menos de lo esperado"));
  });

  it("un monto con más decimales que la moneda se rechaza antes de llamar a la base", async () => {
    wrap(<CodCollectDialog order={order} expected={55} {...base()} />);
    await userEvent.type(screen.getByLabelText("Monto cobrado (opcional)"), "50,005");
    await userEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Usa como máximo 2 decimales.");
    expect(api.codCollect).not.toHaveBeenCalled();
  });

  it("rechazo: el costo parte del envío pagado y avisa cuántos rechazos previos tenía", async () => {
    api.codReject.mockResolvedValue({
      outcome: "rejected_delivery",
      previous_rejections: 2,
      blacklist: "added",
    });
    const props = base();
    wrap(<CodRejectDialog order={order} {...props} />);
    expect(screen.getByLabelText("Costo asumido por la tienda")).toHaveValue("15");
    await userEvent.click(screen.getByRole("button", { name: "Registrar rechazo" }));
    await waitFor(() => expect(api.codReject).toHaveBeenCalledWith("o-1", 15, null, false, null));
    expect(props.onDone).toHaveBeenCalledWith(
      "Rechazo registrado. La clienta tenía 2 rechazo(s) anteriores.",
    );
  });

  it("bloquear exige el motivo y lo manda junto", async () => {
    api.codReject.mockResolvedValue({ outcome: "rejected_delivery", previous_rejections: 0 });
    wrap(<CodRejectDialog order={order} {...base()} />);
    await userEvent.click(screen.getByLabelText("Añadir a la lista negra"));
    await userEvent.click(screen.getByRole("button", { name: "Registrar rechazo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Para bloquear hay que escribir el motivo",
    );
    expect(api.codReject).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Motivo del bloqueo"), "Dos rechazos");
    await userEvent.click(screen.getByRole("button", { name: "Registrar rechazo" }));
    await waitFor(() =>
      expect(api.codReject).toHaveBeenCalledWith("o-1", 15, null, true, "Dos rechazos"),
    );
  });

  it("un rechazo de la base se explica y el diálogo sigue abierto", async () => {
    api.codReject.mockResolvedValue({ outcome: "not_rejectable", status: "paid" });
    const props = base();
    wrap(<CodRejectDialog order={order} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Registrar rechazo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo se puede registrar como rechazado un paquete que ya salió.",
    );
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("incidencias", () => {
  it("abrir: manda tipo, descripción, costo y quién lo asume", async () => {
    api.openIncident.mockResolvedValue({ outcome: "opened", id: "inc-1" });
    const props = base();
    wrap(<OpenIncidentDialog order={order} {...props} />);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "damaged");
    await userEvent.type(screen.getByLabelText("Qué pasó"), "Llegó roto");
    await userEvent.type(screen.getByLabelText("Costo (Bs)"), "25,50");
    await userEvent.selectOptions(screen.getByLabelText("Quién lo asume"), "carrier");
    await userEvent.click(screen.getByRole("button", { name: "Registrar incidencia" }));
    await waitFor(() =>
      expect(api.openIncident).toHaveBeenCalledWith(
        "o-1",
        "damaged",
        "Llegó roto",
        25.5,
        "carrier",
      ),
    );
    expect(props.onDone).toHaveBeenCalledWith("Incidencia registrada.");
  });

  const incident = (over: Partial<IncidentRow> = {}): IncidentRow => ({
    id: "inc-1",
    orderId: "o-1",
    orderNumber: "MIC-000123",
    contactName: "Ana",
    type: "lost",
    status: "open",
    description: null,
    costAssumed: 25,
    costBorneBy: "carrier",
    resolution: null,
    openedAt: "2026-11-10T12:00:00Z",
    resolvedAt: null,
    ...over,
  });

  it("seguimiento: pasa a «en seguimiento» con el costo actual", async () => {
    api.updateIncident.mockResolvedValue({ outcome: "updated" });
    wrap(<UpdateIncidentDialog incident={incident()} {...base()} />);
    await userEvent.click(screen.getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() =>
      expect(api.updateIncident).toHaveBeenCalledWith(
        "inc-1",
        "investigating",
        null,
        25,
        "carrier",
      ),
    );
  });

  it("resolver: manda la resolución y el costo final", async () => {
    api.updateIncident.mockResolvedValue({ outcome: "resolved" });
    const props = base();
    wrap(<UpdateIncidentDialog incident={incident({ status: "investigating" })} {...props} />);
    await userEvent.type(screen.getByLabelText("Resolución"), "Se reenvió");
    const cost = screen.getByLabelText("Costo (Bs)");
    await userEvent.clear(cost);
    await userEvent.type(cost, "30");
    await userEvent.selectOptions(screen.getByLabelText("Quién lo asume"), "store");
    await userEvent.click(screen.getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() =>
      expect(api.updateIncident).toHaveBeenCalledWith(
        "inc-1",
        "resolved",
        "Se reenvió",
        30,
        "store",
      ),
    );
    expect(props.onDone).toHaveBeenCalledWith("Incidencia resuelta.");
  });

  it("resolver sin resolución: la base lo rechaza y se explica", async () => {
    api.updateIncident.mockResolvedValue({
      outcome: "rejected",
      errors: [{ code: "resolution_required" }],
    });
    wrap(<UpdateIncidentDialog incident={incident({ status: "investigating" })} {...base()} />);
    await userEvent.click(screen.getByRole("button", { name: "Guardar seguimiento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Para resolverla, escribe cómo se resolvió.",
    );
  });
});

describe("lista negra", () => {
  const preset = {
    profileId: "p-1",
    phone: "+59171234567",
    email: "ana@test.com",
    orderId: "o-1",
    label: "Ana Pérez",
  };

  it("bloquear una cuenta con su teléfono y correo: manda el pedido de origen y el motivo", async () => {
    api.blacklistAdd.mockResolvedValue({ outcome: "added", ids: ["b1", "b2", "b3"] });
    const props = base();
    wrap(<AddBlacklistDialog preset={preset} {...props} />);
    expect(screen.getByText("Se bloquea a Ana Pérez.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Motivo"), "Rechazó dos paquetes");
    await userEvent.click(screen.getByRole("button", { name: "Bloquear" }));
    await waitFor(() =>
      expect(api.blacklistAdd).toHaveBeenCalledWith({
        kind: "profile",
        profileId: "p-1",
        phone: null,
        email: null,
        reason: "Rechazó dos paquetes",
        orderId: "o-1",
        includeContacts: true,
      }),
    );
    expect(props.onDone).toHaveBeenCalledWith("Bloqueo registrado.");
  });

  it("sin motivo no llama a la base", async () => {
    wrap(<AddBlacklistDialog preset={preset} {...base()} />);
    await userEvent.click(screen.getByRole("button", { name: "Bloquear" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe el motivo");
    expect(api.blacklistAdd).not.toHaveBeenCalled();
  });

  it("un teléfono suelto se normaliza a E.164; uno inválido se rechaza", async () => {
    api.blacklistAdd.mockResolvedValue({ outcome: "added" });
    wrap(<AddBlacklistDialog preset={null} {...base()} />);
    await userEvent.type(screen.getByLabelText("Motivo"), "Evasión");
    await userEvent.type(screen.getByLabelText("Teléfono"), "123");
    await userEvent.click(screen.getByRole("button", { name: "Bloquear" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El teléfono no es válido");
    expect(api.blacklistAdd).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("Teléfono"));
    await userEvent.type(screen.getByLabelText("Teléfono"), "71234567");
    await userEvent.click(screen.getByRole("button", { name: "Bloquear" }));
    await waitFor(() =>
      expect(api.blacklistAdd).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "phone", phone: "+59171234567", profileId: null }),
      ),
    );
  });

  it("«ya estaba bloqueado» se dice y el diálogo sigue abierto", async () => {
    api.blacklistAdd.mockResolvedValue({ outcome: "already" });
    const props = base();
    wrap(<AddBlacklistDialog preset={preset} {...props} />);
    await userEvent.type(screen.getByLabelText("Motivo"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Bloquear" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya estaba bloqueado.");
  });

  it("levantar exige el motivo", async () => {
    api.blacklistLift.mockResolvedValue({ outcome: "lifted" });
    const props = base();
    wrap(<LiftBlacklistDialog entryId="b1" label="Ana" {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Levantar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe el motivo");
    expect(api.blacklistLift).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Por qué se levanta"), "Pagó");
    await userEvent.click(screen.getByRole("button", { name: "Levantar" }));
    await waitFor(() => expect(api.blacklistLift).toHaveBeenCalledWith("b1", "Pagó"));
  });
});

describe("reembolsos y devoluciones", () => {
  it("descartar un reembolso exige el motivo", async () => {
    api.rejectRefund.mockResolvedValue({ outcome: "rejected" });
    wrap(<RejectRefundDialog refund={{ id: "r-1" }} {...base()} />);
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe el motivo");
    expect(api.rejectRefund).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Motivo"), "Se arrepintió");
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(api.rejectRefund).toHaveBeenCalledWith("r-1", "Se arrepintió"));
  });

  it("abrir una devolución: solo manda las líneas con unidades y pide el motivo", async () => {
    api.openReturn.mockResolvedValue({ outcome: "opened", id: "ret-1" });
    const props = base();
    wrap(<OpenReturnDialog order={order} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Registrar devolución" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elige al menos una unidad a devolver.",
    );
    const qty = screen.getAllByLabelText("Unidades");
    await userEvent.clear(qty[0]!);
    await userEvent.type(qty[0]!, "1");
    await userEvent.click(screen.getByRole("button", { name: "Registrar devolución" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe el motivo");
    await userEvent.type(screen.getByLabelText("Resumen de la devolución"), "Llegó dañada");
    await userEvent.click(screen.getByRole("button", { name: "Registrar devolución" }));
    await waitFor(() =>
      expect(api.openReturn).toHaveBeenCalledWith(
        "o-1",
        [{ item_id: "i-1", qty: 1, reason_code: "damaged", restock: "inspection" }],
        "Llegó dañada",
        null,
      ),
    );
    expect(props.onDone).toHaveBeenCalledWith("Devolución registrada.");
  });

  it("fuera de plazo: pide la justificación y la manda en el segundo intento", async () => {
    api.openReturn
      .mockResolvedValueOnce({ outcome: "outside_window", window_days: 7 })
      .mockResolvedValueOnce({ outcome: "opened", id: "ret-1" });
    wrap(<OpenReturnDialog order={order} {...base()} />);
    await userEvent.clear(screen.getAllByLabelText("Unidades")[0]!);
    await userEvent.type(screen.getAllByLabelText("Unidades")[0]!, "1");
    await userEvent.type(screen.getByLabelText("Resumen de la devolución"), "Cambió de opinión");
    await userEvent.click(screen.getByRole("button", { name: "Registrar devolución" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("hace más de 7 días");
    await userEvent.type(
      screen.getByLabelText("Por qué se acepta fuera de plazo"),
      "Clienta antigua",
    );
    await userEvent.click(screen.getByRole("button", { name: "Registrar devolución" }));
    await waitFor(() => expect(api.openReturn).toHaveBeenCalledTimes(2));
    expect(api.openReturn.mock.calls[1]![3]).toBe("Clienta antigua");
  });

  const ret = (): ReturnRow => ({
    id: "ret-1",
    orderId: "o-1",
    status: "open",
    reason: "Dañada",
    outsideWindow: false,
    overrideReason: null,
    openedAt: "2026-11-10T12:00:00Z",
    closedAt: null,
    closeNote: null,
    items: [
      {
        id: "ri-1",
        orderItemId: "i-1",
        qty: 1,
        reasonCode: "damaged",
        restock: "inspection",
        restockedAt: null,
      },
      {
        id: "ri-2",
        orderItemId: "i-2",
        qty: 1,
        reasonCode: "wrong_size",
        restock: "yes",
        restockedAt: null,
      },
    ],
  });

  it("cerrar: los «por inspeccionar» se deciden aquí; los demás no se preguntan", async () => {
    api.closeReturn.mockResolvedValue({ outcome: "closed", restocked_units: 2 });
    const props = base();
    wrap(<CloseReturnDialog ret={ret()} order={order} {...props} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    await userEvent.selectOptions(screen.getByRole("combobox"), "no");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar devolución" }));
    await waitFor(() =>
      expect(api.closeReturn).toHaveBeenCalledWith("ret-1", [{ item_id: "i-1", restock: "no" }]),
    );
    expect(props.onDone).toHaveBeenCalledWith(
      "Devolución cerrada. Unidades que volvieron al stock: 2.",
    );
  });
});

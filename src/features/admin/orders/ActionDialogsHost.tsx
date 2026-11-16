import {
  AddBlacklistDialog,
  CodCollectDialog,
  CodRejectDialog,
  OpenIncidentDialog,
  ProcessRefundDialog,
  RejectRefundDialog,
  UpdateIncidentDialog,
} from "./ActionDialogs";
import { EditOrderDialog } from "./EditOrderDialog";
import { RefundWizard, type RefundPreset } from "./RefundWizard";
import { CloseReturnDialog, OpenReturnDialog, RejectReturnDialog } from "./ReturnDialogs";
import type { IncidentRow, OrderDetail, RefundRow, ReturnRow } from "./types";

/** Qué diálogo de acción está abierto en el detalle del pedido (a lo sumo uno). Cada diálogo nace limpio al abrirse. */
export type DialogState =
  | null
  | { kind: "edit" }
  | { kind: "refund"; preset: RefundPreset }
  | { kind: "returnOpen" }
  | { kind: "returnClose"; ret: ReturnRow }
  | { kind: "returnReject"; ret: ReturnRow }
  | { kind: "codCollect"; expected: number }
  | { kind: "codReject" }
  | { kind: "incident" }
  | { kind: "incidentUpdate"; incident: IncidentRow }
  | { kind: "blacklist" }
  | { kind: "refundProcess"; refund: RefundRow }
  | { kind: "refundReject"; refund: RefundRow };

interface Props {
  order: OrderDetail;
  state: DialogState;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ActionDialogsHost({ order, state, onClose, onDone }: Props) {
  if (!state) return null;
  const close = (open: boolean) => {
    if (!open) onClose();
  };
  switch (state.kind) {
    case "edit":
      return <EditOrderDialog order={order} onOpenChange={close} onDone={onDone} />;
    case "refund":
      return (
        <RefundWizard order={order} preset={state.preset} onOpenChange={close} onDone={onDone} />
      );
    case "returnOpen":
      return <OpenReturnDialog order={order} onOpenChange={close} onDone={onDone} />;
    case "returnClose":
      return (
        <CloseReturnDialog ret={state.ret} order={order} onOpenChange={close} onDone={onDone} />
      );
    case "returnReject":
      return <RejectReturnDialog ret={state.ret} onOpenChange={close} onDone={onDone} />;
    case "codCollect":
      return (
        <CodCollectDialog
          order={order}
          expected={state.expected}
          onOpenChange={close}
          onDone={onDone}
        />
      );
    case "codReject":
      return <CodRejectDialog order={order} onOpenChange={close} onDone={onDone} />;
    case "incident":
      return <OpenIncidentDialog order={order} onOpenChange={close} onDone={onDone} />;
    case "incidentUpdate":
      return (
        <UpdateIncidentDialog incident={state.incident} onOpenChange={close} onDone={onDone} />
      );
    case "blacklist":
      return (
        <AddBlacklistDialog
          preset={{
            profileId: order.profileId,
            phone: order.contactPhone,
            email: order.contactEmail,
            orderId: order.id,
            label: order.contactName,
          }}
          onOpenChange={close}
          onDone={onDone}
        />
      );
    case "refundProcess":
      return <ProcessRefundDialog refund={state.refund} onOpenChange={close} onDone={onDone} />;
    case "refundReject":
      return <RejectRefundDialog refund={state.refund} onOpenChange={close} onDone={onDone} />;
  }
}

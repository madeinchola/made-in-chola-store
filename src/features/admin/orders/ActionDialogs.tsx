import { useState } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "../ui/FormDialog";
import {
  blacklistAdd,
  blacklistLift,
  codCollect,
  codReject,
  openIncident,
  processRefund,
  rejectRefund,
  updateIncident,
} from "./api";
import { useOrderMutation } from "./hooks";
import { errorText, formatMoney, normalizePhone, parseOptionalMoney, validateText } from "./logic";
import {
  BLACKLIST_OK,
  COD_OK,
  INCIDENT_OK,
  REFUND_ACTION_OK,
  resultCode,
  succeeded,
} from "./outcomes";
import {
  COST_BEARERS,
  INCIDENT_TYPES,
  type CostBearer,
  type IncidentRow,
  type IncidentType,
  type OrderDetail,
  type RefundRow,
} from "./types";

interface Base {
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}

const moneyError = (problem: string) => t(`admin.orders.errors.money_${problem}` as MessageKey);

// ── Contra entrega ───────────────────────────────────────────────────────────────────────
const C = "admin.orders.cod" as const;

/** Registrar el cobro de la contra entrega (el monto esperado por omisión; menos queda como saldo por cobrar). */
export function CodCollectDialog({
  order,
  expected,
  onOpenChange,
  onDone,
}: Base & { order: OrderDetail; expected: number }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const collect = useOrderMutation((a: { amount: number | null; note: string | null }) =>
    codCollect(order.id, a.amount, a.note),
  );
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t(`${C}.collectTitle`, { number: order.number })}
      description={t(`${C}.collectDescription`, { amount: formatMoney(expected, order.currency) })}
      submitLabel={t(`${C}.collect`)}
      onSubmit={async () => {
        const money = parseOptionalMoney(amount);
        if (!money.ok) return moneyError(money.problem);
        const result = await collect.mutateAsync({
          amount: money.value,
          note: note.trim() || null,
        });
        if (succeeded(result, COD_OK)) {
          const message = result.short === true ? t(`${C}.collectedShort`) : t(`${C}.collected`);
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      <Field
        label={t(`${C}.amount`)}
        hint={t(`${C}.amountHint`, { amount: formatMoney(expected, order.currency) })}
      >
        <Input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label={t(`${C}.note`)}>
        <Textarea
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

/** La clienta rechazó el paquete: el pedido se cancela, la tienda asume el envío de vuelta y se sugiere bloquear la cuenta. */
export function CodRejectDialog({ order, onOpenChange, onDone }: Base & { order: OrderDetail }) {
  const [cost, setCost] = useState(String(order.shippingCost - order.shippingDiscount || ""));
  const [note, setNote] = useState("");
  const [block, setBlock] = useState(false);
  const [why, setWhy] = useState("");
  const reject = useOrderMutation(
    (a: { cost: number; note: string | null; block: boolean; why: string | null }) =>
      codReject(order.id, a.cost, a.note, a.block, a.why),
  );
  return (
    <FormDialog
      open
      destructive
      onOpenChange={onOpenChange}
      title={t(`${C}.rejectTitle`, { number: order.number })}
      description={t(`${C}.rejectDescription`)}
      submitLabel={t(`${C}.reject`)}
      onSubmit={async () => {
        const money = parseOptionalMoney(cost, true);
        if (!money.ok) return moneyError(money.problem);
        let reason: string | null = null;
        if (block) {
          const parsed = validateText(why, 300);
          if (!parsed.ok) return t(`${C}.errors.blockReason`);
          reason = parsed.value;
        }
        const result = await reject.mutateAsync({
          cost: money.value ?? 0,
          note: note.trim() || null,
          block,
          why: reason,
        });
        if (succeeded(result, COD_OK)) {
          const prev = Number(result.previous_rejections ?? 0);
          const message = t(`${C}.rejected`, { previous: prev });
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      <Field label={t(`${C}.cost`)} hint={t(`${C}.costHint`)}>
        <Input inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} />
      </Field>
      <Field label={t(`${C}.rejectNote`)}>
        <Textarea
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5"
          checked={block}
          onChange={(event) => setBlock(event.target.checked)}
        />
        <span>{t(`${C}.block`)}</span>
      </label>
      {block && (
        <Field label={t(`${C}.blockReason`)} hint={t(`${C}.blockHint`)}>
          <Input maxLength={300} value={why} onChange={(event) => setWhy(event.target.value)} />
        </Field>
      )}
    </FormDialog>
  );
}

// ── Incidencias ──────────────────────────────────────────────────────────────────────────
const I = "admin.orders.incidents" as const;

export function OpenIncidentDialog({
  order,
  onOpenChange,
  onDone,
}: Base & { order: { id: string; number: string } }) {
  const [type, setType] = useState<IncidentType>("lost");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [bearer, setBearer] = useState<CostBearer>("store");
  const open = useOrderMutation((a: { cost: number }) =>
    openIncident(order.id, type, description.trim() || null, a.cost, bearer),
  );
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t(`${I}.openTitle`, { number: order.number })}
      description={t(`${I}.openDescription`)}
      submitLabel={t(`${I}.open`)}
      onSubmit={async () => {
        const money = parseOptionalMoney(cost, true);
        if (!money.ok) return moneyError(money.problem);
        const result = await open.mutateAsync({ cost: money.value ?? 0 });
        if (succeeded(result, INCIDENT_OK)) {
          const message = t(`${I}.opened`);
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      <Field label={t(`${I}.type`)}>
        <Select value={type} onChange={(event) => setType(event.target.value as IncidentType)}>
          {INCIDENT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`${I}.types.${x}` as MessageKey)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t(`${I}.description`)}>
        <Textarea
          rows={3}
          maxLength={1000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t(`${I}.cost`)}>
          <Input
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </Field>
        <Field label={t(`${I}.bearer`)} hint={t(`${I}.bearerHint`)}>
          <Select value={bearer} onChange={(event) => setBearer(event.target.value as CostBearer)}>
            {COST_BEARERS.map((x) => (
              <option key={x} value={x}>
                {t(`${I}.bearers.${x}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </FormDialog>
  );
}

/** Seguimiento: pasa a «investigando» o se resuelve (con su resolución, el costo final y quién lo asume). */
export function UpdateIncidentDialog({
  incident,
  onOpenChange,
  onDone,
}: Base & { incident: IncidentRow }) {
  const [status, setStatus] = useState<"investigating" | "resolved">(
    incident.status === "open" ? "investigating" : "resolved",
  );
  const [resolution, setResolution] = useState(incident.resolution ?? "");
  const [cost, setCost] = useState(String(incident.costAssumed));
  const [bearer, setBearer] = useState<CostBearer>(incident.costBorneBy);
  const update = useOrderMutation((a: { cost: number | null }) =>
    updateIncident(incident.id, status, resolution.trim() || null, a.cost, bearer),
  );
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t(`${I}.updateTitle`, { number: incident.orderNumber })}
      description={t(`${I}.updateDescription`)}
      submitLabel={t(`${I}.update`)}
      onSubmit={async () => {
        const money = parseOptionalMoney(cost, true);
        if (!money.ok) return moneyError(money.problem);
        const result = await update.mutateAsync({ cost: money.value });
        if (succeeded(result, INCIDENT_OK)) {
          const message = t(status === "resolved" ? `${I}.resolved` : `${I}.updated`);
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      <Field label={t(`${I}.status`)}>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as "investigating" | "resolved")}
        >
          <option value="investigating">{t(`${I}.statuses.investigating`)}</option>
          <option value="resolved">{t(`${I}.statuses.resolved`)}</option>
        </Select>
      </Field>
      <Field
        label={t(`${I}.resolution`)}
        {...(status === "resolved" ? { hint: t(`${I}.resolutionHint`) } : {})}
      >
        <Textarea
          rows={3}
          maxLength={1000}
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t(`${I}.cost`)}>
          <Input
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </Field>
        <Field label={t(`${I}.bearer`)}>
          <Select value={bearer} onChange={(event) => setBearer(event.target.value as CostBearer)}>
            {COST_BEARERS.map((x) => (
              <option key={x} value={x}>
                {t(`${I}.bearers.${x}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </FormDialog>
  );
}

// ── Lista negra ──────────────────────────────────────────────────────────────────────────
const B = "admin.orders.blacklist" as const;

/** Bloquear una cuenta (con su teléfono y correo, si se quiere) o un teléfono/correo suelto. */
export function AddBlacklistDialog({
  preset,
  onOpenChange,
  onDone,
}: Base & {
  preset: {
    profileId: string | null;
    phone: string | null;
    email: string | null;
    orderId: string | null;
    label: string;
  } | null;
}) {
  const [kind, setKind] = useState<"profile" | "phone" | "email">(
    preset?.profileId ? "profile" : "phone",
  );
  const [phone, setPhone] = useState(preset?.phone ?? "");
  const [email, setEmail] = useState(preset?.email ?? "");
  const [contacts, setContacts] = useState(true);
  const [reason, setReason] = useState("");
  const add = useOrderMutation((a: Parameters<typeof blacklistAdd>[0]) => blacklistAdd(a));
  return (
    <FormDialog
      open
      destructive
      onOpenChange={onOpenChange}
      title={t(`${B}.addTitle`)}
      description={
        preset?.label
          ? t(`${B}.addDescriptionFor`, { name: preset.label })
          : t(`${B}.addDescription`)
      }
      submitLabel={t(`${B}.add`)}
      onSubmit={async () => {
        const why = validateText(reason, 300);
        if (!why.ok) return t(`${B}.errors.reason`);
        let phoneValue: string | null = null;
        if (kind === "phone") {
          phoneValue = normalizePhone(phone);
          if (!phoneValue) return t(`${B}.errors.phone`);
        }
        if (kind === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
          return t(`${B}.errors.email`);
        const result = await add.mutateAsync({
          kind,
          profileId: kind === "profile" ? (preset?.profileId ?? null) : null,
          phone: phoneValue,
          email: kind === "email" ? email.trim() : null,
          reason: why.value,
          orderId: preset?.orderId ?? null,
          includeContacts: kind === "profile" && contacts,
        });
        if (succeeded(result, BLACKLIST_OK)) {
          const message = t(`${B}.added`);
          onDone(message);
          toast.success(message);
          return null;
        }
        if (result.outcome === "already") return t(`${B}.already`);
        return errorText(resultCode(result));
      }}
    >
      <Field label={t(`${B}.kind`)}>
        <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          {preset?.profileId && <option value="profile">{t(`${B}.kinds.profile`)}</option>}
          <option value="phone">{t(`${B}.kinds.phone`)}</option>
          <option value="email">{t(`${B}.kinds.email`)}</option>
        </Select>
      </Field>
      {kind === "phone" && (
        <Field label={t(`${B}.phone`)}>
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
      )}
      {kind === "email" && (
        <Field label={t(`${B}.email`)}>
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
      )}
      {kind === "profile" && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5"
            checked={contacts}
            onChange={(event) => setContacts(event.target.checked)}
          />
          <span>{t(`${B}.includeContacts`)}</span>
        </label>
      )}
      <Field label={t(`${B}.reason`)} hint={t(`${B}.effect`)}>
        <Textarea
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

export function LiftBlacklistDialog({
  entryId,
  label,
  onOpenChange,
  onDone,
}: Base & { entryId: string; label: string }) {
  const [reason, setReason] = useState("");
  const lift = useOrderMutation((text: string) => blacklistLift(entryId, text));
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t(`${B}.liftTitle`)}
      description={t(`${B}.liftDescription`, { name: label })}
      submitLabel={t(`${B}.lift`)}
      onSubmit={async () => {
        const why = validateText(reason, 300);
        if (!why.ok) return t(`${B}.errors.reason`);
        const result = await lift.mutateAsync(why.value);
        if (succeeded(result, BLACKLIST_OK)) {
          const message = t(`${B}.lifted`);
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      <Field label={t(`${B}.liftReason`)}>
        <Textarea
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

// ── Reembolsos solicitados: marcar como devuelto o descartar ─────────────────────────────
const F = "admin.orders.refund.actions" as const;

export function ProcessRefundDialog({
  refund,
  onOpenChange,
  onDone,
}: Base & { refund: Pick<RefundRow, "id" | "amount" | "currency"> }) {
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const process = useOrderMutation((a: { ref: string | null; note: string | null }) =>
    processRefund(refund.id, a.ref, a.note),
  );
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t(`${F}.processTitle`)}
      description={t(`${F}.processDescription`, {
        amount: formatMoney(refund.amount, refund.currency),
      })}
      submitLabel={t(`${F}.process`)}
      onSubmit={async () => {
        const result = await process.mutateAsync({
          ref: ref.trim() || null,
          note: note.trim() || null,
        });
        if (succeeded(result, REFUND_ACTION_OK)) {
          const message = t(`${F}.processed`);
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      <Field label={t(`${F}.ref`)} hint={t(`${F}.refHint`)}>
        <Input maxLength={120} value={ref} onChange={(event) => setRef(event.target.value)} />
      </Field>
      <Field label={t(`${F}.note`)}>
        <Textarea
          rows={2}
          maxLength={300}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

export function RejectRefundDialog({
  refund,
  onOpenChange,
  onDone,
}: Base & { refund: Pick<RefundRow, "id"> }) {
  const [note, setNote] = useState("");
  const reject = useOrderMutation((text: string) => rejectRefund(refund.id, text));
  return (
    <FormDialog
      open
      destructive
      onOpenChange={onOpenChange}
      title={t(`${F}.rejectTitle`)}
      description={t(`${F}.rejectDescription`)}
      submitLabel={t(`${F}.reject`)}
      onSubmit={async () => {
        const why = validateText(note, 300);
        if (!why.ok) return t(`${F}.errors.reason`);
        const result = await reject.mutateAsync(why.value);
        if (succeeded(result, REFUND_ACTION_OK)) {
          const message = t(`${F}.rejected`);
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      <Field label={t(`${F}.rejectNote`)}>
        <Textarea
          rows={2}
          maxLength={300}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "../ui/FormDialog";
import { closeReturn, openReturn, rejectReturn } from "./api";
import { useOrderMutation } from "./hooks";
import { errorText, validateText } from "./logic";
import { RETURN_OK, resultCode, succeeded } from "./outcomes";
import { RETURN_REASONS, type OrderDetail, type RestockChoice, type ReturnRow } from "./types";

const R = "admin.orders.returns" as const;

interface Base {
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}

/** Abrir una devolución: qué unidades vuelven, por qué y si regresan al stock (o se inspeccionan antes). */
export function OpenReturnDialog({ order, onOpenChange, onDone }: Base & { order: OrderDetail }) {
  const [rows, setRows] = useState(
    order.items.map((i) => ({
      id: i.id,
      name: i.name,
      max: i.qty,
      qty: "0",
      reason: "damaged",
      restock: "inspection",
    })),
  );
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [needOverride, setNeedOverride] = useState(false);
  const open = useOrderMutation(
    (args: {
      items: { item_id: string; qty: number; reason_code: string; restock: string }[];
      reason: string;
      override: string | null;
    }) => openReturn(order.id, args.items, args.reason, args.override),
  );

  async function submit(): Promise<string | null> {
    const items = rows
      .map((r) => ({
        item_id: r.id,
        qty: Number.parseInt(r.qty, 10) || 0,
        reason_code: r.reason,
        restock: r.restock,
      }))
      .filter((r) => r.qty > 0);
    const why = validateText(reason, 300);
    if (items.length === 0) return t(`${R}.errors.items`);
    if (!why.ok) return t(`${R}.errors.reason`);
    const ovr = needOverride ? validateText(override, 300) : null;
    if (ovr && !ovr.ok) return t(`${R}.errors.override`);
    const result = await open.mutateAsync({
      items,
      reason: why.value,
      override: ovr?.ok ? ovr.value : null,
    });
    if (succeeded(result, RETURN_OK)) {
      const message = t(`${R}.opened`);
      onDone(message);
      toast.success(message);
      return null;
    }
    if (result.outcome === "outside_window") {
      setNeedOverride(true);
      return t(`${R}.outsideWindow`, { days: Number(result.window_days ?? 0) });
    }
    return errorText(resultCode(result));
  }

  return (
    <FormDialog
      open
      wide
      onOpenChange={onOpenChange}
      title={t(`${R}.openTitle`, { number: order.number })}
      description={t(`${R}.openDescription`)}
      submitLabel={t(`${R}.open`)}
      busyLabel={t(`${R}.opening`)}
      onSubmit={submit}
    >
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t(`${R}.itemsLegend`)}</legend>
        {rows.map((r, idx) => (
          <div
            key={r.id}
            className="grid gap-2 text-sm sm:grid-cols-[1fr_5rem_9rem_9rem] sm:items-end"
          >
            <span className="break-words">
              {r.name} <span className="text-muted-foreground">× {r.max}</span>
            </span>
            <Field label={t(`${R}.qty`)}>
              <Input
                inputMode="numeric"
                value={r.qty}
                onChange={(event) =>
                  setRows(
                    rows.map((x, i) =>
                      i === idx
                        ? { ...x, qty: event.target.value.replace(/\D/g, "").slice(0, 3) }
                        : x,
                    ),
                  )
                }
              />
            </Field>
            <Field label={t(`${R}.why`)}>
              <Select
                value={r.reason}
                onChange={(event) =>
                  setRows(
                    rows.map((x, i) => (i === idx ? { ...x, reason: event.target.value } : x)),
                  )
                }
              >
                {RETURN_REASONS.map((c) => (
                  <option key={c} value={c}>
                    {t(`${R}.reasons.${c}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t(`${R}.restock`)}>
              <Select
                value={r.restock}
                onChange={(event) =>
                  setRows(
                    rows.map((x, i) => (i === idx ? { ...x, restock: event.target.value } : x)),
                  )
                }
              >
                {(["yes", "no", "inspection"] as const).map((c) => (
                  <option key={c} value={c}>
                    {t(`${R}.restocks.${c}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ))}
      </fieldset>
      <Field label={t(`${R}.reason`)}>
        <Textarea
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {needOverride && (
        <Field label={t(`${R}.override`)} hint={t(`${R}.overrideHint`)}>
          <Textarea
            rows={2}
            maxLength={300}
            value={override}
            onChange={(event) => setOverride(event.target.value)}
          />
        </Field>
      )}
    </FormDialog>
  );
}

/** Cerrar la devolución: lo «por inspeccionar» se decide aquí (vuelve al stock o no) y lo que vuelve suma stock. */
export function CloseReturnDialog({
  ret,
  order,
  onOpenChange,
  onDone,
}: Base & { ret: ReturnRow; order: OrderDetail }) {
  const pending = ret.items.filter((i) => i.restock === "inspection");
  const [choice, setChoice] = useState<Record<string, RestockChoice>>(
    Object.fromEntries(pending.map((i) => [i.orderItemId, "yes" as RestockChoice])),
  );
  const close = useOrderMutation((resolutions: { item_id: string; restock: string }[]) =>
    closeReturn(ret.id, resolutions),
  );
  const nameOf = (id: string) => order.items.find((i) => i.id === id)?.name ?? "";
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t(`${R}.closeTitle`, { number: order.number })}
      description={t(`${R}.closeDescription`)}
      submitLabel={t(`${R}.close`)}
      onSubmit={async () => {
        const result = await close.mutateAsync(
          pending.map((i) => ({ item_id: i.orderItemId, restock: choice[i.orderItemId] ?? "yes" })),
        );
        if (succeeded(result, RETURN_OK)) {
          const message = t(`${R}.closed`, { units: Number(result.restocked_units ?? 0) });
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${R}.nothingToInspect`)}</p>
      ) : (
        pending.map((i) => (
          <Field key={i.id} label={t(`${R}.inspect`, { name: nameOf(i.orderItemId), qty: i.qty })}>
            <Select
              value={choice[i.orderItemId] ?? "yes"}
              onChange={(event) =>
                setChoice({ ...choice, [i.orderItemId]: event.target.value as RestockChoice })
              }
            >
              <option value="yes">{t(`${R}.restocks.yes`)}</option>
              <option value="no">{t(`${R}.restocks.no`)}</option>
            </Select>
          </Field>
        ))
      )}
    </FormDialog>
  );
}

export function RejectReturnDialog({ ret, onOpenChange, onDone }: Base & { ret: ReturnRow }) {
  const [note, setNote] = useState("");
  const reject = useOrderMutation((text: string) => rejectReturn(ret.id, text));
  return (
    <FormDialog
      open
      destructive
      onOpenChange={onOpenChange}
      title={t(`${R}.rejectTitle`)}
      description={t(`${R}.rejectDescription`)}
      submitLabel={t(`${R}.reject`)}
      onSubmit={async () => {
        const text = validateText(note, 300);
        if (!text.ok) return t(`${R}.errors.reason`);
        const result = await reject.mutateAsync(text.value);
        if (succeeded(result, RETURN_OK)) {
          const message = t(`${R}.rejected`);
          onDone(message);
          toast.success(message);
          return null;
        }
        return errorText(resultCode(result));
      }}
    >
      <Field label={t(`${R}.rejectNote`)}>
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

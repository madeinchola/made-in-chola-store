import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { StockAdjustReason } from "@/features/catalog/types";
import { toAppError } from "@/lib/errors";
import { StockLightBadge } from "../../ui/badges";
import { SectionCard } from "../../ui/PageHeader";
import { setVariantStock } from "../api";
import { changesBreakingReason, computeStockChanges, type StockChange } from "../stockChanges";
import type { AdminVariant } from "../types";
import type { SectionProps } from "./types";

const REASONS: readonly StockAdjustReason[] = ["adjust", "import", "return"];

/** Falló un ajuste a mitad de la tanda: los anteriores YA se registraron (cada uno es un movimiento propio). */
class PartialStockError extends Error {
  constructor(
    readonly done: number,
    readonly total: number,
    readonly variantName: string,
    cause: unknown,
  ) {
    super(toAppError(cause).message, { cause });
  }
}

/** Matriz de variantes con su stock. Cambiar una cantidad registra un movimiento en el libro de stock, con su motivo. */
export function StockSection({ detail, onChanged, onError, onDirtyChange }: SectionProps) {
  const colors = useMemo(() => new Map(detail.colors.map((c) => [c.id, c])), [detail.colors]);
  const sizes = useMemo(() => new Map(detail.sizes.map((s) => [s.id, s])), [detail.sizes]);
  const rows = useMemo(
    () =>
      detail.variants
        .filter((v) => !v.archived && colors.get(v.colorId)?.archived === false)
        .sort(
          (a, b) =>
            (colors.get(a.colorId)?.sortOrder ?? 0) - (colors.get(b.colorId)?.sortOrder ?? 0) ||
            (sizes.get(a.sizeId ?? "")?.sortOrder ?? 0) -
              (sizes.get(b.sizeId ?? "")?.sortOrder ?? 0),
        ),
    [detail.variants, colors, sizes],
  );
  const nameOf = (v: AdminVariant) => {
    const color = colors.get(v.colorId)?.name ?? "";
    const size = v.sizeId ? sizes.get(v.sizeId)?.label : undefined;
    return size ? `${color} / ${size}` : color;
  };

  const [edited, setEdited] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<StockAdjustReason>("adjust");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [note, setNote] = useState("");

  // Lo escrito NO se borra cuando el stock cambia por otro lado (una venta, otra persona): se compara con lo nuevo al
  // guardar, y la base rechaza el guardado si lo que se veía ya no es lo que hay. Solo se limpia tras guardar con éxito.

  const dirty = rows.some(
    (v) => edited[v.id] !== undefined && edited[v.id]?.trim() !== String(v.stockOnHand),
  );
  useEffect(() => onDirtyChange("stock", dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange("stock", false), [onDirtyChange]);

  const save = useMutation({
    mutationFn: async (changes: StockChange[]) => {
      let done = 0;
      for (const change of changes) {
        const variant = rows.find((r) => r.id === change.variantId);
        try {
          await setVariantStock({
            variantId: change.variantId,
            expected: change.expected,
            newValue: change.newValue,
            reason,
            ...(note.trim() ? { note: note.trim() } : {}),
          });
          done++;
        } catch (e) {
          throw new PartialStockError(done, changes.length, variant ? nameOf(variant) : "", e);
        }
      }
      return done;
    },
    onSuccess: async () => {
      toast.success(t("admin.products.stock.saved"));
      setNote("");
      setEdited({});
      setProblems({});
      setReasonError(undefined);
      await onChanged();
    },
    onError: async (e) => {
      if (e instanceof PartialStockError) {
        toast.error(
          t("admin.products.stock.partial", {
            done: e.done,
            total: e.total,
            name: e.variantName,
            message: e.message,
          }),
        );
        await onChanged(); // lo que sí se guardó debe verse
      } else {
        toast.error(t("admin.products.errors.unexpected"), { description: toAppError(e).message });
      }
      onError(e);
    },
  });

  const submit = () => {
    const result = computeStockChanges(rows, edited);
    const messages: Record<string, string> = {};
    for (const [id] of Object.entries(result.problems))
      messages[id] = t("admin.products.stock.invalid");
    setProblems(messages);
    if (Object.keys(messages).length > 0) return;
    if (changesBreakingReason(result.changes, reason).length > 0) {
      return setReasonError(
        t("admin.products.stock.onlyIncrease", {
          reason: t(`admin.products.stock.reasons.${reason}`),
        }),
      );
    }
    setReasonError(undefined);
    if (result.changes.length === 0)
      return void toast.info(t("admin.products.stock.nothingChanged"));
    save.mutate(result.changes);
  };

  const totalOnHand = rows.reduce((n, v) => n + v.stockOnHand, 0);
  const totalAvailable = rows.reduce((n, v) => n + v.available, 0);

  return (
    <SectionCard
      id="sec-stock"
      title={t("admin.products.edit.sections.stock")}
      description={t("admin.products.stock.intro")}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.products.stock.noVariants")}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("admin.products.edit.sections.stock")}</caption>
              <thead className="border-b bg-muted/60">
                <tr>
                  {(["color", "sku", "onHand", "reserved", "available", "light"] as const).map(
                    (k) => (
                      <th key={k} scope="col" className="px-3 py-2 font-medium">
                        {k === "color"
                          ? `${t("admin.products.stock.color")} / ${t("admin.products.stock.size")}`
                          : t(`admin.products.stock.${k}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="border-b last:border-b-0">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {nameOf(v)}
                    </th>
                    <td className="px-3 py-2 text-muted-foreground">{v.sku}</td>
                    <td className="w-32 px-3 py-2">
                      <Field
                        label={t("admin.products.stock.newValue", { name: nameOf(v) })}
                        error={problems[v.id]}
                      >
                        <Input
                          inputMode="numeric"
                          autoComplete="off"
                          value={edited[v.id] ?? String(v.stockOnHand)}
                          onChange={(e) => setEdited((cur) => ({ ...cur, [v.id]: e.target.value }))}
                        />
                      </Field>
                    </td>
                    <td className="px-3 py-2">{v.reserved}</td>
                    <td className="px-3 py-2">{v.available}</td>
                    <td className="px-3 py-2">
                      <StockLightBadge light={v.light} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("admin.products.stock.totals", { onHand: totalOnHand, available: totalAvailable })}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t("admin.products.stock.reason")} error={reasonError}>
              <Select
                value={reason}
                onChange={(e) => setReason(e.target.value as StockAdjustReason)}
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`admin.products.stock.reasons.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("admin.products.stock.note")}>
              <Input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <Button
            type="button"
            className="mt-4"
            disabled={save.isPending || !dirty}
            onClick={submit}
          >
            {save.isPending ? t("admin.products.stock.saving") : t("admin.products.stock.save")}
          </Button>
        </>
      )}
    </SectionCard>
  );
}

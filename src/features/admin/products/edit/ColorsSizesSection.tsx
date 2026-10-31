import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toAppError } from "@/lib/errors";
import { isStaleVersion } from "../../lib/versioned";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { SectionCard } from "../../ui/PageHeader";
import {
  addColor,
  addSize,
  setColorArchived,
  setSizeArchived,
  syncProductVariants,
  updateColor,
  updateSize,
} from "../api";
import {
  HEX_RE,
  MAX_COLOR_NAME,
  MAX_ITEMS,
  MAX_SIZE_LABEL,
  validateColors,
  validateSizes,
} from "../productSchema";
import { isEmptyPlan, type VariantPlan } from "../variantPlan";
import type { AdminColor, AdminSize } from "../types";
import type { SectionProps } from "./types";

type Archive = { kind: "color"; item: AdminColor } | { kind: "size"; item: AdminSize };

/** Colores y tallas del producto. Cada cambio de estructura re-sincroniza las variantes (crea, restaura o archiva). */
export function ColorsSizesSection({ detail, onChanged, onError }: SectionProps) {
  const productId = detail.product.id;
  const [colorEdits, setColorEdits] = useState<Record<string, { name: string; hex: string }>>({});
  const [sizeEdits, setSizeEdits] = useState<Record<string, string>>({});
  const [newColor, setNewColor] = useState({ name: "", hex: "" });
  const [newColorError, setNewColorError] = useState<string | undefined>();
  const [newSize, setNewSize] = useState("");
  const [newSizeError, setNewSizeError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<Archive | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const activeColors = detail.colors.filter((c) => !c.archived);
  const archivedColors = detail.colors.filter((c) => c.archived);
  const activeSizes = detail.sizes.filter((s) => !s.archived);
  const archivedSizes = detail.sizes.filter((s) => s.archived);
  const activeVariantCount = detail.variants.filter((v) => !v.archived).length;

  const report = (plan: VariantPlan) => {
    if (plan.blocked.length > 0) {
      toast.warning(t("admin.products.colorsSizes.syncBlocked", { count: plan.blocked.length }));
    } else if (!isEmptyPlan(plan)) {
      toast.success(t("admin.products.colorsSizes.syncDone"));
    }
  };
  const fail = (e: unknown) => {
    if (!isStaleVersion(e))
      toast.error(t("admin.products.errors.unexpected"), { description: toAppError(e).message });
    onError(e);
  };

  /** Ejecuta un cambio de estructura y deja las variantes al día. */
  const structural = useMutation({
    mutationFn: async (change: () => Promise<unknown>) => {
      await change();
      return syncProductVariants(productId);
    },
    onSuccess: async (plan) => {
      report(plan);
      await onChanged();
    },
    onError: fail,
  });

  const manualSync = useMutation({
    mutationFn: () => syncProductVariants(productId),
    onSuccess: async (plan) => {
      if (isEmptyPlan(plan)) toast.info(t("admin.products.colorsSizes.syncNothing"));
      else report(plan);
      await onChanged();
    },
    onError: fail,
  });

  const saveColorRow = (c: AdminColor) => {
    const edit = colorEdits[c.id];
    if (!edit) return;
    const others = activeColors
      .filter((x) => x.id !== c.id)
      .map((x) => ({ name: x.name, hex: x.hex ?? "" }));
    const errors = validateColors([...others, { name: edit.name, hex: edit.hex }]);
    const message = errors[others.length];
    if (message) return setRowErrors((cur) => ({ ...cur, [c.id]: message }));
    setRowErrors((cur) => ({ ...cur, [c.id]: "" }));
    structural.mutate(async () => {
      await updateColor(c, {
        name: edit.name,
        hex: edit.hex.trim() === "" ? null : edit.hex.trim(),
      });
      setColorEdits(({ [c.id]: _gone, ...rest }) => rest);
    });
  };

  const saveSizeRow = (s: AdminSize) => {
    const label = sizeEdits[s.id];
    if (label === undefined) return;
    const others = activeSizes.filter((x) => x.id !== s.id).map((x) => x.label);
    const message = validateSizes([...others, label])[others.length];
    if (message) return setRowErrors((cur) => ({ ...cur, [s.id]: message }));
    setRowErrors((cur) => ({ ...cur, [s.id]: "" }));
    structural.mutate(async () => {
      await updateSize(s, label);
      setSizeEdits(({ [s.id]: _gone, ...rest }) => rest);
    });
  };

  const submitNewColor = () => {
    const drafts = [...activeColors.map((c) => ({ name: c.name, hex: c.hex ?? "" })), newColor];
    const message = validateColors(drafts)[drafts.length - 1];
    setNewColorError(message);
    if (message) return;
    const order = detail.colors.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1;
    structural.mutate(async () => {
      await addColor(productId, newColor, order);
      setNewColor({ name: "", hex: "" });
    });
  };

  const submitNewSize = () => {
    const labels = [...activeSizes.map((s) => s.label), newSize];
    const message = validateSizes(labels)[labels.length - 1];
    setNewSizeError(message);
    if (message) return;
    const order = detail.sizes.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1;
    structural.mutate(async () => {
      await addSize(productId, newSize, order);
      setNewSize("");
    });
  };

  const stockOfColor = (colorId: string) =>
    detail.variants
      .filter((v) => !v.archived && v.colorId === colorId)
      .reduce((n, v) => n + v.stockOnHand, 0);
  const stockOfSize = (sizeId: string) =>
    detail.variants
      .filter((v) => !v.archived && v.sizeId === sizeId)
      .reduce((n, v) => n + v.stockOnHand, 0);
  const busy = structural.isPending || manualSync.isPending;

  const confirmCopy = (a: Archive) => {
    const name = a.kind === "color" ? a.item.name : a.item.label;
    const units = a.kind === "color" ? stockOfColor(a.item.id) : stockOfSize(a.item.id);
    const body = t("admin.products.colorsSizes.confirmArchive.body");
    return {
      title: t("admin.products.colorsSizes.confirmArchive.title", { name }),
      description:
        units > 0
          ? `${body} ${t("admin.products.colorsSizes.confirmArchive.bodyWithStock", { units })}`
          : body,
    };
  };

  return (
    <SectionCard
      id="sec-colors"
      title={t("admin.products.edit.sections.colorsSizes")}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => manualSync.mutate()}
        >
          {manualSync.isPending
            ? t("admin.products.colorsSizes.syncing")
            : t("admin.products.colorsSizes.sync")}
        </Button>
      }
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold">{t("admin.products.colorsSizes.colors")}</h3>
          <ul className="space-y-3">
            {activeColors.map((c) => {
              const edit = colorEdits[c.id] ?? { name: c.name, hex: c.hex ?? "" };
              const changed = edit.name !== c.name || edit.hex !== (c.hex ?? "");
              return (
                <li key={c.id} className="flex flex-wrap items-start gap-2">
                  <div className="min-w-[8rem] flex-1">
                    <Field
                      label={`${t("admin.products.colorsSizes.colorName")}: ${c.name}`}
                      error={rowErrors[c.id] || undefined}
                    >
                      <Input
                        value={edit.name}
                        maxLength={MAX_COLOR_NAME}
                        onChange={(e) =>
                          setColorEdits((cur) => ({
                            ...cur,
                            [c.id]: { ...edit, name: e.target.value },
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="w-32">
                    <Field label={`${t("admin.products.colorsSizes.colorHex")}: ${c.name}`}>
                      <Input
                        value={edit.hex}
                        placeholder="#A1B2C3"
                        maxLength={7}
                        onChange={(e) =>
                          setColorEdits((cur) => ({
                            ...cur,
                            [c.id]: { ...edit, hex: e.target.value },
                          }))
                        }
                      />
                    </Field>
                  </div>
                  {HEX_RE.test(edit.hex) && (
                    <span
                      aria-hidden="true"
                      className="mt-8 h-6 w-6 rounded border"
                      style={{ backgroundColor: edit.hex }}
                    />
                  )}
                  <div className="mt-7 flex gap-1">
                    {changed && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => saveColorRow(c)}
                      >
                        {t("admin.actions.save")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`${t("admin.products.colorsSizes.archiveColor")}: ${c.name}`}
                      onClick={() => setConfirm({ kind: "color", item: c })}
                    >
                      {t("admin.actions.archive")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {archivedColors.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {archivedColors.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span>
                    {c.name} ({t("admin.products.colorsSizes.archivedTag")})
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`${t("admin.products.colorsSizes.restoreItem")}: ${c.name}`}
                    onClick={() => structural.mutate(() => setColorArchived(c, false))}
                  >
                    {t("admin.products.colorsSizes.restoreItem")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-start gap-2 border-t pt-4">
            <div className="min-w-[8rem] flex-1">
              <Field label={t("admin.products.colorsSizes.addColor")} error={newColorError}>
                <Input
                  value={newColor.name}
                  maxLength={MAX_COLOR_NAME}
                  onChange={(e) => setNewColor((c) => ({ ...c, name: e.target.value }))}
                />
              </Field>
            </div>
            <div className="w-32">
              <Field label={t("admin.products.colorsSizes.colorHex")}>
                <Input
                  value={newColor.hex}
                  placeholder="#A1B2C3"
                  maxLength={7}
                  onChange={(e) => setNewColor((c) => ({ ...c, hex: e.target.value }))}
                />
              </Field>
            </div>
            <Button
              type="button"
              className="mt-7"
              disabled={busy || activeColors.length >= MAX_ITEMS}
              onClick={submitNewColor}
            >
              {t("admin.actions.add")}
            </Button>
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-sm font-semibold">{t("admin.products.colorsSizes.sizes")}</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("admin.products.colorsSizes.sizesHint")}
          </p>
          {activeSizes.length === 0 && (
            <p className="mb-2 text-sm text-muted-foreground">
              {t("admin.products.colorsSizes.noSizes")}
            </p>
          )}
          <ul className="space-y-3">
            {activeSizes.map((s) => {
              const label = sizeEdits[s.id] ?? s.label;
              return (
                <li key={s.id} className="flex items-start gap-2">
                  <div className="w-32">
                    <Field
                      label={`${t("admin.products.colorsSizes.sizeLabel")}: ${s.label}`}
                      error={rowErrors[s.id] || undefined}
                    >
                      <Input
                        value={label}
                        maxLength={MAX_SIZE_LABEL}
                        onChange={(e) =>
                          setSizeEdits((cur) => ({ ...cur, [s.id]: e.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="mt-7 flex gap-1">
                    {label !== s.label && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => saveSizeRow(s)}
                      >
                        {t("admin.actions.save")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`${t("admin.products.colorsSizes.archiveSize")}: ${s.label}`}
                      onClick={() => setConfirm({ kind: "size", item: s })}
                    >
                      {t("admin.actions.archive")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {archivedSizes.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {archivedSizes.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span>
                    {s.label} ({t("admin.products.colorsSizes.archivedTag")})
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`${t("admin.products.colorsSizes.restoreItem")}: ${s.label}`}
                    onClick={() => structural.mutate(() => setSizeArchived(s, false))}
                  >
                    {t("admin.products.colorsSizes.restoreItem")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-start gap-2 border-t pt-4">
            <div className="w-32">
              <Field label={t("admin.products.colorsSizes.addSize")} error={newSizeError}>
                <Input
                  value={newSize}
                  maxLength={MAX_SIZE_LABEL}
                  onChange={(e) => setNewSize(e.target.value)}
                />
              </Field>
            </div>
            <Button
              type="button"
              className="mt-7"
              disabled={busy || activeSizes.length >= MAX_ITEMS}
              onClick={submitNewSize}
            >
              {t("admin.actions.add")}
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        {t("admin.products.colorsSizes.variantsCount", { count: activeVariantCount })}
      </p>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          {...confirmCopy(confirm)}
          confirmLabel={t("admin.actions.archive")}
          destructive
          // Si falla, mutateAsync rechaza: el diálogo se queda abierto (el error ya se informó en onError).
          onConfirm={async () => {
            await structural.mutateAsync(() =>
              confirm.kind === "color"
                ? setColorArchived(confirm.item, true)
                : setSizeArchived(confirm.item, true),
            );
          }}
        />
      )}
    </SectionCard>
  );
}

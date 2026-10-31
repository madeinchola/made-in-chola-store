import type { UseFormReturn } from "react-hook-form";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CODE_RE, SLUG_RE, type ProductDataValues } from "./productSchema";
import { useAvailability, type Availability } from "./useAvailability";

function availabilityHint(state: Availability, free: string): string | undefined {
  if (state === "checking") return t("admin.products.data.slugChecking");
  if (state === "free") return free;
  return undefined;
}

interface Props {
  form: UseFormReturn<ProductDataValues>;
  /** Al editar: el producto propio (no cuenta como "ocupado") y sus valores originales. */
  excludeId?: string;
  originalSlug?: string;
  originalCode?: string;
  /** El usuario escribió el slug a mano (deja de generarse solo). */
  onSlugEdited?: () => void;
  onGenerateSlug?: () => void;
}

/** Campos de los datos del producto: los comparten la pantalla de creación y la sección "Datos" de la edición. */
export function ProductDataFields({
  form,
  excludeId,
  originalSlug,
  originalCode,
  onSlugEdited,
  onGenerateSlug,
}: Props) {
  const {
    register,
    watch,
    formState: { errors },
  } = form;
  const slug = watch("slug");
  const code = watch("code");
  const description = watch("description");
  const slugState = useAvailability("slug", slug ?? "", {
    valid: SLUG_RE.test((slug ?? "").trim()) && (slug ?? "").trim().length <= 80,
    ...(originalSlug !== undefined ? { original: originalSlug } : {}),
    ...(excludeId ? { excludeId } : {}),
  });
  const codeState = useAvailability("code", code ?? "", {
    valid: CODE_RE.test((code ?? "").trim()),
    ...(originalCode !== undefined ? { original: originalCode } : {}),
    ...(excludeId ? { excludeId } : {}),
  });
  const slugChanged = originalSlug !== undefined && (slug ?? "").trim() !== originalSlug;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label={t("admin.products.data.name")} error={errors.name?.message}>
          <Input maxLength={160} autoComplete="off" {...register("name")} />
        </Field>
      </div>
      <Field
        label={t("admin.products.data.code")}
        error={
          errors.code?.message ??
          (codeState === "taken" ? t("admin.products.data.codeTaken") : undefined)
        }
        hint={
          availabilityHint(codeState, t("admin.products.data.slugFree")) ??
          t("admin.products.data.codeHint")
        }
      >
        <Input maxLength={40} autoComplete="off" {...register("code")} />
      </Field>
      <div>
        <Field
          label={t("admin.products.data.slug")}
          error={
            errors.slug?.message ??
            (slugState === "taken" ? t("admin.products.data.slugTaken") : undefined)
          }
          hint={
            availabilityHint(slugState, t("admin.products.data.slugFree")) ??
            t("admin.products.data.slugHint")
          }
        >
          <Input
            maxLength={80}
            autoComplete="off"
            {...register("slug", { onChange: () => onSlugEdited?.() })}
          />
        </Field>
        {onGenerateSlug && (
          <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={onGenerateSlug}>
            {t("admin.products.data.slugAuto")}
          </Button>
        )}
        {slugChanged && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("admin.products.data.slugChanged")}
          </p>
        )}
      </div>
      <Field label={t("admin.products.data.model")} error={errors.model?.message}>
        <Input maxLength={120} {...register("model")} />
      </Field>
      <Field
        label={t("admin.products.data.cost")}
        error={errors.costBase?.message}
        hint={t("admin.products.data.costHint")}
      >
        <Input inputMode="decimal" autoComplete="off" {...register("costBase")} />
      </Field>
      <div className="sm:col-span-2">
        <Field
          label={t("admin.products.data.description")}
          error={errors.description?.message}
          hint={`${t("admin.products.data.descriptionHint")} (${(description ?? "").length}/5000)`}
        >
          <Textarea rows={5} {...register("description")} />
        </Field>
      </div>
      <Field label={t("admin.products.data.materials")} error={errors.materials?.message}>
        <Textarea rows={3} {...register("materials")} />
      </Field>
      <Field label={t("admin.products.data.washcare")} error={errors.washcare?.message}>
        <Textarea rows={3} {...register("washcare")} />
      </Field>
      <Field label={t("admin.products.data.outOfStock")}>
        <Select {...register("outOfStockBehavior")}>
          <option value="sold_out">{t("admin.products.data.outOfStockSoldOut")}</option>
          <option value="hide">{t("admin.products.data.outOfStockHide")}</option>
        </Select>
      </Field>
      <div className="flex flex-col justify-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" {...register("isNew")} />
          {t("admin.products.data.isNew")}
        </label>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" {...register("allowConvertedPrices")} />
            {t("admin.products.data.allowConverted")}
          </label>
          <p className="ml-6 text-xs text-muted-foreground">
            {t("admin.products.data.allowConvertedHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

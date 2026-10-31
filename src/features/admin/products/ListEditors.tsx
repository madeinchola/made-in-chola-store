import { Plus, X } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  HEX_RE,
  MAX_ITEMS,
  MAX_COLOR_NAME,
  MAX_SIZE_LABEL,
  type ColorDraft,
  type ListErrors,
} from "./productSchema";

const COMMON_SIZES = ["XS", "S", "M", "L", "XL"] as const;

interface ColorListEditorProps {
  colors: ColorDraft[];
  onChange: (colors: ColorDraft[]) => void;
  errors: ListErrors;
}

/** Lista editable de colores (nombre + tono opcional) para el producto nuevo. */
export function ColorListEditor({ colors, onChange, errors }: ColorListEditorProps) {
  const set = (i: number, patch: Partial<ColorDraft>) =>
    onChange(colors.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      {colors.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("admin.products.colorsSizes.noColors")}</p>
      )}
      {colors.map((c, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2">
          <div className="min-w-[10rem] flex-1">
            <Field
              label={`${t("admin.products.colorsSizes.colorName")} ${i + 1}`}
              error={errors[i]}
            >
              <Input
                value={c.name}
                maxLength={MAX_COLOR_NAME}
                autoComplete="off"
                onChange={(e) => set(i, { name: e.target.value })}
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label={`${t("admin.products.colorsSizes.colorHex")} ${i + 1}`}>
              <Input
                value={c.hex}
                placeholder="#A1B2C3"
                maxLength={7}
                autoComplete="off"
                onChange={(e) => set(i, { hex: e.target.value })}
              />
            </Field>
          </div>
          <input
            type="color"
            aria-label={`${t("admin.products.colorsSizes.colorHex")} ${i + 1}`}
            value={HEX_RE.test(c.hex) ? c.hex : "#cccccc"}
            onChange={(e) => set(i, { hex: e.target.value.toUpperCase() })}
            className="mt-7 h-10 w-10 cursor-pointer rounded border"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-7"
            aria-label={`${t("admin.actions.remove")} ${t("admin.products.colorsSizes.colorName")} ${i + 1}`}
            onClick={() => onChange(colors.filter((_, idx) => idx !== i))}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={colors.length >= MAX_ITEMS}
        onClick={() => onChange([...colors, { name: "", hex: "" }])}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t("admin.products.colorsSizes.addColor")}
      </Button>
      {colors.length >= MAX_ITEMS && (
        <p className="text-xs text-muted-foreground">
          {t("admin.products.colorsSizes.tooMany", { max: MAX_ITEMS })}
        </p>
      )}
    </div>
  );
}

interface SizeListEditorProps {
  sizes: string[];
  onChange: (sizes: string[]) => void;
  errors: ListErrors;
}

/** Lista editable de tallas (opcional) para el producto nuevo. */
export function SizeListEditor({ sizes, onChange, errors }: SizeListEditorProps) {
  const addCommon = () => {
    const have = new Set(sizes.map((s) => s.trim().toLowerCase()));
    const missing = COMMON_SIZES.filter((s) => !have.has(s.toLowerCase()));
    onChange([...sizes.filter((s) => s.trim() !== ""), ...missing]);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("admin.products.colorsSizes.sizesHint")}</p>
      {sizes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("admin.products.colorsSizes.noSizes")}</p>
      )}
      {sizes.map((s, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="w-40">
            <Field
              label={`${t("admin.products.colorsSizes.sizeLabel")} ${i + 1}`}
              error={errors[i]}
            >
              <Input
                value={s}
                maxLength={MAX_SIZE_LABEL}
                autoComplete="off"
                onChange={(e) => onChange(sizes.map((x, idx) => (idx === i ? e.target.value : x)))}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-7"
            aria-label={`${t("admin.actions.remove")} ${t("admin.products.colorsSizes.sizeLabel")} ${i + 1}`}
            onClick={() => onChange(sizes.filter((_, idx) => idx !== i))}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={sizes.length >= MAX_ITEMS}
          onClick={() => onChange([...sizes, ""])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("admin.products.colorsSizes.addSize")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={addCommon}>
          {t("admin.products.create.commonSizes")}
        </Button>
      </div>
    </div>
  );
}

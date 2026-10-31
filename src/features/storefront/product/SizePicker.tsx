import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { SizeOption } from "./variantSelection";

interface SizePickerProps {
  options: SizeOption[];
  value: string | null;
  onChange: (sizeId: string) => void;
}

/**
 * Fila «TALLA» del diseño: arriba y abajo una línea; a la derecha las tallas como TEXTO (la elegida subrayada, las
 * agotadas o inexistentes en ese color atenuadas, tachadas y no seleccionables, con el motivo para lectores de pantalla).
 * Nunca se muestran cantidades.
 */
export function SizePicker({ options, value, onChange }: SizePickerProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-y border-foreground/70 py-1">
      <span id="size-label" className="eyebrow">
        {t("shop.product.sizeLabel")}
      </span>
      <RadioGroupPrimitive.Root
        aria-labelledby="size-label"
        value={value ?? ""}
        onValueChange={onChange}
        orientation="horizontal"
        className="flex flex-wrap items-center justify-end gap-x-1"
      >
        {options.map((option) => (
          <RadioGroupPrimitive.Item
            key={option.id}
            value={option.id}
            disabled={!option.selectable}
            className={cn(
              "min-h-11 min-w-9 px-2 text-sm uppercase tracking-[0.08em] underline-offset-[6px] transition-colors duration-fast ease-standard",
              "data-[state=checked]:underline",
              option.selectable
                ? "hover:text-muted-foreground"
                : "cursor-not-allowed text-muted-foreground/70 line-through",
            )}
          >
            {option.label}
            {!option.selectable && (
              <>
                {/* el espacio va FUERA del span: dentro, el nombre accesible lo pierde («M(agotada)») */}{" "}
                <span className="sr-only">
                  {option.state === "unavailable"
                    ? t("shop.product.sizeUnavailable")
                    : t("shop.product.sizeSoldOut")}
                </span>
              </>
            )}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </div>
  );
}

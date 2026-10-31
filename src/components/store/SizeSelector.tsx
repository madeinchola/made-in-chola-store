import { useId } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { t } from "@/i18n";
import type { PublicStockStatus } from "@/features/catalog/types";
import { cn } from "@/lib/utils";

export interface SizeOption {
  id: string;
  label: string;
  status: PublicStockStatus;
}

interface SizeSelectorProps {
  options: readonly SizeOption[];
  value: string | undefined;
  onValueChange: (id: string) => void;
  className?: string;
}

/**
 * Selector de talla. Las tallas agotadas se ven tachadas, no se pueden elegir y se anuncian como "(agotada)";
 * "pocas unidades" sí se puede elegir. Sin tallas (producto de talla única) no pinta nada.
 */
export function SizeSelector({ options, value, onValueChange, className }: SizeSelectorProps) {
  const labelId = useId();
  if (options.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)}>
      <p id={labelId} className="eyebrow text-muted-foreground">
        {t("store.size.label")}
      </p>
      <RadioGroupPrimitive.Root
        aria-labelledby={labelId}
        orientation="horizontal"
        value={value ?? ""}
        onValueChange={onValueChange}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => {
          const soldOut = option.status === "out";
          return (
            <RadioGroupPrimitive.Item
              key={option.id}
              value={option.id}
              disabled={soldOut}
              className={cn(
                "inline-flex h-11 min-w-11 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors duration-fast ease-standard hover:border-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
                soldOut &&
                  "cursor-not-allowed text-muted-foreground line-through hover:border-input",
              )}
            >
              {option.label}
              {soldOut && (
                <>
                  {" "}
                  <span className="sr-only">{t("store.size.soldOut")}</span>
                </>
              )}
            </RadioGroupPrimitive.Item>
          );
        })}
      </RadioGroupPrimitive.Root>
    </div>
  );
}

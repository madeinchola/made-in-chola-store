import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { normalizeHex } from "./colorHex";

interface ColorSwatchProps {
  hex: string | null;
  className?: string;
}

/**
 * Muestra de color (solo visual: el nombre lo da quien la usa). SIEMPRE lleva borde `border-input`: los colores claros
 * (blanco, crema, hueso) se confundirían con el fondo #F5F4F4. Sin hex válido → patrón rayado neutro.
 */
export function ColorSwatch({ hex, className }: ColorSwatchProps) {
  const color = normalizeHex(hex);
  return (
    <span
      data-swatch
      aria-hidden="true"
      style={color ? { backgroundColor: color } : undefined}
      className={cn(
        "block h-full w-full rounded-pill border border-input",
        !color &&
          "bg-[repeating-linear-gradient(45deg,hsl(var(--muted))_0_4px,hsl(var(--border))_4px_8px)]",
        className,
      )}
    />
  );
}

export interface ColorOption {
  id: string;
  name: string;
  hex: string | null;
  disabled?: boolean;
}

interface ColorSwatchGroupProps {
  options: readonly ColorOption[];
  value: string | undefined;
  onValueChange: (id: string) => void;
  className?: string;
}

/** Selector de color (grupo de opciones: flechas para moverse). Muestra el nombre del color elegido como texto. */
export function ColorSwatchGroup({
  options,
  value,
  onValueChange,
  className,
}: ColorSwatchGroupProps) {
  const selected = options.find((option) => option.id === value);
  return (
    <div className={cn("space-y-2", className)}>
      <p aria-live="polite" className="text-sm">
        {selected ? t("store.swatch.selected", { name: selected.name }) : t("store.swatch.choose")}
      </p>
      <RadioGroupPrimitive.Root
        aria-label={t("store.swatch.label")}
        orientation="horizontal"
        value={value ?? ""}
        onValueChange={onValueChange}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => (
          <RadioGroupPrimitive.Item
            key={option.id}
            value={option.id}
            disabled={option.disabled ?? false}
            aria-label={option.name}
            title={option.name}
            className="h-9 w-9 rounded-pill border-2 border-transparent p-[3px] transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-foreground"
          >
            <ColorSwatch hex={option.hex} />
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </div>
  );
}

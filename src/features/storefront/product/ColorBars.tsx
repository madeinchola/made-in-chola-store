import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { normalizeHex } from "@/components/store/colorHex";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ColorOption } from "./variantSelection";

interface ColorBarsProps {
  options: ColorOption[];
  value: string | null;
  onChange: (colorId: string) => void;
}

/** Fondo de la barra: el color, o un rayado neutro si el color no tiene un hexadecimal válido. */
function barStyle(hex: string | null) {
  const valid = normalizeHex(hex);
  return valid
    ? { backgroundColor: valid }
    : {
        backgroundImage:
          "repeating-linear-gradient(135deg, hsl(var(--muted)) 0 4px, hsl(var(--input)) 4px 5px)",
      };
}

/**
 * Selector de color del diseño: barras rectangulares (≈ 66×16 px) en fila; la elegida lleva una raya debajo. Es un
 * grupo de opciones (flechas del teclado) con borde siempre visible, para que el blanco y el crudo no se pierdan.
 */
export function ColorBars({ options, value, onChange }: ColorBarsProps) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={t("shop.product.colorGroup")}
      value={value ?? ""}
      onValueChange={onChange}
      orientation="horizontal"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-4"
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.id}
          value={option.id}
          aria-label={
            option.available ? option.name : `${option.name} ${t("shop.product.colorSoldOut")}`
          }
          title={option.name}
          style={barStyle(option.hex)}
          className={cn(
            "relative h-4 w-[4.1rem] border border-input transition-opacity duration-fast ease-standard",
            // área de toque de 32 px de alto sin cambiar la barra del diseño
            "before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
            // raya de «elegido» bajo la barra
            "after:absolute after:-bottom-2 after:left-0 after:h-px after:w-8 after:bg-foreground after:opacity-0 after:content-[''] data-[state=checked]:after:opacity-100",
          )}
        >
          {/* Agotado: una raya diagonal (el borde y el color se conservan completos: una barra casi transparente
              perdía el contraste mínimo del borde, WCAG 1.4.11, y el color no debe ser lo único que lo diga). */}
          {!option.available && (
            <span
              aria-hidden="true"
              data-sold-out-mark=""
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top_right,transparent_calc(50%-0.75px),hsl(var(--foreground))_calc(50%-0.75px),hsl(var(--foreground))_calc(50%+0.75px),transparent_calc(50%+0.75px))]"
            />
          )}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

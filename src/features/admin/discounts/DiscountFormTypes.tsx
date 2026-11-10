import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { couponMode } from "./discountForm";
import { DISCOUNT_KINDS, type DiscountKind } from "./types";

interface DiscountTypeCardsProps {
  /** El tipo ya elegido (al volver desde el paso 2), o null si todavía no se eligió ninguno. */
  value: DiscountKind | null;
  onPick: (kind: DiscountKind) => void;
}

/** Paso 1 del asistente: una tarjeta por tipo, con su nombre y una frase que explica qué hace. */
export function DiscountTypeCards({ value, onPick }: DiscountTypeCardsProps) {
  return (
    <div
      role="group"
      aria-label={t("admin.discounts.wizard.typesLabel")}
      className="grid gap-3 sm:grid-cols-2"
    >
      {DISCOUNT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          onClick={() => onPick(kind)}
          className={cn(
            "flex min-h-11 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
            value === kind && "border-primary bg-muted/60",
          )}
        >
          <span className="text-sm font-semibold">{t(`admin.discounts.list.kind.${kind}`)}</span>
          <span className="text-xs text-muted-foreground">
            {t(`admin.discounts.wizard.typeSummary.${kind}`)}
          </span>
          <span className="text-xs font-medium">
            {couponMode(kind) === "always"
              ? t("admin.discounts.list.mode.coupon")
              : couponMode(kind) === "never"
                ? t("admin.discounts.list.mode.automatic")
                : `${t("admin.discounts.list.mode.automatic")} / ${t("admin.discounts.list.mode.coupon")}`}
          </span>
        </button>
      ))}
    </div>
  );
}

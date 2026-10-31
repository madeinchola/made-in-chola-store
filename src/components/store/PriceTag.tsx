import { cva, type VariantProps } from "class-variance-authority";
import { t } from "@/i18n";
import { formatMoney, type Money } from "@/lib/money";
import { cn } from "@/lib/utils";

const priceVariants = cva("flex flex-wrap items-baseline gap-x-2 tabular-nums", {
  variants: {
    size: { sm: "text-sm", md: "text-base", lg: "text-xl" },
  },
  defaultVariants: { size: "md" },
});

interface PriceTagProps extends VariantProps<typeof priceVariants> {
  price: Money;
  /** Precio anterior (tachado). Se ignora si no es mayor que `price` o si es de otra moneda. */
  compareAt?: Money | undefined;
  className?: string;
}

/** Precio con formato de moneda; con descuento muestra el anterior tachado y anuncia ambos a lectores de pantalla. */
export function PriceTag({ price, compareAt, size, className }: PriceTagProps) {
  const showCompare =
    compareAt !== undefined &&
    compareAt.currency === price.currency &&
    compareAt.amount > price.amount;
  return (
    <p className={cn(priceVariants({ size }), className)}>
      {showCompare && (
        <>
          <span className="sr-only">{t("store.price.was")} </span>
          <s className="whitespace-nowrap text-muted-foreground">{formatMoney(compareAt)}</s>
          <span className="sr-only">{t("store.price.now")} </span>
        </>
      )}
      <span className="whitespace-nowrap font-medium">{formatMoney(price)}</span>
    </p>
  );
}

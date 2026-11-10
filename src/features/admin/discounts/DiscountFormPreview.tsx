import { t } from "@/i18n";
import { describeParts, describeWindow, type Describable, type DiscountNames } from "./describe";

interface DiscountPreviewProps {
  /** El descuento tal como quedaría, o null si todavía falta algo para poder describirlo. */
  discount: Describable | null;
  names: DiscountNames;
}

/** Vista previa en lenguaje claro: se actualiza al escribir y dice lo mismo que el listado dirá después. */
export function DiscountPreview({ discount, names }: DiscountPreviewProps) {
  const parts = discount ? describeParts(discount, names) : null;
  return (
    <section
      aria-labelledby="discount-preview-title"
      className="rounded-lg border border-primary/30 bg-muted/60 p-3 text-sm"
    >
      <h3 id="discount-preview-title" className="text-xs font-semibold uppercase tracking-wide">
        {t("admin.discounts.wizard.preview.title")}
      </h3>
      {discount && parts ? (
        <div className="mt-1 space-y-1">
          <p className="break-words font-medium">{parts.effect}</p>
          {parts.details.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {parts.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
          {discount.kind !== "flash" && (
            <p className="text-muted-foreground">{describeWindow(discount)}</p>
          )}
        </div>
      ) : (
        <p className="mt-1 text-muted-foreground">{t("admin.discounts.wizard.preview.empty")}</p>
      )}
    </section>
  );
}

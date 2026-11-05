import { t } from "@/i18n";

/** Texto secundario del aviso de fusión: cuántas líneas se ajustaron u omitieron (nada si todo se juntó sin cambios). */
export function mergeDescription(adjusted: number, skipped: number): string | undefined {
  const parts = [
    adjusted === 1
      ? t("cart.merge.adjustedOne")
      : adjusted > 1
        ? t("cart.merge.adjustedMany", { n: adjusted })
        : null,
    skipped === 1
      ? t("cart.merge.skippedOne")
      : skipped > 1
        ? t("cart.merge.skippedMany", { n: skipped })
        : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

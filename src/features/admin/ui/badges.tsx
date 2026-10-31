import type { StockLight } from "@/features/catalog/types";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import type { DisplayState } from "../products/types";

const LIGHT_TONE = { ok: "success", low: "warning", critical: "danger", out: "danger" } as const;

/** Semáforo de stock: color Y texto (el color solo no basta para quien no lo distingue). */
export function StockLightBadge({ light }: { light: StockLight | null }) {
  if (!light) return <span className="text-muted-foreground">{t("admin.none")}</span>;
  return <Badge tone={LIGHT_TONE[light]}>{t(`admin.light.${light}`)}</Badge>;
}

const STATE_TONE = {
  active: "success",
  draft: "neutral",
  soldout: "danger",
  hidden: "warning",
  archived: "neutral",
} as const;

/** Estado del producto tal como lo calcula la base (mismas reglas que la tienda). */
export function ProductStateBadge({ state }: { state: DisplayState }) {
  return <Badge tone={STATE_TONE[state]}>{t(`admin.products.list.statusBadge.${state}`)}</Badge>;
}

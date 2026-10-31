import { t } from "@/i18n";
import { formatDateTime } from "@/lib/datetime";
import type { AdminCollection } from "./types";

/** Vigencia legible en hora de La Paz: "Siempre", "Desde …", "Hasta …" o "… → …". */
export function windowText(c: Pick<AdminCollection, "startsAt" | "endsAt">): string {
  const start = c.startsAt ? formatDateTime(c.startsAt) : null;
  const end = c.endsAt ? formatDateTime(c.endsAt) : null;
  if (start && end) return t("admin.taxonomy.collections.windowBetween", { start, end });
  if (start) return t("admin.taxonomy.collections.windowFrom", { start });
  if (end) return t("admin.taxonomy.collections.windowUntil", { end });
  return t("admin.taxonomy.collections.windowAlways");
}

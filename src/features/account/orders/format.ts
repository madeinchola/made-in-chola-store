import { formatDateTime } from "@/lib/datetime";
import { formatMoney, type Money } from "@/lib/money";
import { t } from "@/i18n";

const NONE = t("acct.profile.personal.none");

/** Total para mostrar. Una moneda no soportada o un monto fuera de rango NO rompen la pantalla: se muestra «—». */
export function displayMoney(money: Money): string {
  try {
    return formatMoney(money);
  } catch {
    return NONE;
  }
}

/** Fecha (día, en hora de La Paz) para mostrar. Una fecha inválida NO rompe la pantalla: se muestra «—». */
export function displayDate(iso: string): string {
  try {
    return formatDateTime(iso, { dateStyle: "medium", timeStyle: undefined });
  } catch {
    return NONE;
  }
}

import { t } from "@/i18n";
import { formatMoney, fromDecimal, toDecimalString } from "@/lib/money";
import { toCsv } from "./csv";
import { formatLaPaz, laPazStamp } from "./CouponsLogic";
import type { Redemption, RedemptionStatus } from "./types";

/** Lógica PURA del reporte de redenciones: filtros, orden, totales exactos, textos y CSV. Sin React ni red. */

/** Tope de la consulta de redenciones (las últimas): si llegan tantas, puede haber más antiguas que no se leyeron. */
export const REDEMPTIONS_LIMIT = 1000;

export type StatusFilter = "all" | RedemptionStatus;
export type SortDirection = "asc" | "desc";

export function filterByStatus(rows: readonly Redemption[], status: StatusFilter): Redemption[] {
  return status === "all" ? [...rows] : rows.filter((r) => r.status === status);
}

const instant = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
};

/** Por fecha (descendente por defecto: lo más nuevo arriba); a igual fecha, por id para que el orden sea estable. */
export function sortByDate(
  rows: readonly Redemption[],
  direction: SortDirection = "desc",
): Redemption[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort(
    (a, b) => sign * (instant(a.createdAt) - instant(b.createdAt)) || a.id.localeCompare(b.id),
  );
}

// ── Dinero exacto ──────────────────────────────────────────────────────────────────────────
// La base guarda `numeric(14,4)`. Se suma en enteros de 1/10 000 (BigInt) para que 0,1 + 0,2 sea exactamente 0,3.
const SCALE = 10_000;
const toUnits = (amount: number): bigint => BigInt(Math.round(amount * SCALE));

function unitsToDecimal(units: bigint): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(5, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

/** «Bs 15,50»; una moneda desconocida no rompe la pantalla («XYZ 15.5»). */
export function formatAmountUnits(units: bigint, currency: string): string {
  try {
    return formatMoney(fromDecimal(unitsToDecimal(units), currency));
  } catch {
    return `${currency} ${unitsToDecimal(units).replace(/\.?0+$/, "")}`;
  }
}

export const formatAmount = (amount: number, currency: string): string =>
  formatAmountUnits(toUnits(amount), currency);

/** «15.50» (punto decimal, sin símbolo ni separador de miles) para el CSV. */
function plainAmount(amount: number, currency: string): string {
  try {
    return toDecimalString(fromDecimal(unitsToDecimal(toUnits(amount)), currency));
  } catch {
    return unitsToDecimal(toUnits(amount)).replace(/\.?0+$/, "");
  }
}

export interface Totals {
  /** Filas mostradas (todos los estados). */
  records: number;
  /** Usos vigentes: reservados o aplicados (los devueltos no cuentan). */
  active: number;
  /** Suma descontada por moneda, SIN los devueltos; ordenada por código de moneda. */
  amounts: { currency: string; units: bigint; text: string }[];
}

export function redemptionTotals(rows: readonly Redemption[]): Totals {
  const sums = new Map<string, bigint>();
  let active = 0;
  for (const r of rows) {
    sums.set(r.currency, sums.get(r.currency) ?? 0n);
    if (r.status === "reverted") continue;
    active += 1;
    sums.set(r.currency, (sums.get(r.currency) ?? 0n) + toUnits(r.amount));
  }
  return {
    records: rows.length,
    active,
    amounts: [...sums.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, units]) => ({ currency, units, text: formatAmountUnits(units, currency) })),
  };
}

// ── Textos ─────────────────────────────────────────────────────────────────────────────────
export const shortId = (id: string): string => id.slice(0, 8);

export function ownerText(r: Pick<Redemption, "ownerType" | "ownerId">): string {
  return t(`admin.discounts.redemptions.cells.owner.${r.ownerType}`, { id: shortId(r.ownerId) });
}

export const dateText = (iso: string): string => formatLaPaz(iso);

/** Nombre mostrado de la clienta: su nombre; sin nombre, «Sin nombre» (tiene cuenta) o «Sin cuenta (invitada)». */
export function customerName(r: Pick<Redemption, "customerName" | "profileId">): string {
  if (r.customerName !== null && r.customerName.trim() !== "") return r.customerName;
  return t(
    r.profileId === null
      ? "admin.discounts.redemptions.cells.guest"
      : "admin.discounts.redemptions.cells.noName",
  );
}

// ── CSV ────────────────────────────────────────────────────────────────────────────────────
/** Lo filtrado, en el orden en que se ve: una fila por redención, fecha en hora de La Paz y monto con punto decimal. */
export function redemptionsCsv(rows: readonly Redemption[]): string {
  const H = "admin.discounts.redemptions.export.headers" as const;
  const O = "admin.discounts.redemptions.export.ownerType" as const;
  return toCsv([
    [
      t(`${H}.date`),
      t(`${H}.discount`),
      t(`${H}.code`),
      t(`${H}.customer`),
      t(`${H}.email`),
      t(`${H}.ownerType`),
      t(`${H}.ownerId`),
      t(`${H}.amount`),
      t(`${H}.currency`),
      t(`${H}.status`),
    ],
    ...rows.map((r) => [
      laPazStamp(r.createdAt),
      r.discountName ?? "",
      r.couponCode ?? "",
      r.customerName ?? "",
      r.customerEmail ?? "",
      t(`${O}.${r.ownerType}`),
      r.ownerId,
      plainAmount(r.amount, r.currency),
      r.currency,
      t(`admin.discounts.redemptions.status.${r.status}`),
    ]),
  ]);
}

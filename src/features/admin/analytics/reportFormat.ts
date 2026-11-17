import { getCurrency } from "@/lib/currencies";
import { toLaPazInputValue } from "@/lib/datetime";
import { channelLabel, formatAmount, formatInt, formatPercent, paymentMethodLabel } from "./logic";
import {
  discountKindLabel,
  paymentStatusLabel,
  productStatusLabel,
  providerLabel,
  refundMethodLabel,
  refundStatusLabel,
  saleStatusLabel,
  stockLightLabel,
} from "./labels";
import type { ColumnKind, ReportValue } from "./reportTypes";

/** Cómo se escriben los números en el archivo: «Excel en español» (coma decimal) o estándar (punto decimal). */
export type CsvNumberFormat = "excel" | "standard";

const WORDS: Record<string, (v: string) => string> = {
  saleStatus: saleStatusLabel,
  paymentStatus: paymentStatusLabel,
  refundStatus: refundStatusLabel,
  stockLight: stockLightLabel,
  productStatus: productStatusLabel,
  discountKind: discountKindLabel,
  refundMethod: refundMethodLabel,
  provider: providerLabel,
  paymentMethod: paymentMethodLabel,
  channel: channelLabel,
};

const SEGMENT: Record<string, string> = { new: "Nueva", recurring: "Recurrente" };
const RETURN_KIND: Record<string, string> = { refund: "Reembolso", return: "Devolución" };

/** Fecha y hora de La Paz, «2020-03-05 18:00» (la base guarda todo en UTC). */
function dateTime(iso: string): string {
  const value = toLaPazInputValue(iso);
  return value === "" ? iso : value.replace("T", " ");
}

function words(kind: ColumnKind, value: string): string | null {
  const fn = WORDS[kind];
  if (fn) return fn(value);
  if (kind === "segment") return SEGMENT[value] ?? value;
  if (kind === "returnKind") return RETURN_KIND[value] ?? value;
  return null;
}

/** Lo que se ve en la tabla. Lo desconocido (`null`) es «—», nunca un cero. */
export function displayValue(kind: ColumnKind, value: ReportValue, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (kind) {
    case "int":
      return formatInt(Number(value));
    case "money":
      return formatAmount(Number(value), currency);
    case "percent":
      return formatPercent(Number(value));
    case "datetime":
      return dateTime(String(value));
    case "date":
      return dateTime(String(value)).slice(0, 10);
    case "yesNo":
      return value === true ? "Sí" : "No";
    default:
      return words(kind, String(value)) ?? String(value);
  }
}

/**
 * Lo que va al archivo: números sin símbolo ni separador de miles (las hojas de cálculo los reconocen como números), con la coma o
 * el punto decimal elegido; las palabras en español; lo desconocido, vacío (una celda vacía no es un cero).
 */
export function csvValue(
  kind: ColumnKind,
  value: ReportValue,
  currency: string,
  format: CsvNumberFormat,
): string {
  if (value === null || value === undefined || value === "") return "";
  const sep = (s: string) => (format === "excel" ? s.replace(".", ",") : s);
  switch (kind) {
    case "int":
      return String(Math.trunc(Number(value)));
    case "money": {
      const decimals = getCurrency(currency).decimals;
      return sep(Number(value).toFixed(decimals));
    }
    case "percent":
      return sep(Number(value).toFixed(1));
    case "datetime":
      return dateTime(String(value));
    case "date":
      return dateTime(String(value)).slice(0, 10);
    case "yesNo":
      return value === true ? "Sí" : "No";
    default:
      return words(kind, String(value)) ?? String(value);
  }
}

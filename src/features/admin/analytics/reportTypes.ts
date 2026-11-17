import type { adminAnalytics } from "@/i18n/admin/analytics";

/** Encabezados que existen en los textos (`admin.analytics.reports.cols.*`): una columna nueva sin texto no compila. */
export type ColHeader = keyof typeof adminAnalytics.reports.cols;

/** Un renglón de reporte, ya normalizado: números como números, fechas como texto ISO, lo desconocido como `null`. */
export type ReportValue = string | number | boolean | null;
export type ReportRow = Record<string, ReportValue>;

/** Cómo se muestra (y se escribe en el CSV) cada columna. */
export type ColumnKind =
  | "text"
  | "int"
  | "money"
  | "percent"
  | "datetime"
  | "date"
  | "saleStatus"
  | "paymentStatus"
  | "refundStatus"
  | "stockLight"
  | "productStatus"
  | "discountKind"
  | "refundMethod"
  | "provider"
  | "paymentMethod"
  | "channel"
  | "yesNo"
  | "segment"
  | "returnKind";

export interface ReportColumn {
  /** Nombre del campo del renglón y, a la vez, clave de su encabezado en los textos. */
  key: ColHeader;
  header: ColHeader;
  kind: ColumnKind;
  /** Columna con la moneda de ESE renglón; si no hay, la del reporte. */
  currencyKey?: string;
  align?: "right";
}

export type ReportId =
  "ventas" | "productos" | "inventario" | "descuentos" | "pagos" | "devoluciones" | "clientas";

export interface ReportPageArgs {
  from: string;
  to: string;
  currency: string | null;
  offset: number;
  limit: number;
}

export interface ReportPageResult {
  rows: ReportRow[];
  total: number;
  /** Solo la clienta nueva/recurrente trae un resumen en la cabecera. */
  summary?: Record<string, number>;
}

export interface ReportDef {
  id: ReportId;
  path: string;
  tabKey: string;
  aboutKey: string;
  usesRange: boolean;
  usesCurrency: boolean;
  fileBase: string;
  columns: readonly ReportColumn[];
  /** Clave estable de un renglón (para React). */
  rowKey: (row: ReportRow, index: number) => string;
}

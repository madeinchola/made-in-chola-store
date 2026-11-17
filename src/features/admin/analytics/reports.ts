import type { ColHeader, ReportColumn, ReportDef, ReportId } from "./reportTypes";

const col = (
  key: ColHeader,
  kind: ReportColumn["kind"],
  extra: Partial<ReportColumn> = {},
): ReportColumn => ({ key, header: key, kind, ...extra });

const money = (key: ColHeader, currencyKey?: string): ReportColumn =>
  col(key, "money", { align: "right", ...(currencyKey ? { currencyKey } : {}) });
const int = (key: ColHeader): ReportColumn => col(key, "int", { align: "right" });

const keyOf = (row: Record<string, unknown>, index: number): string =>
  typeof row.id === "string" && row.id !== "" ? row.id : String(index);

/** Los reportes: qué columnas tiene cada uno y qué filtros usa. Las consultas y su paginación son del servidor. */
export const REPORTS: readonly ReportDef[] = [
  {
    id: "ventas",
    path: "/admin/reportes",
    tabKey: "sales",
    aboutKey: "sales",
    usesRange: true,
    usesCurrency: true,
    fileBase: "reporte-ventas",
    rowKey: keyOf,
    columns: [
      col("number", "text"),
      col("soldAt", "datetime"),
      col("status", "saleStatus"),
      col("payment", "paymentMethod"),
      col("channel", "channel"),
      col("customer", "text"),
      int("units"),
      money("gross"),
      money("discount"),
      money("shipping"),
      money("refunded"),
      money("net"),
      money("margin"),
    ],
  },
  {
    id: "productos",
    path: "/admin/reportes/productos",
    tabKey: "products",
    aboutKey: "products",
    usesRange: true,
    usesCurrency: true,
    fileBase: "reporte-productos",
    rowKey: keyOf,
    columns: [
      col("product", "text"),
      col("code", "text"),
      int("units"),
      int("orders"),
      money("revenue"),
      money("margin"),
      col("marginPct", "percent", { align: "right" }),
    ],
  },
  {
    id: "inventario",
    path: "/admin/reportes/inventario",
    tabKey: "inventory",
    aboutKey: "inventory",
    usesRange: false,
    usesCurrency: false,
    fileBase: "reporte-inventario",
    rowKey: keyOf,
    columns: [
      col("product", "text"),
      col("code", "text"),
      col("sku", "text"),
      col("color", "text"),
      col("size", "text"),
      col("productStatus", "productStatus"),
      int("onHand"),
      int("reserved"),
      int("available"),
      col("light", "stockLight"),
      money("cost"),
      money("value"),
    ],
  },
  {
    id: "descuentos",
    path: "/admin/reportes/descuentos",
    tabKey: "discounts",
    aboutKey: "discounts",
    usesRange: true,
    usesCurrency: false,
    fileBase: "reporte-descuentos",
    rowKey: keyOf,
    columns: [
      col("discountName", "text"),
      col("kind", "discountKind"),
      col("coupon", "yesNo"),
      int("usesApplied"),
      int("usesReserved"),
      int("customers"),
      money("amountApplied", "currency"),
    ],
  },
  {
    id: "pagos",
    path: "/admin/reportes/pagos",
    tabKey: "payments",
    aboutKey: "payments",
    usesRange: true,
    usesCurrency: false,
    fileBase: "reporte-pagos",
    rowKey: keyOf,
    columns: [
      col("createdAt", "datetime"),
      col("orderNumber", "text"),
      col("provider", "provider"),
      col("method", "paymentMethod"),
      col("status", "paymentStatus"),
      money("amount", "currency"),
      money("received", "currency"),
      col("paidAt", "datetime"),
    ],
  },
  {
    id: "devoluciones",
    path: "/admin/reportes/devoluciones",
    tabKey: "returns",
    aboutKey: "returns",
    usesRange: true,
    usesCurrency: false,
    fileBase: "reporte-devoluciones",
    rowKey: (row, index) =>
      `${String(row.kind)}:${String(row.orderNumber)}:${String(row.createdAt)}:${index}`,
    columns: [
      col("createdAt", "datetime"),
      col("kind", "returnKind"),
      col("orderNumber", "text"),
      col("status", "refundStatus"),
      money("amount", "currency"),
      money("shippingAmount", "currency"),
      money("deduction", "currency"),
      col("method", "refundMethod"),
      col("reason", "text"),
    ],
  },
  {
    id: "clientas",
    path: "/admin/reportes/clientas",
    tabKey: "customers",
    aboutKey: "customers",
    usesRange: true,
    usesCurrency: true,
    fileBase: "reporte-clientas",
    rowKey: keyOf,
    columns: [
      col("name", "text"),
      col("email", "text"),
      int("orders"),
      money("net"),
      col("firstSale", "date"),
      col("segment", "segment"),
    ],
  },
];

export function reportById(id: ReportId): ReportDef {
  const found = REPORTS.find((r) => r.id === id);
  if (!found) throw new RangeError(`Reporte desconocido: ${id}`);
  return found;
}

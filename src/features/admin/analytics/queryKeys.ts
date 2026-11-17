import { adminKeys } from "../queryKeys";
import type { ReportId, ReportPageArgs } from "./reportTypes";
import type { BreakdownDimension, DateRange, Granularity } from "./types";

/** Claves de caché de las métricas. Cuelgan de ["admin", "analytics"]. */
export const analyticsKeys = {
  all: [...adminKeys.all, "analytics"] as const,
  summary: (range: DateRange, granularity: Granularity) =>
    [...analyticsKeys.all, "summary", range, granularity] as const,
  top: (range: DateRange, currency: string | null, by: string, dir: string, limit: number) =>
    [...analyticsKeys.all, "top", range, currency, by, dir, limit] as const,
  breakdown: (range: DateRange, dimension: BreakdownDimension, currency: string | null) =>
    [...analyticsKeys.all, "breakdown", range, dimension, currency] as const,
  paymentMix: (range: DateRange) => [...analyticsKeys.all, "payment-mix", range] as const,
  funnel: (range: DateRange) => [...analyticsKeys.all, "funnel", range] as const,
  report: (id: ReportId, args: ReportPageArgs) =>
    [...analyticsKeys.all, "report", id, args] as const,
  inventory: () => [...analyticsKeys.all, "inventory"] as const,
  slow: (days: number) => [...analyticsKeys.all, "slow", days] as const,
  coverage: (days: number) => [...analyticsKeys.all, "coverage", days] as const,
};

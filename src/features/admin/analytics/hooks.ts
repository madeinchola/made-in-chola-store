import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchBreakdown,
  fetchCoverage,
  fetchFunnel,
  fetchInventorySummary,
  fetchPaymentMix,
  fetchSalesSummary,
  fetchSlowMovers,
  fetchTopProducts,
} from "./api";
import { analyticsKeys } from "./queryKeys";
import { fetchReportPage } from "./reportsApi";
import type { ReportId, ReportPageArgs } from "./reportTypes";
import type { BreakdownDimension, DateRange, Granularity } from "./types";

// Las cifras cambian con cada venta: se leen frescas al volver a la pestaña, y al cambiar de período se queda la pantalla anterior
// (sin parpadeo) hasta que llegue la nueva.
const live = {
  staleTime: 30_000,
  refetchOnWindowFocus: true,
  placeholderData: keepPreviousData,
} as const;

export const useSalesSummary = (range: DateRange, granularity: Granularity, enabled = true) =>
  useQuery({
    queryKey: analyticsKeys.summary(range, granularity),
    queryFn: () => fetchSalesSummary(range, granularity),
    enabled,
    ...live,
  });

export const useTopProducts = (
  range: DateRange,
  currency: string | null,
  by: "units" | "revenue",
  dir: "asc" | "desc",
  limit: number,
  enabled = true,
) =>
  useQuery({
    queryKey: analyticsKeys.top(range, currency, by, dir, limit),
    queryFn: () => fetchTopProducts(range, currency, by, dir, limit),
    enabled,
    ...live,
  });

export const useBreakdown = (
  range: DateRange,
  dimension: BreakdownDimension,
  currency: string | null,
  enabled = true,
) =>
  useQuery({
    queryKey: analyticsKeys.breakdown(range, dimension, currency),
    queryFn: () => fetchBreakdown(range, dimension, currency, 50),
    enabled,
    ...live,
  });

export const usePaymentMix = (range: DateRange, enabled = true) =>
  useQuery({
    queryKey: analyticsKeys.paymentMix(range),
    queryFn: () => fetchPaymentMix(range),
    enabled,
    ...live,
  });

export const useFunnel = (range: DateRange, enabled = true) =>
  useQuery({
    queryKey: analyticsKeys.funnel(range),
    queryFn: () => fetchFunnel(range),
    enabled,
    ...live,
  });

export const useInventorySummary = () =>
  useQuery({
    queryKey: analyticsKeys.inventory(),
    queryFn: fetchInventorySummary,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

export const useSlowMovers = (days: number, enabled = true) =>
  useQuery({
    queryKey: analyticsKeys.slow(days),
    queryFn: () => fetchSlowMovers(days, 100),
    enabled,
    staleTime: 60_000,
  });

export const useCoverage = (days: number, enabled = true) =>
  useQuery({
    queryKey: analyticsKeys.coverage(days),
    queryFn: () => fetchCoverage(days, 100),
    enabled,
    staleTime: 60_000,
  });

export const useReport = (id: ReportId, args: ReportPageArgs, enabled = true) =>
  useQuery({
    queryKey: analyticsKeys.report(id, args),
    queryFn: () => fetchReportPage(id, args),
    enabled,
    ...live,
  });

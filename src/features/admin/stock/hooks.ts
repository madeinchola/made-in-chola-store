import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "../queryKeys";
import { getStockAlertSummary, listStockAlertVariants } from "./api";

/** La campana se refresca sola cada minuto: una venta puede vaciar una variante mientras el admin trabaja. */
export const useStockAlertSummary = () =>
  useQuery({
    queryKey: adminKeys.stockSummary(),
    queryFn: getStockAlertSummary,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

export const useStockAlertVariants = (limit = 8) =>
  useQuery({
    queryKey: [...adminKeys.stockAlerts(), limit],
    queryFn: () => listStockAlertVariants(limit),
    staleTime: 30_000,
  });

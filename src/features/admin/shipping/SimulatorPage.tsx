import { useMemo } from "react";
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { useLocations, useMethods } from "./hooks";
import { SimulatorForm } from "./SimulatorForm";

/** «Simulador»: prueba lo que verá una clienta (costo, distancia, desglose y franjas) con el cálculo REAL del servidor. */
export function ShippingSimulatorPage() {
  const methods = useMethods();
  const locations = useLocations();

  const activeMethods = useMemo(
    () => (methods.data ?? []).filter((m) => m.isActive && !m.archived),
    [methods.data],
  );
  const origin = useMemo(
    () => (locations.data ?? []).find((l) => l.isPrimary && l.isActive && !l.archived) ?? null,
    [locations.data],
  );

  if (methods.isError || locations.isError) {
    return (
      <ErrorState
        onRetry={() => {
          if (methods.isError) void methods.refetch();
          if (locations.isError) void locations.refetch();
        }}
      />
    );
  }
  if (methods.isPending || locations.isPending) return <LoadingState />;
  if (activeMethods.length === 0) {
    return (
      <EmptyState
        action={
          <Link
            to="/admin/envios"
            className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            {t("admin.shipping.delivery.simulator.goToMethods")}
          </Link>
        }
      >
        {t("admin.shipping.delivery.simulator.empty")}
      </EmptyState>
    );
  }
  return <SimulatorForm methods={activeMethods} origin={origin} />;
}

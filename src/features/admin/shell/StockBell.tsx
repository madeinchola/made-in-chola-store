import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { useStockAlertSummary } from "../stock/hooks";

/** Campana del encabezado: cuántos productos publicados necesitan reposición; lleva al listado ya filtrado. */
export function StockBell() {
  const { data } = useStockAlertSummary();
  const total = data?.total ?? 0;
  const label = total > 0 ? t("admin.bell.count", { count: total }) : t("admin.bell.none");
  return (
    <Link
      to="/admin/productos?estado=publicados&stock=alert"
      aria-label={`${t("admin.bell.label")}: ${label}`}
      title={label}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-muted"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {total > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-destructive-foreground"
        >
          {total > 99 ? "99+" : total}
        </span>
      )}
    </Link>
  );
}

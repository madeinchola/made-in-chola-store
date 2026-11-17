import { NavLink, Outlet } from "react-router-dom";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { PageHeader } from "../ui/PageHeader";
import { REPORTS } from "./reports";

/** Marco de Reportes: un único <h1> y cada reporte como una ruta (con su filtro en la dirección). */
export function ReportsLayout() {
  return (
    <>
      <PageHeader
        title={t("admin.analytics.reports.title")}
        description={t("admin.analytics.reports.description")}
      />
      <nav
        aria-label={t("admin.analytics.reports.tabs.label")}
        className="mb-6 border-b border-border"
      >
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {REPORTS.map((r) => (
            <li key={r.id} className="shrink-0">
              <NavLink
                to={r.path}
                end={r.id === "ventas"}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-medium transition-colors",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {t(`admin.analytics.reports.tabs.${r.tabKey as "sales"}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}

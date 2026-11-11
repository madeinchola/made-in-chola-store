import { NavLink, Outlet } from "react-router-dom";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { PageHeader } from "../ui/PageHeader";
import { PAYMENTS_TABS } from "./tabs";

/** Marco del panel de Pagos: un único <h1> y las secciones como enlaces (cada una tiene su dirección). */
export function PaymentsLayout() {
  return (
    <>
      <PageHeader title={t("admin.payments.title")} description={t("admin.payments.description")} />
      <nav aria-label={t("admin.payments.tabs.label")} className="mb-6 border-b border-border">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {PAYMENTS_TABS.map(({ to, label, end }) => (
            <li key={to} className="shrink-0">
              <NavLink
                to={to}
                end={end ?? false}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-medium transition-colors",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {t(label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}

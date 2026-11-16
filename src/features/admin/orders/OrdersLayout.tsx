import { Plus } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import { PageHeader } from "../ui/PageHeader";
import { useAttentionSummary } from "./hooks";
import { ORDERS_TABS } from "./tabs";

/** Marco del panel de Pedidos: un único <h1>, las secciones como enlaces y el aviso de lo que pide atención. */
export function OrdersLayout() {
  const summary = useAttentionSummary();
  const pending = summary.data?.orders ?? 0;
  return (
    <>
      <PageHeader
        title={t("admin.orders.title")}
        description={t("admin.orders.description")}
        actions={
          <Link to="/admin/pedidos/nuevo" className={cn(buttonVariants(), "min-h-11 gap-2")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("admin.orders.newOrder")}
          </Link>
        }
      />
      <nav aria-label={t("admin.orders.tabs.label")} className="mb-6 border-b border-border">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {ORDERS_TABS.map(({ to, label, end }) => (
            <li key={to} className="shrink-0">
              <NavLink
                to={to}
                end={end ?? false}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {t(label)}
                {to === "/admin/pedidos/atencion" && pending > 0 && (
                  <span
                    className="rounded-pill bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground"
                    aria-label={t("admin.orders.attentionBadge", { count: pending })}
                  >
                    {pending > 99 ? "99+" : pending}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}

import { AlertTriangle } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { PageHeader } from "../ui/PageHeader";
import { useNotificationCounts, useNotificationHealth } from "./hooks";
import { healthProblems } from "./logic";
import { NOTIFICATIONS_TABS } from "./tabs";

const L = "admin.notifications.health" as const;

/** Marco del panel de Notificaciones: un único <h1>, las secciones como enlaces y el aviso de lo que impide enviar. */
export function NotificationsLayout() {
  const health = useNotificationHealth();
  const counts = useNotificationCounts();
  const problems = health.data ? healthProblems(health.data) : [];
  const attention =
    (counts.data?.dead ?? 0) + (counts.data?.failed ?? 0) + (counts.data?.manual ?? 0);
  return (
    <>
      <PageHeader
        title={t("admin.notifications.title")}
        description={t("admin.notifications.description")}
      />
      {problems.length > 0 && (
        <div
          role="status"
          className="mb-6 flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{t(`${L}.title`)}</p>
            <ul className="list-disc space-y-1 pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <p>
              <Link to="/admin/notificaciones/envio" className="underline underline-offset-2">
                {t(`${L}.fix`)}
              </Link>
            </p>
          </div>
        </div>
      )}
      <nav aria-label={t("admin.notifications.tabs.label")} className="mb-6 border-b border-border">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {NOTIFICATIONS_TABS.map(({ to, label, end }) => (
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
                {to === "/admin/notificaciones" && attention > 0 && (
                  <span
                    className="rounded-pill bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground"
                    aria-label={t("admin.notifications.attentionBadge", { count: attention })}
                  >
                    {attention > 99 ? "99+" : attention}
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

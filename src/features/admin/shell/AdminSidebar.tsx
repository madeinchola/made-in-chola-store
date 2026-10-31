import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import { t } from "@/i18n";
import { ADMIN_NAV } from "./nav";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Cierra el cajón en pantallas pequeñas al elegir una opción. */
  onNavigate?: () => void;
}

/** Navegación lateral. Contraída muestra solo iconos, pero cada enlace conserva su nombre accesible. */
export function AdminSidebar({ collapsed, onToggleCollapsed, onNavigate }: AdminSidebarProps) {
  return (
    <nav aria-label={t("admin.nav.main")} className="flex h-full flex-col gap-1 p-2">
      <ul className="flex flex-col gap-1">
        {ADMIN_NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end ?? false}
              onClick={onNavigate}
              title={collapsed ? t(label) : undefined}
              className={({ isActive }) =>
                cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium hover:bg-muted",
                  isActive && "bg-primary text-primary-foreground hover:bg-primary/90",
                  collapsed && "md:justify-center md:px-0",
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className={cn(collapsed && "md:sr-only")}>{t(label)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? t("admin.nav.expand") : t("admin.nav.collapse")}
        aria-pressed={collapsed}
        className="mt-auto hidden h-10 items-center justify-center gap-2 rounded-md text-sm text-muted-foreground hover:bg-muted md:flex"
      >
        {collapsed ? (
          <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
        ) : (
          <>
            <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
            <span>{t("admin.nav.collapse")}</span>
          </>
        )}
      </button>
    </nav>
  );
}

import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/useAuth";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { accountRoutes, type AccountSection } from "./accountRoutes";

const SECTIONS: AccountSection[] = ["profile", "addresses", "tax", "orders", "security"];

/**
 * Marco de «Mi cuenta»: título, saludo y navegación entre secciones (lista horizontal desplazable en móvil, columna
 * lateral en escritorio). El contenido de cada sección entra por `<Outlet />`. PROVISIONAL en estilo: no hay diseño de
 * cuenta en los PDF; usa tokens y tipografía del sistema de UI.
 */
export function AccountLayout() {
  const { profile } = useAuth();
  return (
    <div className="container py-8 lg:py-12">
      <header className="mb-6 space-y-1 lg:mb-10">
        <h1 className="font-display text-display-lg">{t("acct.layout.title")}</h1>
        {profile?.full_name && (
          <p className="text-muted-foreground">
            {t("acct.layout.greeting", { name: profile.full_name })}
          </p>
        )}
      </header>
      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label={t("acct.layout.nav.label")} className="-mx-1 overflow-x-auto lg:mx-0">
          <ul className="flex gap-1 p-1 lg:flex-col lg:gap-0 lg:border-l lg:border-border lg:p-0">
            {SECTIONS.map((section) => (
              <li key={section} className="shrink-0">
                <NavLink
                  to={accountRoutes[section]}
                  end={section === "profile"}
                  className={({ isActive }) =>
                    cn(
                      "eyebrow block whitespace-nowrap px-3 py-2.5 transition-colors duration-fast ease-standard hover:text-foreground lg:-ml-px lg:border-l-2 lg:py-2",
                      isActive
                        ? "border-foreground text-foreground max-lg:underline max-lg:underline-offset-8"
                        : "border-transparent text-muted-foreground",
                    )
                  }
                >
                  {t(`acct.layout.nav.${section}` as MessageKey)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

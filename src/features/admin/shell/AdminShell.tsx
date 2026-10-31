import { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/useAuth";
import { AdminSidebar } from "./AdminSidebar";
import { Breadcrumbs } from "./Breadcrumbs";
import { pageTitleKey } from "./crumbs";
import { StockBell } from "./StockBell";

const COLLAPSED_KEY = "mic.admin.sidebarCollapsed";

// localStorage puede fallar (modo privado, datos bloqueados): la barra funciona igual, solo no recuerda el estado.
const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};
const writeCollapsed = (value: boolean) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
};

/**
 * Marco del panel: encabezado, navegación lateral (colapsable; en pantallas pequeñas es un cajón) y contenido.
 * La autorización NO está aquí: `RequireAdmin` envuelve toda la ruta /admin y la base aplica RLS en cada consulta.
 */
export function AdminShell() {
  const { profile, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  const mainRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);
  const originalTitle = useRef(document.title);

  // En una aplicación de una sola página, cambiar de ruta no recarga nada y los lectores de pantalla no se enteran. Al cambiar
  // de pantalla se cierra el cajón, se actualiza el título de la pestaña y el foco pasa al contenido (que se anuncia).
  // La primera carga no roba el foco: así el primer Tab sigue llegando al enlace "Saltar al contenido".
  useEffect(() => {
    setDrawerOpen(false);
    document.title = `${t(pageTitleKey(location.pathname))} · ${t("admin.title")} · ${t("app.name")}`;
    if (firstRoute.current) firstRoute.current = false;
    else mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  // Al salir del panel se devuelve el título que había. Se captura al renderizar (antes de que ningún efecto lo cambie).
  useEffect(
    () => () => {
      document.title = originalTitle.current;
    },
    [],
  );

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        {t("admin.skipToContent")}
      </a>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="md:hidden"
          aria-label={drawerOpen ? t("admin.nav.close") : t("admin.nav.open")}
          aria-expanded={drawerOpen}
          aria-controls="admin-sidebar"
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
        <Link to="/admin" className="font-display text-lg font-bold">
          {t("app.name")}
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <Link to="/" className="hidden text-sm hover:underline sm:inline">
            {t("admin.nav.storefront")}
          </Link>
          <StockBell />
          {profile && (
            <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground lg:inline">
              {t("admin.header.user", { name: profile.full_name })}
            </span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
            {t("admin.header.logout")}
          </Button>
        </div>
      </header>

      <div className="flex">
        <aside
          id="admin-sidebar"
          className={cn(
            "fixed inset-y-14 left-0 z-20 w-60 border-r bg-background transition-transform md:static md:inset-auto md:translate-x-0 md:transition-[width]",
            // Cerrado, el cajón se saca de la pantalla Y del árbol de accesibilidad y del orden de tabulación (`invisible`):
            // un cajón solo desplazado fuera de la pantalla seguiría siendo alcanzable con el teclado y por lectores de pantalla.
            drawerOpen ? "visible translate-x-0" : "invisible -translate-x-full md:visible",
            collapsed ? "md:w-16" : "md:w-60",
          )}
        >
          <AdminSidebar
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onNavigate={() => setDrawerOpen(false)}
          />
        </aside>
        <main
          ref={mainRef}
          id="admin-main"
          tabIndex={-1}
          className="min-w-0 flex-1 p-4 focus-visible:ring-0 focus-visible:ring-offset-0 sm:p-6"
        >
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

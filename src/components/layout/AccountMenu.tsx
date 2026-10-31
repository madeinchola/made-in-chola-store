import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { User } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { iconClass } from "./headerStyles";
import { storeRoutes } from "./storeRoutes";

const itemClass =
  "block w-full px-4 py-2.5 text-left text-sm transition-colors duration-fast hover:bg-muted";

/**
 * Cuenta de la cabecera: un solo icono de usuario como en el diseño.
 * - Sin sesión: enlace «Ingresar» (el registro está en esa pantalla y en el menú móvil).
 * - Con sesión: botón con el nombre de la persona que despliega «Mi cuenta», «Panel» (solo administradores) y
 *   «Cerrar sesión» (patrón *disclosure*: Esc cierra y devuelve el foco, un clic fuera o salir con Tab también).
 * Mientras la sesión carga no se pinta nada (sin parpadeo de «Ingresar» para quien ya tenía sesión).
 */
export function AccountMenu({ overlay = false }: { overlay?: boolean }) {
  const { status, profile, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const focusInside = rootRef.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (focusInside) buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (status === "anonymous") {
    return (
      <Link to={storeRoutes.login} aria-label={t("nav.login")} className={iconClass(overlay)}>
        <User className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      </Link>
    );
  }
  if (status !== "authenticated") return null;

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-testid="account-menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={profile?.full_name ?? t("nav.account")}
        title={profile?.full_name ?? t("nav.account")}
        onClick={() => setOpen((value) => !value)}
        className={cn(iconClass(overlay), "cursor-pointer")}
      >
        <User className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={t("layout.header.accountMenu")}
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-56 rounded-card border bg-popover py-2 text-popover-foreground shadow-md"
      >
        <p className="eyebrow truncate px-4 pb-2 text-muted-foreground">
          {profile?.full_name ?? t("nav.account")}
        </p>
        <Link to={storeRoutes.account} className={itemClass}>
          {t("nav.account")}
        </Link>
        {isAdmin && (
          <Link to={storeRoutes.admin} className={itemClass}>
            {t("nav.admin")}
          </Link>
        )}
        <button type="button" onClick={() => void signOut()} className={itemClass}>
          {t("nav.logout")}
        </button>
      </div>
    </div>
  );
}

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { useAuth } from "./useAuth";

function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="container py-16 text-center text-muted-foreground"
    >
      {t("guard.loading")}
    </div>
  );
}

/** Exige sesión. Visitante → /login (recordando a dónde iba). */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "anonymous") {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  return <Outlet />;
}

/**
 * Exige rol admin. Visitante → /login; cliente → inicio. Es solo UX: la autorización real la aplica
 * la base de datos (RLS / is_admin()) en cada consulta.
 */
export function RequireAdmin() {
  const { status, isAdmin } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "anonymous") {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

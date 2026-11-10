import { Navigate, Outlet, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { useAuth } from "./useAuth";

/**
 * Mientras se lee la sesión se reserva TODA la altura de la pantalla (igual que `lazyPage`): con un aviso corto el pie de
 * página quedaba a la vista y, al aparecer la pantalla real, bajaba de golpe (CLS ≈ 1 en /checkout y /cuenta al cargar).
 */
function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="container min-h-[100svh] py-16 text-center text-muted-foreground"
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

import { Link, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";

export function PublicLayout() {
  const { status, profile, isAdmin, signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link to="/" className="font-display text-xl font-bold text-primary">
            {t("app.name")}
          </Link>
          <nav
            aria-label="Principal"
            className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm"
          >
            <Link to="/" className="hover:underline">
              {t("nav.home")}
            </Link>
            {status === "authenticated" ? (
              <>
                {isAdmin && (
                  <Link to="/admin" className="hover:underline">
                    {t("nav.admin")}
                  </Link>
                )}
                <Link to="/cuenta" className="hover:underline" title={t("nav.account")}>
                  {profile?.full_name ?? t("nav.account")}
                </Link>
                <button type="button" onClick={() => void signOut()} className="hover:underline">
                  {t("nav.logout")}
                </button>
              </>
            ) : status === "anonymous" ? (
              <>
                <Link to="/login" className="hover:underline">
                  {t("nav.login")}
                </Link>
                <Link to="/registro" className="hover:underline">
                  {t("nav.register")}
                </Link>
              </>
            ) : null}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        {t("footer.rights", { year: new Date().getFullYear() })}
      </footer>
    </div>
  );
}

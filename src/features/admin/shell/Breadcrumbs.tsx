import { Link, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { crumbsFor } from "./crumbs";

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = crumbsFor(pathname);
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label={t("admin.breadcrumbs.label")} className="mb-4 text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link to="/admin" className="hover:underline">
            {t("admin.breadcrumbs.home")}
          </Link>
        </li>
        {crumbs.map((c, i) => (
          <li key={c.to} className="flex items-center gap-1.5">
            <span aria-hidden="true">/</span>
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="text-foreground">
                {t(c.key)}
              </span>
            ) : (
              <Link to={c.to} className="hover:underline">
                {t(c.key)}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

import { Link } from "react-router-dom";
import { t, type MessageKey } from "@/i18n";
import { useBusinessData } from "./useBusinessData";

const L = "admin.legal.business" as const;

export function BusinessDataNotice() {
  const { missing, loading } = useBusinessData();
  if (loading) return null;
  if (missing.length === 0) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t(`${L}.complete`)}
      </p>
    );
  }
  const list = missing.map((name) => t(`${L}.names.${name}` as MessageKey)).join(", ");
  return (
    <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
      <p className="font-medium">{t(`${L}.title`)}</p>
      <p className="mt-1">{t(`${L}.missing`, { list })}</p>
      <p className="mt-2">
        <Link to="/admin/ajustes" className="underline underline-offset-2">
          {t(`${L}.link`)}
        </Link>
      </p>
    </div>
  );
}

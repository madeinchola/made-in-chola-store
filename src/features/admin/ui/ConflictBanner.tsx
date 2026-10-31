import { t } from "@/i18n";
import { Button } from "@/components/ui/button";

/**
 * Aviso de edición concurrente: otra persona guardó antes. NO se guardó nada del usuario; recargar descarta sus
 * cambios locales y trae la versión actual.
 */
export function ConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-warning/50 bg-warning-soft p-4 text-sm text-warning"
    >
      <p className="font-semibold">{t("admin.conflict.title")}</p>
      <p className="mt-1">{t("admin.conflict.body")}</p>
      <Button type="button" size="sm" className="mt-3" onClick={onReload}>
        {t("admin.conflict.reload")}
      </Button>
    </div>
  );
}

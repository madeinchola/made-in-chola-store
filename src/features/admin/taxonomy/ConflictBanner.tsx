import { t } from "@/i18n";
import { Button } from "@/components/ui/button";

/** Aviso de edición concurrente: lo que se intentó guardar NO se aplicó; hay que ver la versión actual. */
export function ConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <div>
        <p className="font-medium">{t("admin.conflict.title")}</p>
        <p>{t("admin.conflict.body")}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        {t("admin.conflict.reload")}
      </Button>
    </div>
  );
}

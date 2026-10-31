import { t } from "@/i18n";

/** Pantalla de error inesperado: dice qué pasó sin detalles técnicos, da una referencia de soporte y permite recargar. */
export function ErrorScreen({ correlationId }: { correlationId: string }) {
  return (
    <div role="alert" className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold">{t("error.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("error.body")}</p>
        <p className="text-xs text-muted-foreground">
          {t("error.reference", { id: correlationId })}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          {t("error.reload")}
        </button>
      </div>
    </div>
  );
}

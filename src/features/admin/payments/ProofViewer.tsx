import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useSignedUrl } from "./hooks";

/**
 * El archivo de un comprobante, por una URL firmada de 5 minutos (el bucket es privado: no hay otra forma de verlo). Una imagen
 * se muestra en línea; un PDF, como enlace a una pestaña nueva (sin incrustarlo: el visor del navegador lo aísla).
 */
export function ProofViewer({ path, mime }: { path: string; mime: string }) {
  const query = useSignedUrl(path);
  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("admin.payments.proof.loading")}
      </p>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div role="alert" className="space-y-2 text-sm text-destructive">
        <p>{t("admin.payments.proof.openError")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t("admin.actions.retry")}
        </Button>
      </div>
    );
  }
  if (mime === "application/pdf") {
    return (
      <a
        href={query.data}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        {t("admin.payments.proof.pdfLink")}
      </a>
    );
  }
  return (
    <a href={query.data} target="_blank" rel="noopener noreferrer" className="block w-fit">
      <img
        src={query.data}
        alt={t("admin.payments.proof.imageAlt")}
        className="max-h-80 max-w-full rounded-md border border-border object-contain"
      />
      <span className="sr-only">{t("admin.payments.proof.open")}</span>
    </a>
  );
}

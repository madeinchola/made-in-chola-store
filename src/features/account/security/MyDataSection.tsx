import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { downloadMyData } from "./myData";

/**
 * «Descargar mis datos» (S15, BR-ACC-07): un archivo JSON con todo lo que la tienda guarda de quien lo pide. Lo arma la base con lo de
 * ESA cuenta y el navegador lo guarda: no queda en ningún servidor ni en ningún enlace.
 */
export function MyDataSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadMyData();
      toast.success(t("acct.security.myData.done"));
    } catch {
      setError(t("acct.security.myData.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="my-data-title" className="space-y-3">
      <h3 id="my-data-title" className="font-display text-xl">
        {t("acct.security.myData.title")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("acct.security.myData.intro")}</p>
      <p className="text-sm text-muted-foreground">{t("acct.security.myData.includes")}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? t("acct.security.myData.downloading") : t("acct.security.myData.download")}
      </Button>
    </section>
  );
}

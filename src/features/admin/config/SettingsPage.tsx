import { useState } from "react";
import { t } from "@/i18n";
import { PageHeader } from "../ui/PageHeader";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { BannersSection } from "./BannersSection";
import { useSettings } from "./hooks";
import { SettingsForm } from "./SettingsForm";

/** Ajustes de la tienda (datos, redes, textos de ficha, inventario) y banner de noticias. */
export function SettingsPage() {
  const settings = useSettings();
  // Al recargar tras un conflicto se vuelve a leer y se reinicia el formulario con la versión actual.
  const [formKey, setFormKey] = useState(0);

  const reload = async () => {
    await settings.refetch();
    setFormKey((k) => k + 1);
  };

  return (
    <>
      <PageHeader
        title={t("admin.config.settings.title")}
        description={t("admin.config.settings.description")}
      />
      <div className="space-y-6">
        {settings.isError ? (
          <ErrorState
            message={t("admin.config.settings.loadError")}
            onRetry={() => void settings.refetch()}
          />
        ) : settings.isPending ? (
          <LoadingState />
        ) : (
          <SettingsForm key={formKey} rows={settings.data} onReload={() => void reload()} />
        )}
        <BannersSection />
      </div>
    </>
  );
}

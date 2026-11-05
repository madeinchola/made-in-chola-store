import { Component, type ReactNode } from "react";
import { t } from "@/i18n";

/**
 * Red de seguridad del cajón: su contenido se descarga bajo demanda y, tras un despliegue (hash viejo) o con la red a
 * medias, esa descarga puede fallar. Sin esto el error subía hasta la ruta y sustituía TODO el sitio por la pantalla de
 * error. Aquí solo falla el cajón: se explica y se ofrece ir a la página de la bolsa o recargar.
 */
export class DrawerBoundary extends Component<
  { children: ReactNode; viewBag: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="space-y-3 px-6 py-8">
        <p className="font-display text-display-sm">{t("cart.drawer.errorTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("cart.drawer.errorDescription")}</p>
        <div className="flex flex-wrap gap-3 pt-2">
          {this.props.viewBag}
          <button
            type="button"
            className="min-h-11 rounded-md border border-border px-4 text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            {t("cart.drawer.reload")}
          </button>
        </div>
      </div>
    );
  }
}

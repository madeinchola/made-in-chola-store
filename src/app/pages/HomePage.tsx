import { t } from "@/i18n";

/**
 * Portada provisional (el contenido real llega en S5). Es un hero a pantalla completa bajo la cabecera transparente,
 * como en el diseño: la foto/video del hero se editará desde el panel; mientras tanto, un fondo liso de la marca.
 */
export function HomePage() {
  return (
    <section className="theme-inverse flex min-h-[min(100svh,57rem)] flex-col items-center justify-center gap-4 px-[var(--gutter)] pb-16 pt-header text-center">
      <p className="eyebrow text-muted-foreground">{t("home.eyebrow")}</p>
      <h1 className="font-display text-display-xl">{t("home.title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("home.subtitle")}</p>
    </section>
  );
}

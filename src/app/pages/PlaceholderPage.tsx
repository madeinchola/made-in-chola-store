import { t } from "@/i18n";

/** Ruta reservada (p. ej. /producto/:slug): existe para verificar el rewrite SPA; el contenido llega en S5. */
export function PlaceholderPage() {
  return (
    <section className="container py-16 text-center text-muted-foreground">
      {t("placeholder.soon")}
    </section>
  );
}

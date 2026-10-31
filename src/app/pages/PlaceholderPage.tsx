import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { t } from "@/i18n";

/** Pantalla reservada (nosotros, contacto, carrito, legales): el contenido llega con su sprint; mientras tanto no se indexa. */
export function PlaceholderPage() {
  usePageMeta({ title: t("app.name"), robots: "noindex,follow" });
  return (
    <section className="container py-16 text-center text-muted-foreground">
      {t("placeholder.soon")}
    </section>
  );
}

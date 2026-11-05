import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { t } from "@/i18n";

/**
 * Pantalla reservada (nosotros, contacto, legales, pago): el contenido llega con su sprint; mientras tanto no se indexa.
 * Con `title` lleva su `<h1>`; sin él (las que aún no tienen nombre) solo el aviso.
 */
export function PlaceholderPage({ title }: { title?: string } = {}) {
  usePageMeta({ title: title ?? t("app.name"), robots: "noindex,follow" });
  return (
    <section className="container py-16 text-center text-muted-foreground">
      {title && <h1 className="mb-3 font-display text-display-md text-foreground">{title}</h1>}
      {t("placeholder.soon")}
    </section>
  );
}

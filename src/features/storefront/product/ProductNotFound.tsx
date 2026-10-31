import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button-variants";
import { t } from "@/i18n";
import { usePageMeta } from "../seo/usePageMeta";
import { storeRoutesForProduct } from "./routes";

/**
 * 404 amable de la ficha: producto inexistente, oculto, en borrador o archivado (todos se ven igual: nada interno se
 * filtra). No se indexa. Si el administrador repone el producto, la misma URL vuelve a funcionar sola.
 */
export function ProductNotFound() {
  usePageMeta({ title: t("shop.product.notFound.title"), robots: "noindex,nofollow" });
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-[var(--gutter)] py-16 text-center">
      <h1 className="font-display text-display-md">{t("shop.product.notFound.title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("shop.product.notFound.body")}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Link
          to={storeRoutesForProduct.shop}
          className={buttonVariants({ variant: "outline", caps: true })}
        >
          {t("shop.product.notFound.shop")}
        </Link>
        <Link to={storeRoutesForProduct.home} className={buttonVariants({ variant: "ghost" })}>
          {t("shop.product.notFound.home")}
        </Link>
      </div>
    </section>
  );
}

import { Navigate, useLocation, useParams } from "react-router-dom";
import { ErrorState } from "@/components/store/ErrorState";
import { useStoreSettings } from "@/features/catalog/hooks";
import { t } from "@/i18n";
import { useSlugRedirect } from "../hooks";
import { ProductNotFound } from "./ProductNotFound";
import { ProductSkeleton } from "./ProductSkeleton";
import { ProductView } from "./ProductView";
import { storeRoutesForProduct } from "./routes";
import { useProductDetail } from "./useProductDetail";

/** Los slugs son minúsculas, dígitos y guiones; cualquier otra cosa ni se consulta. */
const VALID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG = 120;

/**
 * Ficha de producto `/producto/:slug`.
 * - Slug con MAYÚSCULAS → redirige (replace) al slug en minúsculas.
 * - Slug que no existe → si era el nombre ANTERIOR de un producto renombrado, redirige al actual; si no, 404 amable.
 * - Producto oculto/borrador/archivado: la base ya no lo devuelve, así que es la misma 404 (y vuelve solo si se repone).
 * - Nunca pantalla en blanco: cargando (esqueleto), error (con reintento) o contenido.
 */
export function ProductPage() {
  const { slug: raw = "" } = useParams();
  const location = useLocation();
  const slug = raw.toLowerCase();
  const wellFormed = slug.length <= MAX_SLUG && VALID_SLUG.test(slug);
  const needsLowercase = wellFormed && raw !== slug;

  const detail = useProductDetail(wellFormed && !needsLowercase ? slug : undefined);
  const settings = useStoreSettings();
  const missing = detail.isSuccess && detail.data === null;
  const redirect = useSlugRedirect(slug, missing);

  if (!wellFormed) return <ProductNotFound />;
  if (needsLowercase) {
    return (
      <Navigate
        replace
        to={{ pathname: storeRoutesForProduct.product(slug), search: location.search }}
      />
    );
  }
  // Con datos ya cargados se sigue mostrando la ficha aunque un refresco en segundo plano falle.
  if (detail.data)
    return (
      <ProductView
        key={detail.data.product.id}
        detail={detail.data}
        slug={slug}
        settings={settings.data}
      />
    );
  if (detail.isError) {
    return (
      <ErrorState
        title={t("shop.product.error.title")}
        description={t("shop.product.error.body")}
        onRetry={() => void detail.refetch()}
        className="min-h-[60vh] justify-center"
      />
    );
  }
  if (missing) {
    if (redirect.isPending) return <ProductSkeleton />;
    // Si no se pudo consultar si el slug fue renombrado, no se afirma que «no existe»: error con reintento.
    if (redirect.isError) {
      return (
        <ErrorState
          title={t("shop.product.error.title")}
          description={t("shop.product.error.body")}
          onRetry={() => void redirect.refetch()}
          className="min-h-[60vh] justify-center"
        />
      );
    }
    const current = redirect.data;
    if (current && current !== slug) {
      return (
        <Navigate
          replace
          to={{ pathname: storeRoutesForProduct.product(current), search: location.search }}
        />
      );
    }
    return <ProductNotFound />;
  }
  return <ProductSkeleton />;
}

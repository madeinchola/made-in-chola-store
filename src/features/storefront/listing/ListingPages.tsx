import { Navigate, useLocation, useParams } from "react-router-dom";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { ErrorState } from "@/components/store/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { NotFoundPage } from "@/app/pages/NotFoundPage";
import { useCategoryTree, useCollections } from "@/features/catalog/hooks";
import { t } from "@/i18n";
import { ProductGridSkeleton } from "./ProductGrid";
import { ListingView } from "./ListingView";
import { SearchView } from "./SearchView";
import { categoryTrail } from "./listingContext";

/** Mientras llegan las categorías/colecciones (para saber el nombre y si existen): esqueleto, nunca pantalla en blanco. */
function ListingSkeletonPage() {
  return (
    <div aria-busy="true" className="container space-y-6 py-8 lg:py-12">
      <p role="status" className="sr-only">
        {t("shop.listing.loading")}
      </p>
      <Skeleton className="h-12 w-1/3" />
      <ProductGridSkeleton />
    </div>
  );
}

/** Categoría o colección inexistente, archivada o vencida: 404 amable, sin indexar. */
function ListingNotFound() {
  return <NotFoundPage />; // la propia 404 se marca noindex
}

function ListingLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="container py-12">
      <ErrorState
        title={t("shop.listing.error.title")}
        description={t("shop.listing.error.body")}
        onRetry={onRetry}
      />
    </div>
  );
}

/** `/tienda`: toda la colección. */
export function ShopPage() {
  return (
    <ListingView
      scope={{}}
      path={storeRoutes.shop}
      listId="shop"
      title={t("shop.listing.shopTitle")}
      trail={[]}
      metaTitle={t("shop.seo.shopTitle")}
      metaDescription={t("shop.seo.shopDescription")}
    />
  );
}

/** `/categoria/:slug` (cualquier nivel; incluye los productos de sus subcategorías). */
export function CategoryPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const tree = useCategoryTree();
  const lower = slug.toLowerCase();
  // Los slugs son siempre minúsculas: /categoria/Ropa redirige a /categoria/ropa conservando los parámetros.
  if (slug !== lower) {
    return (
      <Navigate to={{ pathname: storeRoutes.category(lower), search: location.search }} replace />
    );
  }
  if (tree.isPending) return <ListingSkeletonPage />;
  if (tree.isError) return <ListingLoadError onRetry={() => void tree.refetch()} />;
  const chain = categoryTrail(tree.data, slug);
  const node = chain.at(-1);
  if (!node) return <ListingNotFound />;
  return (
    <ListingView
      key={slug}
      scope={{ categorySlug: slug }}
      path={storeRoutes.category(slug)}
      listId={`category:${slug}`}
      title={node.name}
      description={node.description}
      trail={[
        { name: t("shop.listing.shopTitle"), path: storeRoutes.shop },
        ...chain
          .slice(0, -1)
          .map((parent) => ({ name: parent.name, path: storeRoutes.category(parent.slug) })),
      ]}
      metaTitle={t("shop.seo.categoryTitle", { name: node.name })}
      metaDescription={node.description || t("shop.seo.categoryDescription", { name: node.name })}
    />
  );
}

/** `/coleccion/:slug` (las colecciones vencidas o archivadas no existen para el público: 404). */
export function CollectionPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const collections = useCollections();
  const lower = slug.toLowerCase();
  if (slug !== lower) {
    return (
      <Navigate to={{ pathname: storeRoutes.collection(lower), search: location.search }} replace />
    );
  }
  if (collections.isPending) return <ListingSkeletonPage />;
  if (collections.isError) return <ListingLoadError onRetry={() => void collections.refetch()} />;
  const collection = collections.data.find((item) => item.slug === slug);
  if (!collection) return <ListingNotFound />;
  return (
    <ListingView
      key={slug}
      scope={{ collectionSlug: slug }}
      path={storeRoutes.collection(slug)}
      listId={`collection:${slug}`}
      title={collection.name}
      description={collection.description}
      trail={[{ name: t("shop.listing.shopTitle"), path: storeRoutes.shop }]}
      metaTitle={t("shop.seo.collectionTitle", { name: collection.name })}
      metaDescription={
        collection.description ||
        t("shop.listing.seo.collectionDescription", { name: collection.name })
      }
    />
  );
}

/** `/buscar?q=`. */
export const SearchPage = SearchView;

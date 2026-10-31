import { Link } from "react-router-dom";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { Button } from "@/components/ui/button";
import { useCategoryTree } from "@/features/catalog/hooks";
import { t } from "@/i18n";

/**
 * «Seguir explorando» para los callejones sin salida (vacío, sin resultados, invitación a buscar): las categorías
 * principales y el acceso a toda la tienda. Si las categorías no cargan, queda al menos el enlace a la tienda.
 */
export function ExploreLinks() {
  const { data: tree } = useCategoryTree();
  return (
    <div className="mt-6 flex flex-col items-center gap-4">
      {tree && tree.length > 0 && (
        <nav aria-label={t("shop.listing.empty.exploreLabel")}>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {tree.map((category) => (
              <li key={category.id}>
                <Link
                  to={storeRoutes.category(category.slug)}
                  className="eyebrow underline underline-offset-4 hover:opacity-70"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <Button asChild variant="outline" caps>
        <Link to={storeRoutes.shop}>{t("shop.listing.empty.allProducts")}</Link>
      </Button>
    </div>
  );
}

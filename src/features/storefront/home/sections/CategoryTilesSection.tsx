import { Link } from "react-router-dom";
import { ImagePlaceholder } from "@/components/store/ImagePlaceholder";
import { safeLink, type SafeLink } from "@/components/layout/safeLink";
import { useCategoryTree } from "@/features/catalog/hooks";
import type { HomeSection, HomeSectionItem } from "@/features/catalog/types";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { HomeImage } from "../HomeImage";
import {
  cleanText,
  flattenCategories,
  sortItems,
  tileAspect,
  tileSpanClass,
} from "../homeSections";
import { gutterX } from "../homeStyles";

const labelClass =
  "mb-3.5 block font-display text-[clamp(1.125rem,0.9rem+0.9vw,1.375rem)] leading-tight";

/**
 * Baldosas de categorías (PDF de Inicio): la etiqueta en serif ARRIBA de cada imagen; con 3 baldosas, anchos 1·1·2 y
 * alturas distintas alineadas arriba. La baldosa entera es un enlace cuyo nombre es la etiqueta.
 */
export function CategoryTilesSection({ section }: { section: HomeSection }) {
  const tree = useCategoryTree();
  const categories = tree.data ? flattenCategories(tree.data) : [];
  const items = sortItems(section.items)
    .map((item) => ({ item, ...describe(item, categories) }))
    .filter((entry) => entry.label !== null || entry.item.media.kind !== "none");

  if (items.length === 0) return null;
  return (
    <section
      aria-label={cleanText(section.title) ?? t("shop.home.categories")}
      className={cn("border-t border-foreground pb-16 pt-[4.25rem]", gutterX)}
    >
      <ul className="grid grid-cols-2 items-start gap-x-2.5 gap-y-10 lg:grid-cols-4">
        {items.map(({ item, label, link }, index) => {
          const tile = (
            <>
              {label && <span className={labelClass}>{label}</span>}
              <span
                className={cn("relative block overflow-hidden bg-secondary", tileAspect(index))}
              >
                {/* Con etiqueta, ella nombra el enlace: el texto oculto del marcador («Sin imagen») no debe sumarse. */}
                <span className="absolute inset-0 block" aria-hidden={label ? true : undefined}>
                  {item.media.kind === "image" ? (
                    <HomeImage media={item.media} />
                  ) : (
                    <ImagePlaceholder />
                  )}
                </span>
              </span>
            </>
          );
          return (
            <li key={item.id} className={tileSpanClass(index, items.length)}>
              {link?.kind === "internal" ? (
                <Link to={link.to} className="block rounded-sm">
                  {tile}
                </Link>
              ) : link?.kind === "external" ? (
                <a href={link.href} rel="noopener noreferrer" className="block rounded-sm">
                  {tile}
                </a>
              ) : (
                tile
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Etiqueta y destino de una baldosa: lo que escribió el admin, o el nombre/ruta de su categoría. */
function describe(
  item: HomeSectionItem,
  categories: readonly { id: string; name: string; slug: string }[],
): { label: string | null; link: SafeLink | null } {
  const category = item.categoryId ? categories.find((c) => c.id === item.categoryId) : undefined;
  // Un enlace escrito pero NO seguro (`javascript:`…) no se sustituye por la categoría: se respeta que no haya enlace.
  const written = cleanText(item.linkUrl);
  const link: SafeLink | null = written
    ? safeLink(written)
    : category
      ? { kind: "internal", to: `/categoria/${encodeURIComponent(category.slug)}` }
      : null;
  return { label: cleanText(item.label) ?? category?.name ?? null, link };
}

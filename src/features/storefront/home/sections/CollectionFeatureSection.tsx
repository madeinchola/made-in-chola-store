import { ProductCard } from "@/components/store/ProductCard";
import type { HomeSection } from "@/features/catalog/types";
import { usePrefetchProduct } from "@/features/storefront/hooks";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { HomeImage } from "../HomeImage";
import { cleanText, splitCollectionTitle } from "../homeSections";
import { gutterX, mediaScrim, overMediaClass, overMediaRing } from "../homeStyles";
import { SectionLink } from "../SectionLink";
import { useSectionProducts } from "../useHomeProducts";
import { useTrackItemList } from "../useTrackItemList";

/**
 * Colección destacada (PDF de Inicio): baldosa grande a la izquierda (2 de las 4 columnas) con «Colección *NADAS*»
 * —el nombre en cursiva—, un párrafo y «VER TODO»; a la derecha, las tarjetas de la colección con «DESDE Bs …».
 * Una línea fina oscura la separa de la fila anterior.
 */
export function CollectionFeatureSection({ section }: { section: HomeSection }) {
  const { products } = useSectionProducts(section);
  const prefetch = usePrefetchProduct();
  const title = cleanText(section.title);
  const body = cleanText(section.body);
  const cta = cleanText(section.ctaLabel) ?? t("shop.home.viewAll");
  const parts = title ? splitCollectionTitle(title) : null;
  useTrackItemList(section.id, title ?? "", products);

  return (
    <section className={cn("border-t border-foreground pb-16 pt-3", gutterX)}>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-6 lg:grid-cols-4">
        <div
          className={cn(
            "relative isolate col-span-2 aspect-[7/9] overflow-hidden bg-secondary lg:row-span-2",
            overMediaClass,
          )}
        >
          <div className="absolute inset-0">
            <HomeImage media={section.media} />
          </div>
          <div aria-hidden="true" className={cn("absolute inset-0", mediaScrim)} />
          <div className="absolute inset-x-0 bottom-0 z-10 space-y-3 p-5">
            {title && (
              <h2 className="font-display text-[clamp(1.5rem,1rem+1.2vw,2rem)] leading-none">
                {parts ? (
                  <>
                    {parts.prefix} <em>{parts.name}</em>
                  </>
                ) : (
                  title
                )}
              </h2>
            )}
            {body && <p className="max-w-[18.5rem] text-justify text-xs leading-snug">{body}</p>}
            <SectionLink
              url={section.ctaUrl}
              label={cta}
              className={cn(
                "eyebrow inline-block rounded-sm font-normal underline underline-offset-4 transition-opacity duration-fast hover:opacity-70",
                overMediaRing,
              )}
            />
          </div>
        </div>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            headingAs="h3"
            pricePrefix={t("shop.home.from")}
            imageClassName="aspect-[4/5]"
            onPrefetch={prefetch}
          />
        ))}
      </div>
    </section>
  );
}

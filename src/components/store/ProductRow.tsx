import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import type { ProductSummary } from "@/features/catalog/types";
import { t } from "@/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ProductCard } from "./ProductCard";

type CarouselApi = Parameters<NonNullable<React.ComponentProps<typeof Carousel>["setApi"]>>[0];

interface ProductRowProps {
  title: string;
  products: ProductSummary[];
  /** Enlace «VER TODO» a la derecha del título (`external`: URL completa de otro sitio). */
  viewAll?: { to: string; label: string; external?: boolean };
  headingAs?: "h2" | "h3";
  /** Precarga de la ficha al pasar el ratón por una tarjeta. */
  onPrefetch?: (slug: string) => void;
  /** Texto antes del precio de cada tarjeta (ya traducido). */
  pricePrefix?: string;
  className?: string;
}

const arrowClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-sm text-foreground transition-opacity duration-fast hover:opacity-70 aria-disabled:cursor-default aria-disabled:opacity-35 aria-disabled:hover:opacity-35";

/**
 * Fila de productos como en el PDF de Inicio: título serif grande y, a la derecha, «VER TODO» subrayado con las flechas
 * ‹ ›; debajo, un carrusel que se arrastra con el dedo (4 tarjetas en escritorio, 2,3 en móvil). Las flechas usan
 * `aria-disabled` (nunca `disabled`: un botón que se desactiva con el foco lo pierde). Sin productos no se pinta.
 */
export function ProductRow({
  title,
  products,
  viewAll,
  headingAs: Heading = "h2",
  onPrefetch,
  pricePrefix,
  className,
}: ProductRowProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    if (!api) return;
    const sync = () => {
      setCanPrev(api.canScrollPrev());
      setCanNext(api.canScrollNext());
    };
    sync();
    api.on("select", sync).on("reInit", sync);
    return () => {
      api.off("select", sync).off("reInit", sync);
    };
  }, [api]);

  if (products.length === 0) return null;

  const linkClass =
    "eyebrow font-normal underline underline-offset-4 transition-opacity duration-fast hover:opacity-70";
  return (
    <section className={cn("space-y-5", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <Heading className="font-display text-[clamp(1.5rem,0.9rem+1.4vw,1.875rem)] leading-tight">
          {title}
        </Heading>
        <div className="flex shrink-0 items-center gap-2">
          {viewAll &&
            (viewAll.external ? (
              <a href={viewAll.to} rel="noopener noreferrer" className={linkClass}>
                {viewAll.label}
              </a>
            ) : (
              <Link to={viewAll.to} className={linkClass}>
                {viewAll.label}
              </Link>
            ))}
          <button
            type="button"
            aria-label={t("ui.carousel.prev")}
            aria-disabled={!canPrev}
            onClick={() => canPrev && api?.scrollPrev(prefersReducedMotion())}
            className={arrowClass}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label={t("ui.carousel.next")}
            aria-disabled={!canNext}
            onClick={() => canNext && api?.scrollNext(prefersReducedMotion())}
            className={arrowClass}
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <Carousel label={title} setApi={setApi} opts={{ align: "start", dragFree: true }}>
        <CarouselContent className="-ml-2.5">
          {products.map((product) => (
            <CarouselItem key={product.id} className="basis-[43%] pl-2.5 sm:basis-1/3 lg:basis-1/4">
              <ProductCard
                product={product}
                {...(onPrefetch ? { onPrefetch } : {})}
                {...(pricePrefix ? { pricePrefix } : {})}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </section>
  );
}

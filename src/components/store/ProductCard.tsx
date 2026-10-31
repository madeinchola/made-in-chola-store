import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { ImagePlaceholder } from "./ImagePlaceholder";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import type { ProductSummary } from "@/features/catalog/types";
import { t } from "@/i18n";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  product: ProductSummary;
  /** Destino del enlace; por defecto la ficha `/producto/{slug}`. */
  to?: string;
  /** Imagen por encima del pliegue (carga inmediata, sin lazy). */
  priority?: boolean;
  /** Nivel del título según el contexto de la página. */
  headingAs?: "h2" | "h3" | "h4";
  /** Se llama al pasar el ratón o enfocar la tarjeta: la pantalla puede precargar la ficha. */
  onPrefetch?: (slug: string) => void;
  /** Texto antes del precio, ya traducido («Desde»): las tarjetas de una colección destacada lo llevan. */
  pricePrefix?: string;
  /** Clases extra de la baldosa de imagen (p. ej. otra proporción: `aspect-[4/5]`). */
  imageClassName?: string;
  className?: string;
}

/**
 * Tarjeta de producto como en el PDF de Inicio: baldosa de imagen 5:7 con esquinas rectas y el chip («NUEVO»,
 * «AGOTADO») abajo a la izquierda; debajo, el nombre en serif a la izquierda y el precio a la derecha en la misma fila,
 * y el número de colores en letra diminuta. UN solo enlace por tarjeta (enlace estirado sobre el nombre): no hay
 * controles anidados.
 */
export function ProductCard({
  product,
  to,
  priority = false,
  headingAs: Heading = "h3",
  onPrefetch,
  pricePrefix,
  imageClassName,
  className,
}: ProductCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.coverPath !== null && !imageFailed;
  return (
    <article
      className={cn("group relative flex min-w-0 flex-col gap-3", className)}
      onPointerEnter={onPrefetch ? () => onPrefetch(product.slug) : undefined}
      onFocus={onPrefetch ? () => onPrefetch(product.slug) : undefined}
    >
      <div className={cn("relative aspect-[5/7] overflow-hidden bg-secondary", imageClassName)}>
        {showImage ? (
          <img
            src={productImageUrl(product.coverPath as string)}
            alt={product.coverAlt?.trim() || product.name}
            width={500}
            height={700}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            onError={() => setImageFailed(true)}
            className={cn(
              "h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-slow motion-safe:ease-standard motion-safe:group-hover:scale-105",
              product.soldOut && "opacity-60",
            )}
          />
        ) : (
          <ImagePlaceholder />
        )}
        {(product.isNew || product.soldOut) && (
          <div className="absolute bottom-2.5 left-2.5 flex flex-col items-start gap-1">
            {product.isNew && (
              <Badge tone="solid" caps className="rounded-sm px-2 py-0.5 text-[0.625rem]">
                {t("store.card.new")}
              </Badge>
            )}
            {product.soldOut && (
              <Badge
                tone="outline"
                caps
                className="rounded-sm bg-background px-2 py-0.5 text-[0.625rem]"
              >
                {t("store.card.soldOut")}
              </Badge>
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 px-1">
        <div className="flex items-baseline justify-between gap-3">
          <Heading className="min-w-0 font-display text-[0.9375rem] leading-snug">
            <Link
              to={to ?? `/producto/${product.slug}`}
              title={product.name}
              className="block after:absolute after:inset-0 after:content-['']"
            >
              <span className="line-clamp-2 break-words">{product.name}</span>
            </Link>
          </Heading>
          <p className="shrink-0 whitespace-nowrap text-[0.6875rem] uppercase tabular-nums tracking-[0.08em]">
            {pricePrefix && (
              <>
                <span>{pricePrefix}</span>{" "}
              </>
            )}
            <span>{formatMoney(product.price)}</span>
          </p>
        </div>
        {product.colorsCount > 0 && (
          <p className="eyebrow mt-1 text-[0.625rem] font-normal text-muted-foreground">
            {product.colorsCount === 1
              ? t("store.card.colorsOne")
              : t("store.card.colors", { count: product.colorsCount })}
          </p>
        )}
      </div>
    </article>
  );
}

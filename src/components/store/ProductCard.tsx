import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PriceTag } from "./PriceTag";
import { ImagePlaceholder } from "./ImagePlaceholder";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import type { ProductSummary } from "@/features/catalog/types";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  product: ProductSummary;
  /** Destino del enlace; por defecto la ficha `/producto/{slug}`. */
  to?: string;
  /** Imagen por encima del pliegue (carga inmediata, sin lazy). */
  priority?: boolean;
  /** Nivel del título según el contexto de la página. */
  headingAs?: "h2" | "h3" | "h4";
  className?: string;
}

/**
 * Tarjeta de producto del listado: baldosa de imagen con chips, nombre, número de colores y precio.
 * UN solo enlace por tarjeta (enlace estirado sobre el nombre): no hay controles anidados.
 */
export function ProductCard({
  product,
  to,
  priority = false,
  headingAs: Heading = "h3",
  className,
}: ProductCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.coverPath !== null && !imageFailed;
  return (
    <article className={cn("group relative flex min-w-0 flex-col gap-3", className)}>
      <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-secondary">
        {showImage ? (
          <img
            src={productImageUrl(product.coverPath as string)}
            alt={product.coverAlt?.trim() || product.name}
            width={600}
            height={800}
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
          <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
            {product.isNew && (
              <Badge tone="solid" caps>
                {t("store.card.new")}
              </Badge>
            )}
            {product.soldOut && (
              <Badge tone="outline" caps className="bg-background">
                {t("store.card.soldOut")}
              </Badge>
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <Heading className="font-display text-lg leading-snug">
          <Link
            to={to ?? `/producto/${product.slug}`}
            title={product.name}
            className="block after:absolute after:inset-0 after:content-['']"
          >
            <span className="line-clamp-2 break-words">{product.name}</span>
          </Link>
        </Heading>
        {product.colorsCount > 0 && (
          <p className="eyebrow text-muted-foreground">
            {product.colorsCount === 1
              ? t("store.card.colorsOne")
              : t("store.card.colors", { count: product.colorsCount })}
          </p>
        )}
        <PriceTag price={product.price} />
      </div>
    </article>
  );
}

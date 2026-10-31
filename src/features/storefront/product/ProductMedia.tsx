import { useRef, useState } from "react";
import { Gallery } from "@/components/store/Gallery";
import { ImagePlaceholder } from "@/components/store/ImagePlaceholder";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import type { ProductImage } from "@/features/catalog/types";
import { t } from "@/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { useIsLargeScreen } from "./useIsLargeScreen";

interface ProductMediaProps {
  images: ProductImage[];
  productName: string;
  /** Al cambiar de color el carrusel móvil vuelve a la primera imagen (`key`). */
  colorId: string | null;
}

/**
 * Imágenes de la ficha. Escritorio (diseño): todas apiladas a gran tamaño, con una tira de miniaturas debajo que
 * lleva a cada una. Móvil (sin diseño): carrusel con deslizamiento. En ambos la primera imagen es la del LCP (carga
 * inmediata y prioridad alta); las demás, perezosas. Todas reservan su espacio, sin saltos al cargar.
 */
export function ProductMedia({ images, productName, colorId }: ProductMediaProps) {
  const large = useIsLargeScreen();
  const refs = useRef(new Map<string, HTMLLIElement>());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const markFailed = (id: string) =>
    setFailed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  if (!large) {
    // `Gallery` ordena por `sortOrder`; `images` ya viene en el orden de la ficha (las del color elegido primero), así
    // que se renumera para que ese orden se respete también en el carrusel móvil.
    const ordered = images.map((image, index) => ({ ...image, sortOrder: index }));
    return <Gallery key={colorId ?? "none"} images={ordered} productName={productName} />;
  }

  if (images.length === 0) {
    return (
      <div className="aspect-[4/5] overflow-hidden bg-secondary">
        <ImagePlaceholder />
      </div>
    );
  }

  const total = images.length;
  const goTo = (id: string) =>
    refs.current.get(id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });

  return (
    <section aria-label={t("shop.product.media.label")}>
      <ol className="flex flex-col gap-3">
        {images.map((image, index) => (
          <li
            key={image.id}
            ref={(element) => {
              if (element) refs.current.set(image.id, element);
              else refs.current.delete(image.id);
            }}
            className="aspect-[4/5] scroll-mt-4 overflow-hidden bg-secondary"
          >
            {failed.has(image.id) ? (
              <ImagePlaceholder />
            ) : (
              <img
                src={productImageUrl(image.path)}
                alt={
                  image.alt?.trim() ||
                  t("shop.product.media.imageAlt", { name: productName, n: index + 1, total })
                }
                width={800}
                height={1000}
                loading={index === 0 ? "eager" : "lazy"}
                // En minúsculas: React 18 no reconoce `fetchPriority` y avisa en consola.
                {...{ fetchpriority: index === 0 ? "high" : "auto" }}
                decoding="async"
                onError={() => markFailed(image.id)}
                className="h-full w-full object-cover"
              />
            )}
          </li>
        ))}
      </ol>
      {total > 1 && (
        <ul
          aria-label={t("shop.product.media.thumbs")}
          className="mt-3 flex gap-1.5 overflow-x-auto p-1"
        >
          {images.map((image, index) => (
            <li key={image.id} className="shrink-0">
              <button
                type="button"
                aria-label={t("shop.product.media.thumb", { n: index + 1, total })}
                onClick={() => goTo(image.id)}
                className="block h-[9.9rem] w-[7.9rem] overflow-hidden bg-secondary"
              >
                {failed.has(image.id) ? (
                  <ImagePlaceholder as="span" />
                ) : (
                  <img
                    src={productImageUrl(image.path)}
                    alt=""
                    width={158}
                    height={198}
                    loading="lazy"
                    decoding="async"
                    onError={() => markFailed(image.id)}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

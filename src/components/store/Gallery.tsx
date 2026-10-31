import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import type { ProductImage } from "@/features/catalog/types";
import { t } from "@/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ImagePlaceholder } from "./ImagePlaceholder";

type CarouselApi = Parameters<NonNullable<React.ComponentProps<typeof Carousel>["setApi"]>>[0];

interface GalleryProps {
  /** Imágenes a mostrar (se ordenan por `sortOrder`). Al cambiar de color pásale `key={colorId}` para volver a la primera. */
  images: readonly ProductImage[];
  /** `alt` de respaldo para imágenes sin texto alternativo. */
  productName: string;
  className?: string;
}

/**
 * Galería de la ficha de producto: visor con deslizamiento táctil, miniaturas sincronizadas (columna en escritorio, fila
 * con desplazamiento en móvil) y vista ampliada en un diálogo con flechas y teclado ← →. Una sola imagen: sin miniaturas
 * ni flechas. Sin imágenes, o si una falla al cargar: baldosa provisional en su lugar (nunca un icono de imagen rota).
 */
export function Gallery({ images, productName, className }: GalleryProps) {
  const items = useMemo(() => [...images].sort((a, b) => a.sortOrder - b.sortOrder), [images]);
  const total = items.length;

  const [api, setApi] = useState<CarouselApi>();
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const zoomButton = useRef<HTMLButtonElement>(null);

  const active = Math.min(selected, Math.max(0, total - 1));

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setSelected(api.selectedScrollSnap());
    api.on("select", onSelect).on("reInit", onSelect);
    return () => {
      api.off("select", onSelect).off("reInit", onSelect);
    };
  }, [api]);

  const markFailed = useCallback(
    (id: string) => setFailed((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
    [],
  );

  const select = (index: number) => {
    setSelected(index);
    api?.scrollTo(index, prefersReducedMotion());
  };

  /** Mueve la imagen ampliada (acotado a los extremos). */
  const moveZoom = (delta: number) =>
    setZoomIndex((i) => (i === null ? i : Math.min(total - 1, Math.max(0, i + delta))));

  const closeZoom = () => {
    if (zoomIndex !== null) select(zoomIndex);
    setZoomIndex(null);
  };

  const renderImage = (image: ProductImage, className: string, alt?: string, inButton = false) =>
    failed.has(image.id) ? (
      <ImagePlaceholder {...(inButton ? { as: "span" as const } : {})} />
    ) : (
      <img
        src={productImageUrl(image.path)}
        alt={alt ?? (image.alt?.trim() || productName)}
        decoding="async"
        onError={() => markFailed(image.id)}
        className={className}
      />
    );

  if (total === 0) {
    return (
      <div className={cn("aspect-[3/4] overflow-hidden rounded-card", className)}>
        <ImagePlaceholder />
      </div>
    );
  }

  const zoomed = zoomIndex === null ? undefined : items[zoomIndex];

  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row-reverse lg:items-start", className)}>
      <div className="relative min-w-0 flex-1">
        {total > 1 ? (
          <Carousel
            label={t("store.gallery.label")}
            opts={{ align: "start" }}
            setApi={setApi}
            className="overflow-hidden rounded-card bg-secondary"
          >
            <CarouselContent className="ml-0">
              {items.map((image, index) => (
                <CarouselItem key={image.id} className="pl-0">
                  <div className="aspect-[3/4]">
                    {renderImage(
                      image,
                      "h-full w-full object-cover",
                      image.alt?.trim() || `${productName} (${index + 1}/${total})`,
                    )}
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        ) : (
          <div className="aspect-[3/4] overflow-hidden rounded-card bg-secondary">
            {renderImage(items[0] as ProductImage, "h-full w-full object-cover")}
          </div>
        )}
        <Button
          ref={zoomButton}
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("store.gallery.zoom")}
          onClick={() => setZoomIndex(active)}
          className="absolute right-3 top-3 z-10 rounded-pill bg-background/90"
        >
          <Expand aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>

      {total > 1 && (
        <div
          role="group"
          aria-label={t("store.gallery.thumbs")}
          className="flex gap-2 overflow-x-auto p-1 lg:max-h-[40rem] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible"
        >
          {items.map((image, index) => (
            <button
              key={image.id}
              type="button"
              aria-label={t("store.gallery.thumb", { n: index + 1, total })}
              aria-current={index === active ? "true" : undefined}
              onClick={() => select(index)}
              className="relative h-20 w-16 shrink-0 overflow-hidden rounded-md border-2 border-transparent bg-secondary transition-colors duration-fast ease-standard aria-[current=true]:border-foreground"
            >
              {renderImage(image, "h-full w-full object-cover", "", true)}
            </button>
          ))}
        </div>
      )}

      <Dialog open={zoomed !== undefined} onOpenChange={(open) => !open && closeZoom()}>
        <DialogContent
          className="h-[90vh] max-w-5xl"
          bodyClassName="grid-rows-[minmax(0,1fr)] gap-0 p-3 sm:p-4"
          onCloseAutoFocus={(event) => {
            // En Safari/Firefox (macOS) el clic no enfoca el botón de ampliar: se le devuelve el foco a mano.
            event.preventDefault();
            zoomButton.current?.focus();
          }}
          onKeyDown={(event) => {
            if (zoomIndex === null) return;
            if (event.key === "ArrowLeft") moveZoom(-1);
            if (event.key === "ArrowRight") moveZoom(1);
          }}
        >
          <DialogTitle className="sr-only">{t("store.gallery.zoomTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("store.gallery.zoomDescription")}
          </DialogDescription>
          {zoomed && (
            <div className="relative min-h-0">
              {failed.has(zoomed.id) ? (
                <ImagePlaceholder />
              ) : (
                <img
                  src={productImageUrl(zoomed.path)}
                  alt={zoomed.alt?.trim() || productName}
                  onError={() => markFailed(zoomed.id)}
                  className="h-full w-full object-contain"
                />
              )}
              {total > 1 && (
                <>
                  {/* `aria-disabled` y no `disabled`: un botón que se deshabilita mientras tiene el foco lo pierde, y con él las flechas del teclado. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("store.gallery.prev")}
                    aria-disabled={zoomIndex === 0}
                    onClick={() => moveZoom(-1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-pill bg-background/90 aria-disabled:opacity-40"
                  >
                    <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("store.gallery.next")}
                    aria-disabled={zoomIndex === total - 1}
                    onClick={() => moveZoom(1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-pill bg-background/90 aria-disabled:opacity-40"
                  >
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <p
                    aria-live="polite"
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-pill bg-background/90 px-3 py-1 text-xs tabular-nums"
                  >
                    {t("store.gallery.counter", { n: (zoomIndex ?? 0) + 1, total })}
                  </p>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

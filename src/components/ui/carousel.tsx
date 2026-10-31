import * as React from "react";
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "@/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type EmblaApi = NonNullable<UseEmblaCarouselType[1]>;
type EmblaOptions = Parameters<typeof useEmblaCarousel>[0];

interface CarouselContextValue {
  viewportRef: UseEmblaCarouselType[0];
  api: UseEmblaCarouselType[1];
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
}

const CarouselContext = React.createContext<CarouselContextValue | null>(null);
const SlideContext = React.createContext<{ n: number; total: number } | null>(null);

function useCarousel() {
  const context = React.useContext(CarouselContext);
  if (!context) throw new Error("Los componentes del carrusel van dentro de <Carousel>.");
  return context;
}

interface CarouselProps extends React.HTMLAttributes<HTMLDivElement> {
  opts?: EmblaOptions;
  /** Se entrega la API de embla (p. ej. para sincronizar miniaturas). */
  setApi?: (api: EmblaApi) => void;
  /** Nombre accesible del carrusel. */
  label?: string;
}

/**
 * Carrusel táctil (embla): arrastre con el dedo, flechas del teclado y botones. Sin reproducción automática a propósito
 * (WCAG 2.2.2): nada se mueve sin que la persona lo pida.
 */
export const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(
  ({ opts, setApi, label, className, children, onKeyDownCapture, ...props }, ref) => {
    const [viewportRef, api] = useEmblaCarousel({ align: "start", ...opts });
    const [canScrollPrev, setCanScrollPrev] = React.useState(false);
    const [canScrollNext, setCanScrollNext] = React.useState(false);

    const sync = React.useCallback((embla: EmblaApi) => {
      setCanScrollPrev(embla.canScrollPrev());
      setCanScrollNext(embla.canScrollNext());
    }, []);

    React.useEffect(() => {
      if (!api) return;
      setApi?.(api);
      sync(api);
      api.on("reInit", sync).on("select", sync);
      return () => {
        api.off("reInit", sync).off("select", sync);
      };
    }, [api, setApi, sync]);

    // `jump`: con «reducir movimiento» se salta sin animar (embla anima por JavaScript, el CSS global no le afecta).
    const scrollPrev = React.useCallback(() => api?.scrollPrev(prefersReducedMotion()), [api]);
    const scrollNext = React.useCallback(() => api?.scrollNext(prefersReducedMotion()), [api]);

    return (
      <CarouselContext.Provider
        value={{ viewportRef, api, scrollPrev, scrollNext, canScrollPrev, canScrollNext }}
      >
        <div
          ref={ref}
          role="region"
          aria-roledescription="carousel"
          aria-label={label ?? t("ui.carousel.label")}
          className={cn("relative", className)}
          onKeyDownCapture={(event) => {
            onKeyDownCapture?.(event);
            if (event.defaultPrevented) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              scrollPrev();
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              scrollNext();
            }
          }}
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    );
  },
);
Carousel.displayName = "Carousel";

export const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const { viewportRef } = useCarousel();
  const slides = React.Children.toArray(children);
  return (
    <div ref={viewportRef} className="overflow-hidden">
      <div ref={ref} className={cn("-ml-4 flex", className)} {...props}>
        {slides.map((slide, index) => (
          <SlideContext.Provider key={index} value={{ n: index + 1, total: slides.length }}>
            {slide}
          </SlideContext.Provider>
        ))}
      </div>
    </div>
  );
});
CarouselContent.displayName = "CarouselContent";

export const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const slide = React.useContext(SlideContext);
    return (
      <div
        ref={ref}
        role="group"
        aria-roledescription="slide"
        aria-label={slide ? t("ui.carousel.slide", slide) : undefined}
        className={cn("min-w-0 shrink-0 grow-0 basis-full pl-4", className)}
        {...props}
      />
    );
  },
);
CarouselItem.displayName = "CarouselItem";

type ArrowProps = Omit<React.ComponentProps<typeof Button>, "children">;

// Los botones usan `aria-disabled` y NO `disabled`: al llegar al extremo con el teclado, un botón que se desactiva
// estando enfocado pierde el foco (cae al <body>) y las flechas dejan de funcionar.

export const CarouselPrevious = ({ className, ...props }: ArrowProps) => {
  const { scrollPrev, canScrollPrev } = useCarousel();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={t("ui.carousel.prev")}
      aria-disabled={!canScrollPrev}
      onClick={() => canScrollPrev && scrollPrev()}
      className={cn(
        "absolute left-2 top-1/2 -translate-y-1/2 rounded-pill bg-background/90",
        className,
      )}
      {...props}
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
};

export const CarouselNext = ({ className, ...props }: ArrowProps) => {
  const { scrollNext, canScrollNext } = useCarousel();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={t("ui.carousel.next")}
      aria-disabled={!canScrollNext}
      onClick={() => canScrollNext && scrollNext()}
      className={cn(
        "absolute right-2 top-1/2 -translate-y-1/2 rounded-pill bg-background/90",
        className,
      )}
      {...props}
    >
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
};

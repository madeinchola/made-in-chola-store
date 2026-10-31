import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Skeleton } from "@/components/ui/skeleton";
import { Block, Specimen } from "./Block";

export function FeedbackSection() {
  return (
    <Block
      id="carga-carrusel"
      title="Carga y carrusel"
      note="Los marcadores de carga reservan el espacio final para que la página no salte (CLS). El carrusel se arrastra con el dedo, responde a las flechas del teclado y no avanza solo."
    >
      <Specimen label="Marcador de carga de una tarjeta de producto">
        <div aria-busy="true" className="w-48 space-y-3">
          <Skeleton className="aspect-[3/4] w-full rounded-card" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </Specimen>

      <Carousel label="Ejemplo de carrusel" opts={{ align: "start" }} className="px-12">
        <CarouselContent>
          {["Camisetas", "Chompas", "Pantalones", "Sombreros", "Accesorios"].map((name) => (
            <CarouselItem key={name} className="basis-2/3 sm:basis-1/3 lg:basis-1/4">
              <div className="flex aspect-[3/4] items-end rounded-card bg-secondary p-4">
                <span className="eyebrow">{name}</span>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </Block>
  );
}

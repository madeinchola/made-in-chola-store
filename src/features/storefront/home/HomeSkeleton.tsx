import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { heroHeightClass } from "./homeStyles";

/**
 * Esqueleto de la portada mientras llegan los datos. Reserva la altura del hero (la cabecera es transparente y BLANCA
 * encima: por eso el fondo es el de la marca y no un gris claro que la haría ilegible) para que nada salte al cargar.
 * Ya incluye el único <h1> de la página.
 */
export function HomeSkeleton() {
  return (
    <div aria-busy="true">
      <h1 className="sr-only">{t("app.name")}</h1>
      <p role="status" className="sr-only">
        {t("shop.home.loading")}
      </p>
      <div aria-hidden="true" className={cn("bg-primary", heroHeightClass)} />
      <div aria-hidden="true" className="px-[var(--gutter)] pb-12 pt-16 lg:pt-[4.25rem]">
        <Skeleton className="h-8 w-56" />
        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="aspect-[5/7] w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

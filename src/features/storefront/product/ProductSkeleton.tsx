import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";

/**
 * Esqueleto de la ficha: reserva el espacio de las imágenes y de la columna de datos para que no haya saltos. Mide lo
 * mismo que la ficha real: en móvil la imagen es 3:4 con una tira de miniaturas debajo (la galería), en escritorio 4:5; y
 * ocupa al menos la altura de la pantalla para que el pie quede SIEMPRE por debajo del pliegue: si no, al llegar los datos
 * el pie (un bloque enorme) baja de golpe a la vista y el salto de maquetación (CLS) superaba el límite «bueno» de 0,1.
 */
export function ProductSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid min-h-[100svh] content-start gap-x-[7vw] gap-y-8 px-[2vw] pb-16 pt-4 lg:grid-cols-[minmax(0,1.17fr)_minmax(0,1fr)] lg:pr-[8.1vw]"
    >
      <span role="status" className="sr-only">
        {t("shop.product.loading")}
      </span>
      <div className="space-y-3">
        <Skeleton className="aspect-[3/4] w-full rounded-none lg:aspect-[4/5]" />
        <div className="flex gap-2 p-1 lg:hidden">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-20 w-16 shrink-0 rounded-md" />
          ))}
        </div>
      </div>
      <div className="space-y-6 lg:mt-[7rem]">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-[4.25rem] w-full rounded-none" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

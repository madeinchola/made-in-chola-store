import { lazy, Suspense, type ComponentType } from "react";
import { t } from "@/i18n";

/**
 * Pantalla cargada bajo demanda: el panel de administración vive en chunks aparte, así la tienda pública no descarga su
 * código. Se usa `React.lazy` (y no la propiedad `lazy` de la ruta) porque funciona igual con un router de datos que con
 * `useRoutes`. Mientras llega el código se anuncia la carga a los lectores de pantalla y se reserva TODA la altura de la
 * pantalla (`min-h-[100svh]`): así el pie de página queda siempre por debajo del pliegue y no «salta» fuera de la vista
 * cuando la pantalla aparece (con 70 vh el pie se veía y, al cargar, bajaba de golpe: CLS 0,107 en la ficha en móvil).
 */
export function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Page = lazy(() => load().then((module) => ({ default: module[name] as ComponentType })));
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-live="polite"
          className="min-h-[100svh] p-8 text-center text-muted-foreground"
        >
          {t("guard.loading")}
        </div>
      }
    >
      <Page />
    </Suspense>
  );
}

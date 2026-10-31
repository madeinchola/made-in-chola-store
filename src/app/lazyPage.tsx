import { lazy, Suspense, type ComponentType } from "react";
import { t } from "@/i18n";

/**
 * Pantalla cargada bajo demanda: el panel de administración vive en chunks aparte, así la tienda pública no descarga su
 * código. Se usa `React.lazy` (y no la propiedad `lazy` de la ruta) porque funciona igual con un router de datos que con
 * `useRoutes`. Mientras llega el código se anuncia la carga a los lectores de pantalla.
 */
export function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Page = lazy(() => load().then((module) => ({ default: module[name] as ComponentType })));
  return (
    <Suspense
      fallback={
        <div role="status" aria-live="polite" className="p-8 text-center text-muted-foreground">
          {t("guard.loading")}
        </div>
      }
    >
      <Page />
    </Suspense>
  );
}

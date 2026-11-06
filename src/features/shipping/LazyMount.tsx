import {
  createElement,
  lazy,
  Suspense,
  useMemo,
  useState,
  type Attributes,
  type ComponentType,
} from "react";
import { Button } from "@/components/ui/button";
import { MapBoundary } from "@/components/map/MapBoundary";
import { t } from "@/i18n";

/**
 * Monta un componente que se descarga BAJO DEMANDA (código aparte: ni Leaflet ni la libreta de direcciones viajan con
 * la página de la bolsa). Mientras baja dice `loadingText`; si la descarga falla (sin red, o un despliegue nuevo dejó el
 * archivo viejo) lo dice y deja reintentar, sin tumbar la página: `React.lazy` recuerda el fallo, por eso reintentar crea
 * un componente perezoso NUEVO. `load` debe ser una función estable (de módulo).
 */
export function LazyMount<P extends object>({
  load,
  props,
  loadingText,
  failedText,
}: {
  load: () => Promise<{ default: ComponentType<P> }>;
  props: P;
  loadingText: string;
  failedText: string;
}) {
  const [attempt, setAttempt] = useState(0);
  // `attempt` es lo que renueva el componente perezoso tras un fallo; el linter no lo ve como dependencia de `load`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const Component = useMemo(() => lazy(load) as unknown as ComponentType<P>, [load, attempt]);
  return (
    <MapBoundary
      key={attempt}
      fallback={
        <div role="alert" className="space-y-2 text-sm">
          <p>{failedText}</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t("shipping.estimator.retry")}
          </Button>
        </div>
      }
    >
      <Suspense fallback={<p className="text-sm text-muted-foreground">{loadingText}</p>}>
        {createElement(Component, props as Attributes & P)}
      </Suspense>
    </MapBoundary>
  );
}

import { useEffect, useMemo } from "react";
import { useRouteError } from "react-router-dom";
import { logger } from "@/lib/logger";
import { toAppError } from "@/lib/errors";
import { ErrorScreen } from "./ErrorScreen";

/**
 * `errorElement` de las rutas. Sin él, un fallo al renderizar una ruta (p. ej. no se pudo descargar el fragmento de una
 * pantalla del panel por falta de red o por un despliegue nuevo) lo atrapa la pantalla por defecto de React Router, que
 * muestra el mensaje y la traza técnica. Aquí se registra con una referencia y se muestra la pantalla de error normal;
 * recargar la página es la salida (un fragmento que falló queda rechazado en memoria hasta recargar).
 */
export function RouteError() {
  const error = useRouteError();
  const appError = useMemo(() => toAppError(error), [error]);
  useEffect(() => {
    logger.error("Error de ruta", { error: appError, reference: appError.correlationId });
  }, [appError]);
  return <ErrorScreen correlationId={appError.correlationId} />;
}

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { mergeListingParams } from "./filterDraft";
import { parseListingQuery, toSearchParams, type ListingQuery } from "./listParams";

/**
 * El estado del listado vive en la URL (única fuente de verdad): se lee con `parseListingQuery`, que nunca lanza ante
 * parámetros manipulados, y se escribe con `toSearchParams` conservando los parámetros ajenos (utm_…, fbclid).
 * Por defecto cada cambio es una navegación NUEVA (el botón «atrás» deshace el filtro); `replace` es solo para ajustes
 * automáticos (p. ej. saltar a la última página real).
 */
export function useListingQuery(): {
  params: URLSearchParams;
  query: ListingQuery;
  update: (next: ListingQuery, options?: { replace?: boolean }) => void;
} {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseListingQuery(params), [params]);
  const update = useCallback(
    (next: ListingQuery, options?: { replace?: boolean }) => {
      setParams(mergeListingParams(params, toSearchParams(next)), {
        replace: options?.replace ?? false,
      });
    },
    [params, setParams],
  );
  return { params, query, update };
}

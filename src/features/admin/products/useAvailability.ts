import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "../hooks";
import { adminKeys } from "../queryKeys";
import { isCodeAvailable, isSlugAvailable } from "./api";

export type Availability = "idle" | "checking" | "free" | "taken" | "error";

/**
 * Comprobación en vivo de que un código o slug está libre. Espera una pausa al escribir y solo consulta si el valor tiene
 * formato válido y cambió respecto del original (al editar, el valor propio no cuenta como ocupado). La base lo vuelve a
 * exigir al guardar: esto es solo ayuda inmediata.
 */
export function useAvailability(
  kind: "slug" | "code",
  value: string,
  options: { valid: boolean; original?: string; excludeId?: string },
): Availability {
  const debounced = useDebouncedValue(value.trim(), 350);
  const settled = debounced === value.trim();
  const skip = !options.valid || debounced === "" || debounced === options.original;
  const query = useQuery({
    queryKey: [...adminKeys.all, "availability", kind, debounced, options.excludeId ?? ""],
    queryFn: () =>
      kind === "slug"
        ? isSlugAvailable(debounced, options.excludeId)
        : isCodeAvailable(debounced, options.excludeId),
    enabled: !skip,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  if (skip) return "idle";
  if (!settled || query.isPending) return "checking";
  if (query.isError) return "error";
  return query.data ? "free" : "taken";
}

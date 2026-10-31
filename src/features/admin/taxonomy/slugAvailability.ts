import { useQuery } from "@tanstack/react-query";
import { t } from "@/i18n";
import { useDebouncedValue } from "../hooks";
import { slugCheckers } from "./hooks";
import { taxonomyKeys } from "./queryKeys";
import { SLUG_RE } from "./validation";

export type SlugState = "idle" | "checking" | "free" | "taken" | "error";

interface Args {
  table: "categories" | "collections";
  /** Lo que hay escrito ahora en el campo. */
  slug: string;
  /** La propia fila al editar: su slug actual no cuenta como ocupado. */
  excludeId?: string;
  originalSlug?: string;
}

/** Disponibilidad EN VIVO del slug (con retraso al escribir). Un slug mal formado no se consulta: ya lo marca el formulario. */
export function useSlugAvailability({ table, slug, excludeId, originalSlug }: Args): SlugState {
  const typed = slug.trim();
  const debounced = useDebouncedValue(typed, 400);
  const wellFormed = SLUG_RE.test(debounced) && debounced.length <= 80;
  const isOwn = originalSlug !== undefined && debounced === originalSlug;
  const query = useQuery({
    queryKey: taxonomyKeys.slugFree(table, debounced, excludeId ?? ""),
    queryFn: () => slugCheckers[table](debounced, excludeId),
    enabled: wellFormed && !isOwn,
    staleTime: 0,
    retry: false,
  });

  if (typed === "" || !wellFormed) return "idle";
  if (isOwn && typed === debounced) return "free";
  if (typed !== debounced || query.isPending) return "checking";
  if (query.isError) return "error";
  return query.data ? "free" : "taken";
}

/** Texto bajo el campo según el estado: `error` solo si el slug está ocupado; el resto son avisos. */
export function slugFeedback(state: SlugState): { error?: string; hint: string } {
  switch (state) {
    case "taken":
      return { error: t("admin.taxonomy.slug.taken"), hint: "" };
    case "checking":
      return { hint: t("admin.taxonomy.slug.checking") };
    case "free":
      return { hint: t("admin.taxonomy.slug.free") };
    case "error":
      return { hint: t("admin.taxonomy.slug.unchecked") };
    case "idle":
      return { hint: t("admin.taxonomy.slug.hint") };
  }
}

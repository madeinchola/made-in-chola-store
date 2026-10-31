import { X } from "lucide-react";
import { t } from "@/i18n";
import { activeFilters, type ActiveFilter } from "./filterDraft";
import { filterLabel } from "./filterLabel";
import type { ListingQuery } from "./listParams";

interface ActiveFiltersProps {
  query: ListingQuery;
  onRemove: (filter: ActiveFilter) => void;
  onClearAll: () => void;
}

/** Fichas de los filtros activos, cada una con su botón para quitarla, y «Quitar todos». */
export function ActiveFilters({ query, onRemove, onClearAll }: ActiveFiltersProps) {
  const filters = activeFilters(query);
  if (filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul aria-label={t("shop.listing.active.label")} className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const label = filterLabel(filter, query);
          return (
            <li key={`${filter.kind}-${"value" in filter ? filter.value : ""}`}>
              <button
                type="button"
                aria-label={t("shop.listing.active.remove", { label })}
                onClick={() => onRemove(filter)}
                className="inline-flex min-h-9 items-center gap-2 rounded-pill border border-input bg-background px-3 text-sm transition-colors duration-fast hover:bg-muted"
              >
                {label}
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onClearAll}
        className="eyebrow min-h-9 px-2 underline underline-offset-4 hover:opacity-70"
      >
        {t("shop.listing.active.clearAll")}
      </button>
    </div>
  );
}

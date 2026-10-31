import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingState } from "./StateViews";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Si existe, el encabezado es un botón que pide ordenar por esa clave (lo resuelve el servidor). */
  sortKey?: string;
  className?: string;
}

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

interface DataTableProps<T> {
  /** Título accesible de la tabla (se anuncia a lectores de pantalla; no se ve). */
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Recargando con datos previos en pantalla (la tabla sigue visible, marcada como ocupada). */
  refreshing?: boolean;
  error?: boolean;
  onRetry?: () => void;
  empty?: ReactNode;
  sort?: SortState;
  onSortChange?: (key: string) => void;
}

/**
 * Tabla genérica del panel con sus cuatro estados: carga, error (con reintento), vacío y datos. El orden, la búsqueda y la
 * paginación son del servidor: aquí solo se muestran y se pide el cambio. Desplazable en horizontal en pantallas angostas.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  loading = false,
  refreshing = false,
  error = false,
  onRetry,
  empty = <EmptyState>{t("admin.states.empty")}</EmptyState>,
  sort,
  onSortChange,
}: DataTableProps<T>) {
  if (error) return <ErrorState {...(onRetry ? { onRetry } : {})} />;
  if (loading && rows.length === 0) return <LoadingState />;
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="overflow-x-auto rounded-lg border" aria-busy={refreshing || undefined}>
      <table className={cn("w-full text-left text-sm", refreshing && "opacity-60")}>
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b bg-muted/60">
          <tr>
            {columns.map((col) => {
              const sorted = sort && col.sortKey === sort.key ? sort.direction : null;
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("px-3 py-2 font-medium", col.className)}
                >
                  {col.sortKey && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(col.sortKey as string)}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {col.header}
                      {sorted === "asc" && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
                      {sorted === "desc" && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowId(row)} className="border-b last:border-b-0 hover:bg-muted/40">
              {columns.map((col) => (
                <td key={col.id} className={cn("px-3 py-2 align-middle", col.className)}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

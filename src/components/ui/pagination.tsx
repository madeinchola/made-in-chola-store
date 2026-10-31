import type { MouseEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";
import { getPageItems, safePageNumber } from "./pagination-range";

interface PaginationProps {
  /** Página actual (desde 1). */
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Si se da, cada página es un enlace real (clic central, copiar enlace, SEO) y el clic normal llama a `onPageChange`. */
  getHref?: (page: number) => string;
  className?: string;
}

/** Paginación numerada de la tienda (listados). La página actual se anuncia con `aria-current="page"`. */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  getHref,
  className,
}: PaginationProps) {
  const total = safePageNumber(totalPages);
  const current = Math.min(safePageNumber(page), total);
  if (total <= 1) return null;

  const control = (
    target: number,
    content: ReactNode,
    opts: { label?: string; active?: boolean; disabled?: boolean; icon?: boolean },
  ) => {
    const classes = cn(
      buttonVariants({ variant: opts.active ? "default" : "ghost", size: "icon" }),
      "tabular-nums",
    );
    if (opts.disabled) {
      // `aria-disabled` y no `disabled`: si «Siguiente» se desactiva al llegar a la última página estando enfocado,
      // con `disabled` el foco se perdería. El clic no hace nada.
      return (
        <button type="button" aria-disabled="true" aria-label={opts.label} className={classes}>
          {content}
        </button>
      );
    }
    const common = {
      "aria-label": opts.label,
      "aria-current": opts.active ? ("page" as const) : undefined,
      className: classes,
    };
    if (getHref) {
      return (
        <a
          {...common}
          href={getHref(target)}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            // Deja pasar clic con modificador / botón central (abrir en pestaña nueva).
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            onPageChange(target);
          }}
        >
          {content}
        </a>
      );
    }
    return (
      <button type="button" {...common} onClick={() => onPageChange(target)}>
        {content}
      </button>
    );
  };

  return (
    <nav aria-label={t("ui.pagination.label")} className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <li>
          {control(current - 1, <ChevronLeft className="h-4 w-4" aria-hidden="true" />, {
            label: t("ui.pagination.prev"),
            disabled: current <= 1,
          })}
        </li>
        {getPageItems(current, total).map((item) =>
          typeof item === "number" ? (
            <li key={item}>
              {control(item, item, {
                label:
                  item === current
                    ? t("ui.pagination.current", { page: item })
                    : t("ui.pagination.page", { page: item }),
                active: item === current,
              })}
            </li>
          ) : (
            <li
              key={item}
              aria-hidden="true"
              className="flex h-10 w-6 items-end justify-center pb-2 text-muted-foreground"
            >
              {t("ui.pagination.ellipsis")}
            </li>
          ),
        )}
        <li>
          {control(current + 1, <ChevronRight className="h-4 w-4" aria-hidden="true" />, {
            label: t("ui.pagination.next"),
            disabled: current >= total,
          })}
        </li>
      </ul>
    </nav>
  );
}

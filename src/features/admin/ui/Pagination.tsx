import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { pageCount } from "./pageCount";

interface PaginationProps {
  /** Página actual (desde 1). */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Paginación del servidor: total exacto, anterior/siguiente y estado anunciado. */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = pageCount(total, pageSize);
  return (
    <nav
      aria-label={t("admin.table.pagination")}
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-muted-foreground">{t("admin.table.results", { total })}</p>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t("admin.table.prev")}
        </Button>
        <span aria-live="polite">{t("admin.table.page", { page, pages })}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          {t("admin.table.next")}
        </Button>
      </div>
    </nav>
  );
}

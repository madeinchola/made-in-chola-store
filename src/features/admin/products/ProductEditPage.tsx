import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { isStaleVersion } from "../lib/versioned";
import { ConflictBanner } from "../ui/ConflictBanner";
import { PageHeader } from "../ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { ProductStateBadge } from "../ui/badges";
import { UnsavedChangesGuard } from "../ui/UnsavedChangesGuard";
import { ColorsSizesSection } from "./edit/ColorsSizesSection";
import { DataSection } from "./edit/DataSection";
import { ImagesSection } from "./edit/ImagesSection";
import { OrganizeSection } from "./edit/OrganizeSection";
import { PreviewSection } from "./edit/PreviewSection";
import { PricesSection } from "./edit/PricesSection";
import { ProductActions } from "./edit/ProductActions";
import { PublishChecklist } from "./edit/PublishChecklist";
import { StockSection } from "./edit/StockSection";
import type { SectionProps } from "./edit/types";
import { useAdminProduct } from "./hooks";
import { useInvalidateProduct } from "./invalidate";
import { publishChecks } from "./publishChecks";
import type { DisplayState } from "./types";

const SECTION_LINKS = [
  ["sec-data", "admin.products.edit.sections.data"],
  ["sec-prices", "admin.products.edit.sections.prices"],
  ["sec-colors", "admin.products.edit.sections.colorsSizes"],
  ["sec-stock", "admin.products.edit.sections.stock"],
  ["sec-images", "admin.products.edit.sections.images"],
  ["sec-organize", "admin.products.edit.sections.organize"],
  ["sec-preview", "admin.products.edit.sections.preview"],
] as const;

/** Editor de un producto: secciones que se guardan por separado, con control de edición concurrente. */
export function ProductEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const query = useAdminProduct(id);
  const invalidate = useInvalidateProduct();
  const [conflict, setConflict] = useState(false);
  const [discardToken, setDiscardToken] = useState(0);
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set());

  const onDirtyChange = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      if (prev.has(key) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const onChanged = useCallback(() => invalidate(id), [invalidate, id]);
  const onError = useCallback((error: unknown) => {
    if (isStaleVersion(error)) setConflict(true);
  }, []);
  const reload = async () => {
    setConflict(false);
    await query.refetch();
    setDiscardToken((n) => n + 1); // con la versión ya cargada, se descartan las ediciones locales
  };

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const detail = query.data;
  if (!detail) {
    return (
      <EmptyState
        action={
          <Button asChild variant="outline">
            <Link to="/admin/productos">{t("admin.products.edit.backToList")}</Link>
          </Button>
        }
      >
        {t("admin.products.edit.notFound")}
      </EmptyState>
    );
  }

  const p = detail.product;
  const state: DisplayState = p.archived ? "archived" : p.status === "draft" ? "draft" : "active";
  const checks = publishChecks(detail);
  const section: SectionProps = { detail, onChanged, onError, onDirtyChange, discardToken };

  return (
    <>
      <UnsavedChangesGuard dirty={dirtyKeys.size > 0} />
      <PageHeader
        title={p.name}
        description={`${p.code} · /${p.slug}`}
        actions={<ProductStateBadge state={state} />}
      />
      <div className="space-y-6">
        {conflict && <ConflictBanner onReload={() => void reload()} />}
        {p.archived && (
          <div role="status" className="rounded-lg border bg-muted p-4 text-sm">
            {t("admin.products.edit.archivedBanner")}
          </div>
        )}
        {!p.archived && p.status === "draft" && (
          <div className="rounded-lg border bg-background p-4">
            <p className="mb-2 text-sm font-semibold">{t("admin.products.edit.draftBanner")}</p>
            <p className="mb-2 text-xs text-muted-foreground">
              {t("admin.products.edit.publishChecklist.title")}
            </p>
            <PublishChecklist checks={checks} />
          </div>
        )}
        <ProductActions
          detail={detail}
          onChanged={onChanged}
          onError={onError}
          onDuplicated={(newId) => navigate(`/admin/productos/${newId}`)}
        />
        <nav
          aria-label={t("admin.products.edit.title")}
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
        >
          {SECTION_LINKS.map(([anchor, key]) => (
            <a key={anchor} href={`#${anchor}`} className="text-primary hover:underline">
              {t(key)}
            </a>
          ))}
        </nav>
        <DataSection {...section} />
        <PricesSection {...section} />
        <ColorsSizesSection {...section} />
        <StockSection {...section} />
        <ImagesSection {...section} />
        <OrganizeSection {...section} />
        <PreviewSection detail={detail} />
      </div>
    </>
  );
}

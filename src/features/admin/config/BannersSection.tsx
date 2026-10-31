import { useMemo, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/datetime";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "../ui/DataTable";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setBannerActive, setBannerArchived } from "./api";
import { BannerDialog } from "./BannerDialog";
import { bannerStatus, shownBannerId, type BannerStatus } from "./bannerLogic";
import { useBanners, useInvalidateConfig } from "./hooks";
import type { Banner } from "./types";

const STATUS_TONE = {
  live: "success",
  scheduled: "info",
  expired: "neutral",
  inactive: "warning",
  archived: "neutral",
} as const satisfies Record<BannerStatus, string>;

function windowText(b: Banner): string {
  if (!b.startsAt && !b.endsAt) return t("admin.config.banners.always");
  if (b.startsAt && !b.endsAt)
    return t("admin.config.banners.from", { date: formatDateTime(b.startsAt) });
  if (!b.startsAt && b.endsAt)
    return t("admin.config.banners.until", { date: formatDateTime(b.endsAt) });
  return t("admin.config.banners.range", {
    from: formatDateTime(b.startsAt as string),
    to: formatDateTime(b.endsAt as string),
  });
}

const rowAction = (action: string, message: string) =>
  t("admin.config.banners.rowAction", { action, message });

/** Banner de noticias: lista con estado, cuál se muestra ahora, alta/edición, activar y archivar. */
export function BannersSection() {
  const banners = useBanners();
  const invalidate = useInvalidateConfig();
  const [editing, setEditing] = useState<Banner | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toArchive, setToArchive] = useState<Banner | null>(null);

  // "Ahora" se fija al recibir datos: el estado de cada banner se calcula con las mismas reglas que la vista pública.
  const now = useMemo(() => new Date(), [banners.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownId = useMemo(() => shownBannerId(banners.data ?? [], now), [banners.data, now]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (e) {
      toast.error(isStaleVersion(e) ? t("admin.conflict.body") : toAppError(e).message);
      throw e;
    } finally {
      await invalidate();
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (b: Banner) => {
    setEditing(b);
    setDialogOpen(true);
  };

  const columns: Column<Banner>[] = [
    {
      id: "message",
      header: t("admin.config.banners.columns.message"),
      cell: (b) => (
        <div>
          <p className="max-w-md break-words">{b.message}</p>
          {b.id === shownId && (
            <Badge tone="success" className="mt-1">
              {t("admin.config.banners.shownNow")}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "link",
      header: t("admin.config.banners.columns.link"),
      cell: (b) =>
        b.linkUrl ? (
          <span className="break-all font-mono text-xs">{b.linkUrl}</span>
        ) : (
          <span className="text-muted-foreground">{t("admin.config.banners.noLink")}</span>
        ),
    },
    {
      id: "window",
      header: t("admin.config.banners.columns.window"),
      cell: (b) => <span className="whitespace-nowrap">{windowText(b)}</span>,
    },
    {
      id: "state",
      header: t("admin.config.banners.columns.state"),
      cell: (b) => {
        const status = bannerStatus(b, now);
        return (
          <Badge tone={STATUS_TONE[status]}>{t(`admin.config.banners.status.${status}`)}</Badge>
        );
      },
    },
    {
      id: "actions",
      header: t("admin.config.banners.columns.actions"),
      cell: (b) => (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("admin.config.banners.editNamed", { message: b.message })}
            onClick={() => openEdit(b)}
          >
            {t("admin.actions.edit")}
          </Button>
          {!b.archived && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={rowAction(
                b.isActive
                  ? t("admin.config.banners.deactivate")
                  : t("admin.config.banners.activate"),
                b.message,
              )}
              onClick={() =>
                void run(
                  () => setBannerActive(b, !b.isActive),
                  b.isActive
                    ? t("admin.config.banners.toasts.deactivated")
                    : t("admin.config.banners.toasts.activated"),
                ).catch(() => undefined)
              }
            >
              {b.isActive
                ? t("admin.config.banners.deactivate")
                : t("admin.config.banners.activate")}
            </Button>
          )}
          {b.archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={rowAction(t("admin.config.banners.restore"), b.message)}
              onClick={() =>
                void run(
                  () => setBannerArchived(b, false),
                  t("admin.config.banners.toasts.restored"),
                ).catch(() => undefined)
              }
            >
              {t("admin.config.banners.restore")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={rowAction(t("admin.config.banners.archive"), b.message)}
              onClick={() => setToArchive(b)}
            >
              {t("admin.config.banners.archive")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <SectionCard
      id="banners"
      title={t("admin.config.banners.title")}
      description={t("admin.config.banners.description")}
      actions={
        <Button type="button" onClick={openCreate}>
          {t("admin.config.banners.new")}
        </Button>
      }
    >
      {banners.isSuccess && (
        <p className="mb-3 text-sm text-muted-foreground">
          {shownId ? t("admin.config.banners.shownNow") : t("admin.config.banners.noShown")}
        </p>
      )}
      <DataTable
        caption={t("admin.config.banners.title")}
        columns={columns}
        rows={banners.data ?? []}
        getRowId={(b) => b.id}
        loading={banners.isPending}
        refreshing={banners.isFetching && !banners.isPending}
        error={banners.isError}
        onRetry={() => void banners.refetch()}
        empty={<EmptyState>{t("admin.config.banners.empty")}</EmptyState>}
      />

      <BannerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        banner={editing}
        onSaved={() => invalidate()}
      />
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t("admin.config.banners.confirmArchive.title")}
        description={t("admin.config.banners.confirmArchive.body")}
        confirmLabel={t("admin.config.banners.confirmArchive.confirm")}
        destructive
        onConfirm={() =>
          run(
            () => setBannerArchived(toArchive as Banner, true),
            t("admin.config.banners.toasts.archived"),
          )
        }
      />
    </SectionCard>
  );
}

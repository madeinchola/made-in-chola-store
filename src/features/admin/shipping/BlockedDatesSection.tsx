import { useMemo, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ConflictBanner } from "../ui/ConflictBanner";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setBlockedDateArchived } from "./api";
import { BlockedDialog, type BlockedTarget } from "./BlockedDialog";
import { splitBlockedDates } from "./BlockedLogic";
import { useBlockedDates, useInvalidateShipping, useShippingMutation } from "./hooks";
import { formatShortDate, todayInLaPaz } from "./SlotsDates";
import type { BlockedDate } from "./types";

const TOUCH = "h-11";

const dateText = (d: BlockedDate) => formatShortDate(d.blockedOn, { year: true });

function ActionButton(props: ButtonProps) {
  return <Button type="button" variant="ghost" size="sm" {...props} className={TOUCH} />;
}

function BlockedRow({
  date,
  past,
  onEdit,
  onArchive,
  onRestore,
}: {
  date: BlockedDate;
  past: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const named = { date: dateText(date) };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-1">
      <time dateTime={date.blockedOn} className="font-medium tabular-nums">
        {dateText(date)}
      </time>
      <span className="min-w-0 flex-1 basis-40 break-words text-sm text-muted-foreground">
        {date.reason ?? t("admin.shipping.delivery.blocked.noReason")}
      </span>
      {past && <Badge>{t("admin.shipping.delivery.blocked.pastBadge")}</Badge>}
      <div className="ml-auto flex flex-wrap gap-1">
        {date.archived ? (
          <ActionButton
            aria-label={t("admin.shipping.delivery.blocked.restoreNamed", named)}
            onClick={onRestore}
          >
            {t("admin.actions.restore")}
          </ActionButton>
        ) : (
          <>
            <ActionButton
              aria-label={t("admin.shipping.delivery.blocked.editNamed", named)}
              onClick={onEdit}
            >
              {t("admin.actions.edit")}
            </ActionButton>
            <ActionButton
              aria-label={t("admin.shipping.delivery.blocked.archiveNamed", named)}
              onClick={onArchive}
            >
              {t("admin.actions.archive")}
            </ActionButton>
          </>
        )}
      </div>
    </li>
  );
}

/** Fechas bloqueadas (feriados, cierres): próximas, pasadas y archivadas; alta, edición del motivo, archivo y restauración. */
export function BlockedDatesSection() {
  const blocked = useBlockedDates();
  const invalidate = useInvalidateShipping();
  const archive = useShippingMutation((v: { date: BlockedDate; archived: boolean }) =>
    setBlockedDateArchived(v.date.id, v.date.updatedAt, v.archived),
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<BlockedTarget>({ kind: "create" });
  const [toArchive, setToArchive] = useState<BlockedDate | null>(null);
  const [conflict, setConflict] = useState(false);

  // «Hoy» se fija al recibir datos: la lista se reparte con el día de La Paz, no con el de UTC ni el del navegador.
  const today = useMemo(() => todayInLaPaz(), [blocked.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => splitBlockedDates(blocked.data ?? [], today), [blocked.data, today]);

  const openCreate = () => {
    setTarget({ kind: "create" });
    setDialogOpen(true);
  };
  const openEdit = (date: BlockedDate) => {
    setTarget({ kind: "edit", date });
    setDialogOpen(true);
  };

  const run = async (date: BlockedDate, archived: boolean) => {
    try {
      await archive.mutateAsync({ date, archived });
      toast.success(
        archived
          ? t("admin.shipping.delivery.blocked.toasts.archived")
          : t("admin.shipping.delivery.blocked.toasts.restored"),
      );
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
        return;
      }
      toast.error(toAppError(e).message);
      throw e;
    }
  };

  const group = (id: string, title: string, list: BlockedDate[], options: { past: boolean }) =>
    list.length > 0 && (
      <section aria-labelledby={`blocked-${id}`} className="space-y-2">
        <h3 id={`blocked-${id}`} className="font-display text-sm font-semibold">
          {title}
        </h3>
        <ul className="space-y-2">
          {list.map((date) => (
            <BlockedRow
              key={date.id}
              date={date}
              past={options.past}
              onEdit={() => openEdit(date)}
              onArchive={() => setToArchive(date)}
              onRestore={() => void run(date, false).catch(() => undefined)}
            />
          ))}
        </ul>
      </section>
    );

  const hasAny = (blocked.data ?? []).length > 0;
  let body;
  if (blocked.isError) body = <ErrorState onRetry={() => void blocked.refetch()} />;
  else if (blocked.isPending) body = <LoadingState />;
  else if (!hasAny) {
    body = (
      <EmptyState
        action={
          <Button type="button" className={TOUCH} onClick={openCreate}>
            {t("admin.shipping.delivery.blocked.new")}
          </Button>
        }
      >
        {t("admin.shipping.delivery.blocked.empty")}
      </EmptyState>
    );
  } else {
    body = (
      <div className="space-y-5" aria-busy={blocked.isFetching || undefined}>
        {conflict && (
          <ConflictBanner
            onReload={() => {
              setConflict(false);
              void invalidate();
            }}
          />
        )}
        {group("upcoming", t("admin.shipping.delivery.blocked.upcoming"), groups.upcoming, {
          past: false,
        })}
        {group("past", t("admin.shipping.delivery.blocked.past"), groups.past, { past: true })}
        {group("archived", t("admin.shipping.delivery.blocked.archived"), groups.archived, {
          past: false,
        })}
      </div>
    );
  }

  return (
    <SectionCard
      id="blocked-dates"
      title={t("admin.shipping.delivery.blocked.title")}
      description={t("admin.shipping.delivery.blocked.description")}
      actions={
        hasAny && (
          <Button type="button" className={TOUCH} onClick={openCreate}>
            {t("admin.shipping.delivery.blocked.new")}
          </Button>
        )
      }
    >
      {body}
      <BlockedDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        target={target}
        existing={blocked.data ?? []}
        today={today}
      />
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t("admin.shipping.delivery.blocked.confirmArchive.title")}
        description={t("admin.shipping.delivery.blocked.confirmArchive.body", {
          date: toArchive ? dateText(toArchive) : "",
        })}
        confirmLabel={t("admin.shipping.delivery.blocked.confirmArchive.confirm")}
        destructive
        onConfirm={() => run(toArchive as BlockedDate, true)}
      />
    </SectionCard>
  );
}

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setGroupArchived } from "./api";
import { GroupDialog } from "./GroupDialog";
import { GroupMembersDialog } from "./GroupMembersDialog";
import { archiveImpactText, memberCountText, sortGroups } from "./GroupsLogic";
import {
  useDiscountMutation,
  useDiscounts,
  useGroups,
  useInvalidateDiscounts,
  useMembers,
} from "./hooks";
import type { CustomerGroup } from "./types";

const G = "admin.discounts.groups" as const;

/** Cuántas personas tiene un grupo; si no tiene ninguna, lo avisa (nadie recibiría su precio). */
function MemberCount({ group }: { group: CustomerGroup }) {
  const members = useMembers(group.id);
  if (members.isPending) return <span aria-hidden="true">{t(`${G}.members.loading`)}</span>;
  if (members.isError) return <span>{t(`${G}.members.error`)}</span>;
  if (members.data.length > 0) return <span>{memberCountText(members.data.length)}</span>;
  return (
    <div className="min-w-[9rem]">
      <Badge tone="warning">{memberCountText(0)}</Badge>
      {!group.archived && (
        <p className="mt-1 text-xs text-muted-foreground">{t(`${G}.noMembersWarning`)}</p>
      )}
    </div>
  );
}

/** Grupos de clientes (para el «precio por tipo de cliente»): lista, alta y edición, miembros, archivar y restaurar. */
export function GroupsPage() {
  const groups = useGroups();
  const discounts = useDiscounts();
  const invalidate = useInvalidateDiscounts();
  const archive = useDiscountMutation((v: { group: CustomerGroup; archived: boolean }) =>
    setGroupArchived(v.group.id, v.group.updatedAt, v.archived),
  );

  const [editing, setEditing] = useState<CustomerGroup | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [membersOf, setMembersOf] = useState<CustomerGroup | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [toArchive, setToArchive] = useState<CustomerGroup | null>(null);

  const rows = useMemo(() => sortGroups(groups.data ?? []), [groups.data]);

  const run = async (group: CustomerGroup, archived: boolean, success: string) => {
    try {
      await archive.mutateAsync({ group, archived });
      toast.success(success);
    } catch (e) {
      toast.error(isStaleVersion(e) ? t("admin.conflict.body") : toAppError(e).message);
      // Si alguien cambió el grupo, la lista debe mostrar ya la versión nueva.
      void invalidate();
      throw e;
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const archiveDescription = (group: CustomerGroup): string =>
    [t(`${G}.confirmArchive.body`), archiveImpactText(group.id, discounts.data ?? [])]
      .filter((part) => part !== "")
      .join(" ");

  const columns: Column<CustomerGroup>[] = [
    {
      id: "name",
      header: t(`${G}.columns.name`),
      cell: (g) => (
        <div className="min-w-[10rem] max-w-sm">
          <p className="break-words font-medium">{g.name}</p>
          <p className="break-words text-xs text-muted-foreground">
            {g.description ?? t(`${G}.noDescription`)}
          </p>
        </div>
      ),
    },
    {
      id: "members",
      header: t(`${G}.columns.members`),
      cell: (g) => <MemberCount group={g} />,
    },
    {
      id: "status",
      header: t(`${G}.columns.status`),
      cell: (g) => (
        <Badge tone={g.archived ? "neutral" : "success"}>
          {t(g.archived ? `${G}.status.archived` : `${G}.status.active`)}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: t(`${G}.columns.actions`),
      cell: (g) => (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            aria-label={t(`${G}.actions.membersNamed`, { name: g.name })}
            onClick={() => {
              setMembersOf(g);
              setMembersOpen(true);
            }}
          >
            {t(`${G}.actions.members`)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            aria-label={t(`${G}.actions.editNamed`, { name: g.name })}
            onClick={() => {
              setEditing(g);
              setDialogOpen(true);
            }}
          >
            {t("admin.actions.edit")}
          </Button>
          {g.archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t(`${G}.actions.restoreNamed`, { name: g.name })}
              onClick={() => void run(g, false, t(`${G}.toasts.restored`)).catch(() => undefined)}
            >
              {t("admin.actions.restore")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t(`${G}.actions.archiveNamed`, { name: g.name })}
              onClick={() => setToArchive(g)}
            >
              {t("admin.actions.archive")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <SectionCard
      id="groups"
      title={t(`${G}.title`)}
      description={t(`${G}.description`)}
      actions={
        <Button type="button" className="min-h-11" onClick={openCreate}>
          {t(`${G}.new`)}
        </Button>
      }
    >
      <DataTable
        caption={t(`${G}.title`)}
        columns={columns}
        rows={rows}
        getRowId={(g) => g.id}
        loading={groups.isPending}
        refreshing={groups.isFetching && !groups.isPending}
        error={groups.isError}
        onRetry={() => void groups.refetch()}
        empty={
          <EmptyState
            action={
              <Button type="button" className="min-h-11" onClick={openCreate}>
                {t(`${G}.emptyAction`)}
              </Button>
            }
          >
            {t(`${G}.empty`)}
          </EmptyState>
        }
      />

      <GroupDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        group={editing}
        existing={groups.data ?? []}
      />
      <GroupMembersDialog group={membersOf} open={membersOpen} onOpenChange={setMembersOpen} />
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t(`${G}.confirmArchive.title`, { name: toArchive?.name ?? "" })}
        description={toArchive ? archiveDescription(toArchive) : ""}
        confirmLabel={t(`${G}.confirmArchive.confirm`)}
        destructive
        onConfirm={() => run(toArchive as CustomerGroup, true, t(`${G}.toasts.archived`))}
      />
    </SectionCard>
  );
}

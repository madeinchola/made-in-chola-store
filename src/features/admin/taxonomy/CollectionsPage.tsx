import { useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil } from "lucide-react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reorderChanges } from "../products/imageOrder";
import { isStaleVersion } from "../lib/versioned";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { PageHeader } from "../ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { CollectionDialog, type CollectionDialogTarget } from "./CollectionDialog";
import { ConflictBanner } from "./ConflictBanner";
import { SortableItem } from "./SortableItem";
import { collectionStatus } from "./collectionStatus";
import { reorderAccessibility, useReorderSensors } from "./dnd";
import { useAdminCollections, useReorderCollections, useSetCollectionArchived } from "./hooks";
import { moveWithin } from "./tree";
import type { AdminCollection, CollectionStatus } from "./types";
import { windowText } from "./windowText";

type Confirm = { kind: "archive" | "restore"; collection: AdminCollection };

const STATUS_TONE = {
  active: "success",
  scheduled: "info",
  expired: "warning",
  archived: "neutral",
} as const satisfies Record<CollectionStatus, string>;

const byOrder = (a: AdminCollection, b: AdminCollection) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es");

/** Colecciones: lista con vigencia y estado, crear/editar, archivar/restaurar y reordenar (ratón o teclado). */
export function CollectionsPage() {
  const query = useAdminCollections();
  const setArchived = useSetCollectionArchived();
  const reorder = useReorderCollections();
  const sensors = useReorderSensors();
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<CollectionDialogTarget | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [conflict, setConflict] = useState(false);

  const all = query.data;
  const visible = useMemo(
    () => (all ? all.filter((c) => showArchived || !c.archived).sort(byOrder) : []),
    [all, showArchived],
  );
  const nameOf = useMemo(() => (id: string) => all?.find((c) => c.id === id)?.name ?? "", [all]);
  const now = new Date();

  const applyOrder = async (orderedIds: string[]) => {
    const byId = new Map(visible.map((c) => [c.id, c]));
    const desired = orderedIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [{ id, sortOrder: c.sortOrder }] : [];
    });
    const changes = reorderChanges(desired).flatMap((ch) => {
      const c = byId.get(ch.id);
      return c ? [{ id: ch.id, sortOrder: ch.sortOrder, updatedAt: c.updatedAt }] : [];
    });
    if (changes.length === 0) return;
    try {
      await reorder.mutateAsync(changes);
      toast.success(t("admin.taxonomy.collections.messages.reordered"));
    } catch (error) {
      if (isStaleVersion(error)) setConflict(true);
      else
        toast.error(
          t("admin.taxonomy.errors.reorderFailed", { message: toAppError(error).message }),
        );
    }
  };

  const move = (c: AdminCollection, direction: "up" | "down") =>
    void applyOrder(
      moveWithin(
        visible.map((v) => v.id),
        c.id,
        direction,
      ),
    );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = visible.map((c) => c.id);
    void applyOrder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  const reload = () => {
    setConflict(false);
    void query.refetch();
  };

  const confirmAction = async () => {
    if (!confirm) return;
    const archived = confirm.kind === "archive";
    try {
      await setArchived.mutateAsync({ collection: confirm.collection, archived });
      toast.success(t(`admin.taxonomy.collections.messages.${archived ? "archived" : "restored"}`));
    } catch (error) {
      if (isStaleVersion(error)) {
        setConflict(true);
        return;
      }
      toast.error(toAppError(error).message);
      throw error;
    }
  };

  return (
    <>
      <PageHeader
        title={t("admin.taxonomy.collections.title")}
        description={t("admin.taxonomy.collections.description")}
        actions={
          <Button type="button" onClick={() => setDialog({ kind: "create" })}>
            {t("admin.taxonomy.collections.new")}
          </Button>
        }
      />
      {conflict && <ConflictBanner onReload={reload} />}
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          className="h-4 w-4"
        />
        {t("admin.taxonomy.collections.showArchived")}
      </label>

      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <LoadingState />
      ) : visible.length === 0 ? (
        <EmptyState>
          {all && all.length > 0
            ? t("admin.taxonomy.collections.emptyOnlyArchived")
            : t("admin.taxonomy.collections.empty")}
        </EmptyState>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={reorderAccessibility(nameOf)}
        >
          <SortableContext items={visible.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ul aria-label={t("admin.taxonomy.collections.listLabel")} className="space-y-2">
              {visible.map((c, index) => {
                const status = collectionStatus(c, now);
                return (
                  <SortableItem
                    key={c.id}
                    id={c.id}
                    disabled={reorder.isPending}
                    dragLabel={t("admin.taxonomy.collections.row.drag", { name: c.name })}
                  >
                    {(handle) => (
                      <div
                        className={cn(
                          "flex flex-wrap items-center gap-2 rounded-lg border bg-background px-2 py-2",
                          c.archived && "opacity-70",
                        )}
                      >
                        {handle}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{c.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            /{c.slug} · {windowText(c)}
                          </p>
                        </div>
                        <Badge tone={STATUS_TONE[status]}>
                          {t(`admin.taxonomy.status.${status}`)}
                        </Badge>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={reorder.isPending || index === 0}
                            aria-label={t("admin.taxonomy.collections.row.moveUp", {
                              name: c.name,
                            })}
                            title={t("admin.taxonomy.collections.row.moveUp", { name: c.name })}
                            onClick={() => move(c, "up")}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={reorder.isPending || index === visible.length - 1}
                            aria-label={t("admin.taxonomy.collections.row.moveDown", {
                              name: c.name,
                            })}
                            title={t("admin.taxonomy.collections.row.moveDown", { name: c.name })}
                            onClick={() => move(c, "down")}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t("admin.taxonomy.collections.row.edit", { name: c.name })}
                            title={t("admin.taxonomy.collections.row.edit", { name: c.name })}
                            onClick={() => setDialog({ kind: "edit", collection: c })}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t(
                              c.archived
                                ? "admin.taxonomy.collections.row.restore"
                                : "admin.taxonomy.collections.row.archive",
                              { name: c.name },
                            )}
                            title={t(
                              c.archived
                                ? "admin.taxonomy.collections.row.restore"
                                : "admin.taxonomy.collections.row.archive",
                              { name: c.name },
                            )}
                            onClick={() =>
                              setConfirm({
                                kind: c.archived ? "restore" : "archive",
                                collection: c,
                              })
                            }
                          >
                            {c.archived ? (
                              <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Archive className="h-4 w-4" aria-hidden="true" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </SortableItem>
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <CollectionDialog
        target={dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={(message) => toast.success(message)}
        onConflict={() => setConflict(true)}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm
            ? t(`admin.taxonomy.collections.${confirm.kind}.title`, {
                name: confirm.collection.name,
              })
            : ""
        }
        description={confirm ? t(`admin.taxonomy.collections.${confirm.kind}.body`) : ""}
        confirmLabel={confirm ? t(`admin.taxonomy.collections.${confirm.kind}.confirm`) : ""}
        destructive={confirm?.kind === "archive"}
        onConfirm={confirmAction}
      />
    </>
  );
}

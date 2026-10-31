import { useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
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
import { CategoryDialog, type CategoryDialogTarget } from "./CategoryDialog";
import { ConflictBanner } from "./ConflictBanner";
import { SortableItem } from "./SortableItem";
import { reorderAccessibility, useReorderSensors } from "./dnd";
import { useAdminCategories, useReorderCategories, useSetCategoryArchived } from "./hooks";
import { buildCategoryTree, moveWithin, siblingsOf, type CategoryTreeNode } from "./tree";
import type { AdminCategory } from "./types";

type Confirm = { kind: "archive" | "restore"; category: AdminCategory };

interface LevelProps {
  nodes: readonly CategoryTreeNode[];
  busy: boolean;
  onEdit: (c: AdminCategory) => void;
  onAddChild: (c: AdminCategory) => void;
  onToggleArchived: (c: AdminCategory) => void;
  onMove: (c: AdminCategory, direction: "up" | "down") => void;
}

/** Un nivel del árbol: las hermanas se pueden reordenar entre sí (mover a otro padre se hace editando la categoría). */
function TreeLevel({ nodes, busy, ...handlers }: LevelProps) {
  return (
    <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
      <ul className="space-y-2">
        {nodes.map((node, index) => (
          <SortableItem
            key={node.id}
            id={node.id}
            disabled={busy}
            dragLabel={t("admin.taxonomy.categories.row.drag", { name: node.name })}
          >
            {(handle) => (
              <>
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-lg border bg-background px-2 py-2",
                    node.archived && "opacity-70",
                  )}
                >
                  {handle}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {node.name}
                      {node.archived && <Badge>{t("admin.taxonomy.categories.archivedTag")}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      /{node.slug} ·{" "}
                      {node.children.length > 0
                        ? t("admin.taxonomy.categories.childrenCount", {
                            count: node.children.length,
                          })
                        : (node.description ?? t("admin.taxonomy.categories.noDescription"))}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || index === 0}
                      aria-label={t("admin.taxonomy.categories.row.moveUp", { name: node.name })}
                      title={t("admin.taxonomy.categories.row.moveUp", { name: node.name })}
                      onClick={() => handlers.onMove(node, "up")}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || index === nodes.length - 1}
                      aria-label={t("admin.taxonomy.categories.row.moveDown", { name: node.name })}
                      title={t("admin.taxonomy.categories.row.moveDown", { name: node.name })}
                      onClick={() => handlers.onMove(node, "down")}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    {!node.archived && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("admin.taxonomy.categories.row.addChild", {
                          name: node.name,
                        })}
                        title={t("admin.taxonomy.categories.row.addChild", { name: node.name })}
                        onClick={() => handlers.onAddChild(node)}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("admin.taxonomy.categories.row.edit", { name: node.name })}
                      title={t("admin.taxonomy.categories.row.edit", { name: node.name })}
                      onClick={() => handlers.onEdit(node)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t(
                        node.archived
                          ? "admin.taxonomy.categories.row.restore"
                          : "admin.taxonomy.categories.row.archive",
                        { name: node.name },
                      )}
                      title={t(
                        node.archived
                          ? "admin.taxonomy.categories.row.restore"
                          : "admin.taxonomy.categories.row.archive",
                        { name: node.name },
                      )}
                      onClick={() => handlers.onToggleArchived(node)}
                    >
                      {node.archived ? (
                        <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Archive className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
                {node.children.length > 0 && (
                  <div className="ml-6 mt-2 border-l pl-3">
                    <TreeLevel nodes={node.children} busy={busy} {...handlers} />
                  </div>
                )}
              </>
            )}
          </SortableItem>
        ))}
      </ul>
    </SortableContext>
  );
}

/** Categorías: árbol jerárquico con crear/editar, archivar/restaurar y reordenar (ratón o teclado). */
export function CategoriesPage() {
  const query = useAdminCategories();
  const setArchived = useSetCategoryArchived();
  const reorder = useReorderCategories();
  const sensors = useReorderSensors();
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<CategoryDialogTarget | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [conflict, setConflict] = useState(false);

  const categories = query.data;
  const tree = useMemo(
    () => (categories ? buildCategoryTree(categories, { showArchived }) : []),
    [categories, showArchived],
  );
  const nameOf = useMemo(
    () => (id: string) => categories?.find((c) => c.id === id)?.name ?? "",
    [categories],
  );

  /** Aplica un nuevo orden de hermanas escribiendo solo las filas que cambian. */
  const applyOrder = async (parentId: string | null, orderedIds: string[]) => {
    if (!categories) return;
    const siblings = new Map(
      siblingsOf(categories, parentId, { showArchived }).map((c) => [c.id, c]),
    );
    const desired = orderedIds.flatMap((id) => {
      const c = siblings.get(id);
      return c ? [{ id, sortOrder: c.sortOrder }] : [];
    });
    const changes = reorderChanges(desired).flatMap((ch) => {
      const c = siblings.get(ch.id);
      return c ? [{ id: ch.id, sortOrder: ch.sortOrder, updatedAt: c.updatedAt }] : [];
    });
    if (changes.length === 0) return;
    try {
      await reorder.mutateAsync(changes);
      toast.success(t("admin.taxonomy.categories.messages.reordered"));
    } catch (error) {
      if (isStaleVersion(error)) setConflict(true);
      else
        toast.error(
          t("admin.taxonomy.errors.reorderFailed", { message: toAppError(error).message }),
        );
    }
  };

  const move = (category: AdminCategory, direction: "up" | "down") => {
    if (!categories) return;
    const ids = siblingsOf(categories, category.parentId, { showArchived }).map((c) => c.id);
    void applyOrder(category.parentId, moveWithin(ids, category.id, direction));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!categories || !over || active.id === over.id) return;
    const from = categories.find((c) => c.id === active.id);
    const to = categories.find((c) => c.id === over.id);
    // Solo entre hermanas: cambiar de padre se hace editando la categoría (así no se crean ciclos por accidente).
    if (!from || !to || from.parentId !== to.parentId) return;
    const ids = siblingsOf(categories, from.parentId, { showArchived }).map((c) => c.id);
    void applyOrder(from.parentId, arrayMove(ids, ids.indexOf(from.id), ids.indexOf(to.id)));
  };

  const reload = () => {
    setConflict(false);
    void query.refetch();
  };

  const confirmAction = async () => {
    if (!confirm) return;
    const archived = confirm.kind === "archive";
    try {
      await setArchived.mutateAsync({ category: confirm.category, archived });
      toast.success(t(`admin.taxonomy.categories.messages.${archived ? "archived" : "restored"}`));
    } catch (error) {
      if (isStaleVersion(error)) {
        setConflict(true); // se cierra el diálogo y se muestra el aviso
        return;
      }
      toast.error(toAppError(error).message); // la regla de la base va en español; el diálogo sigue abierto
      throw error;
    }
  };

  return (
    <>
      <PageHeader
        title={t("admin.taxonomy.categories.title")}
        description={t("admin.taxonomy.categories.description")}
        actions={
          <Button type="button" onClick={() => setDialog({ kind: "create", parentId: null })}>
            {t("admin.taxonomy.categories.new")}
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
        {t("admin.taxonomy.categories.showArchived")}
      </label>

      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <LoadingState />
      ) : tree.length === 0 ? (
        <EmptyState>
          {categories && categories.length > 0
            ? t("admin.taxonomy.categories.emptyOnlyArchived")
            : t("admin.taxonomy.categories.empty")}
        </EmptyState>
      ) : (
        <nav aria-label={t("admin.taxonomy.categories.treeLabel")}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={reorderAccessibility(nameOf)}
          >
            <TreeLevel
              nodes={tree}
              busy={reorder.isPending}
              onEdit={(c) => setDialog({ kind: "edit", category: c })}
              onAddChild={(c) => setDialog({ kind: "create", parentId: c.id })}
              onToggleArchived={(c) =>
                setConfirm({ kind: c.archived ? "restore" : "archive", category: c })
              }
              onMove={move}
            />
          </DndContext>
        </nav>
      )}

      <CategoryDialog
        target={dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        categories={categories ?? []}
        onSaved={(message) => toast.success(message)}
        onConflict={() => setConflict(true)}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm
            ? t(`admin.taxonomy.categories.${confirm.kind}.title`, { name: confirm.category.name })
            : ""
        }
        description={confirm ? t(`admin.taxonomy.categories.${confirm.kind}.body`) : ""}
        confirmLabel={confirm ? t(`admin.taxonomy.categories.${confirm.kind}.confirm`) : ""}
        destructive={confirm?.kind === "archive"}
        onConfirm={confirmAction}
      />
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, ArrowRight, GripVertical, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import { toAppError } from "@/lib/errors";
import { isStaleVersion } from "../../lib/versioned";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { SectionCard } from "../../ui/PageHeader";
import { archiveImage, saveImageOrder, updateImage, uploadProductImage } from "../api";
import { moveToFront, reorderChanges } from "../imageOrder";
import { coverImage, isImageVisible } from "./coverImage";
import { ALLOWED_IMAGE_TYPES, prepareImage } from "../imageProcessing";
import type { AdminColor, AdminImage } from "../types";
import type { SectionProps } from "./types";

type UploadStatus = "queued" | "uploading" | "done" | "failed";
interface UploadItem {
  key: string;
  file: File;
  status: UploadStatus;
  error?: string;
}

const uploadErrorMessage = (name: string, error: unknown): string => {
  const code = error instanceof Error ? error.message : "";
  if (code === "type" || code === "empty" || code === "too_large") {
    return t(`admin.products.images.errors.${code}`, { name });
  }
  return t("admin.products.images.errors.generic", { name });
};

interface CardProps {
  image: AdminImage;
  index: number;
  total: number;
  colors: AdminColor[];
  /** Es la portada REAL (la primera imagen que la tienda muestra). */
  isCover: boolean;
  /** La tienda no la muestra: está asignada a un color archivado. */
  hidden: boolean;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onMakeCover: (id: string) => void;
  onRemove: (image: AdminImage) => void;
  onPatch: (image: AdminImage, patch: { alt?: string | null; color_id?: string | null }) => void;
}

function ImageCard({
  image,
  index,
  total,
  colors,
  isCover,
  hidden,
  busy,
  onMove,
  onMakeCover,
  onRemove,
  onPatch,
}: CardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });
  const [alt, setAlt] = useState(image.alt ?? "");
  useEffect(() => setAlt(image.alt ?? ""), [image.alt, image.updatedAt]);
  const label = t("admin.products.images.imageN", { n: index + 1 });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border bg-background p-3 ${isDragging ? "z-10 opacity-70 shadow-lg" : ""}`}
    >
      <div className="relative">
        <img
          src={productImageUrl(image.path)}
          alt={image.alt ?? label}
          loading="lazy"
          className="aspect-[4/5] w-full rounded object-cover"
        />
        {isCover && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            <Star className="h-3 w-3" aria-hidden="true" />
            {t("admin.products.images.cover")}
          </span>
        )}
      </div>
      {hidden && (
        <p className="mt-2 text-xs text-amber-800">{t("admin.products.images.hiddenNote")}</p>
      )}
      <div className="mt-2 flex items-center justify-between gap-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("admin.products.images.dragHandle", { name: label })}
          className="cursor-grab rounded p-1 hover:bg-muted"
        >
          <GripVertical className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="text-sm font-medium">{label}</span>
        <div className="flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || index === 0}
            aria-label={`${t("admin.products.images.moveUp")}: ${label}`}
            onClick={() => onMove(index, index - 1)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || index === total - 1}
            aria-label={`${t("admin.products.images.moveDown")}: ${label}`}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="mt-2 space-y-2">
        <Field label={`${t("admin.products.images.alt")} (${label})`}>
          <Input
            value={alt}
            maxLength={200}
            onChange={(e) => setAlt(e.target.value)}
            onBlur={() => {
              const next = alt.trim() === "" ? null : alt.trim();
              if (next !== image.alt) onPatch(image, { alt: next });
            }}
          />
        </Field>
        <Field label={`${t("admin.products.images.color")} (${label})`}>
          <Select
            value={image.colorId ?? ""}
            disabled={busy}
            onChange={(e) =>
              onPatch(image, { color_id: e.target.value === "" ? null : e.target.value })
            }
          >
            <option value="">{t("admin.products.images.colorAny")}</option>
            {/* un color archivado solo se ofrece si la imagen sigue asignada a él (para poder cambiarla) */}
            {colors
              .filter((c) => !c.archived || c.id === image.colorId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.archived ? t("admin.products.images.colorArchived", { name: c.name }) : c.name}
                </option>
              ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2">
          {!isCover && !hidden && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onMakeCover(image.id)}
            >
              {t("admin.products.images.makeCover")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`${t("admin.products.images.remove")}: ${label}`}
            onClick={() => onRemove(image)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("admin.actions.remove")}
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Imágenes del producto: subida múltiple (se reducen antes de subir), orden por arrastre o botones, color y texto alternativo. */
export function ImagesSection({ detail, onChanged, onError }: SectionProps) {
  const productId = detail.product.id;
  const [order, setOrder] = useState<string[]>(() => detail.images.map((i) => i.id));
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [toRemove, setToRemove] = useState<AdminImage | null>(null);
  const uploadingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // El orden local sigue al del servidor cada vez que éste cambia (tras subir, quitar o reordenar).
  const serverKey = detail.images.map((i) => `${i.id}:${i.sortOrder}`).join("|");
  useEffect(() => setOrder(detail.images.map((i) => i.id)), [serverKey, detail.images]);

  const byId = new Map(detail.images.map((i) => [i.id, i]));
  const ordered = order.flatMap((id) => byId.get(id) ?? []);
  const cover = coverImage(ordered, detail.colors);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fail = (e: unknown) => {
    if (!isStaleVersion(e))
      toast.error(t("admin.products.errors.unexpected"), { description: toAppError(e).message });
    onError(e);
  };

  const persistOrder = async (ids: string[]) => {
    const previous = order;
    setOrder(ids);
    setBusy(true);
    try {
      const changes = reorderChanges(ids.flatMap((id) => byId.get(id) ?? []));
      if (changes.length > 0) {
        await saveImageOrder(changes);
        toast.success(t("admin.products.images.reordered"));
        await onChanged();
      }
    } catch (e) {
      setOrder(previous);
      fail(e);
      // un fallo a mitad puede haber escrito parte del orden (cada fila es una escritura): se muestra el estado real
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const move = (from: number, to: number) => void persistOrder(arrayMove(order, from, to));
  const makeCover = (id: string) => void persistOrder(moveToFront(order, id));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from >= 0 && to >= 0) move(from, to);
  };

  const patch = async (
    image: AdminImage,
    change: { alt?: string | null; color_id?: string | null },
  ) => {
    setBusy(true);
    try {
      await updateImage(image, change);
      await onChanged();
    } catch (e) {
      fail(e);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const runUploads = async (items: UploadItem[]) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    const setStatus = (key: string, status: UploadStatus, error?: string) =>
      setQueue((q) =>
        q.map((i) =>
          i.key === key ? { ...i, status, ...(error ? { error } : { error: undefined }) } : i,
        ),
      );
    const placed: { sortOrder: number }[] = detail.images.map((i) => ({ sortOrder: i.sortOrder }));
    try {
      for (const item of items) {
        setStatus(item.key, "uploading");
        try {
          const prepared = await prepareImage(item.file);
          // copia: `placed` sigue creciendo y quien reciba la lista no debe verla cambiar bajo sus pies
          const saved = await uploadProductImage(productId, prepared, [...placed]);
          placed.push({ sortOrder: saved.sortOrder });
          setStatus(item.key, "done");
        } catch (e) {
          setStatus(item.key, "failed", uploadErrorMessage(item.file.name, e));
        }
      }
    } finally {
      uploadingRef.current = false;
      await onChanged();
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items: UploadItem[] = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      status: "queued",
    }));
    setQueue((q) => [...q.filter((i) => i.status !== "done"), ...items]);
    if (inputRef.current) inputRef.current.value = "";
    void runUploads(items);
  };

  const retry = (item: UploadItem) => void runUploads([item]);
  const pending = queue.filter((i) => i.status === "queued" || i.status === "uploading").length;
  const done = queue.filter((i) => i.status === "done").length;

  return (
    <SectionCard
      id="sec-images"
      title={t("admin.products.edit.sections.images")}
      description={t("admin.products.images.intro")}
    >
      <div className="mb-4">
        <label className="inline-flex cursor-pointer items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 has-[:disabled]:opacity-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2">
          {t("admin.products.images.add")}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            className="sr-only"
            disabled={pending > 0}
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.products.images.dropHint")}</p>
      </div>

      {queue.length > 0 && (
        <div className="mb-4 rounded-lg border p-3" aria-live="polite">
          {pending > 0 && (
            <p className="mb-2 text-sm font-medium">
              {t("admin.products.images.uploading", { done, total: queue.length })}
            </p>
          )}
          <ul className="space-y-1 text-sm">
            {queue.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-2">
                <span className="truncate">{item.file.name}</span>
                <span
                  className={
                    item.status === "failed" ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {item.status === "queued" && t("admin.products.images.queued")}
                  {item.status === "uploading" && t("admin.products.images.uploadingOne")}
                  {item.status === "done" && t("admin.products.images.done")}
                  {item.status === "failed" && (item.error ?? t("admin.products.images.failed"))}
                </span>
                {item.status === "failed" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending > 0}
                    onClick={() => retry(item)}
                  >
                    {t("admin.products.images.retry")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.products.images.empty")}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: { draggable: t("admin.products.images.dndInstructions") },
            announcements: {
              onDragStart: ({ active }: DragStartEvent) =>
                t("admin.products.images.dndStart", { n: order.indexOf(String(active.id)) + 1 }),
              onDragOver: ({ active, over }) =>
                over
                  ? t("admin.products.images.dndOver", {
                      n: order.indexOf(String(active.id)) + 1,
                      pos: order.indexOf(String(over.id)) + 1,
                      total: order.length,
                    })
                  : undefined,
              onDragEnd: ({ active, over }) =>
                t("admin.products.images.dndEnd", {
                  n: order.indexOf(String(active.id)) + 1,
                  pos:
                    (over ? order.indexOf(String(over.id)) : order.indexOf(String(active.id))) + 1,
                  total: order.length,
                }),
              onDragCancel: ({ active }) =>
                t("admin.products.images.dndCancel", { n: order.indexOf(String(active.id)) + 1 }),
            },
          }}
        >
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <ul
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              aria-label={t("admin.products.edit.sections.images")}
            >
              {ordered.map((image, index) => (
                <ImageCard
                  key={image.id}
                  image={image}
                  index={index}
                  total={ordered.length}
                  colors={detail.colors}
                  isCover={image.id === cover?.id}
                  hidden={!isImageVisible(image, detail.colors)}
                  busy={busy}
                  onMove={move}
                  onMakeCover={makeCover}
                  onRemove={setToRemove}
                  onPatch={(img, change) => void patch(img, change)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {toRemove && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setToRemove(null)}
          title={t("admin.products.images.confirmRemove.title")}
          description={t("admin.products.images.confirmRemove.body")}
          confirmLabel={t("admin.products.images.confirmRemove.confirm")}
          destructive
          onConfirm={async () => {
            try {
              await archiveImage(toRemove);
              await onChanged();
            } catch (e) {
              fail(e);
              throw e;
            }
          }}
        />
      )}
    </SectionCard>
  );
}

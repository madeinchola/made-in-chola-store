import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableItemProps {
  id: string;
  /** Nombre accesible del asa de arrastre ("Arrastrar Ropa para reordenar"). */
  dragLabel: string;
  disabled?: boolean;
  /** Recibe el asa de arrastre para colocarla donde convenga dentro de la fila. */
  children: (handle: ReactNode) => ReactNode;
}

/** Elemento de una lista reordenable. El asa es un botón: se arrastra con ratón o con el teclado (Espacio + flechas). */
export function SortableItem({ id, dragLabel, disabled = false, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={dragLabel}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 w-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("list-none", isDragging && "relative z-10 opacity-60")}
    >
      {children(handle)}
    </li>
  );
}

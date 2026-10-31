import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DndContextProps,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { t } from "@/i18n";

/** Arrastre con el ratón (con un pequeño umbral para no confundirlo con un clic) y con el teclado. */
export function useReorderSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** Anuncios y instrucciones en ESPAÑOL para lectores de pantalla (dnd-kit los trae en inglés por defecto). */
export function reorderAccessibility(
  nameOf: (id: string) => string,
): NonNullable<DndContextProps["accessibility"]> {
  const name = (id: string | number) => nameOf(String(id));
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("admin.taxonomy.dnd.pickedUp", { name: name(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("admin.taxonomy.dnd.movedOver", { name: name(active.id), over: name(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("admin.taxonomy.dnd.dropped", { name: name(active.id), over: name(over.id) })
        : t("admin.taxonomy.dnd.droppedOutside", { name: name(active.id) }),
    onDragCancel: ({ active }) => t("admin.taxonomy.dnd.cancelled", { name: name(active.id) }),
  };
  return {
    announcements,
    screenReaderInstructions: { draggable: t("admin.taxonomy.dnd.instructions") },
  };
}

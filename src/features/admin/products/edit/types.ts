import type { AdminProductDetail } from "../types";

/** Lo que recibe cada sección del editor de producto. */
export interface SectionProps {
  detail: AdminProductDetail;
  /** Refresca el detalle (y las cachés relacionadas) tras guardar. */
  onChanged: () => Promise<unknown>;
  /** Un error al guardar: el editor decide si es un conflicto de edición o un error para mostrar. */
  onError: (error: unknown) => void;
  /** La sección avisa si tiene cambios sin guardar (para la guarda de navegación). */
  onDirtyChange: (key: string, dirty: boolean) => void;
  /** Sube cada vez que el usuario pide "Recargar la versión actual": ahí SÍ se descartan las ediciones locales. */
  discardToken?: number;
}

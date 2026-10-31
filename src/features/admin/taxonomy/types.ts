export interface AdminCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  archived: boolean;
  /** Versión de la fila: se devuelve tal cual al guardar (control de edición concurrente). */
  updatedAt: string;
}

export interface AdminCollection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** ISO/UTC o null (sin inicio). */
  startsAt: string | null;
  /** ISO/UTC o null (sin fin). */
  endsAt: string | null;
  sortOrder: number;
  archived: boolean;
  updatedAt: string;
}

export type CollectionStatus = "active" | "scheduled" | "expired" | "archived";

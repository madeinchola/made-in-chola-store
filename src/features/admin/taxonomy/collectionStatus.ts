import type { AdminCollection, CollectionStatus } from "./types";

/**
 * Estado de una colección en `now`. Mismas reglas que la vista pública `public_collections`:
 * visible si no está archivada, `starts_at <= now` (inicio INCLUIDO) y `ends_at > now` (fin EXCLUIDO).
 */
export function collectionStatus(
  c: Pick<AdminCollection, "archived" | "startsAt" | "endsAt">,
  now: Date,
): CollectionStatus {
  if (c.archived) return "archived";
  const t = now.getTime();
  if (c.startsAt !== null && new Date(c.startsAt).getTime() > t) return "scheduled";
  if (c.endsAt !== null && new Date(c.endsAt).getTime() <= t) return "expired";
  return "active";
}

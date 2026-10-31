import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import { dayRangeIso, type AuditListParams } from "./listParams";
import { isAuditAction } from "./tables";
import type { AuditActor, AuditPage, AuditRow } from "./types";

/**
 * Página del registro de auditoría (solo lectura: más recientes primero, con total exacto), filtrada y paginada EN EL
 * SERVIDOR. Los días se interpretan en hora de La Paz (ver `dayRangeIso`). Luego resuelve el nombre de quien hizo cada cambio.
 */
export async function listAuditLog(params: AuditListParams): Promise<AuditPage> {
  const sb = getSupabase();
  let query = sb.from("audit_log").select("*", { count: "exact" });
  if (params.table) query = query.eq("table_name", params.table);
  if (params.action) query = query.eq("action", params.action);
  if (params.actorId) query = query.eq("actor_id", params.actorId);
  const range = dayRangeIso(params.from, params.to);
  if (range.gte) query = query.gte("occurred_at", range.gte);
  if (range.lt) query = query.lt("occurred_at", range.lt);

  const from = (Math.max(1, params.page) - 1) * params.pageSize;
  const ordered = query
    .order("occurred_at", { ascending: false })
    // El id desempata: dos cambios en el mismo instante no deben cambiar de página al paginar.
    .order("id", { ascending: false });
  const { data, error, count } = await ordered.range(from, from + params.pageSize - 1);
  if (error?.code === "PGRST103") {
    // Página más allá del final (URL a mano): PostgREST responde 416. No es un fallo: página vacía con el total real,
    // para que la pantalla vuelva a la última página válida.
    const first = await ordered.range(0, 0);
    if (first.error) throw fromDbError(first.error);
    return { rows: [], total: first.count ?? 0 };
  }
  if (error) throw fromDbError(error);

  const rows = data ?? [];
  const actorIds = [...new Set(rows.flatMap((r) => (r.actor_id ? [r.actor_id] : [])))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const profiles = await sb.from("profiles").select("id,full_name").in("id", actorIds);
    if (profiles.error) throw fromDbError(profiles.error);
    for (const p of profiles.data ?? []) names.set(p.id, p.full_name);
  }

  return {
    total: count ?? 0,
    rows: rows.map((r): AuditRow => ({
      id: r.id,
      occurredAt: r.occurred_at,
      actorId: r.actor_id,
      actorName: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
      actorRole: r.actor_role,
      tableName: r.table_name,
      recordId: r.record_id,
      // La base lo restringe con un CHECK; un valor inesperado se trata como modificación antes que romper la pantalla.
      action: isAuditAction(r.action) ? r.action : "UPDATE",
      diff: r.diff,
    })),
  };
}

/** Administradores, para el filtro "Quién" (las personas que pueden haber hecho cambios desde el panel). */
export async function listAdminActors(): Promise<AuditActor[]> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id,full_name")
    .eq("role", "admin")
    .order("full_name");
  if (error) throw fromDbError(error);
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name }));
}

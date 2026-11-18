import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import type { LegalKind } from "@/features/legal/types";
import type {
  AcceptanceStat,
  OverviewRow,
  VersionDetail,
  VersionStatus,
  VersionSummary,
} from "./types";

/**
 * Acceso a datos del panel de Textos legales. Todo pasa por funciones SQL que exigen ser administrador por dentro: las tablas de
 * versiones y aceptaciones no se leen ni se escriben desde el navegador.
 */
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const obj = (v: unknown): Row =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : {};
const list = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await (
    getSupabase().rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (error) throw fromDbError(error as { message: string; code?: string });
  return data;
}

const mapSummary = (r: Row): VersionSummary => ({
  version: num(r.version),
  status: str(r.status) as VersionStatus,
  effectiveAt: strOrNull(r.effective_at),
  publishedAt: strOrNull(r.published_at),
  changeNote: strOrNull(r.change_note),
});

export async function fetchOverview(): Promise<OverviewRow[]> {
  return list(await rpc("admin_legal_overview")).map((r) => ({
    kind: str(r.kind) as LegalKind,
    title: str(r.title),
    requiresAcceptance: r.requires_acceptance === true,
    currentVersion: numOrNull(r.current_version),
    currentEffectiveAt: strOrNull(r.current_effective_at),
    hasDraft: r.has_draft === true,
    versions: list(r.versions).map(mapSummary),
  }));
}

/** Sin `version`: el borrador si lo hay y, si no, la última versión. `null` = el documento todavía no tiene versiones. */
export async function fetchVersion(
  kind: LegalKind,
  version?: number,
): Promise<VersionDetail | null> {
  const raw = await rpc("admin_legal_get", { p_kind: kind, p_version: version ?? null });
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Row;
  return {
    id: str(r.id),
    kind: str(r.kind) as LegalKind,
    version: num(r.version),
    status: str(r.status) as VersionStatus,
    body: str(r.body),
    changeNote: strOrNull(r.change_note),
    effectiveAt: strOrNull(r.effective_at),
    publishedAt: strOrNull(r.published_at),
    updatedAt: strOrNull(r.updated_at),
  };
}

export async function saveDraft(
  kind: LegalKind,
  body: string,
  note: string | null,
): Promise<{ version: number }> {
  const raw = obj(
    await rpc("admin_legal_save_draft", { p_kind: kind, p_body: body, p_note: note }),
  );
  return { version: num(raw.version) };
}

export async function discardDraft(kind: LegalKind): Promise<void> {
  await rpc("admin_legal_discard_draft", { p_kind: kind });
}

/** `effectiveAt` en formato ISO con zona; `null` = desde ahora. */
export async function publishVersion(
  kind: LegalKind,
  effectiveAt: string | null,
  note: string | null,
): Promise<{ version: number; effectiveAt: string | null }> {
  const raw = obj(
    await rpc("admin_legal_publish", {
      p_kind: kind,
      p_effective_at: effectiveAt,
      p_note: note,
    }),
  );
  return { version: num(raw.version), effectiveAt: strOrNull(raw.effective_at) };
}

export async function fetchAcceptanceStats(): Promise<AcceptanceStat[]> {
  return list(await rpc("admin_legal_acceptance_stats")).map((r) => ({
    kind: str(r.kind) as LegalKind,
    version: num(r.version),
    accounts: num(r.accounts),
    orders: num(r.orders),
  }));
}

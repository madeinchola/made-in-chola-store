import { callFunction } from "@/lib/functions";
import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import type { AcceptedLegal, LegalDocument, LegalKind, RequiredLegal } from "./types";

/**
 * Lectura pública de los textos legales VIGENTES (funciones que solo devuelven lo publicado y ya vigente) y aceptación de nuevas
 * versiones. El registro y el checkout mandan las versiones que aceptó la persona junto con su petición; aquí solo viven la lectura y
 * la «aceptar de nuevo».
 */
type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

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

function mapDocument(raw: unknown): LegalDocument | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Raw;
  return {
    kind: String(r.kind) as LegalKind,
    title: String(r.title ?? ""),
    requiresAcceptance: r.requires_acceptance === true,
    version: typeof r.version === "number" ? r.version : null,
    effectiveAt: str(r.effective_at),
    changeNote: str(r.change_note),
    body: str(r.body),
  };
}

export async function fetchLegalDocument(kind: LegalKind): Promise<LegalDocument | null> {
  return mapDocument(await rpc("public_legal_document", { p_kind: kind }));
}

export async function fetchLegalIndex(): Promise<LegalDocument[]> {
  const raw = (await rpc("public_legal_index")) as unknown;
  return (Array.isArray(raw) ? raw : []).flatMap((r) => {
    const doc = mapDocument(r);
    return doc ? [doc] : [];
  });
}

const toRequired = (raw: unknown): RequiredLegal => {
  const out: RequiredLegal = {};
  if (typeof raw === "object" && raw !== null) {
    const r = raw as Raw;
    if (typeof r.terms === "number") out.terms = r.terms;
    if (typeof r.privacy === "number") out.privacy = r.privacy;
  }
  return out;
};

export async function fetchRequiredLegal(): Promise<RequiredLegal> {
  return toRequired(await rpc("public_legal_required"));
}

/** Lo que a la persona que entró todavía le falta aceptar (en su versión vigente). */
export async function fetchPendingLegal(): Promise<RequiredLegal> {
  return toRequired(await rpc("my_legal_pending"));
}

/** ¿Son las mismas versiones? (la aceptación solo vale para las que la persona tenía delante al marcar la casilla). */
export function sameRequired(a: RequiredLegal, b: RequiredLegal): boolean {
  return a.terms === b.terms && a.privacy === b.privacy;
}

/** Las versiones listas para mandar al servidor (solo los documentos que se exigen). */
export function toAccepted(required: RequiredLegal): AcceptedLegal {
  return {
    ...(required.terms !== undefined ? { legal_terms: required.terms } : {}),
    ...(required.privacy !== undefined ? { legal_privacy: required.privacy } : {}),
  };
}

export type AcceptResult = { ok: true } | { ok: false; code: string };

export async function acceptLegalAgain(
  versions: RequiredLegal,
  token: string,
): Promise<AcceptResult> {
  const result = await callFunction("legal-accept", toAccepted(versions), { token });
  return result.ok ? { ok: true } : { ok: false, code: result.code };
}

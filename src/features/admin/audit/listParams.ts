import { fromLaPazInputValue } from "@/lib/datetime";
import { isAuditTable, type AuditAction, type AuditTable } from "./tables";

export const AUDIT_PAGE_SIZE = 25;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface AuditListParams {
  table?: AuditTable;
  action?: AuditAction;
  actorId?: string;
  /** Día (AAAA-MM-DD, hora de La Paz), inclusive. */
  from?: string;
  /** Día (AAAA-MM-DD, hora de La Paz), inclusive. */
  to?: string;
  /** Desde 1. */
  page: number;
  pageSize: number;
}

export const DEFAULT_AUDIT_PARAMS: AuditListParams = { page: 1, pageSize: AUDIT_PAGE_SIZE };

// Valores de la URL en español.
const ACTION_BY_URL: Record<string, AuditAction> = {
  creado: "INSERT",
  editado: "UPDATE",
  eliminado: "DELETE",
};
const URL_BY_ACTION: Record<AuditAction, string> = {
  INSERT: "creado",
  UPDATE: "editado",
  DELETE: "eliminado",
};

/** ¿Es una fecha REAL del calendario? ("2026-02-30" tiene buen formato pero no existe.) */
export function isValidDay(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** URL → parámetros. Todo valor inválido cae al valor por defecto; un rango invertido descarta el "hasta". */
export function parseAuditParams(sp: URLSearchParams): AuditListParams {
  const params: AuditListParams = { ...DEFAULT_AUDIT_PARAMS };
  const table = sp.get("tabla");
  if (isAuditTable(table)) params.table = table;
  const action = ACTION_BY_URL[sp.get("accion") ?? ""];
  if (action) params.action = action;
  const actor = sp.get("actor");
  if (actor && UUID_RE.test(actor)) params.actorId = actor;
  const from = sp.get("desde");
  if (from && isValidDay(from)) params.from = from;
  const to = sp.get("hasta");
  if (to && isValidDay(to) && !(params.from && params.from > to)) params.to = to;
  const rawPage = sp.get("pagina") ?? "";
  if (/^[1-9]\d{0,5}$/.test(rawPage) && Number(rawPage) <= 100_000) params.page = Number(rawPage);
  return params;
}

/** Parámetros → URL, sin los valores por defecto. */
export function toAuditSearchParams(p: AuditListParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.table) sp.set("tabla", p.table);
  if (p.action) sp.set("accion", URL_BY_ACTION[p.action]);
  if (p.actorId) sp.set("actor", p.actorId);
  if (p.from) sp.set("desde", p.from);
  if (p.to) sp.set("hasta", p.to);
  if (p.page > 1) sp.set("pagina", String(p.page));
  return sp;
}

export const hasAuditFilters = (p: AuditListParams): boolean =>
  Boolean(p.table || p.action || p.actorId || p.from || p.to);

export type AuditPatch = { [K in keyof AuditListParams]?: AuditListParams[K] | undefined };

/** Aplica un cambio y vuelve a la página 1, salvo que el cambio indique otra página. `undefined` quita el filtro. */
export function applyAuditPatch(params: AuditListParams, patch: AuditPatch): AuditListParams {
  const next: Record<string, unknown> = { ...params, page: 1 };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as unknown as AuditListParams;
}

/**
 * Rango [gte, lt) en UTC de los días elegidos, interpretados en hora de La Paz: desde el inicio del día "desde" hasta el
 * inicio del día SIGUIENTE a "hasta" (el día "hasta" entra completo). La Paz no tiene horario de verano: un día = 24 h.
 */
export function dayRangeIso(from?: string, to?: string): { gte?: string; lt?: string } {
  const range: { gte?: string; lt?: string } = {};
  if (from && isValidDay(from)) {
    const iso = fromLaPazInputValue(`${from}T00:00`);
    if (iso) range.gte = iso;
  }
  if (to && isValidDay(to)) {
    const iso = fromLaPazInputValue(`${to}T00:00`);
    if (iso) range.lt = new Date(new Date(iso).getTime() + DAY_MS).toISOString();
  }
  return range;
}

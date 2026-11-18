import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import {
  PAGE_SIZE,
  type ComplaintFilter,
  type ComplaintKind,
  type ComplaintPage,
  type ComplaintRow,
  type ComplaintStatus,
  type ComplaintSummary,
} from "./types";

/** Acceso a datos del panel de Reclamos: la tabla no se lee directo (ni el administrador); todo pasa por funciones que exigen ser admin por dentro. */
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const obj = (v: unknown): Row =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : {};

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

const mapRow = (r: Row): ComplaintRow => ({
  id: str(r.id),
  number: str(r.number),
  createdAt: str(r.created_at),
  kind: str(r.kind) as ComplaintKind,
  status: str(r.status) as ComplaintStatus,
  contactName: str(r.contact_name),
  contactEmail: strOrNull(r.contact_email),
  contactPhone: strOrNull(r.contact_phone),
  orderNumber: strOrNull(r.order_number),
  detail: str(r.detail),
  response: strOrNull(r.response),
  dueAt: str(r.due_at),
  answeredAt: strOrNull(r.answered_at),
  overdue: r.overdue === true,
  hasAccount: r.has_account === true,
});

const STATUS_FOR: Record<ComplaintFilter, string | null> = {
  open: "open",
  all: null,
  answered: "answered",
  closed: "closed",
};

export async function listComplaints(
  filter: ComplaintFilter,
  page: number,
): Promise<ComplaintPage> {
  const data = await rpc("admin_complaints", {
    p_status: STATUS_FOR[filter],
    p_offset: (page - 1) * PAGE_SIZE,
    p_limit: PAGE_SIZE,
  });
  const rows = (Array.isArray(data) ? data : []).map((r) => obj(r));
  return { rows: rows.map(mapRow), total: rows.length > 0 ? num(rows[0]!.total_count) : 0 };
}

export async function complaintSummary(): Promise<ComplaintSummary> {
  const r = obj(await rpc("admin_complaints_summary"));
  return {
    new: num(r.new),
    inReview: num(r.in_review),
    overdue: num(r.overdue),
    total: num(r.total),
  };
}

export async function updateComplaint(
  id: string,
  status: ComplaintStatus,
  response: string | null,
): Promise<void> {
  await rpc("admin_complaint_update", { p_id: id, p_status: status, p_response: response });
}

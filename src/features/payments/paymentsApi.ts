import { AppError } from "@/lib/errors";
import { callFunction } from "@/lib/functions";
import { getSupabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { parsePaymentView } from "./paymentsMapping";
import { checkProofFile, proofPath, type ProofProblem } from "./proofFile";
import type { PaymentView } from "./types";

const PROOFS_BUCKET = "payment-proofs";
const QR_BUCKET = "payment-qr";

async function sessionToken(): Promise<string | undefined> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? undefined;
  } catch {
    return undefined;
  }
}

/** Lo que la clienta ve de su pago. `null` = el pedido no existe o no es suyo (el servidor responde igual). */
export async function getPaymentView(orderId: string): Promise<PaymentView | null> {
  const { data, error } = await getSupabase().rpc("customer_payment_view", { p_order_id: orderId });
  if (error) throw new AppError("unknown", t("pay.loadError.title"), { cause: error });
  return parsePaymentView(data);
}

/** URL pública de la imagen del QR de la tienda (el bucket es público: es la imagen que ve cualquiera que paga). */
export function qrImageUrl(path: string): string {
  return getSupabase().storage.from(QR_BUCKET).getPublicUrl(path).data.publicUrl;
}

export type UploadProblem =
  | ProofProblem
  | "payment_closed"
  | "proof_pending"
  | "too_many_proofs"
  | "invalid_file"
  | "file_missing"
  | "not_found"
  | "rate_limited"
  | "login"
  | "network"
  | "unknown";

export type UploadResult =
  { ok: true; proofId: string | null } | { ok: false; problem: UploadProblem };

interface SubmitResponse {
  ok: boolean;
  outcome: string;
  proof_id?: string | null;
  reason?: string;
}

const KNOWN: readonly UploadProblem[] = [
  "payment_closed",
  "proof_pending",
  "too_many_proofs",
  "invalid_file",
  "file_missing",
  "not_found",
];

/**
 * Sube un comprobante en dos pasos: (1) el archivo va DIRECTO al bucket privado, a la carpeta de la clienta (la política de
 * Storage valida la ruta, el pedido y el tope), y (2) la función `payments` lo revisa de verdad (tipo real, tamaño, huella) y lo
 * registra. Si el paso 2 lo rechaza, la función borra el archivo. Nunca lanza.
 */
export async function uploadProof(input: {
  userId: string;
  orderId: string;
  paymentId: string;
  file: Blob;
  /** El identificador de ESTE archivo elegido: al reintentar tras un corte de red se reutiliza la misma ruta (no se sube otro). */
  fileId?: string;
}): Promise<UploadResult> {
  const check = await checkProofFile(input.file);
  if (!check.ok) return { ok: false, problem: check.problem };
  const fileId = input.fileId ?? crypto.randomUUID();
  const path = proofPath(input.userId, input.orderId, fileId, check.ext);

  const upload = await getSupabase()
    .storage.from(PROOFS_BUCKET)
    .upload(path, input.file, { contentType: check.mime, upsert: false });
  if (upload.error) {
    const status = String((upload.error as { statusCode?: string | number }).statusCode);
    // Ya estaba subido (un reintento tras un corte de red, con la misma ruta): se sigue con el registro.
    const already = status === "409" || /already exists|duplicate/i.test(upload.error.message);
    if (!already) {
      // La política de Storage dice que no cuando el cobro ya se cerró, el pedido no es suyo o se pasó del tope de archivos.
      const denied =
        status === "403" || /row-level security|violates|not allowed/i.test(upload.error.message);
      return { ok: false, problem: denied ? "payment_closed" : "network" };
    }
  }

  const token = await sessionToken();
  const result = await callFunction<SubmitResponse>(
    "payments",
    { action: "proof_submit", payment_id: input.paymentId, path },
    token ? { token } : {},
  );
  if (!result.ok) {
    if (result.status === 401) return { ok: false, problem: "login" };
    if (result.status === 429) return { ok: false, problem: "rate_limited" };
    return { ok: false, problem: result.code === "network" ? "network" : "unknown" };
  }
  const data = result.data;
  if (data.ok) return { ok: true, proofId: data.proof_id ?? null };
  const problem = KNOWN.find((p) => p === data.outcome);
  return { ok: false, problem: problem ?? "unknown" };
}

export type RetryResult =
  | { ok: true }
  | {
      ok: false;
      problem:
        | "order_closed"
        | "payment_blocked"
        | "payment_open"
        | "too_many_attempts"
        | "not_retryable"
        | "not_found"
        | "login"
        | "rate_limited"
        | "network"
        | "unknown";
    };

const RETRY_PROBLEMS = [
  "order_closed",
  "payment_blocked",
  "payment_open",
  "too_many_attempts",
  "not_retryable",
  "not_found",
] as const;

/** Nuevo cobro (misma orden, ventana nueva) para un pedido que sigue pendiente. */
export async function retryPayment(orderId: string): Promise<RetryResult> {
  const token = await sessionToken();
  const result = await callFunction<{ ok: boolean; outcome: string }>(
    "payments",
    { action: "retry", order_id: orderId },
    token ? { token } : {},
  );
  if (!result.ok) {
    if (result.status === 401) return { ok: false, problem: "login" };
    if (result.status === 429) return { ok: false, problem: "rate_limited" };
    return { ok: false, problem: result.code === "network" ? "network" : "unknown" };
  }
  if (result.data.ok) return { ok: true };
  const known = RETRY_PROBLEMS.find((p) => p === result.data.outcome);
  return { ok: false, problem: known ?? "unknown" };
}

/** Las líneas de un pedido (variante y cantidad) para «Volver a pedir». La RLS deja leer solo las de la propia clienta. */
export async function listOrderLines(
  orderId: string,
): Promise<{ variantId: string; qty: number }[]> {
  const { data, error } = await getSupabase()
    .from("order_items")
    .select("variant_id, qty")
    .eq("order_id", orderId)
    .order("line_no");
  if (error) throw new AppError("unknown", t("pay.reorder.failed"), { cause: error });
  return (data ?? []).map((row) => ({
    variantId: row.variant_id as string,
    qty: row.qty as number,
  }));
}

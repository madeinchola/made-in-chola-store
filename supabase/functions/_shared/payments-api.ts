import { z } from "https://esm.sh/zod@3.25.76";

/**
 * Lógica pura de la función `payments` (S11): el esquema de las peticiones de la clienta, los topes y el análisis del archivo
 * de un comprobante. Sin red ni base: se prueba entera con Deno.
 *
 * Misma decisión de S7 sobre el aviso de zod: NINGUNA petición lleva listas; el esquema es `.strict()` y el cuerpo se corta
 * en 1 kB.
 */
export const MAX_BODY_BYTES = 1024;
/** Tope de un comprobante (el bucket también lo impone). */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

export const LIMITS = {
  anyPerIp: { max: 300, windowSeconds: 60 },
  proofPerUser: { max: 10, windowSeconds: 600 },
  retryPerUser: { max: 5, windowSeconds: 600 },
} as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PROOF_PATH = new RegExp(`^(${UUID})/(${UUID})/(${UUID})\\.(jpg|jpeg|png|webp|pdf)$`);

export const paymentsRequestSchema = z.discriminatedUnion("action", [
  // Nuevo cobro (misma orden, ventana nueva) para un pedido que sigue pendiente.
  z.object({ action: z.literal("retry"), order_id: z.string().uuid() }).strict(),
  // «Ya subí el archivo»: la función lo revisa de verdad (tipo, tamaño, huella) y lo registra.
  z
    .object({
      action: z.literal("proof_submit"),
      payment_id: z.string().uuid(),
      path: z.string().max(200),
    })
    .strict(),
]);
export type PaymentsRequest = z.infer<typeof paymentsRequestSchema>;

export function userLimit(action: PaymentsRequest["action"]) {
  return action === "retry"
    ? { name: "retry", ...LIMITS.retryPerUser }
    : { name: "proof", ...LIMITS.proofPerUser };
}

/** La ruta del comprobante debe ser `{clienta}/{pedido}/{uuid}.{ext}` y la carpeta, la de quien pregunta. */
export function parseProofPath(
  path: string,
  userId: string,
): { orderId: string; ext: string } | null {
  const match = PROOF_PATH.exec(path);
  if (!match || match[1] !== userId) return null;
  return { orderId: match[2]!, ext: match[4]! };
}

export type ProofMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/**
 * El tipo REAL del archivo por sus primeros bytes. La extensión y el tipo que declara el navegador los pone quien sube: un
 * `.jpg` que en realidad es un SVG con script, un HTML o un ejecutable no pasa.
 */
export function detectProofMime(bytes: Uint8Array): ProofMime | null {
  const startsWith = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP: «RIFF» + 4 bytes de tamaño + «WEBP»
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // «%PDF-»
  return null;
}

const EXT_BY_MIME: Record<ProofMime, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

/** La extensión de la ruta debe corresponder al tipo real. */
export function extMatchesMime(ext: string, mime: ProofMime): boolean {
  return EXT_BY_MIME[mime].includes(ext);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Se copia a un ArrayBuffer propio: `crypto.subtle` no acepta vistas sobre buffers compartidos.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ProofCheck =
  | { ok: true; mime: ProofMime; hash: string; size: number }
  | { ok: false; reason: "empty" | "too_large" | "unknown_type" | "extension_mismatch" };

/** Todo lo que se comprueba de un archivo antes de registrarlo como comprobante. */
export async function checkProofFile(bytes: Uint8Array, ext: string): Promise<ProofCheck> {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > PROOF_MAX_BYTES) return { ok: false, reason: "too_large" };
  const mime = detectProofMime(bytes);
  if (!mime) return { ok: false, reason: "unknown_type" };
  if (!extMatchesMime(ext, mime)) return { ok: false, reason: "extension_mismatch" };
  return { ok: true, mime, hash: await sha256Hex(bytes), size: bytes.byteLength };
}

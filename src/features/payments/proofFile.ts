/**
 * Validación del archivo de un comprobante EN EL NAVEGADOR. Es una ayuda para la clienta (explicar el problema antes de subir);
 * la defensa real es del servidor, que vuelve a revisar el tipo REAL del archivo por sus bytes, su tamaño y su huella.
 */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export type ProofMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
export type ProofProblem = "empty" | "too_large" | "unknown_type";

const EXT: Record<ProofMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** El tipo real por los primeros bytes (la extensión y el tipo que declara el aparato los pone quien sube). */
export function detectMime(head: Uint8Array): ProofMime | null {
  const at = (sig: number[], offset = 0) =>
    head.length >= offset + sig.length && sig.every((b, i) => head[offset + i] === b);
  if (at([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

export type ProofCheck =
  { ok: true; mime: ProofMime; ext: string; size: number } | { ok: false; problem: ProofProblem };

async function readHead(file: Blob, length = 16): Promise<Uint8Array> {
  const slice = file.slice(0, length);
  if (typeof slice.arrayBuffer === "function") return new Uint8Array(await slice.arrayBuffer());
  // Entornos sin Blob.arrayBuffer (pruebas): FileReader.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

export async function checkProofFile(file: Blob): Promise<ProofCheck> {
  if (file.size === 0) return { ok: false, problem: "empty" };
  if (file.size > PROOF_MAX_BYTES) return { ok: false, problem: "too_large" };
  const mime = detectMime(await readHead(file));
  if (!mime) return { ok: false, problem: "unknown_type" };
  return { ok: true, mime, ext: EXT[mime], size: file.size };
}

/** La ruta del archivo en el bucket privado: `{clienta}/{pedido}/{uuid}.{ext}` (la política de Storage exige esta forma). */
export function proofPath(userId: string, orderId: string, fileId: string, ext: string): string {
  return `${userId}/${orderId}/${fileId}.${ext}`;
}

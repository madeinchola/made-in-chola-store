import { z } from "https://esm.sh/zod@3.25.76";
import { HttpError } from "./errors.ts";

/**
 * Lee el cuerpo como texto SIN pasar de `maxBytes`: se corta la lectura en cuanto lo supera (también si llega por
 * trozos y no declara `Content-Length`), así un cuerpo gigante nunca se carga entero en memoria. 413 si lo supera.
 */
export async function readLimitedText(req: Request, maxBytes: number): Promise<string> {
  const tooLarge = () => new HttpError(413, "payload_too_large", "La petición es demasiado grande");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Como `parseBody`, pero con tope de tamaño. Úsalo en funciones PÚBLICAS: el tope es la defensa contra el aviso de zod
 * (GHSA-mrhx-c7xc-m3w5, memoria agotada al validar colecciones enormes) sin migrar de versión, junto con esquemas que
 * solo aceptan valores escalares (ningún `z.array`).
 */
export async function parseBodyLimited<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
  maxBytes: number,
): Promise<z.infer<T>> {
  const text = await readLimitedText(req, maxBytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "El cuerpo no es JSON válido");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(
      400,
      "validation",
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

/** Parsea el body JSON contra un esquema zod; 400 con detalle de campos si falla. */
export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "El cuerpo no es JSON válido");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(
      400,
      "validation",
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

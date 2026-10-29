import { z } from "https://esm.sh/zod@3.25.76";
import { HttpError } from "./errors.ts";

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

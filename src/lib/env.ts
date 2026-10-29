import { z } from "zod";

/** JWT de Supabase con rol service_role: jamás debe llegar al bundle del navegador. */
function jwtRole(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

const schema = z.object({
  VITE_SUPABASE_URL: z.string({ required_error: "falta" }).url("no es una URL válida"),
  VITE_SUPABASE_ANON_KEY: z
    .string({ required_error: "falta" })
    .min(20, "demasiado corta para ser una clave anon")
    .refine((v) => jwtRole(v) !== "service_role", {
      message: "es una clave service_role: NUNCA debe usarse en el navegador",
    }),
  VITE_APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  VITE_SITE_URL: z.string().url("no es una URL válida").default("http://localhost:5173"),
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Configuración de entorno inválida:\n${issues.map((i) => ` - ${i}`).join("\n")}`);
    this.name = "EnvError";
    this.issues = issues;
  }
}

/** Valida y tipa las variables. Falla ruidosamente con un mensaje por variable. */
export function parseEnv(source: Record<string, unknown>): Env {
  // Las variables vacías (`VITE_X=`) cuentan como ausentes.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(import.meta.env as Record<string, unknown>);
  return cached;
}

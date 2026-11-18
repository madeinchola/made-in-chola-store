import { z } from "https://esm.sh/zod@3.25.76";
import { HttpError } from "./errors.ts";
import { clientIp, networkFingerprint } from "./rate-limit.ts";
import { serviceClient } from "./supabase.ts";

/**
 * Aceptación de los textos legales (S15). La base sabe cuáles documentos exigen aceptación y en qué versión (`public_legal_required`);
 * aquí se comprueba que quien se registra o compra mandó EXACTAMENTE esas versiones, y se registra con la huella de su red (nunca la IP).
 *
 * Los campos viajan sueltos (`legal_terms`, `legal_privacy`) y no como una lista o un objeto abierto: las peticiones del checkout son
 * `.strict()` y de 2 kB (decisión de S7 sobre el aviso de zod).
 */
export const legalFields = {
  legal_terms: z.number().int().min(1).max(100000).optional(),
  legal_privacy: z.number().int().min(1).max(100000).optional(),
} as const;

export type LegalFields = {
  legal_terms?: number | undefined;
  legal_privacy?: number | undefined;
};
export type LegalVersions = Record<string, number>;

/** Las versiones que mandó la persona, como las entiende la base. */
export function sentVersions(fields: LegalFields): LegalVersions {
  const out: LegalVersions = {};
  if (fields.legal_terms !== undefined) out.terms = fields.legal_terms;
  if (fields.legal_privacy !== undefined) out.privacy = fields.legal_privacy;
  return out;
}

/** 409 con lo vigente: la pantalla vuelve a mostrar los textos y pide leerlos de nuevo. */
export function checkLegal(required: LegalVersions, sent: LegalVersions): void {
  for (const [kind, version] of Object.entries(required)) {
    const got = sent[kind];
    if (got === undefined) {
      throw new HttpError(
        409,
        "legal_required",
        "Para continuar acepta los términos y la política de privacidad",
        {},
        { required },
      );
    }
    if (got !== version) {
      throw new HttpError(
        409,
        "legal_outdated",
        "Actualizamos los textos legales. Léelos de nuevo para continuar.",
        {},
        { required },
      );
    }
  }
}

export interface RecordInput {
  profileId: string | null;
  orderId: string | null;
  context: "register" | "checkout" | "reaccept";
  versions: LegalVersions;
  ip: string;
}

export interface LegalDeps {
  required: () => Promise<LegalVersions>;
  record: (input: RecordInput) => Promise<void>;
}

/** Lo vigente que exige aceptación y el registro, con la base real. */
export function defaultLegalDeps(): LegalDeps {
  return {
    required: async () => {
      const { data, error } = await serviceClient().rpc("public_legal_required");
      if (error) throw error;
      const out: LegalVersions = {};
      for (const [k, v] of Object.entries((data ?? {}) as Record<string, unknown>)) {
        if (typeof v === "number") out[k] = v;
      }
      return out;
    },
    record: async (input) => {
      const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const { error } = await serviceClient().rpc("record_legal_acceptance", {
        p_profile: input.profileId,
        p_order: input.orderId,
        p_context: input.context,
        p_versions: input.versions,
        p_ip_hash: await networkFingerprint(input.ip, secret),
      });
      if (error) throw error;
    },
  };
}

/** Antes de crear la cuenta o el pedido: lo que mandó coincide con lo vigente (si nada exige aceptación, no se pide nada). */
export async function assertLegalAccepted(
  fields: LegalFields,
  deps: LegalDeps,
): Promise<LegalVersions> {
  const required = await deps.required();
  checkLegal(required, sentVersions(fields));
  return required;
}

/**
 * Aceptar de nuevo (`legal-accept`): se acepta lo que la persona vio en el aviso, que puede ser SOLO una parte de lo vigente (si
 * únicamente cambiaron los términos no se le vuelve a pedir la privacidad). Cada versión que manda tiene que ser EXACTAMENTE la
 * vigente de un documento que exige aceptación; no mandar nada, habiendo algo exigido, es `legal_required`. Devuelve solo lo que
 * mandó (eso es lo que se registra: nunca se anota como aceptado algo que la persona no vio).
 */
export async function assertLegalSubset(
  fields: LegalFields,
  deps: LegalDeps,
): Promise<LegalVersions> {
  const required = await deps.required();
  if (Object.keys(required).length === 0) return {};
  const sent = sentVersions(fields);
  if (Object.keys(sent).length === 0) checkLegal(required, sent); // lanza legal_required con lo vigente
  for (const [kind, version] of Object.entries(sent)) {
    if (required[kind] !== version) {
      checkLegal({ [kind]: required[kind] ?? -1 }, { [kind]: version });
    }
  }
  return sent;
}

/**
 * Después de crear la cuenta o el pedido: se registra lo aceptado. Si la base lo rechaza (un texto cambió justo entre la comprobación
 * y el registro) NO se deshace lo creado —el pedido o la cuenta ya existen—: se avisa en el registro y la cuenta quedará «pendiente»
 * y se le pedirá aceptar de nuevo al entrar.
 */
export async function recordLegalAcceptance(
  input: Omit<RecordInput, "ip"> & { req: Request },
  deps: LegalDeps,
  onFailure: (error: unknown) => void,
): Promise<void> {
  if (Object.keys(input.versions).length === 0) return;
  try {
    await deps.record({ ...input, ip: clientIp(input.req) });
  } catch (error) {
    onFailure(error);
  }
}

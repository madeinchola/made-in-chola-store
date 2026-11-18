export type LegalKind = "terms" | "privacy" | "cookies" | "shipping" | "returns";

export const LEGAL_KINDS: readonly LegalKind[] = [
  "terms",
  "privacy",
  "cookies",
  "shipping",
  "returns",
];

/** Cada documento tiene su dirección (las de términos, privacidad, envíos y reembolsos ya existían en el pie de página). */
export const LEGAL_PATHS: Record<LegalKind, string> = {
  terms: "/legal/terminos",
  privacy: "/legal/privacidad",
  cookies: "/legal/cookies",
  shipping: "/legal/envios",
  returns: "/legal/reembolsos",
};

export interface LegalDocument {
  kind: LegalKind;
  title: string;
  requiresAcceptance: boolean;
  /** `null` = todavía no hay una versión vigente. */
  version: number | null;
  effectiveAt: string | null;
  changeNote: string | null;
  body: string | null;
}

/** Las versiones VIGENTES de los documentos que exigen aceptación. Vacío = no se exige nada (todavía no hay textos publicados). */
export type RequiredLegal = Partial<Record<"terms" | "privacy", number>>;

/** Lo que aceptó la persona, con los nombres que entiende el servidor. */
export interface AcceptedLegal {
  legal_terms?: number;
  legal_privacy?: number;
}

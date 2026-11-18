import type { LegalKind } from "@/features/legal/types";

export type VersionStatus = "draft" | "published";

export interface VersionSummary {
  version: number;
  status: VersionStatus;
  effectiveAt: string | null;
  publishedAt: string | null;
  changeNote: string | null;
}

/** Una fila de la lista: el documento, su versión vigente y todas sus versiones (la más nueva primero). */
export interface OverviewRow {
  kind: LegalKind;
  title: string;
  requiresAcceptance: boolean;
  currentVersion: number | null;
  currentEffectiveAt: string | null;
  hasDraft: boolean;
  versions: VersionSummary[];
}

/** Una versión completa, con su texto. */
export interface VersionDetail {
  id: string;
  kind: LegalKind;
  version: number;
  status: VersionStatus;
  body: string;
  changeNote: string | null;
  effectiveAt: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface AcceptanceStat {
  kind: LegalKind;
  version: number;
  accounts: number;
  orders: number;
}

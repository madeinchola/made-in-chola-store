import { useQuery } from "@tanstack/react-query";
import {
  fetchLegalDocument,
  fetchLegalIndex,
  fetchPendingLegal,
  fetchRequiredLegal,
} from "./legalApi";
import type { LegalKind } from "./types";

const MINUTE = 60_000;

export const legalKeys = {
  all: ["legal"] as const,
  document: (kind: LegalKind) => [...legalKeys.all, "document", kind] as const,
  index: () => [...legalKeys.all, "index"] as const,
  required: () => [...legalKeys.all, "required"] as const,
  pending: (userId?: string) => [...legalKeys.all, "pending", userId ?? ""] as const,
};

export const useLegalDocument = (kind: LegalKind) =>
  useQuery({
    queryKey: legalKeys.document(kind),
    queryFn: () => fetchLegalDocument(kind),
    staleTime: 5 * MINUTE,
  });

export const useLegalIndex = (enabled = true) =>
  useQuery({
    queryKey: legalKeys.index(),
    queryFn: fetchLegalIndex,
    staleTime: 5 * MINUTE,
    enabled,
  });

/** Siempre fresco: si un texto cambió mientras la persona llenaba el formulario, lo que se manda tiene que ser lo vigente. */
export const useLegalRequired = () =>
  useQuery({
    queryKey: legalKeys.required(),
    queryFn: fetchRequiredLegal,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });

/** Lo que a esta persona le falta aceptar; la llave lleva su identificador para que otra sesión no herede la respuesta. */
export const usePendingLegal = (userId: string | undefined) =>
  useQuery({
    queryKey: legalKeys.pending(userId),
    queryFn: fetchPendingLegal,
    enabled: userId !== undefined,
    staleTime: 5 * MINUTE,
  });

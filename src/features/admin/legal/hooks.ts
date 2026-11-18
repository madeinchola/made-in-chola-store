import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { legalKeys } from "@/features/legal/hooks";
import type { LegalKind } from "@/features/legal/types";
import {
  discardDraft,
  fetchAcceptanceStats,
  fetchOverview,
  fetchVersion,
  publishVersion,
  saveDraft,
} from "./api";

export const adminLegalKeys = {
  all: ["admin", "legal"] as const,
  overview: () => [...adminLegalKeys.all, "overview"] as const,
  version: (kind: LegalKind, version?: number) =>
    [...adminLegalKeys.all, "version", kind, version ?? "latest"] as const,
  stats: () => [...adminLegalKeys.all, "stats"] as const,
};

// El panel siempre lee fresco: otra persona del equipo pudo publicar mientras tanto.
const fresh = { staleTime: 0, gcTime: 0 } as const;

export const useLegalOverview = () =>
  useQuery({ queryKey: adminLegalKeys.overview(), queryFn: fetchOverview, ...fresh });

export const useLegalVersion = (kind: LegalKind, version?: number, enabled = true) =>
  useQuery({
    queryKey: adminLegalKeys.version(kind, version),
    queryFn: () => fetchVersion(kind, version),
    enabled,
    ...fresh,
  });

export const useAcceptanceStats = () =>
  useQuery({ queryKey: adminLegalKeys.stats(), queryFn: fetchAcceptanceStats, ...fresh });

/** Tras cualquier cambio se refresca el panel y lo que ve la tienda (los textos vigentes y lo que se exige al pagar). */
export function useInvalidateLegal() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminLegalKeys.all }),
      queryClient.invalidateQueries({ queryKey: legalKeys.all }),
    ]);
}

export function useSaveDraft(kind: LegalKind) {
  const invalidate = useInvalidateLegal();
  return useMutation({
    mutationFn: (input: { body: string; note: string | null }) =>
      saveDraft(kind, input.body, input.note),
    onSuccess: invalidate,
  });
}

export function useDiscardDraft(kind: LegalKind) {
  const invalidate = useInvalidateLegal();
  return useMutation({ mutationFn: () => discardDraft(kind), onSuccess: invalidate });
}

export function usePublish(kind: LegalKind) {
  const invalidate = useInvalidateLegal();
  return useMutation({
    mutationFn: (input: { effectiveAt: string | null; note: string | null }) =>
      publishVersion(kind, input.effectiveAt, input.note),
    onSuccess: invalidate,
  });
}

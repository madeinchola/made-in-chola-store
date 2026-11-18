import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { complaintSummary, listComplaints, updateComplaint } from "./api";
import type { ComplaintFilter, ComplaintStatus } from "./types";

export const complaintKeys = {
  all: ["admin", "complaints"] as const,
  list: (filter: ComplaintFilter, page: number) =>
    [...complaintKeys.all, "list", filter, page] as const,
  summary: () => [...complaintKeys.all, "summary"] as const,
};

// Siempre fresco: entra un reclamo nuevo en cualquier momento.
const fresh = { staleTime: 0, gcTime: 0 } as const;

export const useComplaints = (filter: ComplaintFilter, page: number) =>
  useQuery({
    queryKey: complaintKeys.list(filter, page),
    queryFn: () => listComplaints(filter, page),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    ...fresh,
  });

export const useComplaintSummary = () =>
  useQuery({
    queryKey: complaintKeys.summary(),
    queryFn: complaintSummary,
    refetchInterval: 60_000,
    ...fresh,
  });

export function useUpdateComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: ComplaintStatus; response: string | null }) =>
      updateComplaint(input.id, input.status, input.response),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: complaintKeys.all }),
  });
}

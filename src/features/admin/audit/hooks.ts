import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listAdminActors, listAuditLog } from "./api";
import type { AuditListParams } from "./listParams";
import { auditKeys } from "./queryKeys";

/** Mantiene la página anterior en pantalla mientras llega la siguiente (sin parpadeo al filtrar o paginar). */
export const useAuditLog = (params: AuditListParams) =>
  useQuery({
    queryKey: auditKeys.list(params),
    queryFn: () => listAuditLog(params),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

export const useAdminActors = () =>
  useQuery({ queryKey: auditKeys.actors(), queryFn: listAdminActors, staleTime: 60_000 });

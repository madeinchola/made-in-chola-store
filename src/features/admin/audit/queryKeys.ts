import { adminKeys } from "../queryKeys";
import type { AuditListParams } from "./listParams";

/** Claves de caché de Auditoría. Cuelgan de ["admin", "audit"]. */
export const auditKeys = {
  all: [...adminKeys.all, "audit"] as const,
  list: (params: AuditListParams) => [...auditKeys.all, "list", params] as const,
  actors: () => [...auditKeys.all, "actors"] as const,
};

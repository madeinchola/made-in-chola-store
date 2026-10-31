import type { AuditAction } from "./tables";

export interface AuditRow {
  id: number;
  occurredAt: string;
  actorId: string | null;
  /** Nombre de la persona (de `profiles`); null si fue el sistema o ya no se encuentra. */
  actorName: string | null;
  /** Rol con el que se hizo el cambio (`authenticated`, `service_role`…). */
  actorRole: string;
  tableName: string;
  recordId: string | null;
  action: AuditAction;
  diff: unknown;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
}

export interface AuditActor {
  id: string;
  name: string;
}

import { useState } from "react";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { renderLegal } from "@/features/legal/renderLegal";
import type { LegalKind } from "@/features/legal/types";
import { DataTable, type Column } from "../ui/DataTable";
import { useAcceptanceStats, useLegalVersion } from "./hooks";
import { formatDate, versionStatuses, type DisplayStatus } from "./logic";
import type { VersionSummary } from "./types";

const L = "admin.legal.history" as const;
const TONE = {
  draft: "warning",
  current: "success",
  scheduled: "info",
  replaced: "neutral",
} as const;

interface VersionHistoryProps {
  kind: LegalKind;
  versions: VersionSummary[];
  vars: Record<string, string>;
  /** Copiar una versión al editor como base del borrador. */
  onUseAsBase: (body: string, note: string) => void;
}

/** Todas las versiones del documento: cuál rige, qué cambió, cuántas cuentas y pedidos la aceptaron, con su texto a la vista. */
export function VersionHistory({ kind, versions, vars, onUseAsBase }: VersionHistoryProps) {
  const stats = useAcceptanceStats();
  const [viewing, setViewing] = useState<number | null>(null);
  const statuses = versionStatuses(versions);
  const accepted = new Map(
    (stats.data ?? []).filter((s) => s.kind === kind).map((s) => [s.version, s]),
  );

  const columns: Column<VersionSummary>[] = [
    { id: "version", header: t(`${L}.col.version`), cell: (v) => `v${v.version}` },
    {
      id: "status",
      header: t(`${L}.col.status`),
      cell: (v) => {
        const status: DisplayStatus = statuses.get(v.version) ?? "replaced";
        return (
          <Badge tone={TONE[status]}>{t(`${L}.${status === "draft" ? "draft" : status}`)}</Badge>
        );
      },
    },
    {
      id: "effective",
      header: t(`${L}.col.effective`),
      cell: (v) => (v.effectiveAt ? formatDate(v.effectiveAt) : t(`${L}.noNote`)),
    },
    { id: "note", header: t(`${L}.col.note`), cell: (v) => v.changeNote ?? t(`${L}.noNote`) },
    {
      id: "accepted",
      header: t(`${L}.col.accepted`),
      cell: (v) => {
        const s = accepted.get(v.version);
        return s
          ? t(`${L}.accepted`, { accounts: s.accounts, orders: s.orders })
          : t(`${L}.noAccepted`);
      },
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${L}.col.actions`)}</span>,
      cell: (v) =>
        v.status === "draft" ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            aria-label={t(`${L}.viewLabel`, { version: v.version })}
            onClick={() => setViewing(v.version)}
          >
            {t(`${L}.view`)}
          </Button>
        ),
    },
  ];

  return (
    <section aria-labelledby="legal-history" className="space-y-3">
      <h2 id="legal-history" className="font-display text-lg font-semibold">
        {t(`${L}.title`)}
      </h2>
      <p className="text-sm text-muted-foreground">{t("admin.legal.stats.help")}</p>
      <DataTable
        caption={t(`${L}.caption`)}
        columns={columns}
        rows={versions}
        getRowId={(v) => String(v.version)}
        empty={<p className="text-sm text-muted-foreground">{t(`${L}.empty`)}</p>}
      />
      {viewing !== null && (
        <ViewVersionDialog
          kind={kind}
          version={viewing}
          vars={vars}
          onClose={() => setViewing(null)}
          onUseAsBase={onUseAsBase}
        />
      )}
    </section>
  );
}

function ViewVersionDialog({
  kind,
  version,
  vars,
  onClose,
  onUseAsBase,
}: {
  kind: LegalKind;
  version: number;
  vars: Record<string, string>;
  onClose: () => void;
  onUseAsBase: (body: string, note: string) => void;
}) {
  const query = useLegalVersion(kind, version);
  const data = query.data;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(`${L}.viewTitle`, { version })}</DialogTitle>
          <DialogDescription>
            {data?.effectiveAt ? formatDate(data.effectiveAt) : ""}
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("admin.states.loading")}
          </p>
        ) : data ? (
          <div className="text-sm" data-testid="version-body">
            {renderLegal(data.body, vars, t("legal.page.missingData"))}
          </div>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {t("admin.states.errorBody")}
          </p>
        )}
        <DialogFooter>
          {data && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onUseAsBase(data.body, data.changeNote ?? "");
                onClose();
              }}
            >
              {t(`${L}.useAsBase`)}
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            {t(`${L}.viewClose`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

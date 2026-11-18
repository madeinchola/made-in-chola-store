import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { LEGAL_PATHS } from "@/features/legal/types";
import { DataTable, type Column } from "../ui/DataTable";
import { PageHeader } from "../ui/PageHeader";
import { BusinessDataNotice } from "./BusinessData";
import { useLegalOverview } from "./hooks";
import { formatDate } from "./logic";
import type { OverviewRow } from "./types";

const L = "admin.legal.list" as const;

/** Los cinco documentos legales: cuál es la versión vigente de cada uno, si hay un borrador y la entrada al editor. */
export function LegalListPage() {
  const query = useLegalOverview();
  const rows = query.data ?? [];

  const columns: Column<OverviewRow>[] = [
    {
      id: "document",
      header: t(`${L}.col.document`),
      cell: (r) => <span className="font-medium">{r.title}</span>,
    },
    {
      id: "acceptance",
      header: t(`${L}.col.acceptance`),
      cell: (r) => (
        <Badge tone={r.requiresAcceptance ? "info" : "neutral"}>
          {r.requiresAcceptance ? t(`${L}.requires`) : t(`${L}.informative`)}
        </Badge>
      ),
    },
    {
      id: "current",
      header: t(`${L}.col.current`),
      cell: (r) =>
        r.currentVersion !== null && r.currentEffectiveAt ? (
          t(`${L}.currentValue`, {
            version: r.currentVersion,
            date: formatDate(r.currentEffectiveAt),
          })
        ) : (
          <Badge tone="warning">{t(`${L}.notPublished`)}</Badge>
        ),
    },
    {
      id: "draft",
      header: t(`${L}.col.draft`),
      cell: (r) =>
        r.hasDraft ? (
          <Badge tone="warning">{t(`${L}.hasDraft`)}</Badge>
        ) : (
          <span className="text-muted-foreground">{t(`${L}.noDraft`)}</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${L}.col.actions`)}</span>,
      cell: (r) => (
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/admin/legal/${r.kind}`}
            aria-label={t(`${L}.editLabel`, { title: r.title })}
            className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11" })}
          >
            {t(`${L}.edit`)}
          </Link>
          <Link
            to={LEGAL_PATHS[r.kind]}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm", className: "min-h-11" })}
          >
            {t(`${L}.view`)}
            <span className="sr-only"> {t("legal.consent.opensNew")}</span>
          </Link>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("admin.legal.title")} description={t("admin.legal.description")} />
      <div className="space-y-6">
        <div
          role="note"
          className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{t("admin.legal.warning.title")}</p>
            <p>{t("admin.legal.warning.body")}</p>
          </div>
        </div>
        <BusinessDataNotice />
        <DataTable
          caption={t(`${L}.caption`)}
          columns={columns}
          rows={rows}
          getRowId={(r) => r.kind}
          loading={query.isLoading}
          error={query.isError}
          onRetry={() => void query.refetch()}
        />
      </div>
    </>
  );
}

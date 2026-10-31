import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/datetime";
import { DataTable, type Column } from "../ui/DataTable";
import { PageHeader } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";
import { pageCount } from "../ui/pageCount";
import { EmptyState } from "../ui/StateViews";
import { diffEntries, changeSummary, formatDiffValue } from "./diff";
import { useAdminActors, useAuditLog } from "./hooks";
import {
  applyAuditPatch,
  hasAuditFilters,
  parseAuditParams,
  toAuditSearchParams,
  type AuditPatch,
} from "./listParams";
import { AUDIT_ACTIONS, AUDIT_TABLES, isAuditTable, type AuditAction } from "./tables";
import type { AuditRow } from "./types";

const tableLabel = (name: string): string =>
  isAuditTable(name) ? t(`admin.audit.tables.${name}`) : name;

function ChangeDetail({ row }: { row: AuditRow }) {
  const entries = diffEntries(row.action, row.diff);
  const isUpdate = row.action === "UPDATE";
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-sm text-primary hover:underline">
        {t("admin.audit.detail.show")}
        <span className="sr-only">{t("admin.audit.detail.showSr", { id: row.id })}</span>
      </summary>
      <div className="mt-2 rounded-md border bg-muted/30 p-3 text-sm">
        <p className="mb-2 text-xs text-muted-foreground">
          {t("admin.audit.detail.actorRole", { role: row.actorRole })}
        </p>
        {entries.length === 0 ? (
          <p className="text-muted-foreground">{t("admin.audit.detail.empty")}</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">{t("admin.audit.detail.title")}</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="pb-1 pr-3 font-medium">
                  {t("admin.audit.detail.field")}
                </th>
                {isUpdate ? (
                  <>
                    <th scope="col" className="pb-1 pr-3 font-medium">
                      {t("admin.audit.detail.before")}
                    </th>
                    <th scope="col" className="pb-1 font-medium">
                      {t("admin.audit.detail.after")}
                    </th>
                  </>
                ) : (
                  <th scope="col" className="pb-1 font-medium">
                    {t("admin.audit.detail.value")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.key} className="border-t align-top">
                  <th scope="row" className="py-1 pr-3 font-mono text-xs font-normal">
                    {e.key}
                  </th>
                  {e.kind === "redacted" ? (
                    <td colSpan={isUpdate ? 2 : 1} className="py-1 italic text-muted-foreground">
                      {isUpdate
                        ? t("admin.audit.detail.redactedChanged")
                        : t("admin.audit.detail.redacted")}
                    </td>
                  ) : e.kind === "changed" ? (
                    <>
                      <td className="break-all py-1 pr-3">{formatDiffValue(e.old)}</td>
                      <td className="break-all py-1">{formatDiffValue(e.new)}</td>
                    </>
                  ) : (
                    <td colSpan={isUpdate ? 2 : 1} className="break-all py-1">
                      {formatDiffValue(e.value)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

function actorLabel(row: AuditRow): string {
  if (row.actorName) return row.actorName;
  return row.actorId === null ? t("admin.audit.system") : t("admin.audit.unknownActor");
}

/** Auditoría: quién cambió qué y cuándo. Solo lectura; filtros en la URL; paginación del servidor (25 por página). */
export function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parseAuditParams(searchParams), [searchParams]);
  const query = useAuditLog(params);
  const actors = useAdminActors();

  const update = (patch: AuditPatch) =>
    setSearchParams(toAuditSearchParams(applyAuditPatch(params, patch)));

  // Si la página pedida ya no existe (URL a mano), se vuelve a la última válida en vez de mostrar una tabla vacía.
  const total = query.data?.total;
  const isBeyondEnd =
    query.data !== undefined &&
    query.data.rows.length === 0 &&
    params.page > 1 &&
    !query.isFetching;
  useEffect(() => {
    if (isBeyondEnd && total !== undefined) {
      setSearchParams(toAuditSearchParams({ ...params, page: pageCount(total, params.pageSize) }), {
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBeyondEnd, total]);

  const actorOptions = useMemo(() => {
    const list = [...(actors.data ?? [])];
    // Un actor que llega por la URL y ya no es admin sigue siendo filtrable.
    if (params.actorId && !list.some((a) => a.id === params.actorId)) {
      list.push({ id: params.actorId, name: t("admin.audit.unknownActor") });
    }
    return list;
  }, [actors.data, params.actorId]);

  const columns: Column<AuditRow>[] = [
    {
      id: "when",
      header: t("admin.audit.columns.when"),
      cell: (r) => (
        <time dateTime={r.occurredAt} className="whitespace-nowrap">
          {formatDateTime(r.occurredAt)}
        </time>
      ),
    },
    { id: "actor", header: t("admin.audit.columns.actor"), cell: (r) => actorLabel(r) },
    {
      id: "what",
      header: t("admin.audit.columns.what"),
      cell: (r) => (
        <div>
          <p>{tableLabel(r.tableName)}</p>
          <p className="text-xs text-muted-foreground">{t(`admin.audit.actions.${r.action}`)}</p>
        </div>
      ),
    },
    {
      id: "record",
      header: t("admin.audit.columns.record"),
      cell: (r) =>
        r.recordId ? (
          <span className="break-all font-mono text-xs">{r.recordId}</span>
        ) : (
          t("admin.audit.noRecord")
        ),
    },
    {
      id: "change",
      header: t("admin.audit.columns.change"),
      cell: (r) => (
        <div>
          <p>{changeSummary(r.action, r.diff)}</p>
          <ChangeDetail row={r} />
        </div>
      ),
      className: "min-w-[16rem]",
    },
  ];

  const filtered = hasAuditFilters(params);

  return (
    <>
      <PageHeader title={t("admin.audit.title")} description={t("admin.audit.description")} />

      <form
        role="search"
        aria-label={t("admin.audit.filters.label")}
        onSubmit={(e) => e.preventDefault()}
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Field label={t("admin.audit.filters.table")}>
          <Select
            value={params.table ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              update({ table: isAuditTable(value) ? value : undefined });
            }}
          >
            <option value="">{t("admin.audit.filters.all")}</option>
            {AUDIT_TABLES.map((name) => (
              <option key={name} value={name}>
                {t(`admin.audit.tables.${name}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.audit.filters.action")}>
          <Select
            value={params.action ?? ""}
            onChange={(e) =>
              update({ action: (e.target.value || undefined) as AuditAction | undefined })
            }
          >
            <option value="">{t("admin.audit.filters.allActions")}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`admin.audit.actions.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.audit.filters.actor")}>
          <Select
            value={params.actorId ?? ""}
            onChange={(e) => update({ actorId: e.target.value || undefined })}
          >
            <option value="">{t("admin.audit.filters.allActors")}</option>
            {actorOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.audit.filters.from")} hint={t("admin.audit.filters.dateHint")}>
          <Input
            type="date"
            value={params.from ?? ""}
            max={params.to ?? undefined}
            onChange={(e) => update({ from: e.target.value || undefined })}
          />
        </Field>
        <Field label={t("admin.audit.filters.to")}>
          <Input
            type="date"
            value={params.to ?? ""}
            min={params.from ?? undefined}
            onChange={(e) => update({ to: e.target.value || undefined })}
          />
        </Field>
        {filtered && (
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSearchParams(new URLSearchParams())}
            >
              {t("admin.audit.filters.clear")}
            </Button>
          </div>
        )}
      </form>

      <DataTable
        caption={t("admin.audit.title")}
        columns={columns}
        rows={query.data?.rows ?? []}
        getRowId={(r) => String(r.id)}
        loading={query.isPending}
        refreshing={query.isFetching && !query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={
          <EmptyState
            {...(filtered
              ? {
                  action: (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSearchParams(new URLSearchParams())}
                    >
                      {t("admin.audit.filters.clear")}
                    </Button>
                  ),
                }
              : {})}
          >
            {filtered ? t("admin.audit.emptyFiltered") : t("admin.audit.empty")}
          </EmptyState>
        }
      />
      {query.data && query.data.total > 0 && (
        <Pagination
          page={params.page}
          pageSize={params.pageSize}
          total={query.data.total}
          onPageChange={(page) => update({ page })}
        />
      )}
    </>
  );
}

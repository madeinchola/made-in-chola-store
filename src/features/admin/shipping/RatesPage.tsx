import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useCurrencies } from "../config/hooks";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setRateArchived } from "./api";
import {
  useInvalidateShipping,
  useMethods,
  useRates,
  useShippingMutation,
  useZones,
} from "./hooks";
import { RatesDialog } from "./RatesDialog";
import { currencyChoices } from "./RatesFormLogic";
import {
  isLastLiveRule,
  orderRangeText,
  rateStatus,
  ruleSummary,
  ruleZoneLabel,
  ruleZoneState,
  sortRates,
  validityText,
  type RateStatus,
} from "./RatesLogic";
import type { RateRule } from "./types";

const STATUS_TONE = {
  live: "success",
  scheduled: "info",
  expired: "neutral",
  inactive: "warning",
  archived: "neutral",
} as const satisfies Record<RateStatus, string>;

const R = "admin.shipping.rates.rules" as const;

/**
 * Tarifas de envío: reglas por método, en el orden en que las evalúa el servidor, con un resumen legible de cada una, su
 * zona, rango de monto, vigencia y estado. Alta y edición en un diálogo con el editor de tramos; archivar y restaurar.
 */
export function ShippingRatesPage() {
  const methods = useMethods();
  const rates = useRates();
  const zones = useZones();
  const currencies = useCurrencies();
  const invalidate = useInvalidateShipping();
  const archive = useShippingMutation((v: { rule: RateRule; archived: boolean }) =>
    setRateArchived(v.rule.id, v.rule.updatedAt, v.archived),
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RateRule | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toArchive, setToArchive] = useState<RateRule | null>(null);

  // Las tarifas se ponen a los métodos de entrega a domicilio: el recojo siempre es gratis y no lleva reglas.
  const deliveryMethods = useMemo(
    () => (methods.data ?? []).filter((m) => m.kind === "delivery" && !m.archived),
    [methods.data],
  );
  const method = deliveryMethods.find((m) => m.id === selectedId) ?? deliveryMethods[0] ?? null;
  const zonesById = useMemo(() => new Map((zones.data ?? []).map((z) => [z.id, z])), [zones.data]);
  const rows = useMemo(
    () => sortRates((rates.data ?? []).filter((r) => r.methodId === method?.id)),
    [rates.data, method?.id],
  );
  const currencyOptions = useMemo(
    () => currencyChoices(currencies.data?.filter((c) => c.enabled).map((c) => c.code)),
    [currencies.data],
  );
  // "Ahora" se fija al recibir datos: el estado de cada regla se calcula con las mismas reglas que el servidor.
  const now = useMemo(() => new Date(), [rates.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (rule: RateRule, archived: boolean, success: string) => {
    try {
      await archive.mutateAsync({ rule, archived });
      toast.success(success);
    } catch (e) {
      toast.error(isStaleVersion(e) ? t("admin.conflict.body") : toAppError(e).message);
      // Si alguien cambió la regla, la lista debe mostrar ya la versión nueva.
      void invalidate();
      throw e;
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (rule: RateRule) => {
    setEditing(rule);
    setDialogOpen(true);
  };

  const archiveDescription = (rule: RateRule): string =>
    [
      t(`${R}.confirmArchive.body`),
      isLastLiveRule(rule, rates.data ?? []) ? t(`${R}.confirmArchive.lastRule`) : null,
    ]
      .filter((part) => part !== null)
      .join(" ");

  const columns: Column<RateRule>[] = [
    {
      id: "rule",
      header: t(`${R}.columns.rule`),
      cell: (r) => (
        <div className="min-w-[15rem]">
          <p className="break-words font-medium">{r.name}</p>
          <p className="text-xs text-muted-foreground">{t(`${R}.kind.${r.kind}`)}</p>
          {r.params ? (
            <p className="mt-1 max-w-sm break-words">{ruleSummary(r.params, r.currency)}</p>
          ) : (
            <p className="mt-1 max-w-sm break-words text-warning">
              <Badge tone="warning" className="mr-2">
                {t(`${R}.invalidParams.badge`)}
              </Badge>
              {t(`${R}.invalidParams.body`)}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "zone",
      header: t(`${R}.columns.zone`),
      cell: (r) => {
        const state = ruleZoneState(r.zoneId, zonesById);
        return (
          <div className="max-w-[14rem]">
            <p className="break-words">
              {zones.isPending && r.zoneId !== null
                ? t("admin.states.loading")
                : ruleZoneLabel(r.zoneId, zonesById)}
            </p>
            {(state === "archived" || state === "inactive" || state === "blocked") && (
              <p className="mt-1 text-xs text-warning">{t(`${R}.zone.unusable`)}</p>
            )}
          </div>
        );
      },
    },
    {
      id: "order",
      header: t(`${R}.columns.order`),
      cell: (r) => orderRangeText(r.minOrderAmount, r.maxOrderAmount, r.currency),
    },
    {
      id: "validity",
      header: t(`${R}.columns.validity`),
      cell: (r) => <span>{validityText(r.validFrom, r.validUntil)}</span>,
    },
    { id: "priority", header: t(`${R}.columns.priority`), cell: (r) => r.priority },
    {
      id: "state",
      header: t(`${R}.columns.state`),
      cell: (r) => {
        const status = rateStatus(r, now);
        return <Badge tone={STATUS_TONE[status]}>{t(`${R}.status.${status}`)}</Badge>;
      },
    },
    {
      id: "actions",
      header: t(`${R}.columns.actions`),
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            aria-label={t(`${R}.editNamed`, { name: r.name })}
            onClick={() => openEdit(r)}
          >
            {t("admin.actions.edit")}
          </Button>
          {r.archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t(`${R}.restoreNamed`, { name: r.name })}
              onClick={() => void run(r, false, t(`${R}.toasts.restored`)).catch(() => undefined)}
            >
              {t("admin.actions.restore")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t(`${R}.archiveNamed`, { name: r.name })}
              onClick={() => setToArchive(r)}
            >
              {t("admin.actions.archive")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const createButton = (label: string) => (
    <Button type="button" className="min-h-11" onClick={openCreate}>
      {label}
    </Button>
  );

  let body;
  if (methods.isPending) body = <LoadingState />;
  else if (methods.isError) body = <ErrorState onRetry={() => void methods.refetch()} />;
  else if (!method) {
    body = (
      <EmptyState
        action={
          <Link to="/admin/envios" className={buttonVariants({ variant: "outline" })}>
            {t(`${R}.noMethodsAction`)}
          </Link>
        }
      >
        {t(`${R}.noMethods`)}
      </EmptyState>
    );
  } else {
    body = (
      <>
        {deliveryMethods.length > 1 ? (
          <div className="mb-4 max-w-sm">
            <Field label={t(`${R}.method`)}>
              <Select
                className="min-h-11"
                value={method.id}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {deliveryMethods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <p className="mb-4 text-sm font-medium">
            {t(`${R}.methodSingle`, { name: method.name })}
          </p>
        )}
        <DataTable
          caption={t(`${R}.title`)}
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          loading={rates.isPending}
          refreshing={rates.isFetching && !rates.isPending}
          error={rates.isError}
          onRetry={() => void rates.refetch()}
          empty={
            <EmptyState action={createButton(t(`${R}.emptyAction`))}>{t(`${R}.empty`)}</EmptyState>
          }
        />
        <RatesDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          rule={editing}
          method={method}
          zones={zones.data ?? []}
          currencies={currencyOptions}
        />
        <ConfirmDialog
          open={toArchive !== null}
          onOpenChange={(open) => !open && setToArchive(null)}
          title={t(`${R}.confirmArchive.title`, { name: toArchive?.name ?? "" })}
          description={toArchive ? archiveDescription(toArchive) : ""}
          confirmLabel={t(`${R}.confirmArchive.confirm`)}
          destructive
          onConfirm={() => run(toArchive as RateRule, true, t(`${R}.toasts.archived`))}
        />
      </>
    );
  }

  return (
    <SectionCard
      id="rates"
      title={t(`${R}.title`)}
      description={t(`${R}.description`)}
      actions={method ? createButton(t(`${R}.new`)) : undefined}
    >
      <p className="mb-4 text-sm">{t(`${R}.priorityHelp`)}</p>
      {body}
    </SectionCard>
  );
}

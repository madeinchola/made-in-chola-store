import { useMemo, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/datetime";
import { toAppError } from "@/lib/errors";
import { BASE_CURRENCY } from "@/lib/currencies";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { PageHeader, SectionCard } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";
import { EmptyState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setCurrencyEnabled } from "./api";
import {
  useCountries,
  useCurrencies,
  useCurrentRates,
  useInvalidateConfig,
  useRateHistory,
} from "./hooks";
import { RateDialog } from "./RateDialog";
import { Switch } from "./Switch";
import type { CurrencyRow, RateHistoryRow } from "./types";

const HISTORY_PAGE_SIZE = 10;

/** Monedas: activar/desactivar, tipo de cambio vigente por moneda, nuevo tipo de cambio e historial inmutable. */
export function CurrenciesPage() {
  const currencies = useCurrencies();
  const countries = useCountries();
  const invalidate = useInvalidateConfig();
  const [historyPage, setHistoryPage] = useState(1);
  const history = useRateHistory(historyPage, HISTORY_PAGE_SIZE);

  const foreignCodes = useMemo(
    () => (currencies.data ?? []).filter((c) => c.code !== BASE_CURRENCY).map((c) => c.code),
    [currencies.data],
  );
  const rates = useCurrentRates(foreignCodes);

  const [toToggle, setToToggle] = useState<CurrencyRow | null>(null);
  const [rateFor, setRateFor] = useState<CurrencyRow | null>(null);

  const currentIds = useMemo(
    () => new Set(Object.values(rates.data ?? {}).flatMap((r) => (r ? [r.id] : []))),
    [rates.data],
  );

  const toggle = async (currency: CurrencyRow) => {
    try {
      await setCurrencyEnabled(currency, !currency.enabled);
      toast.success(
        currency.enabled
          ? t("admin.config.currencies.toggle.disabledToast")
          : t("admin.config.currencies.toggle.enabledToast"),
      );
    } catch (e) {
      toast.error(isStaleVersion(e) ? t("admin.conflict.body") : toAppError(e).message);
      throw e;
    } finally {
      await invalidate();
    }
  };

  const columns: Column<CurrencyRow>[] = [
    {
      id: "code",
      header: t("admin.config.currencies.columns.code"),
      cell: (c) => (
        <div>
          <p className="font-medium">
            {c.code} <span className="font-normal text-muted-foreground">({c.symbol})</span>
          </p>
          <p className="text-xs text-muted-foreground">{c.name}</p>
        </div>
      ),
    },
    {
      id: "decimals",
      header: t("admin.config.currencies.columns.decimals"),
      cell: (c) => c.decimals,
    },
    {
      id: "rate",
      header: t("admin.config.currencies.columns.rate"),
      cell: (c) => {
        if (c.code === BASE_CURRENCY) return <Badge>{t("admin.config.currencies.baseTag")}</Badge>;
        const rate = rates.data?.[c.code];
        if (rates.isPending)
          return <span className="text-muted-foreground">{t("admin.states.loading")}</span>;
        if (!rate)
          return (
            <span className="text-muted-foreground">{t("admin.config.currencies.noRate")}</span>
          );
        return (
          <div>
            <p>{t("admin.config.currencies.rateLine", { rate: rate.rate, code: c.code })}</p>
            <p className="text-xs text-muted-foreground">
              {t("admin.config.currencies.since", { date: formatDateTime(rate.validFrom) })} ·{" "}
              {t(`admin.config.currencies.mode.${rate.mode}`)}
            </p>
          </div>
        );
      },
    },
    {
      id: "state",
      header: t("admin.config.currencies.columns.state"),
      cell: (c) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={c.enabled}
            disabled={c.code === BASE_CURRENCY}
            label={t("admin.config.currencies.toggleLabel", { name: c.name })}
            onCheckedChange={() => setToToggle(c)}
          />
          <span className="text-sm">
            {c.enabled
              ? t("admin.config.currencies.enabled")
              : t("admin.config.currencies.disabled")}
          </span>
          {c.code === BASE_CURRENCY && (
            <span className="text-xs text-muted-foreground">
              {t("admin.config.currencies.baseLocked")}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: t("admin.config.currencies.columns.actions"),
      cell: (c) =>
        c.code === BASE_CURRENCY ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("admin.config.currencies.newRateFor", { name: c.name })}
            onClick={() => setRateFor(c)}
          >
            {t("admin.config.currencies.newRate")}
          </Button>
        ),
    },
  ];

  const historyColumns: Column<RateHistoryRow>[] = [
    {
      id: "validFrom",
      header: t("admin.config.currencies.history.columns.validFrom"),
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-2">
          <time dateTime={r.validFrom} className="whitespace-nowrap">
            {formatDateTime(r.validFrom)}
          </time>
          {currentIds.has(r.id) && (
            <Badge tone="success">{t("admin.config.currencies.history.current")}</Badge>
          )}
        </div>
      ),
    },
    {
      id: "pair",
      header: t("admin.config.currencies.history.columns.pair"),
      cell: (r) => t("admin.config.currencies.history.pair", { code: r.toCurrency }),
    },
    { id: "rate", header: t("admin.config.currencies.history.columns.rate"), cell: (r) => r.rate },
    {
      id: "mode",
      header: t("admin.config.currencies.history.columns.mode"),
      cell: (r) => t(`admin.config.currencies.mode.${r.mode}`),
    },
    {
      id: "recorded",
      header: t("admin.config.currencies.history.columns.recorded"),
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span>,
    },
  ];

  const affectedCountries = (c: CurrencyRow) =>
    (countries.data ?? []).filter((k) => k.enabled && k.currencyCode === c.code).map((k) => k.name);

  const toggleDescription = (c: CurrencyRow): string => {
    if (!c.enabled) return t("admin.config.currencies.toggle.enableBody", { code: c.code });
    const names = affectedCountries(c);
    return [
      t("admin.config.currencies.toggle.disableBody", { code: c.code }),
      names.length > 0
        ? t("admin.config.currencies.toggle.countries", { countries: names.join(", ") })
        : t("admin.config.currencies.toggle.noCountries"),
    ].join(" ");
  };

  return (
    <>
      <PageHeader
        title={t("admin.config.currencies.title")}
        description={t("admin.config.currencies.description")}
      />
      <div className="space-y-6">
        <SectionCard id="currencies" title={t("admin.config.currencies.title")}>
          <DataTable
            caption={t("admin.config.currencies.title")}
            columns={columns}
            rows={currencies.data ?? []}
            getRowId={(c) => c.code}
            loading={currencies.isPending}
            refreshing={currencies.isFetching && !currencies.isPending}
            error={currencies.isError}
            onRetry={() => void currencies.refetch()}
            empty={<EmptyState>{t("admin.states.empty")}</EmptyState>}
          />
        </SectionCard>

        <SectionCard
          id="history"
          title={t("admin.config.currencies.history.title")}
          description={t("admin.config.currencies.history.description")}
        >
          <DataTable
            caption={t("admin.config.currencies.history.title")}
            columns={historyColumns}
            rows={history.data?.rows ?? []}
            getRowId={(r) => String(r.id)}
            loading={history.isPending}
            refreshing={history.isFetching && !history.isPending}
            error={history.isError}
            onRetry={() => void history.refetch()}
            empty={<EmptyState>{t("admin.config.currencies.history.empty")}</EmptyState>}
          />
          {history.data && history.data.total > 0 && (
            <Pagination
              page={historyPage}
              pageSize={HISTORY_PAGE_SIZE}
              total={history.data.total}
              onPageChange={setHistoryPage}
            />
          )}
        </SectionCard>
      </div>

      <ConfirmDialog
        open={toToggle !== null}
        onOpenChange={(open) => !open && setToToggle(null)}
        title={
          toToggle?.enabled
            ? t("admin.config.currencies.toggle.disableTitle", { name: toToggle.name })
            : t("admin.config.currencies.toggle.enableTitle", { name: toToggle?.name ?? "" })
        }
        description={toToggle ? toggleDescription(toToggle) : ""}
        confirmLabel={
          toToggle?.enabled
            ? t("admin.config.currencies.toggle.disableConfirm")
            : t("admin.config.currencies.toggle.enableConfirm")
        }
        destructive={toToggle?.enabled === true}
        onConfirm={() => toggle(toToggle as CurrencyRow)}
      />

      <RateDialog
        open={rateFor !== null}
        onOpenChange={(open) => !open && setRateFor(null)}
        currency={rateFor}
        currentRate={rateFor ? (rates.data?.[rateFor.code] ?? null) : null}
        onSaved={() => invalidate()}
      />
    </>
  );
}

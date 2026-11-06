import { t } from "@/i18n";
import type { QuoteResult, ShippingMethodInfo } from "@/features/shipping/types";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "../ui/PageHeader";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { formatShortDate } from "./SlotsDates";
import {
  breakdownRows,
  etaParts,
  formatNumber,
  formatServerMoney,
  groupSlotsByDate,
  type BreakdownRow,
  type SimulatorRun,
} from "./SimulatorLogic";

const P = "admin.shipping.delivery.simulator.result";

function etaText(method: ShippingMethodInfo): string {
  const eta = etaParts(method.etaMinDays, method.etaMaxDays);
  switch (eta.kind) {
    case "exact":
      return eta.days === 1 ? t(`${P}.eta.exactOne`) : t(`${P}.eta.exactMany`, { days: eta.days });
    case "range":
      return t(`${P}.eta.range`, { min: eta.min, max: eta.max });
    case "from":
      return eta.days === 1 ? t(`${P}.eta.fromOne`) : t(`${P}.eta.fromMany`, { days: eta.days });
    case "upTo":
      return eta.days === 1 ? t(`${P}.eta.upToOne`) : t(`${P}.eta.upToMany`, { days: eta.days });
    case "none":
      return t(`${P}.eta.none`);
  }
}

const km = (value: number) => t(`${P}.km`, { km: formatNumber(value) });

/** Etiqueta y valor de una fila del desglose. Los números son los del servidor: solo se les da formato. */
function describeRow(row: BreakdownRow): { label: string; value: string } {
  const b = `${P}.breakdown` as const;
  switch (row.id) {
    case "pickup":
      return { label: t(`${b}.pickup`), value: t(`${b}.pickupValue`) };
    case "rule":
      return {
        label: t(`${b}.rule`),
        value: t(`${b}.ruleValue`, {
          name: row.name,
          kind: row.kind === "flat" ? t(`${b}.kindFlat`) : t(`${b}.kindDistance`),
          priority: row.priority,
        }),
      };
    case "straightKm":
      return { label: t(`${b}.straightKm`), value: km(row.km) };
    case "routeKm":
      return { label: t(`${b}.routeKm`), value: km(row.km) };
    case "routeFactor":
      return {
        label: t(`${b}.routeFactor`),
        value: t(`${b}.factorValue`, { factor: formatNumber(row.factor) }),
      };
    case "tier":
      return { label: t(`${b}.tier`), value: t(`${b}.tierValue`, { n: row.tier }) };
    case "extraKm":
      return { label: t(`${b}.extraKm`), value: km(row.km) };
    case "flatRate":
      return { label: t(`${b}.tier`), value: t(`${b}.flatRateValue`) };
    case "minApplied":
      return {
        label: t(`${b}.minApplied`),
        value: row.applied ? t("admin.yes") : t("admin.no"),
      };
    case "maxApplied":
      return {
        label: t(`${b}.maxApplied`),
        value: row.applied ? t("admin.yes") : t("admin.no"),
      };
  }
}

function Breakdown({ result }: { result: QuoteResult }) {
  const rows = breakdownRows(result.breakdown);
  return (
    <section aria-labelledby="simulator-breakdown" className="space-y-2">
      <h3 id="simulator-breakdown" className="font-display font-semibold">
        {t(`${P}.breakdown.title`)}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${P}.breakdown.empty`)}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t(`${P}.breakdown.title`)}</caption>
            <tbody>
              {rows.map((row) => {
                const { label, value } = describeRow(row);
                return (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <th scope="row" className="w-1/2 px-3 py-2 font-medium">
                      {label}
                    </th>
                    <td className="break-words px-3 py-2">{value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SlotsList({ result }: { result: QuoteResult }) {
  const days = groupSlotsByDate(result.slots);
  return (
    <section aria-labelledby="simulator-slots" className="space-y-2">
      <h3 id="simulator-slots" className="font-display font-semibold">
        {t(`${P}.slots.title`)}
      </h3>
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${P}.slots.none`)}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {days.map((day) => (
            <li key={day.date} className="rounded-lg border p-3">
              <h4 className="mb-2 text-sm font-semibold">{formatShortDate(day.date)}</h4>
              <ul className="space-y-1">
                {day.slots.map((slot) => (
                  <li
                    key={slot.slotId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                  >
                    <span className="font-medium tabular-nums">
                      {slot.start}–{slot.end}
                    </span>
                    {slot.available ? (
                      <span className="text-muted-foreground">
                        {t(`${P}.slots.remaining`, {
                          remaining: slot.remaining,
                          capacity: slot.capacity,
                        })}
                      </span>
                    ) : (
                      <Badge tone="danger">{t(`${P}.slots.full`)}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ResultBody({ result }: { result: QuoteResult }) {
  const isDelivery = result.method?.kind === "delivery";
  return (
    <div className="space-y-6">
      {result.ok && result.cost !== null ? (
        <div className="rounded-lg border border-success/40 bg-success-soft p-4">
          <p className="text-sm font-medium">{t(`${P}.cost`)}</p>
          <p className="font-display text-3xl font-bold">
            {formatServerMoney(result.cost, result.currency ?? "BOB")}
          </p>
          {result.method?.kind === "pickup" && (
            <p className="mt-1 text-sm">{t(`${P}.pickupFree`)}</p>
          )}
        </div>
      ) : (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">{t(`${P}.errorsTitle`)}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {result.errors.map((error, index) => (
              <li key={`${error.code}-${index}`}>
                <span className="font-medium">{t(`${P}.fields.${error.field}`)}: </span>
                {t(`shipping.errors.${error.code}`)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t(`${P}.errorsNote`)}</p>
        </div>
      )}

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {result.distanceKm !== null && (
          <div>
            <dt className="font-medium">{t(`${P}.distance`)}</dt>
            <dd>{km(result.distanceKm)}</dd>
          </div>
        )}
        {result.method && (
          <div>
            <dt className="font-medium">{t(`${P}.etaLabel`)}</dt>
            <dd>{etaText(result.method)}</dd>
          </div>
        )}
        {result.selected && (
          <div>
            <dt className="font-medium">{t(`${P}.selected`)}</dt>
            <dd>
              {result.selected.start !== null && result.selected.end !== null
                ? t(`${P}.selectedValue`, {
                    date: formatShortDate(result.selected.date, { year: true }),
                    start: result.selected.start,
                    end: result.selected.end,
                  })
                : t(`${P}.selectedNoSlot`, {
                    date: formatShortDate(result.selected.date, { year: true }),
                  })}
            </dd>
          </div>
        )}
        {result.pickup && (
          <div className="sm:col-span-2">
            <dt className="font-medium">{t(`${P}.pickupTitle`)}</dt>
            <dd className="break-words">
              {t(`${P}.pickupValue`, {
                name: result.pickup.name,
                address: result.pickup.address,
                city: result.pickup.city,
              })}
              {result.pickup.hours
                ? ` · ${t(`${P}.pickupHours`, { hours: result.pickup.hours })}`
                : ""}
            </dd>
          </div>
        )}
      </dl>

      <Breakdown result={result} />
      {isDelivery && <SlotsList result={result} />}
    </div>
  );
}

interface SimulatorResultProps {
  run: SimulatorRun | null;
  /** ¿El resultado corresponde a lo que hay AHORA en el formulario? Si no, se oculta: nunca un costo viejo con datos nuevos. */
  current: boolean;
  onRetry: () => void;
}

/** El resultado de la cotización: cargando, error de red con «Reintentar», errores del servidor, o costo con su desglose. */
export function SimulatorResult({ run, current, onRetry }: SimulatorResultProps) {
  let body;
  if (run === null) {
    body = <p className="text-sm text-muted-foreground">{t(`${P}.idle`)}</p>;
  } else if (!current) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        {t(`${P}.stale`)}
      </p>
    );
  } else if (run.status === "pending") {
    body = <LoadingState label={t(`${P}.calculating`)} />;
  } else if (run.status === "failed") {
    body = (
      <ErrorState title={t(`${P}.failedTitle`)} message={run.error.message} onRetry={onRetry} />
    );
  } else {
    body = <ResultBody result={run.result} />;
  }

  return (
    <SectionCard id="simulator-result" title={t(`${P}.title`)}>
      <div aria-live="polite">{body}</div>
    </SectionCard>
  );
}

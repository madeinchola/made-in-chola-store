import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { useSettings } from "../config/hooks";
import { SectionCard } from "../ui/PageHeader";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { settingInt } from "./SlotsLogic";

const LEAD_KEY = "delivery_min_lead_hours";
const MAX_DAYS_KEY = "delivery_max_days_ahead";

/**
 * Las reglas de calendario que el servidor aplica a TODA entrega a domicilio. Aquí solo se LEEN (se editan en Ajustes): así hay
 * una sola fuente de verdad y no dos pantallas que puedan decir cosas distintas.
 */
export function SlotsRulesCard() {
  const settings = useSettings();
  const lead = settingInt(settings.data, LEAD_KEY);
  const maxDays = settingInt(settings.data, MAX_DAYS_KEY);

  // El tope de días se cuenta desde HOY: si la antelación llega más allá del final del último día permitido, TODA franja queda
  // «demasiado pronto» y la bolsa nunca ofrece fechas, sin ningún error visible (el servidor valida cada ajuste por separado).
  const noSlotsCanBeOffered = lead !== null && maxDays !== null && lead >= (maxDays + 1) * 24;

  let body;
  if (settings.isError) body = <ErrorState onRetry={() => void settings.refetch()} />;
  else if (settings.isPending) body = <LoadingState />;
  else {
    body = (
      <div className="space-y-2">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            {lead === null
              ? t("admin.shipping.delivery.rules.leadHoursUnknown")
              : t(
                  lead === 1
                    ? "admin.shipping.delivery.rules.leadHoursOne"
                    : "admin.shipping.delivery.rules.leadHoursMany",
                  { n: lead },
                )}
          </li>
          <li>
            {maxDays === null
              ? t("admin.shipping.delivery.rules.maxDaysUnknown")
              : t(
                  maxDays === 1
                    ? "admin.shipping.delivery.rules.maxDaysOne"
                    : "admin.shipping.delivery.rules.maxDaysMany",
                  { n: maxDays },
                )}
          </li>
        </ul>
        {noSlotsCanBeOffered && (
          <p role="alert" className="text-sm text-warning">
            {t("admin.shipping.delivery.rules.conflict", { lead, days: maxDays })}
          </p>
        )}
        <Link
          to="/admin/ajustes#settings-shipping"
          className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
        >
          {t("admin.shipping.delivery.rules.settingsLink")}
        </Link>
      </div>
    );
  }

  return (
    <SectionCard
      id="delivery-rules"
      title={t("admin.shipping.delivery.rules.title")}
      description={t("admin.shipping.delivery.rules.description")}
    >
      {body}
    </SectionCard>
  );
}

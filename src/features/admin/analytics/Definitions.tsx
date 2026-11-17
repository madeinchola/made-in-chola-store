import { t } from "@/i18n";

const F = "admin.analytics.dashboard.definitions" as const;

/** Qué significa cada cifra: visible y escrito (no escondido en un globo que no aparece al tocar). */
export function Definitions() {
  const keys = ["sale", "net", "margin", "profit", "currency", "previous"] as const;
  return (
    <details className="rounded-lg border bg-background p-4 sm:p-6">
      <summary className="cursor-pointer font-display text-lg font-semibold">
        {t(`${F}.title`)}
      </summary>
      <ul className="mt-4 space-y-3 text-sm">
        {keys.map((key) => (
          <li key={key} className="max-w-prose text-muted-foreground">
            {t(`${F}.${key}`)}
          </li>
        ))}
      </ul>
    </details>
  );
}

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/store/ErrorState";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { FormAlert } from "../security/FormAlert";
import { useSingleFlight } from "../security/useSingleFlight";
import { usePublicCurrencies, useProfilePreferences, useUpdateProfile } from "./hooks";

/** Idiomas disponibles hoy. La preferencia se guarda igual (`preferred_locale`) para cuando haya más. */
const LOCALES = ["es"] as const;

interface Draft {
  locale: string;
  /** "" = la moneda de la tienda (se guarda como NULL). */
  currency: string;
}

/** Idioma y moneda preferidos. Moneda: las HABILITADAS (vista pública) y «La de la tienda» (NULL). */
export function PreferencesForm() {
  const id = useId();
  const preferences = useProfilePreferences();
  const currencies = usePublicCurrencies();
  const update = useUpdateProfile();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const singleFlight = useSingleFlight();

  const titleId = `${id}-title`;
  const header = (
    <div className="space-y-1">
      <h3 id={titleId} className="font-display text-display-sm">
        {t("acct.profile.preferences.title")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("acct.profile.preferences.intro")}</p>
    </div>
  );

  if (preferences.isError || currencies.isError) {
    return (
      <section aria-labelledby={titleId} className="space-y-4">
        {header}
        <ErrorState
          title={t("acct.profile.preferences.error.title")}
          description={t("acct.profile.preferences.error.description")}
          onRetry={() => {
            void preferences.refetch();
            void currencies.refetch();
          }}
        />
      </section>
    );
  }
  if (!preferences.data || !currencies.data) {
    return (
      <section aria-labelledby={titleId} aria-busy="true" className="space-y-4">
        {header}
        <p className="sr-only" role="status">
          {t("acct.profile.preferences.loading")}
        </p>
        <Skeleton className="h-10 max-w-md" />
        <Skeleton className="h-10 max-w-md" />
      </section>
    );
  }

  const server: Draft = {
    locale: preferences.data.locale,
    currency: preferences.data.currency ?? "",
  };
  const current = draft ?? server;
  const dirty = current.locale !== server.locale || current.currency !== server.currency;
  const pending = update.isPending;

  // Un valor guardado que ya no está entre las opciones (idioma desconocido, moneda deshabilitada después) se muestra
  // igual, marcado «no disponible»: si no, el selector enseñaría otra opción y guardar la cambiaría sin que se note.
  const localeOptions: { value: string; label: string }[] = LOCALES.map((code) => ({
    value: code,
    label: t(`acct.profile.preferences.locales.${code}` as MessageKey),
  }));
  if (!LOCALES.some((code) => code === current.locale)) {
    localeOptions.push({
      value: current.locale,
      label: t("acct.profile.preferences.unavailable", { value: current.locale }),
    });
  }
  const currencyOptions: { value: string; label: string }[] = [
    { value: "", label: t("acct.profile.preferences.storeCurrency") },
    ...currencies.data.map((currency) => ({
      value: currency.code,
      label: t("acct.profile.preferences.currencyOption", {
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
      }),
    })),
  ];
  if (current.currency !== "" && !currencies.data.some((c) => c.code === current.currency)) {
    currencyOptions.push({
      value: current.currency,
      label: t("acct.profile.preferences.unavailable", { value: current.currency }),
    });
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    return singleFlight(async () => {
      setFormError(null);
      try {
        await update.mutateAsync({
          locale: current.locale,
          currency: current.currency === "" ? null : current.currency,
        });
        setDraft(null);
        toast.success(t("acct.profile.preferences.saved"));
      } catch (error) {
        setFormError(toAppError(error).message);
      }
    });
  };

  return (
    <section aria-labelledby={titleId} className="space-y-4">
      {header}
      <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field label={t("acct.profile.preferences.locale")}>
          <Select
            value={current.locale}
            onChange={(event) => setDraft({ ...current, locale: event.target.value })}
          >
            {localeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("acct.profile.preferences.currency")}>
          <Select
            value={current.currency}
            onChange={(event) => setDraft({ ...current, currency: event.target.value })}
          >
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" loading={pending} aria-disabled={!dirty || pending || undefined}>
          {t("acct.profile.preferences.save")}
        </Button>
      </form>
    </section>
  );
}

import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/store/ErrorState";
import { useAuth } from "@/features/auth/useAuth";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { FormAlert } from "../security/FormAlert";
import { useSingleFlight } from "../security/useSingleFlight";
import type { NotificationPreferences, PreferredChannel } from "./api";
import { useNotificationPreferences, useSaveNotificationPreferences } from "./hooks";

type Draft = Pick<NotificationPreferences, "channel" | "marketingEmail" | "marketingWhatsapp">;

const OPTIONS: readonly PreferredChannel[] = ["auto", "email", "whatsapp"];

const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat("es-BO", { dateStyle: "long", timeZone: "America/La_Paz" }).format(
    new Date(iso),
  );

/** `/cuenta/notificaciones`: por dónde recibir los avisos del pedido y si acepta novedades. PROVISIONAL en estilo (no hay diseño de cuenta). */
export function NotificationPreferencesPage() {
  const id = useId();
  const { profile } = useAuth();
  const query = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const singleFlight = useSingleFlight();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const stored = query.data?.preferences;
  useEffect(() => {
    if (stored)
      setDraft({
        channel: stored.channel,
        marketingEmail: stored.marketingEmail,
        marketingWhatsapp: stored.marketingWhatsapp,
      });
  }, [stored]);

  const header = (
    <header className="space-y-1">
      <h2 className="font-display text-display-md">{t("acct.notifications.title")}</h2>
      <p className="text-muted-foreground">{t("acct.notifications.intro")}</p>
    </header>
  );

  if (query.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title={t("acct.notifications.error.title")}
          description={t("acct.notifications.error.description")}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  if (!query.data || !draft || !stored) {
    return (
      <div className="space-y-6" aria-busy="true">
        {header}
        <p className="sr-only" role="status">
          {t("acct.notifications.loading")}
        </p>
        <Skeleton className="h-24 max-w-md" />
        <Skeleton className="h-24 max-w-md" />
      </div>
    );
  }

  const email = profile?.email ?? null;
  const phone = profile?.phone_e164 ?? null;
  const available: Record<PreferredChannel, boolean> = {
    auto: true,
    email: email !== null,
    whatsapp: phone !== null,
  };
  const dirty =
    draft.channel !== stored.channel ||
    draft.marketingEmail !== stored.marketingEmail ||
    draft.marketingWhatsapp !== stored.marketingWhatsapp;
  // Si prefiere un medio que ya no tiene, el sistema le escribe por el otro: se lo decimos en vez de dejarlo creer que sale por ahí.
  const fallbackChannel =
    stored.channel !== "auto" && !available[stored.channel]
      ? t(`acct.notifications.orders.${stored.channel}` as MessageKey).toLowerCase()
      : null;

  const hint = (option: PreferredChannel): string => {
    if (option === "auto") return t("acct.notifications.orders.autoHint");
    if (!available[option]) return t(`acct.notifications.orders.${option}Missing` as MessageKey);
    return option === "email"
      ? t("acct.notifications.orders.emailHint", { email: email ?? "" })
      : t("acct.notifications.orders.whatsappHint", { phone: phone ?? "" });
  };

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !dirty) {
      if (!dirty) toast.message(t("acct.notifications.nothingToSave"));
      return;
    }
    setFormError(null);
    void singleFlight(async () => {
      try {
        await save.mutateAsync(draft);
        toast.success(t("acct.notifications.saved"));
      } catch (error) {
        setFormError(toAppError(error).message);
      }
    });
  }

  return (
    <div className="space-y-10">
      {header}
      <form onSubmit={onSubmit} className="space-y-10" noValidate>
        <fieldset className="space-y-3">
          <legend className="font-display text-display-sm">
            {t("acct.notifications.orders.title")}
          </legend>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("acct.notifications.orders.intro")}
          </p>
          <p className="pt-2 text-sm font-medium" id={`${id}-channel`}>
            {t("acct.notifications.orders.legend")}
          </p>
          <div role="radiogroup" aria-labelledby={`${id}-channel`} className="space-y-3">
            {OPTIONS.map((option) => {
              const optionId = `${id}-${option}`;
              return (
                <div key={option} className="flex items-start gap-3">
                  <input
                    id={optionId}
                    type="radio"
                    name={`${id}-channel`}
                    value={option}
                    checked={draft.channel === option}
                    disabled={!available[option]}
                    onChange={() => setDraft({ ...draft, channel: option })}
                    aria-describedby={`${optionId}-hint`}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                  <div>
                    <label htmlFor={optionId} className="text-sm font-medium">
                      {t(`acct.notifications.orders.${option}` as MessageKey)}
                    </label>
                    <p id={`${optionId}-hint`} className="text-xs text-muted-foreground">
                      {hint(option)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {fallbackChannel && (
            <p role="note" className="text-sm text-muted-foreground">
              {t("acct.notifications.orders.fallback", { channel: fallbackChannel })}
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-display text-display-sm">
            {t("acct.notifications.marketing.title")}
          </legend>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("acct.notifications.marketing.intro")}
          </p>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.marketingEmail}
              onChange={(event) => setDraft({ ...draft, marketingEmail: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            {t("acct.notifications.marketing.email")}
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.marketingWhatsapp}
              onChange={(event) => setDraft({ ...draft, marketingWhatsapp: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            {t("acct.notifications.marketing.whatsapp")}
          </label>
          {stored.consentAt && (stored.marketingEmail || stored.marketingWhatsapp) && (
            <p className="text-xs text-muted-foreground">
              {t("acct.notifications.marketing.consentAt", { date: formatDate(stored.consentAt) })}
            </p>
          )}
        </fieldset>

        {formError && <FormAlert>{formError}</FormAlert>}
        <Button type="submit" className="min-h-11" disabled={save.isPending}>
          {save.isPending ? t("acct.notifications.saving") : t("acct.notifications.save")}
        </Button>
      </form>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { listSettings, saveSettings, type SettingChange } from "../config/api";
import { ErrorState } from "../ui/StateViews";
import { useInvalidateNotifications, useNotificationHealth } from "./hooks";
import { formatDateTime, recipientsProblem } from "./logic";
import { notificationKeys } from "./queryKeys";
import { KEYS, formOf, validateForm, type Form, type Key } from "./settingsForm";

const L = "admin.notifications.settings" as const;

function Row({ label, ok, children }: { label: string; ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b py-3 last:border-0">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2 text-sm">
        {children}
        <Badge tone={ok ? "success" : "warning"}>
          {ok ? t(`${L}.status.ok`) : t(`${L}.status.todo`)}
        </Badge>
      </span>
    </li>
  );
}

/** «Envío y alertas»: qué falta para que salgan los correos, los ajustes del envío y quién recibe las alertas internas. */
export function SettingsPage() {
  const health = useNotificationHealth();
  const invalidate = useInvalidateNotifications();
  const settings = useQuery({
    queryKey: notificationKeys.settings(),
    queryFn: listSettings,
    staleTime: 0,
    gcTime: 0,
  });
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(formOf(settings.data));
  }, [settings.data]);

  const h = health.data;
  const problems = form ? validateForm(form) : {};
  const set = (key: Key, value: string) => form && setForm({ ...form, [key]: value });

  async function save() {
    if (!form || !settings.data || saving) return;
    if (Object.keys(validateForm(form)).length > 0) {
      toast.error(t(`${L}.fixFirst`));
      return;
    }
    const before = formOf(settings.data);
    const rows = new Map(settings.data.map((row) => [row.key, row]));
    const changes: SettingChange[] = [];
    for (const key of KEYS) {
      if (form[key] === before[key] || key === "notify_whatsapp_mode") continue;
      const row = rows.get(key);
      if (!row) continue;
      const value: SettingChange["value"] =
        key === "notify_enabled"
          ? form[key] === "true"
          : key === "notify_max_attempts" || key === "notify_backoff_seconds"
            ? Number(form[key])
            : form[key].trim();
      changes.push({ key, value, updatedAt: row.updatedAt });
    }
    if (changes.length === 0) {
      toast.message(t(`${L}.nothingToSave`));
      return;
    }
    setSaving(true);
    const results = await saveSettings(changes);
    setSaving(false);
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) toast.success(t(`${L}.saved`));
    else
      toast.error(
        failed
          .map((r) => (r.ok ? "" : r.stale ? t("admin.conflict.body") : r.error.message))
          .join(" · "),
      );
    await settings.refetch();
    await invalidate();
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="notif-status" className="max-w-3xl space-y-2">
        <h2 id="notif-status" className="text-lg font-semibold">
          {t(`${L}.statusTitle`)}
        </h2>
        <p className="text-sm text-muted-foreground">{t(`${L}.statusIntro`)}</p>
        {h && (
          <ul className="rounded-lg border px-4">
            <Row label={t(`${L}.check.enabled`)} ok={h.enabled}>
              {h.enabled ? t(`${L}.on`) : t(`${L}.off`)}
            </Row>
            <Row label={t(`${L}.check.provider`)} ok={h.emailProvider !== "none"}>
              {t(`${L}.provider.${h.emailProvider}` as MessageKey)}
            </Row>
            <Row label={t(`${L}.check.sender`)} ok={h.fromEmailSet}>
              {h.fromEmailSet ? t(`${L}.set`) : t(`${L}.unset`)}
            </Row>
            <Row label={t(`${L}.check.worker`)} ok={h.workerConfigured}>
              {h.workerConfigured ? t(`${L}.set`) : t(`${L}.unset`)}
            </Row>
            <Row label={t(`${L}.check.recipients`)} ok={h.recipients > 0}>
              {t(`${L}.recipientsCount`, { count: h.recipients })}
            </Row>
            <Row label={t(`${L}.check.lastSent`)} ok={h.lastSentAt !== null}>
              {h.lastSentAt ? formatDateTime(h.lastSentAt) : t(`${L}.never`)}
            </Row>
          </ul>
        )}
      </section>

      <section aria-labelledby="notif-form" className="max-w-3xl space-y-4">
        <h2 id="notif-form" className="text-lg font-semibold">
          {t(`${L}.formTitle`)}
        </h2>
        {settings.isError && <ErrorState onRetry={() => void settings.refetch()} />}
        {form && (
          <form
            noValidate
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex items-center gap-3">
              <Switch
                id="notify-enabled"
                checked={form.notify_enabled === "true"}
                onCheckedChange={(checked) => set("notify_enabled", checked ? "true" : "false")}
              />
              <label htmlFor="notify-enabled" className="text-sm">
                {t(`${L}.field.enabled`)}
              </label>
            </div>
            <Field label={t(`${L}.field.provider`)} hint={t(`${L}.hint.provider`)}>
              <Select
                value={form.notify_email_provider}
                onChange={(event) => set("notify_email_provider", event.target.value)}
              >
                <option value="none">{t(`${L}.provider.none`)}</option>
                <option value="resend">{t(`${L}.provider.resend`)}</option>
                {form.notify_email_provider === "fake" && (
                  <option value="fake">{t(`${L}.provider.fake`)}</option>
                )}
              </Select>
            </Field>
            <Field
              label={t(`${L}.field.fromName`)}
              error={problems.notify_from_name ? t(problems.notify_from_name) : undefined}
            >
              <Input
                value={form.notify_from_name}
                maxLength={80}
                onChange={(event) => set("notify_from_name", event.target.value)}
              />
            </Field>
            <Field
              label={t(`${L}.field.fromEmail`)}
              hint={t(`${L}.hint.fromEmail`)}
              error={problems.notify_from_email ? t(problems.notify_from_email) : undefined}
            >
              <Input
                type="email"
                value={form.notify_from_email}
                maxLength={254}
                onChange={(event) => set("notify_from_email", event.target.value)}
              />
            </Field>
            <Field
              label={t(`${L}.field.replyTo`)}
              hint={t(`${L}.hint.replyTo`)}
              error={problems.notify_reply_to ? t(problems.notify_reply_to) : undefined}
            >
              <Input
                type="email"
                value={form.notify_reply_to}
                maxLength={254}
                onChange={(event) => set("notify_reply_to", event.target.value)}
              />
            </Field>
            <Field label={t(`${L}.field.whatsapp`)} hint={t(`${L}.hint.whatsapp`)}>
              <Select value={form.notify_whatsapp_mode} disabled onChange={() => undefined}>
                <option value="manual">{t(`${L}.whatsappMode.manual`)}</option>
                <option value="official">{t(`${L}.whatsappMode.official`)}</option>
              </Select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={t(`${L}.field.attempts`)}
                hint={t(`${L}.hint.attempts`)}
                error={problems.notify_max_attempts ? t(problems.notify_max_attempts) : undefined}
              >
                <Input
                  inputMode="numeric"
                  value={form.notify_max_attempts}
                  onChange={(event) => set("notify_max_attempts", event.target.value)}
                />
              </Field>
              <Field
                label={t(`${L}.field.backoff`)}
                hint={t(`${L}.hint.backoff`)}
                error={
                  problems.notify_backoff_seconds ? t(problems.notify_backoff_seconds) : undefined
                }
              >
                <Input
                  inputMode="numeric"
                  value={form.notify_backoff_seconds}
                  onChange={(event) => set("notify_backoff_seconds", event.target.value)}
                />
              </Field>
            </div>
            <Field
              label={t(`${L}.field.recipients`)}
              hint={t(`${L}.hint.recipients`)}
              error={
                problems.alert_recipients
                  ? t(problems.alert_recipients, {
                      entry: recipientsProblem(form.alert_recipients)?.entry ?? "",
                    })
                  : undefined
              }
            >
              <Input
                value={form.alert_recipients}
                placeholder={t(`${L}.placeholder.recipients`)}
                onChange={(event) => set("alert_recipients", event.target.value)}
              />
            </Field>
            <Button type="submit" className="min-h-11" disabled={saving}>
              {saving ? t(`${L}.saving`) : t(`${L}.save`)}
            </Button>
          </form>
        )}
      </section>

      <section aria-labelledby="notif-alerts" className="max-w-3xl space-y-2">
        <h2 id="notif-alerts" className="text-lg font-semibold">
          {t(`${L}.alertsTitle`)}
        </h2>
        <p className="text-sm text-muted-foreground">{t(`${L}.alertsIntro`)}</p>
        <p className="text-sm">
          <Link to="/admin/ajustes" className="underline underline-offset-2">
            {t(`${L}.thresholds`)}
          </Link>
        </p>
      </section>

      <section aria-labelledby="notif-steps" className="max-w-3xl space-y-2">
        <h2 id="notif-steps" className="text-lg font-semibold">
          {t(`${L}.stepsTitle`)}
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {(["domain", "key", "vault", "sender", "provider", "test"] as const).map((step) => (
            <li key={step}>{t(`${L}.steps.${step}` as MessageKey)}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

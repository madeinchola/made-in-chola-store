import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { t, type MessageKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { useStoreSettings } from "@/features/catalog/hooks";
import { useAuth } from "@/features/auth/useAuth";
import { canonicalUrl } from "@/features/storefront/seo/canonical";
import { siteUrl } from "@/features/storefront/seo/siteUrl";
import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { callFunction } from "@/lib/functions";
import {
  COMPLAINT_KINDS,
  DETAIL_MAX,
  EMPTY_FORM,
  firstInvalid,
  toRequestBody,
  validateComplaint,
  type ComplaintErrors,
  type ComplaintForm,
  type FieldKey,
} from "./complaintForm";

const L = "complaints" as const;
const DEFAULT_DAYS = 10;

interface Sent {
  number: string | null;
  dueAt: string | null;
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));

/** El canal de reclamos: un formulario público (con o sin cuenta) que termina en un número de seguimiento. */
export function ComplaintPage() {
  usePageMeta({
    title: t(`${L}.title`),
    description: t(`${L}.intro`, { days: DEFAULT_DAYS }),
    canonical: canonicalUrl(siteUrl(), storeRoutes.complaints),
    robots: "index,follow",
  });
  const settings = useStoreSettings();
  const { profile, session } = useAuth();
  const rawDays = settings.data?.complaints_response_days;
  const days = typeof rawDays === "number" && rawDays > 0 ? rawDays : DEFAULT_DAYS;

  const [form, setForm] = useState<ComplaintForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<ComplaintErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Candado síncrono: dos envíos en el mismo instante (dos Enter seguidos) no esperan al siguiente pintado para verse.
  const sendingRef = useRef(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const prefilled = useRef(false);
  const refs = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Quien tiene sesión no vuelve a escribir su nombre y su correo (se puede cambiar).
  useEffect(() => {
    if (!profile || prefilled.current) return;
    prefilled.current = true;
    setForm((current) => ({
      ...current,
      name: current.name || profile.full_name || "",
      email: current.email || profile.email || "",
    }));
  }, [profile]);

  useEffect(() => {
    if (sent) headingRef.current?.focus();
  }, [sent]);

  const set = <K extends keyof ComplaintForm>(key: K, value: ComplaintForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const message = (key: FieldKey) =>
    errors[key] ? t(`${L}.errors.${errors[key]}` as MessageKey) : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sendingRef.current) return;
    setSubmitError(null);
    const found = validateComplaint(form);
    setErrors(found);
    const first = firstInvalid(found);
    if (first) {
      refs.current[first === "contact" ? "email" : first]?.focus();
      return;
    }
    sendingRef.current = true;
    setSubmitting(true);
    try {
      const result = await callFunction<{ number: string | null; due_at: string | null }>(
        "complaint",
        toRequestBody(form),
        session?.access_token ? { token: session.access_token } : {},
      );
      if (result.ok) {
        setSent({ number: result.data.number, dueAt: result.data.due_at });
        setForm(EMPTY_FORM);
        return;
      }
      setSubmitError(
        t(
          result.status === 429
            ? `${L}.errors.rateLimited`
            : result.code === "network"
              ? `${L}.errors.network`
              : result.status === 400
                ? `${L}.errors.invalid`
                : `${L}.errors.generic`,
        ),
      );
    } finally {
      sendingRef.current = false;
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <section className="container max-w-2xl py-10" aria-labelledby="complaint-done">
        <h1
          id="complaint-done"
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-3xl font-semibold outline-none"
        >
          {t(`${L}.success.title`)}
        </h1>
        <div role="status" className="mt-4 space-y-2">
          {sent.number ? (
            <>
              <p className="text-lg">{t(`${L}.success.number`, { number: sent.number })}</p>
              {sent.dueAt && (
                <p className="text-muted-foreground">
                  {t(`${L}.success.due`, { date: formatDate(sent.dueAt) })}
                </p>
              )}
            </>
          ) : (
            <p>{t(`${L}.success.noNumber`)}</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-6 min-h-11"
          onClick={() => setSent(null)}
        >
          {t(`${L}.success.another`)}
        </Button>
      </section>
    );
  }

  return (
    <section className="container max-w-2xl py-10">
      <h1 className="font-display text-3xl font-semibold">{t(`${L}.title`)}</h1>
      <p className="mt-2 text-muted-foreground">{t(`${L}.intro`, { days })}</p>
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label={t(`${L}.form.label`)}
        className="mt-6 space-y-5"
      >
        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {submitError}
          </div>
        )}
        <Field label={t(`${L}.form.name`)} error={message("name")}>
          <Input
            ref={(el) => void (refs.current.name = el)}
            autoComplete="name"
            maxLength={120}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t(`${L}.form.email`)}
            hint={t(`${L}.form.emailHint`)}
            error={message("email") ?? message("contact")}
          >
            <Input
              ref={(el) => void (refs.current.email = el)}
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field
            label={t(`${L}.form.phone`)}
            hint={t(`${L}.form.phoneHint`)}
            error={message("phone")}
          >
            <Input
              ref={(el) => void (refs.current.phone = el)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={40}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t(`${L}.form.order`)}
            hint={t(`${L}.form.orderHint`)}
            error={message("order")}
          >
            <Input
              ref={(el) => void (refs.current.order = el)}
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={30}
              value={form.order}
              onChange={(e) => set("order", e.target.value)}
            />
          </Field>
          <Field label={t(`${L}.form.kind`)} error={message("kind")}>
            <select
              ref={(el) => void (refs.current.kind = el)}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm aria-[invalid=true]:border-destructive"
              value={form.kind}
              onChange={(e) => set("kind", e.target.value as ComplaintForm["kind"])}
            >
              <option value="" />
              {COMPLAINT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`${L}.kinds.${kind}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label={t(`${L}.form.detail`)}
          hint={t(`${L}.form.detailHint`)}
          error={message("detail")}
        >
          <Textarea
            ref={(el) => void (refs.current.detail = el)}
            rows={7}
            value={form.detail}
            onChange={(e) => set("detail", e.target.value)}
          />
        </Field>
        <p
          className={`text-xs ${form.detail.length > DETAIL_MAX ? "text-destructive" : "text-muted-foreground"}`}
        >
          {t(`${L}.form.counter`, { count: form.detail.length })}
        </p>
        {/* Campo trampa: fuera de la vista, fuera del orden de tabulación y oculto a lectores de pantalla. Un robot lo llena. */}
        <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label>
            {t(`${L}.form.trap`)}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
            />
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(`${L}.form.privacy`, { link: "{link}" })
            .split("{link}")
            .map((part, i, all) => (
              <span key={i}>
                {part}
                {i < all.length - 1 && (
                  <Link to="/legal/privacidad" className="underline underline-offset-2">
                    {t(`${L}.form.privacyLink`)}
                  </Link>
                )}
              </span>
            ))}
        </p>
        <Button type="submit" size="lg" className="min-h-12 w-full sm:w-auto" disabled={submitting}>
          {submitting ? t(`${L}.form.sending`) : t(`${L}.form.submit`)}
        </Button>
      </form>
    </section>
  );
}

import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/features/auth/useAuth";
import { authErrorMessage } from "@/features/auth/messages";
import { safeRedirectPath } from "@/features/auth/redirect";
import { COUNTRIES } from "@/lib/countries";
import { t, type MessageKey } from "@/i18n";
import { normalizeEmail, normalizePhone } from "@shared/identity";
import { validatePassword } from "@shared/password-policy";

interface FormValues {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  password: string;
  confirm: string;
}

type Mode = "email" | "phone";

export function RegisterPage() {
  const { signUp, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = safeRedirectPath((location.state as { from?: unknown } | null)?.from);
  const [mode, setMode] = useState<Mode>("email");
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    mode: "onTouched",
    defaultValues: { fullName: "", email: "", phone: "", country: "BO", password: "", confirm: "" },
  });
  const password = useWatch({ control, name: "password" });

  if (status === "authenticated") return <Navigate to={from} replace />;

  const passwordContext = () => ({
    email: mode === "email" ? getValues("email") : null,
    phone: mode === "phone" ? getValues("phone") : null,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await signUp({
      fullName: values.fullName.trim(),
      ...(mode === "email"
        ? { email: values.email }
        : { phone: values.phone, phoneCountry: values.country }),
      password: values.password,
    });
    if (result.ok) navigate(from, { replace: true });
    else setFormError(authErrorMessage(result));
  });

  return (
    <section className="container max-w-md py-12">
      <h1 className="font-display text-2xl font-bold">{t("auth.register.title")}</h1>
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {formError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {formError}
          </div>
        )}
        <Field label={t("auth.register.name")} error={errors.fullName?.message}>
          <Input
            autoComplete="name"
            {...register("fullName", {
              validate: (v) => (v.trim().length > 0 ? true : t("auth.errors.required")),
              maxLength: { value: 120, message: t("auth.errors.unknown") },
            })}
          />
        </Field>

        <div
          role="group"
          aria-label={t("auth.register.title")}
          className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm"
        >
          {(["email", "phone"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-sm py-1.5 font-medium ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {t(m === "email" ? "auth.register.viaEmail" : "auth.register.viaPhone")}
            </button>
          ))}
        </div>

        {mode === "email" ? (
          <Field label={t("auth.register.email")} error={errors.email?.message}>
            <Input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              {...register("email", {
                validate: (v) => {
                  if (mode !== "email") return true;
                  const r = normalizeEmail(v);
                  return r.ok ? true : t(`auth.email.${r.reason}` as MessageKey);
                },
              })}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-[8.5rem_1fr] gap-2">
            <Field label={t("auth.register.country")}>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                {...register("country")}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.dial}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("auth.register.phone")} error={errors.phone?.message}>
              <Input
                type="tel"
                autoComplete="tel-national"
                inputMode="tel"
                {...register("phone", {
                  validate: (v) => {
                    if (mode !== "phone") return true;
                    const r = normalizePhone(v, getValues("country"));
                    return r.ok ? true : t(`auth.phone.${r.reason}` as MessageKey);
                  },
                })}
              />
            </Field>
          </div>
        )}

        <Field label={t("auth.register.password")} error={errors.password?.message}>
          <PasswordInput
            autoComplete="new-password"
            {...register("password", {
              validate: (v) => {
                const r = validatePassword(v, passwordContext());
                return r.ok
                  ? true
                  : r.failures.map((f) => t(`auth.password.${f}` as MessageKey)).join(" ");
              },
            })}
          />
        </Field>
        <Field label={t("auth.register.confirm")} error={errors.confirm?.message}>
          <PasswordInput
            autoComplete="new-password"
            {...register("confirm", {
              validate: (v) => (v === password ? true : t("auth.errors.passwordMismatch")),
            })}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("auth.register.submitting") : t("auth.register.submit")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("auth.register.haveAccount")}{" "}
        <Link to="/login" state={location.state} className="text-foreground underline">
          {t("auth.register.login")}
        </Link>
      </p>
    </section>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/features/auth/useAuth";
import { authErrorMessage } from "@/features/auth/messages";
import { callFunction } from "@/lib/functions";
import { t, type MessageKey } from "@/i18n";
import { validatePassword } from "@shared/password-policy";

/** Tiempo máximo esperando que supabase-js convierta el enlace del correo en sesión. */
const LINK_TIMEOUT_MS = 6000;

export function ResetPasswordPage() {
  const { session, status, profile } = useAuth();
  const navigate = useNavigate();
  const [timedOut, setTimedOut] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<{ password: string; confirm: string }>({
    mode: "onTouched",
    defaultValues: { password: "", confirm: "" },
  });
  const password = useWatch({ control, name: "password" });

  useEffect(() => {
    if (session) return;
    const timer = window.setTimeout(() => setTimedOut(true), LINK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [session]);

  if (!session) {
    return (
      <section className="container max-w-md py-12 text-center">
        {status === "anonymous" && timedOut ? (
          <>
            <p role="alert">{t("auth.reset.invalidLink")}</p>
            <p className="mt-4">
              <Link to="/recuperar" className="underline">
                {t("auth.reset.requestNew")}
              </Link>
            </p>
          </>
        ) : (
          <p role="status">{t("auth.reset.checking")}</p>
        )}
      </section>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await callFunction(
      "set-password",
      { password: values.password },
      { token: session.access_token },
    );
    if (!res.ok) {
      setFormError(
        authErrorMessage({ code: res.code, retryAfter: res.retryAfter, failures: res.failures }),
      );
      return;
    }
    toast.success(t("auth.reset.success"));
    navigate("/", { replace: true });
  });

  return (
    <section className="container max-w-md py-12">
      <h1 className="font-display text-2xl font-bold">{t("auth.reset.title")}</h1>
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {formError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {formError}
          </div>
        )}
        <Field label={t("auth.reset.password")} error={errors.password?.message}>
          <PasswordInput
            autoComplete="new-password"
            {...register("password", {
              validate: (v) => {
                const r = validatePassword(v, {
                  email: profile?.email,
                  phone: profile?.phone_e164,
                });
                return r.ok
                  ? true
                  : r.failures.map((f) => t(`auth.password.${f}` as MessageKey)).join(" ");
              },
            })}
          />
        </Field>
        <Field label={t("auth.reset.confirm")} error={errors.confirm?.message}>
          <PasswordInput
            autoComplete="new-password"
            {...register("confirm", {
              validate: (v) => (v === password ? true : t("auth.errors.passwordMismatch")),
            })}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("auth.reset.submitting") : t("auth.reset.submit")}
        </Button>
      </form>
    </section>
  );
}

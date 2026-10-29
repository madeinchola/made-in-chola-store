import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";
import { t, type MessageKey } from "@/i18n";
import { normalizeEmail } from "@shared/identity";

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async ({ email }) => {
    const parsed = normalizeEmail(email);
    if (parsed.ok) {
      // El resultado se ignora a propósito: se muestra SIEMPRE el mismo mensaje (no revela si la cuenta existe).
      await getSupabase().auth.resetPasswordForEmail(parsed.email, {
        redirectTo: `${window.location.origin}/restablecer`,
      });
    }
    setSent(true);
  });

  return (
    <section className="container max-w-md py-12">
      <h1 className="font-display text-2xl font-bold">{t("auth.forgot.title")}</h1>
      {sent ? (
        <div role="status" className="mt-6 space-y-4 text-sm">
          <p>{t("auth.forgot.sent")}</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">{t("auth.forgot.body")}</p>
          <Field label={t("auth.forgot.email")} error={errors.email?.message}>
            <Input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              {...register("email", {
                validate: (v) => {
                  const r = normalizeEmail(v);
                  return r.ok ? true : t(`auth.email.${r.reason}` as MessageKey);
                },
              })}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t("auth.forgot.submitting") : t("auth.forgot.submit")}
          </Button>
        </form>
      )}
      <p className="mt-6 rounded-md bg-muted p-3 text-xs text-muted-foreground">
        {t("auth.forgot.phoneOnly")}
      </p>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="underline">
          {t("auth.forgot.back")}
        </Link>
      </p>
    </section>
  );
}

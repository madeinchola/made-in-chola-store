import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/features/auth/useAuth";
import { authErrorMessage } from "@/features/auth/messages";
import { safeRedirectPath } from "@/features/auth/redirect";
import { t, type MessageKey } from "@/i18n";
import { classifyIdentifier, normalizeEmail, normalizePhone } from "@shared/identity";

interface FormValues {
  identifier: string;
  password: string;
}

/** Mensaje de formato para el campo único (solo formato, nunca si la cuenta existe). */
function identifierFormatError(value: string): string | null {
  if (classifyIdentifier(value).kind !== "invalid") return null;
  if (value.includes("@")) {
    const r = normalizeEmail(value);
    return t(`auth.email.${r.ok ? "invalid" : r.reason}` as MessageKey);
  }
  const r = normalizePhone(value);
  return t(`auth.phone.${r.ok ? "invalid_chars" : r.reason}` as MessageKey);
}

export function LoginPage() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = safeRedirectPath((location.state as { from?: unknown } | null)?.from);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { identifier: "", password: "" } });

  if (status === "authenticated") return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async ({ identifier, password }) => {
    setFormError(null);
    const formatError = identifierFormatError(identifier);
    if (formatError) {
      setError("identifier", { message: formatError });
      return;
    }
    const result = await signIn(identifier, password);
    if (result.ok) navigate(from, { replace: true });
    else setFormError(authErrorMessage(result));
  });

  return (
    <section className="container max-w-md py-12">
      <h1 className="font-display text-2xl font-bold">{t("auth.login.title")}</h1>
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {formError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {formError}
          </div>
        )}
        <Field
          label={t("auth.login.identifier")}
          hint={t("auth.login.identifierHint")}
          error={errors.identifier?.message}
        >
          <Input
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            {...register("identifier", { required: t("auth.errors.required") })}
          />
        </Field>
        <Field label={t("auth.login.password")} error={errors.password?.message}>
          <PasswordInput
            autoComplete="current-password"
            {...register("password", { required: t("auth.errors.required") })}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>
      </form>
      <div className="mt-6 space-y-2 text-center text-sm">
        <p>
          <Link to="/recuperar" className="underline">
            {t("auth.login.forgot")}
          </Link>
        </p>
        <p className="text-muted-foreground">
          {t("auth.login.noAccount")}{" "}
          <Link to="/registro" state={location.state} className="text-foreground underline">
            {t("auth.login.register")}
          </Link>
        </p>
      </div>
    </section>
  );
}

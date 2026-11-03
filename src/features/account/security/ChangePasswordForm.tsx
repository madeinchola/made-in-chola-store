import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { PasswordStrength } from "@/components/ui/password-strength";
import { useAuth } from "@/features/auth/useAuth";
import { t, type MessageKey } from "@/i18n";
import { validatePassword } from "@shared/password-policy";
import { FormAlert } from "./FormAlert";
import {
  commonFailureMessage,
  passwordFailureMessages,
  type FunctionFailure,
} from "./functionErrors";
import { useChangePassword } from "./hooks";
import { useSingleFlight } from "./useSingleFlight";

interface FormValues {
  current: string;
  next: string;
  confirm: string;
}

const EMPTY: FormValues = { current: "", next: "", confirm: "" };

/** Los mensajes de una regla por línea: así un solo error de campo puede ser una lista (ver `MessageList`). */
const joinMessages = (messages: readonly string[]) => messages.join("\n");

/** Un mensaje → párrafo; varios (las reglas incumplidas) → lista. Siempre `role="alert"` y enlazado con el campo. */
function MessageList({ id, message }: { id: string; message: string }) {
  const lines = message.split("\n");
  return (
    <div id={id} role="alert" className="text-xs text-destructive">
      {lines.length === 1 ? (
        <p>{message}</p>
      ) : (
        <ul className="list-disc pl-4">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Cambiar la contraseña desde la cuenta: actual + nueva + repetir. La política (la misma del registro) se valida en el
 * cliente para dar respuesta inmediata, pero el servidor decide (también aplica el control de filtraciones públicas).
 * Las contraseñas viven solo en el estado del formulario: se vacían al terminar bien y la actual también si es incorrecta.
 */
export function ChangePasswordForm() {
  const { profile } = useAuth();
  const mutation = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const singleFlight = useSingleFlight();
  const nextId = useId();
  const strengthId = `${nextId}-strength`;
  const nextErrorId = `${nextId}-error`;

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setError,
    setFocus,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ mode: "onTouched", defaultValues: EMPTY });
  const next = useWatch({ control, name: "next" });
  const context = { email: profile?.email ?? null, phone: profile?.phone_e164 ?? null };

  const applyFailure = (failure: FunctionFailure) => {
    if (failure.code === "invalid_credentials") {
      setError("current", {
        type: "server",
        message: t("acct.security.errors.invalid_credentials"),
      });
      setValue("current", ""); // la contraseña mal escrita no se conserva
      setFocus("current");
      return;
    }
    if (failure.code === "weak_password") {
      const rules = passwordFailureMessages(failure.failures);
      setError("next", {
        type: "server",
        message: joinMessages(rules.length > 0 ? rules : [t("auth.errors.weak_password")]),
      });
      setFocus("next");
      return;
    }
    if (failure.code === "pwned_password" || failure.code === "same_password") {
      const key: MessageKey =
        failure.code === "pwned_password"
          ? "auth.errors.pwned_password"
          : "acct.security.errors.same_password";
      setError("next", { type: "server", message: t(key) });
      setFocus("next");
      return;
    }
    setFormError(commonFailureMessage(failure));
  };

  // `singleFlight`: doble envío (Intro + clic) → una sola petición.
  const onSubmit = handleSubmit((values) =>
    singleFlight(async () => {
      setFormError(null);
      const result = await mutation.mutateAsync({
        currentPassword: values.current,
        newPassword: values.next,
      });
      if (result.ok) {
        reset(EMPTY);
        toast.success(
          t(
            result.data.relogin
              ? "acct.security.password.successRelogin"
              : "acct.security.password.success",
          ),
        );
      } else {
        applyFailure(result);
      }
    }),
  );

  const nextError = errors.next?.message;
  const describedBy = [strengthId, nextError ? nextErrorId : null].filter(Boolean).join(" ");

  return (
    <section aria-labelledby={`${nextId}-title`} className="space-y-4">
      <div className="space-y-1">
        <h3 id={`${nextId}-title`} className="font-display text-display-sm">
          {t("acct.security.password.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("acct.security.password.intro")}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field label={t("acct.security.password.current")} error={errors.current?.message}>
          <PasswordInput
            autoComplete="current-password"
            {...register("current", {
              validate: (v) => (v === "" ? t("acct.security.errors.required") : true),
            })}
          />
        </Field>
        <div className="space-y-1.5">
          <label htmlFor={`${nextId}-input`} className="text-sm font-medium">
            {t("acct.security.password.next")}
          </label>
          <PasswordInput
            id={`${nextId}-input`}
            autoComplete="new-password"
            aria-invalid={nextError ? true : undefined}
            aria-describedby={describedBy}
            {...register("next", {
              validate: (v) => {
                if (v !== "" && v === getValues("current")) {
                  return t("acct.security.errors.same_password");
                }
                const result = validatePassword(v, context);
                return result.ok
                  ? true
                  : joinMessages(result.failures.map((f) => t(`auth.password.${f}` as MessageKey)));
              },
            })}
          />
          <PasswordStrength password={next} context={context} id={strengthId} />
          {nextError && <MessageList id={nextErrorId} message={nextError} />}
        </div>
        <Field label={t("acct.security.password.confirm")} error={errors.confirm?.message}>
          <PasswordInput
            autoComplete="new-password"
            {...register("confirm", {
              validate: (v) => (v === getValues("next") ? true : t("auth.errors.passwordMismatch")),
            })}
          />
        </Field>
        <Button type="submit" loading={mutation.isPending}>
          {t("acct.security.password.submit")}
        </Button>
      </form>
    </section>
  );
}

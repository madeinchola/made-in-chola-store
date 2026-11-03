import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { t, type MessageKey } from "@/i18n";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/countries";
import { applyPhoneMask } from "@/lib/phoneMask";
import type { FunctionResult } from "@/lib/functions";
import { normalizeEmail, normalizePhone } from "@shared/identity";
import { FormAlert } from "../security/FormAlert";
import { useSingleFlight } from "../security/useSingleFlight";
import { commonFailureMessage, type FunctionFailure } from "../security/functionErrors";
import type { ContactChange } from "./api";
import { useChangeContact } from "./hooks";

export type ContactKind = "email" | "phone";
export type ContactMode = "change" | "add" | "remove";
export interface ContactTarget {
  kind: ContactKind;
  mode: ContactMode;
}

const TITLE = { change: "changeTitle", add: "addTitle", remove: "removeTitle" } as const;
const INTRO = { change: "changeIntro", add: "addIntro", remove: "removeIntro" } as const;
const SUBMIT = { change: "submitChange", add: "submitAdd", remove: "submitRemove" } as const;
const DONE = { change: "changed", add: "added", remove: "removed" } as const;

const text = (kind: ContactKind, key: string) =>
  t(`acct.profile.contact.${kind}.${key}` as MessageKey);

interface ContactDialogProps {
  target: ContactTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Valores actuales: sirven para avisar «ese ya es tu email» sin llamar al servidor. */
  currentEmail: string | null;
  currentPhone: string | null;
  /** Foco al cerrar cuando quien abrió el diálogo ya no existe (p. ej. el botón «Quitar» desapareció). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Cambiar, agregar o quitar el email o el teléfono. Siempre pide la contraseña actual (BR-ACC-02/03) y llama a la Edge
 * Function `update-contact`. Los errores son UNIFORMES: un contacto que ya es de otra cuenta recibe el mismo mensaje que
 * cualquier otro fallo de la operación, así no se confirma qué emails o teléfonos están registrados.
 */
export function ContactDialog({
  target,
  onOpenChange,
  currentEmail,
  currentPhone,
  onCloseAutoFocus,
}: ContactDialogProps) {
  const mutation = useChangeContact();
  const pending = mutation.isPending;
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => (next || !pending) && onOpenChange(next)}
    >
      <DialogContent {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}>
        {target && (
          <ContactForm
            key={`${target.kind}:${target.mode}`}
            target={target}
            currentEmail={currentEmail}
            currentPhone={currentPhone}
            pending={pending}
            submit={mutation.mutateAsync}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FormValues {
  value: string;
  country: string;
  password: string;
}

interface ContactFormProps {
  target: ContactTarget;
  currentEmail: string | null;
  currentPhone: string | null;
  pending: boolean;
  submit: (input: ContactChange) => Promise<FunctionResult<{ ok: true; changed: boolean }>>;
  onClose: () => void;
}

function ContactForm({
  target,
  currentEmail,
  currentPhone,
  pending,
  submit,
  onClose,
}: ContactFormProps) {
  const { kind, mode } = target;
  const removing = mode === "remove";
  const [formError, setFormError] = useState<string | null>(null);
  const singleFlight = useSingleFlight();
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    setFocus,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { value: "", country: DEFAULT_COUNTRY, password: "" } });

  /** Valida con las MISMAS reglas que el servidor (código compartido) y devuelve el valor normalizado o el error. */
  const check = (raw: string): { ok: true; value: string } | { ok: false; message: string } => {
    if (kind === "email") {
      const result = normalizeEmail(raw);
      if (!result.ok) return { ok: false, message: t(`auth.email.${result.reason}` as MessageKey) };
      if (result.email === currentEmail) {
        return { ok: false, message: t("acct.profile.contact.sameEmail") };
      }
      return { ok: true, value: result.email };
    }
    // `normalizePhone` solo lanza con un país que no conozca: el selector ofrece únicamente los de COUNTRIES, y un
    // test comprueba que todos tienen prefijo (ver phoneCountries.test.ts).
    const result = normalizePhone(raw, getValues("country"));
    if (!result.ok) return { ok: false, message: t(`auth.phone.${result.reason}` as MessageKey) };
    if (result.e164 === currentPhone) {
      return { ok: false, message: t("acct.profile.contact.samePhone") };
    }
    return { ok: true, value: result.e164 };
  };

  const applyFailure = (failure: FunctionFailure) => {
    switch (failure.code) {
      case "invalid_credentials":
        setError("password", {
          type: "server",
          message: t("acct.security.errors.invalid_credentials"),
        });
        setValue("password", ""); // la contraseña mal escrita no se conserva
        setFocus("password");
        return;
      case "invalid_email":
      case "invalid_phone":
        setError("value", { type: "server", message: t(`auth.errors.${failure.code}`) });
        setFocus("value");
        return;
      case "identifier_required":
      case "nothing_to_change":
      case "contact_update_failed":
      case "contact_update_conflict":
      case "contact_update_unavailable":
      case "contact_update_inconsistent":
        setFormError(t(`acct.profile.contact.errors.${failure.code}`));
        return;
      default:
        setFormError(commonFailureMessage(failure));
    }
  };

  const onSubmit = handleSubmit((values) =>
    singleFlight(async () => {
      setFormError(null);
      let nextValue: string | null = null;
      if (!removing) {
        const checked = check(values.value);
        if (!checked.ok) return; // ya lo marcó la validación del campo
        nextValue = checked.value;
      }
      // Se envía el valor YA normalizado (email en minúsculas, teléfono E.164); el servidor lo vuelve a comprobar.
      const input: ContactChange =
        kind === "email"
          ? { password: values.password, email: nextValue }
          : {
              password: values.password,
              phone: nextValue,
              // El país solo importa si hay un número que interpretar (al quitar no viaja).
              ...(nextValue !== null ? { phoneCountry: values.country } : {}),
            };
      const result = await submit(input);
      if (!result.ok) {
        applyFailure(result);
        return;
      }
      if (result.data.changed) toast.success(text(kind, DONE[mode]));
      else toast.info(t("acct.profile.contact.noChange"));
      onClose();
    }),
  );

  const label = text(kind, mode === "add" ? "addField" : "field");
  const valueError = errors.value?.message;
  const validateValue = (raw: string) => {
    const checked = check(raw);
    return checked.ok ? true : checked.message;
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{text(kind, TITLE[mode])}</DialogTitle>
        <DialogDescription>{text(kind, INTRO[mode])}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        {!removing && kind === "email" && (
          <Field label={label} error={valueError}>
            <Input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              {...register("value", { validate: validateValue })}
            />
          </Field>
        )}
        {!removing && kind === "phone" && (
          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
            <Field label={t("acct.profile.contact.country")}>
              <Select {...register("country")}>
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flag} {country.dial}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={label} error={valueError}>
              <Input
                type="tel"
                autoComplete="tel-national"
                inputMode="tel"
                autoFocus
                {...register("value", {
                  validate: validateValue,
                  // Máscara en vivo (7123 4567) conservando el cursor; es solo presentación (`normalizePhone` acepta espacios).
                  onChange: (event: { target: HTMLInputElement; nativeEvent?: Event }) => {
                    applyPhoneMask(
                      event.target,
                      (event.nativeEvent as InputEvent | undefined)?.inputType,
                    );
                  },
                })}
              />
            </Field>
          </div>
        )}
        <Field
          label={t("acct.profile.contact.password")}
          hint={t("acct.profile.contact.passwordHint")}
          error={errors.password?.message}
        >
          <PasswordInput
            autoComplete="current-password"
            {...register("password", {
              validate: (v) => (v === "" ? t("acct.profile.contact.passwordRequired") : true),
            })}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending || undefined}
            onClick={() => !pending && onClose()}
          >
            {t("acct.profile.contact.cancel")}
          </Button>
          <Button type="submit" loading={pending} variant={removing ? "destructive" : "default"}>
            {text(kind, SUBMIT[mode])}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

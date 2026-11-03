import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { LocationPicker } from "@/components/map/LocationPicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/countries";
import { toAppError } from "@/lib/errors";
import { applyPhoneMask } from "@/lib/phoneMask";
import { isSessionError } from "./errors";
import { useCreateAddress, useUpdateAddress } from "./hooks";
import type { Address, DeliveryCountry } from "./types";
import {
  addressToFormValues,
  BOLIVIA_DEPARTMENTS,
  createAddressSchema,
  toAddressInput,
  type AddressFormValues,
} from "./validation";

export type AddressFormTarget = { kind: "create" } | { kind: "edit"; address: Address };

interface AddressFormSheetProps {
  /** Qué se está haciendo (null = cerrado). */
  target: AddressFormTarget | null;
  onOpenChange: (open: boolean) => void;
  countries: readonly DeliveryCountry[];
  /** Cuántas direcciones activas tiene la persona (decide si la primera será la predeterminada). */
  activeCount: number;
  onSaved: (message: string, address: Address) => void;
  /**
   * Se llama al cerrar, DESPUÉS de devolver el foco al botón que abrió el cajón. Si ese botón ya no existe (el estado
   * vacío se reemplazó por la lista) el foco habría caído en <body>: el padre decide a dónde ir.
   */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Formulario de dirección en un cajón (diálogo modal: foco atrapado, Esc cierra, devuelve el foco; en móvil ocupa todo el
 * ancho y el botón de guardar queda siempre a la vista). El formulario se monta al abrir y se desmonta al cerrar: nunca
 * arrastra datos de otra dirección.
 */
export function AddressFormSheet({
  target,
  onOpenChange,
  countries,
  activeCount,
  onSaved,
  onCloseAutoFocus,
}: AddressFormSheetProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={target !== null}
      // Mientras se guarda no se cierra (Esc, clic fuera o la X): se perdería el resultado y el formulario.
      onOpenChange={(open) => {
        if (!open && busy) return;
        onOpenChange(open);
      }}
    >
      <SheetContent
        side="right"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        className="sm:w-[min(100%,34rem)]"
        bodyClassName="px-5 pt-6 sm:px-6"
      >
        {target && (
          <AddressForm
            key={target.kind === "edit" ? target.address.id : "new"}
            target={target}
            countries={countries}
            activeCount={activeCount}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
            onBusyChange={setBusy}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface FormProps {
  target: AddressFormTarget;
  countries: readonly DeliveryCountry[];
  activeCount: number;
  onClose: () => void;
  onSaved: (message: string, address: Address) => void;
  onBusyChange: (busy: boolean) => void;
}

function CheckRow({
  id,
  label,
  checked,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  invalid?: boolean;
  describedBy?: string | undefined;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}

function AddressForm({
  target,
  countries,
  activeCount,
  onClose,
  onSaved,
  onBusyChange,
}: FormProps) {
  const { profile } = useAuth();
  const editing = target.kind === "edit" ? target.address : null;
  const create = useCreateAddress(profile?.id);
  const update = useUpdateAddress(profile?.id);
  const formRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const [formError, setFormError] = useState<{ message: string; session: boolean } | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  // Países ofrecidos. Una dirección ya guardada en un país que dejó de estar habilitado conserva el suyo (la base solo
  // revisa el país cuando CAMBIA); a una dirección nueva no se le ofrece.
  const countryOptions = useMemo(() => {
    const list = [...countries];
    if (editing && !list.some((c) => c.code === editing.country)) {
      list.push({
        code: editing.country,
        name: COUNTRIES.find((c) => c.code === editing.country)?.name ?? editing.country,
      });
    }
    return list;
  }, [countries, editing]);
  const allowedCodes = countryOptions.map((c) => c.code).join(",");
  const schema = useMemo(
    () => createAddressSchema({ allowedCountries: allowedCodes.split(",") }),
    [allowedCodes],
  );

  const defaultValues = useMemo(
    () =>
      addressToFormValues(editing, {
        recipient: profile?.full_name ?? "",
        phone: profile?.phone_e164 ?? null,
        country:
          countryOptions.find((c) => c.code === DEFAULT_COUNTRY)?.code ??
          countryOptions[0]?.code ??
          DEFAULT_COUNTRY,
      }),
    // Los valores iniciales se toman UNA vez al abrir: si el perfil se refrescara mientras se escribe, no se pisa nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    trigger,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<AddressFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onTouched",
    // El primer campo inválido se enfoca con un efecto propio (también cubre el mapa y las casillas).
    shouldFocusError: false,
  });

  const country = watch("country");
  const lat = watch("lat");
  const lng = watch("lng");
  const pinValue = useMemo(() => ({ lat, lng }), [lat, lng]);

  useEffect(() => {
    onBusyChange(isSubmitting);
    return () => onBusyChange(false);
  }, [isSubmitting, onBusyChange]);

  // Tras un envío con errores, el foco va al primer campo inválido (en orden de pantalla). RHF publica los errores DESPUÉS
  // de llamar a `onInvalid`, así que se pide el foco y se concede en cuanto un campo aparece marcado como inválido.
  const focusRequested = useRef(false);
  useEffect(() => {
    if (!focusRequested.current) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!invalid) return;
    focusRequested.current = false;
    invalid.focus();
  }, [errors, focusTick]);

  const onSubmit = handleSubmit(
    async (values) => {
      if (savingRef.current) return; // doble envío
      savingRef.current = true;
      setFormError(null);
      try {
        const input = toAddressInput(values);
        const saved = editing
          ? await update.mutateAsync({ id: editing.id, input })
          : await create.mutateAsync(input);
        onSaved(
          editing ? t("acct.addresses.messages.updated") : t("acct.addresses.messages.created"),
          saved,
        );
      } catch (error) {
        const failure = toAppError(error);
        const session = isSessionError(failure);
        // Con la sesión vencida NO se cierra ni se limpia nada: lo escrito sigue ahí para reintentar.
        setFormError({
          message: session ? t("acct.addresses.form.sessionLost") : failure.message,
          session,
        });
      } finally {
        savingRef.current = false;
      }
    },
    () => {
      focusRequested.current = true;
      setFocusTick((n) => n + 1);
    },
  );

  const isBolivia = country === "BO";
  const isCurrentDefault = editing?.isDefault === true;
  const isFirst = !editing && activeCount === 0;
  const idBase = useMemo(() => `address-form-${editing?.id ?? "new"}`, [editing]);
  const purposeErrorId = `${idBase}-purpose-error`;

  return (
    <>
      <SheetHeader className="pr-8">
        <SheetTitle>
          {editing ? t("acct.addresses.form.editTitle") : t("acct.addresses.form.createTitle")}
        </SheetTitle>
        <SheetDescription>
          {editing ? t("acct.addresses.form.editIntro") : t("acct.addresses.form.createIntro")}
        </SheetDescription>
      </SheetHeader>

      <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
        {formError && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/40 bg-destructive-soft p-3 text-sm text-destructive"
          >
            <p>{formError.message}</p>
            {formError.session && (
              <p>
                <a
                  href="/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {t("acct.addresses.form.sessionLink")}
                </a>
              </p>
            )}
          </div>
        )}

        <Field
          label={t("acct.addresses.form.label")}
          hint={t("acct.addresses.form.labelHint")}
          error={errors.label?.message}
        >
          <Input {...register("label")} autoComplete="off" />
        </Field>

        <Field label={t("acct.addresses.form.recipient")} error={errors.recipient?.message}>
          <Input {...register("recipient")} autoComplete="name" />
        </Field>

        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2">
          <Field label={t("acct.addresses.form.phoneCountry")} error={errors.phoneCountry?.message}>
            <Select {...register("phoneCountry")} autoComplete="off">
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.dial}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("acct.addresses.form.phone")}
            hint={t("acct.addresses.form.phoneHint")}
            error={errors.phone?.message}
          >
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              {...register("phone", {
                // Máscara en vivo (7123 4567) conservando el cursor; RHF lee el valor DESPUÉS de este manejador.
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

        <Field label={t("acct.addresses.form.country")} error={errors.country?.message}>
          <Select
            autoComplete="country"
            {...register("country", {
              // La lista de departamentos depende del país: al cambiar, el anterior ya no sirve.
              onChange: () => setValue("department", "", { shouldValidate: isSubmitted }),
            })}
          >
            {countryOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        {isBolivia ? (
          <Field label={t("acct.addresses.form.department")} error={errors.department?.message}>
            <Select
              key="department-select"
              autoComplete="address-level1"
              {...register("department")}
            >
              <option value="">{t("acct.addresses.form.departmentChoose")}</option>
              {BOLIVIA_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field
            label={t("acct.addresses.form.departmentOther")}
            error={errors.department?.message}
          >
            <Input
              key="department-input"
              autoComplete="address-level1"
              {...register("department")}
            />
          </Field>
        )}

        <Field label={t("acct.addresses.form.city")} error={errors.city?.message}>
          <Input {...register("city")} autoComplete="address-level2" />
        </Field>

        <Field label={t("acct.addresses.form.line1")} error={errors.line1?.message}>
          <Input {...register("line1")} autoComplete="address-line1" />
        </Field>

        <Field label={t("acct.addresses.form.line2")} error={errors.line2?.message}>
          <Input {...register("line2")} autoComplete="address-line2" />
        </Field>

        <Field
          label={t("acct.addresses.form.reference")}
          hint={t("acct.addresses.form.referenceHint")}
          error={errors.referenceText?.message}
        >
          <Textarea {...register("referenceText")} rows={3} autoComplete="off" />
        </Field>

        <LocationPicker
          value={pinValue}
          onChange={(next) => {
            setValue("lat", next.lat, { shouldDirty: true });
            setValue("lng", next.lng, { shouldDirty: true });
            if (isSubmitted) void trigger(["lat", "lng"]);
          }}
          errors={{ lat: errors.lat?.message, lng: errors.lng?.message }}
          country={country}
        />

        <fieldset
          aria-describedby={errors.forShipping ? purposeErrorId : undefined}
          className="space-y-2"
        >
          <legend className="text-sm font-medium">{t("acct.addresses.form.purposeLegend")}</legend>
          <Controller
            control={control}
            name="forShipping"
            render={({ field }) => (
              <CheckRow
                id={`${idBase}-shipping`}
                label={t("acct.addresses.form.shipping")}
                checked={field.value}
                onChange={(checked) => {
                  field.onChange(checked);
                  if (isSubmitted) void trigger("forShipping");
                }}
                invalid={Boolean(errors.forShipping)}
                describedBy={errors.forShipping ? purposeErrorId : undefined}
              />
            )}
          />
          <Controller
            control={control}
            name="forBilling"
            render={({ field }) => (
              <CheckRow
                id={`${idBase}-billing`}
                label={t("acct.addresses.form.billing")}
                checked={field.value}
                onChange={(checked) => {
                  field.onChange(checked);
                  if (isSubmitted) void trigger("forShipping");
                }}
                invalid={Boolean(errors.forShipping)}
                describedBy={errors.forShipping ? purposeErrorId : undefined}
              />
            )}
          />
          {errors.forShipping && (
            <p id={purposeErrorId} role="alert" className="text-xs text-destructive">
              {errors.forShipping.message}
            </p>
          )}
        </fieldset>

        {isCurrentDefault ? (
          <p className="text-sm text-muted-foreground">{t("acct.addresses.form.defaultCurrent")}</p>
        ) : isFirst ? (
          <p className="text-sm text-muted-foreground">{t("acct.addresses.form.defaultFirst")}</p>
        ) : (
          <Controller
            control={control}
            name="isDefault"
            render={({ field }) => (
              <CheckRow
                id={`${idBase}-default`}
                label={t("acct.addresses.form.isDefault")}
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
        )}

        <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-border bg-background px-5 py-3 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
          <Button
            type="button"
            variant="outline"
            aria-disabled={isSubmitting || undefined}
            onClick={() => {
              if (!isSubmitting) onClose();
            }}
          >
            {t("acct.addresses.form.cancel")}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isSubmitting ? t("acct.addresses.form.saving") : t("acct.addresses.form.save")}
          </Button>
        </div>
      </form>
    </>
  );
}

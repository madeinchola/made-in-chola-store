import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { ConflictBanner } from "../ui/ConflictBanner";
import { isStaleVersion } from "../lib/versioned";
import { createMethod, updateMethod } from "./api";
import { useInvalidateShipping, useShippingMutation } from "./hooks";
import {
  isBaseDeliveryMethod,
  methodToValues,
  pickupOptions,
  pickupProblem,
  validateMethodCreate,
  validateMethodUpdate,
  type MethodErrors,
  type MethodFormValues,
  type PickupOption,
} from "./storeMethodLogic";
import type { MethodCreateInput, MethodUpdateInput, ShippingMethod, StoreLocation } from "./types";

interface StoreMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = método nuevo. */
  method: ShippingMethod | null;
  locations: readonly StoreLocation[];
  /** No se pudieron leer las ubicaciones (no es lo mismo que «no hay»). */
  locationsFailed: boolean;
  /** Códigos de TODOS los métodos (también los archivados): el código no puede repetirse. */
  existingCodes: readonly string[];
}

const CHECK_ROW = "flex min-h-11 items-center gap-2 text-sm font-medium";
const CONTROL = "min-h-11";

function optionLabel(o: PickupOption): string {
  if (o.note === "missing") return t("admin.shipping.store.methods.form.pickupOptionMissing");
  if (o.note === "inactive")
    return t("admin.shipping.store.methods.form.pickupOptionInactive", { name: o.name });
  if (o.note === "archived")
    return t("admin.shipping.store.methods.form.pickupOptionArchived", { name: o.name });
  return o.name;
}

function MethodForm({
  method,
  locations,
  locationsFailed,
  existingCodes,
  onClose,
  onBusyChange,
}: Omit<StoreMethodDialogProps, "open" | "onOpenChange"> & {
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [values, setValues] = useState<MethodFormValues>(() => methodToValues(method));
  const [submitted, setSubmitted] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const invalidate = useInvalidateShipping();

  const create = useShippingMutation((input: MethodCreateInput) => createMethod(input));
  const update = useShippingMutation(
    (v: { id: string; updatedAt: string; input: MethodUpdateInput }) =>
      updateMethod(v.id, v.updatedAt, v.input),
  );

  useEffect(() => {
    onBusyChange(saving);
    return () => onBusyChange(false);
  }, [saving, onBusyChange]);

  const editing = method !== null;
  const createResult = useMemo(
    () => validateMethodCreate(values, existingCodes),
    [values, existingCodes],
  );
  const updateResult = useMemo(() => validateMethodUpdate(values), [values]);
  const current = editing ? updateResult : createResult;
  // Tras el primer intento de guardar, los errores siguen a lo que se escribe (el mensaje no queda viejo).
  const errors: MethodErrors = submitted && !current.ok ? current.errors : {};

  useEffect(() => {
    if (focusTick === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const set = <K extends keyof MethodFormValues>(key: K, value: MethodFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const options = useMemo(
    () => pickupOptions(locations, method?.pickupLocationId ?? null),
    [locations, method],
  );
  const currentProblem = method && !locationsFailed ? pickupProblem(method, locations) : null;
  const isPickup = values.kind === "pickup";

  /** Lo que hay que hacer para guardar (alta o edición), o null si el formulario todavía no es válido. */
  const buildSave = (): (() => Promise<unknown>) | null => {
    if (method) {
      return updateResult.ok
        ? () =>
            update.mutateAsync({
              id: method.id,
              updatedAt: method.updatedAt,
              input: updateResult.input,
            })
        : null;
    }
    return createResult.ok ? () => create.mutateAsync(createResult.input) : null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    setFormError(null);
    setSubmitted(true);
    const save = buildSave();
    if (!save) {
      setFocusTick((n) => n + 1);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await save();
      toast.success(
        method
          ? t("admin.shipping.store.methods.toasts.updated")
          : t("admin.shipping.store.methods.toasts.created"),
      );
      onClose();
    } catch (e) {
      if (isStaleVersion(e)) setConflict(true);
      else setFormError(toAppError(e).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const reload = async () => {
    await invalidate();
    onClose();
  };

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      {conflict && <ConflictBanner onReload={() => void reload()} />}
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}

      {editing ? (
        <div className="space-y-1">
          <dl className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipping.store.methods.form.code")}
              </dt>
              <dd className="font-mono">{method.code}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.shipping.store.methods.form.kind")}
              </dt>
              <dd>{t(`admin.shipping.store.methods.kinds.${method.kind}`)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {t("admin.shipping.store.methods.form.fixed")}
          </p>
        </div>
      ) : (
        <Field
          label={t("admin.shipping.store.methods.form.code")}
          hint={t("admin.shipping.store.methods.form.codeHint")}
          error={errors.code}
        >
          <Input
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={`${CONTROL} font-mono`}
            value={values.code}
            onChange={(e) => set("code", e.target.value)}
          />
        </Field>
      )}

      <Field
        label={t("admin.shipping.store.methods.form.name")}
        hint={t("admin.shipping.store.methods.form.nameHint")}
        error={errors.name}
      >
        <Input
          autoComplete="off"
          className={CONTROL}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      {!editing && (
        <Field
          label={t("admin.shipping.store.methods.form.kind")}
          hint={t("admin.shipping.store.methods.form.kindHint")}
        >
          <Select
            className={CONTROL}
            value={values.kind}
            onChange={(e) => set("kind", e.target.value === "pickup" ? "pickup" : "delivery")}
          >
            <option value="delivery">{t("admin.shipping.store.methods.kinds.delivery")}</option>
            <option value="pickup">{t("admin.shipping.store.methods.kinds.pickup")}</option>
          </Select>
        </Field>
      )}

      {isPickup && (
        <div className="space-y-1">
          <Field
            label={t("admin.shipping.store.methods.form.pickupLocation")}
            error={errors.pickupLocationId}
          >
            <Select
              className={CONTROL}
              value={values.pickupLocationId}
              onChange={(e) => set("pickupLocationId", e.target.value)}
            >
              <option value="">{t("admin.shipping.store.methods.form.pickupChoose")}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {locationsFailed
                ? t("admin.shipping.store.methods.form.pickupLoadError")
                : t("admin.shipping.store.methods.form.pickupNone")}
            </p>
          )}
          {currentProblem !== null && values.pickupLocationId === method?.pickupLocationId && (
            <p role="status" className="text-xs text-warning">
              {t(`admin.shipping.store.methods.pickupProblem.${currentProblem}`)}
            </p>
          )}
        </div>
      )}

      <Field label={t("admin.shipping.store.methods.form.description")} error={errors.description}>
        <Textarea
          rows={3}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <div className="space-y-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.shipping.store.methods.form.etaMin")} error={errors.etaMinDays}>
            <Input
              inputMode="numeric"
              autoComplete="off"
              className={CONTROL}
              value={values.etaMinDays}
              onChange={(e) => set("etaMinDays", e.target.value)}
            />
          </Field>
          <Field label={t("admin.shipping.store.methods.form.etaMax")} error={errors.etaMaxDays}>
            <Input
              inputMode="numeric"
              autoComplete="off"
              className={CONTROL}
              value={values.etaMaxDays}
              onChange={(e) => set("etaMaxDays", e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("admin.shipping.store.methods.form.etaHint")}
        </p>
      </div>

      <Field
        label={t("admin.shipping.store.methods.form.order")}
        hint={t("admin.shipping.store.methods.form.orderHint")}
        error={errors.sortOrder}
      >
        <Input
          inputMode="numeric"
          autoComplete="off"
          className={CONTROL}
          value={values.sortOrder}
          onChange={(e) => set("sortOrder", e.target.value)}
        />
      </Field>

      <div>
        <label className={CHECK_ROW}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={values.isActive}
            onChange={(e) => set("isActive", e.target.checked)}
          />
          {t("admin.shipping.store.methods.form.active")}
        </label>
        {method && isBaseDeliveryMethod(method) && !values.isActive && (
          <p role="status" className="text-xs text-warning">
            {t("admin.shipping.store.methods.form.baseDeactivateWarning")}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          aria-disabled={saving || undefined}
          onClick={() => {
            if (!saving) onClose();
          }}
        >
          {t("admin.actions.cancel")}
        </Button>
        <Button type="submit" className="min-h-11" loading={saving}>
          {saving
            ? t("admin.shipping.store.methods.form.submitting")
            : t("admin.shipping.store.methods.form.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Diálogo de alta/edición de un método de envío. Al editar, el código y el tipo se muestran pero NO se cambian (la base
 * los fija). El formulario se monta al abrir: nunca arrastra lo escrito en otro método. Mientras guarda no se puede cerrar.
 */
export function StoreMethodDialog({
  open,
  onOpenChange,
  method,
  locations,
  locationsFailed,
  existingCodes,
}: StoreMethodDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {method
              ? t("admin.shipping.store.methods.form.editTitle")
              : t("admin.shipping.store.methods.form.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.shipping.store.methods.form.intro")}</DialogDescription>
        </DialogHeader>
        <MethodForm
          key={method?.id ?? "new"}
          method={method}
          locations={locations}
          locationsFailed={locationsFailed}
          existingCodes={existingCodes}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      </DialogContent>
    </Dialog>
  );
}

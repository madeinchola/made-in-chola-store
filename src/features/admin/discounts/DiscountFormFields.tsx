import { useId, type Ref } from "react";
import { t } from "@/i18n";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RatesCheckbox } from "../shipping/RatesCheckbox";
import { currencySymbol } from "../shipping/RatesLogic";
import { VolumeTiersEditor } from "./DiscountFormTiers";
import {
  allowedScopes,
  couponMode,
  flagsApply,
  isPercentKind,
  problemText,
  type DiscountErrors,
  type DiscountFormValues,
  type FieldProblem,
} from "./discountForm";
import { TargetsPicker, type TargetScope } from "./TargetsPicker";
import type { CustomerGroup, DiscountScope } from "./types";

const W = "admin.discounts.wizard" as const;

/** Campos de un solo valor, cuyo error es un código de `FIELD_PROBLEMS`. */
type SimpleField =
  | "name"
  | "percent"
  | "maxAmount"
  | "amount"
  | "take"
  | "pay"
  | "minOrder"
  | "startsAt"
  | "endsAt"
  | "usageLimitTotal"
  | "usageLimitPerCustomer"
  | "priority";

export interface GroupsState {
  data: readonly CustomerGroup[] | undefined;
  isPending: boolean;
  isError: boolean;
}

export interface DiscountFieldsProps {
  values: DiscountFormValues;
  set: <K extends keyof DiscountFormValues>(key: K, value: DiscountFormValues[K]) => void;
  onScopeChange: (scope: DiscountScope) => void;
  errors: DiscountErrors;
  /** Editando: el tipo, el alcance y la moneda se muestran fijos. */
  editing: boolean;
  currencies: readonly string[];
  groups: GroupsState;
  nameRef: Ref<HTMLInputElement>;
  /** El descuento guardado tiene parámetros que no se pueden leer. */
  unreadable: boolean;
}

/** Cómo se activa: lo decide el tipo salvo en el envío gratis y la primera compra, donde se elige. */
function Activation({
  values,
  set,
  editing,
}: Pick<DiscountFieldsProps, "values" | "set" | "editing">) {
  const mode = couponMode(values.kind);
  const hintId = useId();
  if (mode === "always") {
    return <p className="text-sm text-muted-foreground">{t(`${W}.activation.always`)}</p>;
  }
  if (mode === "never") {
    return <p className="text-sm text-muted-foreground">{t(`${W}.activation.never`)}</p>;
  }
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{t(`${W}.activation.legend`)}</legend>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="radio"
          name="activation"
          className="h-5 w-5 shrink-0"
          checked={!values.requiresCoupon}
          aria-describedby={`${hintId}-auto`}
          onChange={() => set("requiresCoupon", false)}
        />
        {t(`${W}.activation.automatic`)}
      </label>
      <p id={`${hintId}-auto`} className="pl-7 text-xs text-muted-foreground">
        {t(`${W}.activation.automaticHint`)}
      </p>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="radio"
          name="activation"
          className="h-5 w-5 shrink-0"
          checked={values.requiresCoupon}
          aria-describedby={`${hintId}-code`}
          onChange={() => set("requiresCoupon", true)}
        />
        {t(`${W}.activation.coupon`)}
      </label>
      <p id={`${hintId}-code`} className="pl-7 text-xs text-muted-foreground">
        {t(`${W}.activation.couponHint`)}
      </p>
      {editing && <p className="text-xs text-warning">{t(`${W}.activation.switchWarning`)}</p>}
    </fieldset>
  );
}

/** Los campos del segundo paso (y de la edición): lo propio del tipo, alcance, mínimo, vigencia, límites y combinación. */
export function DiscountFields({
  values,
  set,
  onScopeChange,
  errors,
  editing,
  currencies,
  groups,
  nameRef,
  unreadable,
}: DiscountFieldsProps) {
  const { kind } = values;
  const symbol = currencySymbol(values.currency);
  const scopes = allowedScopes(kind);
  const flash = kind === "flash";
  const text = <F extends SimpleField>(field: F): string | undefined => {
    const problem = errors[field] as FieldProblem<F> | undefined;
    return problem ? problemText(field, problem) : undefined;
  };
  const groupOptions = (groups.data ?? []).filter(
    (g) => !g.archived || g.id === values.customerGroupId,
  );

  return (
    <>
      {unreadable && (
        <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          {t(`${W}.invalidParams`)}
        </p>
      )}

      <Field label={t(`${W}.name`)} hint={t(`${W}.nameHint`)} error={text("name")}>
        <Input
          ref={nameRef}
          className="min-h-11"
          autoComplete="off"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      {editing ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{t(`${W}.fixedKind`, { kind: t(`admin.discounts.list.kind.${kind}`) })}</p>
          <p>
            {t(`${W}.fixedScope`, { scope: t(`${W}.scope.options.${values.scope}`) })}{" "}
            {t(`${W}.fixedCurrency`, { currency: values.currency })}
          </p>
        </div>
      ) : currencies.length > 1 ? (
        <Field label={t(`${W}.currency`)} hint={t(`${W}.currencyHint`)}>
          <Select
            className="min-h-11"
            value={values.currency}
            onChange={(e) => set("currency", e.target.value)}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(`${W}.fixedCurrency`, { currency: values.currency })}
        </p>
      )}

      {/* Lo propio de cada tipo */}
      {isPercentKind(kind) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(`${W}.percent`)} hint={t(`${W}.percentHint`)} error={text("percent")}>
            <Input
              className="min-h-11"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.percent}
              onChange={(e) => set("percent", e.target.value)}
            />
          </Field>
          <Field
            label={t(`${W}.maxAmount`, { symbol })}
            hint={t(`${W}.maxAmountHint`)}
            error={text("maxAmount")}
          >
            <Input
              className="min-h-11"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.maxAmount}
              onChange={(e) => set("maxAmount", e.target.value)}
            />
          </Field>
        </div>
      )}
      {kind === "fixed" && (
        <Field
          label={t(`${W}.amount`, { symbol })}
          hint={t(`${W}.amountHint`)}
          error={text("amount")}
        >
          <Input
            className="min-h-11"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
      )}
      {kind === "bogo" && (
        <div className="space-y-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t(`${W}.take`)} hint={t(`${W}.takeHint`)} error={text("take")}>
              <Input
                className="min-h-11"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={values.take}
                onChange={(e) => set("take", e.target.value)}
              />
            </Field>
            <Field label={t(`${W}.pay`)} hint={t(`${W}.payHint`)} error={text("pay")}>
              <Input
                className="min-h-11"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={values.pay}
                onChange={(e) => set("pay", e.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">{t(`${W}.bogoNote`)}</p>
        </div>
      )}
      {kind === "volume" && (
        <VolumeTiersEditor
          tiers={values.tiers}
          onChange={(tiers) => set("tiers", tiers)}
          errors={errors.tiers}
        />
      )}
      {kind === "group_price" && (
        <div className="space-y-1">
          <Field
            label={t(`${W}.group`)}
            hint={t(`${W}.groupHint`)}
            error={errors.group ? problemText("group", errors.group) : undefined}
          >
            <Select
              className="min-h-11"
              value={values.customerGroupId}
              onChange={(e) => set("customerGroupId", e.target.value)}
            >
              <option value="">{t(`${W}.groupPlaceholder`)}</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.archived ? t(`${W}.groupArchived`, { name: g.name }) : g.name}
                </option>
              ))}
            </Select>
          </Field>
          {groups.isPending && (
            <p className="text-xs text-muted-foreground">{t(`${W}.groupLoading`)}</p>
          )}
          {groups.isError && <p className="text-xs text-destructive">{t(`${W}.groupError`)}</p>}
          {!groups.isPending && !groups.isError && groupOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">{t(`${W}.groupNone`)}</p>
          )}
        </div>
      )}

      <Activation values={values} set={set} editing={editing} />

      {/* Alcance */}
      {!editing && scopes.length > 1 && (
        <Field label={t(`${W}.scope.label`)} hint={t(`${W}.scope.hint`)}>
          <Select
            className="min-h-11"
            value={values.scope}
            onChange={(e) => onScopeChange(e.target.value as DiscountScope)}
          >
            {scopes.map((scope) => (
              <option key={scope} value={scope}>
                {t(`${W}.scope.options.${scope}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!editing && scopes.length === 1 && (
        <p className="text-sm text-muted-foreground">{t(`${W}.scope.shipping`)}</p>
      )}
      {values.scope !== "order" && (
        <TargetsPicker
          scope={values.scope as TargetScope}
          value={values.targets}
          onChange={(targets) => set("targets", targets)}
          error={errors.targets ? problemText("targets", errors.targets) : undefined}
        />
      )}
      {errors.scope && (
        <p role="alert" className="text-xs text-destructive">
          {problemText("scope", errors.scope)}
        </p>
      )}

      <Field
        label={t(`${W}.minOrder`, { symbol })}
        hint={t(kind === "free_shipping" ? `${W}.minOrderShippingHint` : `${W}.minOrderHint`)}
        error={text("minOrder")}
      >
        <Input
          className="min-h-11"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={values.minOrder}
          onChange={(e) => set("minOrder", e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t(flash ? `${W}.startsAtFlash` : `${W}.startsAt`)} error={text("startsAt")}>
          <Input
            className="min-h-11"
            type="datetime-local"
            value={values.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </Field>
        <Field label={t(flash ? `${W}.endsAtFlash` : `${W}.endsAt`)} error={text("endsAt")}>
          <Input
            className="min-h-11"
            type="datetime-local"
            value={values.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {t(flash ? `${W}.windowFlashHint` : `${W}.windowHint`)}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t(`${W}.usageLimitTotal`)}
          hint={t(`${W}.usageLimitTotalHint`)}
          error={text("usageLimitTotal")}
        >
          <Input
            className="min-h-11"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={values.usageLimitTotal}
            onChange={(e) => set("usageLimitTotal", e.target.value)}
          />
        </Field>
        <Field
          label={t(`${W}.usageLimitPerCustomer`)}
          hint={t(`${W}.usageLimitPerCustomerHint`)}
          error={text("usageLimitPerCustomer")}
        >
          <Input
            className="min-h-11"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={values.usageLimitPerCustomer}
            onChange={(e) => set("usageLimitPerCustomer", e.target.value)}
          />
        </Field>
      </div>

      <Field label={t(`${W}.priority`)} hint={t(`${W}.priorityHint`)} error={text("priority")}>
        <Input
          className="min-h-11"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={values.priority}
          onChange={(e) => set("priority", e.target.value)}
        />
      </Field>

      {flagsApply(kind, values.requiresCoupon || couponMode(kind) === "always") && (
        <>
          <RatesCheckbox
            label={t(`${W}.stackable`)}
            hint={t(`${W}.stackableHint`)}
            checked={values.stackable}
            onChange={(checked) => set("stackable", checked)}
          />
          <RatesCheckbox
            label={t(`${W}.excludeSale`)}
            hint={t(`${W}.excludeSaleHint`)}
            checked={values.excludeSale}
            onChange={(checked) => set("excludeSale", checked)}
          />
        </>
      )}
      <RatesCheckbox
        label={t(`${W}.active`)}
        hint={t(`${W}.activeHint`)}
        checked={values.isActive}
        onChange={(checked) => set("isActive", checked)}
      />
    </>
  );
}

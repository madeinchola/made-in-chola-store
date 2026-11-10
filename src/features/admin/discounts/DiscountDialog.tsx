import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrencies } from "../config/hooks";
import { ConflictBanner } from "../ui/ConflictBanner";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { currencyChoices, defaultCurrency } from "../shipping/RatesFormLogic";
import {
  addTarget,
  createDiscount,
  listTargets,
  setDiscountActive,
  setTargetArchived,
  updateDiscount,
} from "./api";
import type { DiscountNames } from "./describe";
import { DiscountFields } from "./DiscountFormFields";
import { DiscountPreview } from "./DiscountFormPreview";
import { DiscountTypeCards } from "./DiscountFormTypes";
import {
  changeKind,
  initialValues,
  previewDescribable,
  toUpdateInput,
  validateDiscount,
  valuesFromDiscount,
  type DiscountFormValues,
  type PickedTarget,
} from "./discountForm";
import { useDiscountMutation, useGroups, useInvalidateDiscounts } from "./hooks";
import { useHydratedTargets, type TargetScope } from "./TargetsPicker";
import type {
  Discount,
  DiscountInput,
  DiscountKind,
  DiscountScope,
  DiscountTarget,
  TargetInput,
} from "./types";

interface DiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = descuento nuevo. */
  discount: Discount | null;
  /** Tras crear un descuento que pide código: abrir la pantalla de «Códigos» de ese descuento. */
  onOpenCodes: (discount: Discount) => void;
}

const W = "admin.discounts.wizard" as const;

interface FailedTarget {
  label: string;
  reason: string;
}
interface SaveJob {
  payload: DiscountInput;
  targetIds: string[];
  targets: readonly PickedTarget[];
}
interface SaveResult {
  /** El descuento recién creado (null al editar). */
  created: Discount | null;
  /** Objetivos que no se pudieron agregar o quitar. */
  failed: FailedTarget[];
  /**
   * Solo al CREAR con objetivos que fallaron: un descuento con alcance «producto/categoría/colección» y sin todos sus objetivos
   * no debe quedar encendido (aplicaría a menos o a nada, sin avisar). `done` = se dejó apagado; `failed` = no se pudo apagar.
   */
  deactivation: "done" | "failed" | null;
}

const targetInput = (discountId: string, scope: TargetScope, id: string): TargetInput =>
  scope === "product"
    ? { discountId, productId: id }
    : scope === "category"
      ? { discountId, categoryId: id }
      : { discountId, collectionId: id };

const targetId = (target: DiscountTarget, scope: TargetScope): string | null =>
  scope === "product"
    ? target.productId
    : scope === "category"
      ? target.categoryId
      : target.collectionId;

function Header({ title, description }: { title: string; description: string }) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  );
}

function DiscountWizard({
  discount,
  initialTargets,
  onClose,
  onOpenCodes,
}: {
  discount: Discount | null;
  initialTargets: readonly PickedTarget[];
  onClose: () => void;
  onOpenCodes: (discount: Discount) => void;
}) {
  const editing = discount !== null;
  const currencies = useCurrencies();
  const groups = useGroups();
  const invalidate = useInvalidateDiscounts();
  const choices = useMemo(
    () => currencyChoices(currencies.data?.filter((c) => c.enabled).map((c) => c.code)),
    [currencies.data],
  );

  const [step, setStep] = useState<1 | 2>(editing ? 2 : 1);
  const [pickedKind, setPickedKind] = useState(false);
  const [values, setValues] = useState<DiscountFormValues>(() =>
    discount
      ? valuesFromDiscount(discount, initialTargets)
      : initialValues("percent", defaultCurrency(choices)),
  );
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // La versión que se envía al guardar: tras un guardado parcial (se guardó el descuento pero falló un objetivo) un segundo
  // intento debe usar la versión NUEVA, o parecería un conflicto con uno mismo.
  const versionRef = useRef(discount?.updatedAt ?? "");

  const save = useDiscountMutation(async (job: SaveJob): Promise<SaveResult> => {
    const failed: FailedTarget[] = [];
    const scope = job.payload.scope;
    if (scope === "order") {
      if (discount) {
        versionRef.current = await updateDiscount(
          discount.id,
          versionRef.current,
          toUpdateInput(job.payload),
        );
        return { created: null, failed, deactivation: null };
      }
      return { created: await createDiscount(job.payload), failed, deactivation: null };
    }
    const labelOf = (id: string) =>
      [...job.targets, ...initialTargets].find((x) => x.id === id)?.label ?? id;
    const reasonOf = (e: unknown) => toAppError(e).message;
    let owner: string;
    let created: Discount | null = null;
    let current: DiscountTarget[] = [];
    if (discount) {
      versionRef.current = await updateDiscount(
        discount.id,
        versionRef.current,
        toUpdateInput(job.payload),
      );
      owner = discount.id;
      // Lo que hay AHORA en la base (no lo que se leyó al abrir): otra persona pudo haberlo cambiado.
      current = await listTargets(discount.id);
    } else {
      created = await createDiscount(job.payload);
      owner = created.id;
    }
    const have = new Set(current.flatMap((x) => targetId(x, scope) ?? []));
    for (const id of job.targetIds.filter((x) => !have.has(x))) {
      try {
        await addTarget(targetInput(owner, scope, id));
      } catch (e) {
        failed.push({ label: labelOf(id), reason: reasonOf(e) });
      }
    }
    for (const row of current) {
      const id = targetId(row, scope);
      if (id === null || job.targetIds.includes(id)) continue;
      try {
        await setTargetArchived(row.id, row.updatedAt, true);
      } catch (e) {
        failed.push({ label: labelOf(id), reason: reasonOf(e) });
      }
    }
    let deactivation: SaveResult["deactivation"] = null;
    if (created && created.isActive && failed.length > 0) {
      try {
        await setDiscountActive(created.id, created.updatedAt, false);
        created = { ...created, isActive: false };
        deactivation = "done";
      } catch {
        deactivation = "failed";
      }
    }
    return { created, failed, deactivation };
  });

  const validation = validateDiscount(values);
  const errors = submitted && !validation.ok ? validation.errors : {};
  const preview = useMemo(() => previewDescribable(values), [values]);
  const names: DiscountNames = {
    targets: values.scope === "order" ? [] : values.targets.map((x) => x.label),
    group: groups.data?.find((g) => g.id === values.customerGroupId)?.name ?? null,
  };

  // Tras un guardado fallido el foco va al primer campo con problema.
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);
  // Al pasar al paso 2 el foco va al nombre (la tarjeta que se pulsó ya no existe).
  useEffect(() => {
    if (step === 2 && !editing) nameRef.current?.focus();
  }, [step, editing]);

  const set = <K extends keyof DiscountFormValues>(key: K, value: DiscountFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const onScopeChange = (scope: DiscountScope) =>
    // Los elegidos de un alcance no sirven para otro: se parte de cero.
    setValues((v) => ({ ...v, scope, targets: [] }));
  const pickKind = (kind: DiscountKind) => {
    setValues((v) => changeKind(v, kind));
    setPickedKind(true);
    setSubmitted(false);
    setStep(2);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    setSubmitted(true);
    if (!validation.ok) {
      setAttempt((n) => n + 1);
      return;
    }
    try {
      const outcome = await save.mutateAsync({
        payload: validation.payload,
        targetIds: validation.targetIds,
        targets: values.targets,
      });
      if (discount) {
        if (outcome.failed.length > 0) {
          setFormError(
            t(`${W}.editTargetsFailed`, {
              names: outcome.failed.map((x) => x.label).join(", "),
              reason: outcome.failed[0]?.reason ?? "",
            }),
          );
          return;
        }
        toast.success(t(`${W}.toasts.updated`));
        onClose();
        return;
      }
      // Alta: el descuento ya existe. Si pide código o faltó parte del alcance, se explica antes de cerrar.
      if (outcome.failed.length === 0) toast.success(t(`${W}.toasts.created`));
      if (outcome.failed.length > 0 || outcome.created?.requiresCoupon) setResult(outcome);
      else onClose();
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
        void invalidate();
      } else {
        setFormError(toAppError(e).message);
      }
    }
  };

  if (result?.created) {
    const created = result.created;
    return (
      <div className="grid gap-4">
        <Header
          title={t(`${W}.done.title`)}
          description={t(`${W}.done.body`, { name: created.name })}
        />
        {created.requiresCoupon && <p className="text-sm">{t(`${W}.done.needsCodes`)}</p>}
        {result.failed.length > 0 && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {t(`${W}.done.targetsFailed`, {
              names: result.failed.map((x) => x.label).join(", "),
              reason: result.failed[0]?.reason ?? "",
            })}{" "}
            {result.deactivation === "done" && t(`${W}.done.deactivated`)}
            {result.deactivation === "failed" && t(`${W}.done.deactivateFailed`)}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
            {t(`${W}.done.close`)}
          </Button>
          {created.requiresCoupon && (
            <Button
              type="button"
              className="min-h-11"
              onClick={() => {
                onOpenCodes(created);
                onClose();
              }}
            >
              {t(`${W}.done.openCodes`)}
            </Button>
          )}
        </DialogFooter>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="grid gap-4">
        <Header title={t(`${W}.createTitle`)} description={t(`${W}.step1`)} />
        <DiscountTypeCards value={pickedKind ? values.kind : null} onPick={pickKind} />
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
            {t("admin.actions.cancel")}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <Header
        title={editing ? t(`${W}.editTitle`) : t(`${W}.createTitle`)}
        description={
          editing
            ? t(`${W}.editDescription`)
            : t(`${W}.step2`, { kind: t(`admin.discounts.list.kind.${values.kind}`) })
        }
      />
      {conflict && (
        <ConflictBanner
          onReload={() => {
            void invalidate();
            onClose();
          }}
        />
      )}
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <DiscountPreview discount={preview} names={names} />
      <DiscountFields
        values={values}
        set={set}
        onScopeChange={onScopeChange}
        errors={errors}
        editing={editing}
        currencies={choices}
        groups={{ data: groups.data, isPending: groups.isPending, isError: groups.isError }}
        nameRef={nameRef}
        unreadable={discount !== null && discount.params === null}
      />
      <DialogFooter>
        {!editing && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={save.isPending}
            onClick={() => setStep(1)}
          >
            {t(`${W}.back`)}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={save.isPending}
          onClick={onClose}
        >
          {t("admin.actions.cancel")}
        </Button>
        <Button type="submit" className="min-h-11" loading={save.isPending} disabled={conflict}>
          {save.isPending
            ? t(`${W}.submitting`)
            : editing
              ? t(`${W}.submitEdit`)
              : t(`${W}.submitCreate`)}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Lee lo que el descuento ya tiene elegido antes de abrir el formulario de edición. */
function DiscountWizardLoader({
  discount,
  onClose,
  onOpenCodes,
}: {
  discount: Discount | null;
  onClose: () => void;
  onOpenCodes: (discount: Discount) => void;
}) {
  const hydrated = useHydratedTargets(discount);
  if (hydrated.status !== "ready") {
    return (
      <div className="grid gap-4">
        <Header title={t(`${W}.editTitle`)} description={t(`${W}.editDescription`)} />
        {hydrated.status === "loading" ? (
          <LoadingState label={t(`${W}.targets.loading`)} />
        ) : (
          <ErrorState title={t(`${W}.targets.loadError`)} onRetry={hydrated.retry} />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
            {t("admin.actions.cancel")}
          </Button>
        </DialogFooter>
      </div>
    );
  }
  return (
    <DiscountWizard
      discount={discount}
      initialTargets={hydrated.picked}
      onClose={onClose}
      onOpenCodes={onOpenCodes}
    />
  );
}

/**
 * Asistente de alta y edición de un descuento. Al CREAR, dos pasos: elegir el tipo y completar sus datos con una vista
 * previa en lenguaje claro. Al EDITAR, un solo paso (el tipo, el alcance y la moneda quedan fijos). El formulario vive dentro
 * del contenido: se reinicia cada vez que se abre.
 */
export function DiscountDialog({ open, onOpenChange, discount, onOpenCodes }: DiscountDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        // Un clic fuera (o sobre un aviso) no debe tirar a la basura lo escrito: se cierra con Cancelar, la X o Esc.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DiscountWizardLoader
          discount={discount}
          onClose={() => onOpenChange(false)}
          onOpenCodes={onOpenCodes}
        />
      </DialogContent>
    </Dialog>
  );
}

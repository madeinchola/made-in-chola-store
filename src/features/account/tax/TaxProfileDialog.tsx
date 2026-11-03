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
import { Select } from "@/components/ui/select";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { FormAlert } from "../security/FormAlert";
import { useSingleFlight } from "../security/useSingleFlight";
import { TaxProfileError } from "./errors";
import { useCreateTaxProfile, useUpdateTaxProfile } from "./hooks";
import {
  TAX_DOC_TYPES,
  taxIdHint,
  taxIdMessage,
  validateTaxId,
  type TaxDocType,
  type TaxIdMode,
} from "./taxId";
import { LEGAL_NAME_MAX, type TaxProfile, type TaxProfileInput } from "./types";

export type TaxDialogTarget = { kind: "create" } | { kind: "edit"; profile: TaxProfile };

interface TaxProfileDialogProps {
  target: TaxDialogTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Rigor de la validación del documento (ajuste público `tax_id_validation`; `strict` si no cargó). */
  mode: TaxIdMode;
  /** Foco al cerrar cuando quien abrió el diálogo ya no existe (p. ej. el botón del estado vacío). */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Crear o editar datos fiscales. El formulario se monta al abrir y se desmonta al cerrar. */
export function TaxProfileDialog({
  target,
  onOpenChange,
  mode,
  onCloseAutoFocus,
}: TaxProfileDialogProps) {
  const create = useCreateTaxProfile();
  const update = useUpdateTaxProfile();
  const pending = create.isPending || update.isPending;
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => (next || !pending) && onOpenChange(next)}
    >
      <DialogContent {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}>
        {target && (
          <TaxForm
            key={target.kind === "edit" ? target.profile.id : "new"}
            target={target}
            mode={mode}
            pending={pending}
            save={(input) =>
              target.kind === "edit"
                ? update.mutateAsync({ id: target.profile.id, input })
                : create.mutateAsync(input)
            }
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FormValues {
  docType: TaxDocType;
  docNumber: string;
  legalName: string;
}

interface TaxFormProps {
  target: TaxDialogTarget;
  mode: TaxIdMode;
  pending: boolean;
  save: (input: TaxProfileInput) => Promise<unknown>;
  onClose: () => void;
}

function TaxForm({ target, mode, pending, save, onClose }: TaxFormProps) {
  const editing = target.kind === "edit" ? target.profile : null;
  const [formError, setFormError] = useState<string | null>(null);
  const singleFlight = useSingleFlight();
  const {
    register,
    handleSubmit,
    getValues,
    watch,
    trigger,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      docType: editing?.docType ?? "ci",
      docNumber: editing?.docNumber ?? "",
      legalName: editing?.legalName ?? "",
    },
  });
  const docType = watch("docType");

  const onSubmit = handleSubmit((values) =>
    singleFlight(async () => {
      setFormError(null);
      const doc = validateTaxId(values.docType, values.docNumber, mode);
      if (!doc.ok) return; // ya lo marcó la validación del campo
      try {
        await save({
          docType: values.docType,
          docNumber: doc.value, // el valor canónico (mayúsculas, CI con guion)
          legalName: values.legalName.trim(),
        });
        toast.success(editing ? t("acct.tax.messages.updated") : t("acct.tax.messages.created"));
        onClose();
      } catch (error) {
        const failure = toAppError(error);
        const reason = failure instanceof TaxProfileError ? failure.reason : "other";
        if (reason === "duplicate" || reason === "doc_format") {
          setError("docNumber", { type: "server", message: failure.message });
          setFocus("docNumber");
        } else if (reason === "legal_name") {
          setError("legalName", { type: "server", message: failure.message });
          setFocus("legalName");
        } else {
          setFormError(failure.message);
        }
      }
    }),
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? t("acct.tax.dialog.editTitle") : t("acct.tax.dialog.createTitle")}
        </DialogTitle>
        <DialogDescription>{t("acct.tax.dialog.intro")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field label={t("acct.tax.dialog.docType")}>
          <Select
            {...register("docType", {
              // Cambiar el tipo cambia las reglas del documento: se vuelve a validar lo ya escrito (y no antes: no se
              // grita «ingresa el número» a quien solo está eligiendo el tipo).
              onChange: () => {
                if (getValues("docNumber").trim() !== "") void trigger("docNumber");
              },
            })}
          >
            {TAX_DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`acct.tax.docTypes.${type}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("acct.tax.dialog.docNumber")}
          hint={taxIdHint(docType, mode)}
          error={errors.docNumber?.message}
        >
          <Input
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            {...register("docNumber", {
              validate: (value) => {
                const result = validateTaxId(getValues("docType"), value, mode);
                return result.ok ? true : taxIdMessage(getValues("docType"), result.reason, mode);
              },
            })}
          />
        </Field>
        <Field
          label={t("acct.tax.dialog.legalName")}
          hint={t("acct.tax.dialog.legalNameHint")}
          error={errors.legalName?.message}
        >
          <Input
            autoComplete="off"
            {...register("legalName", {
              validate: (value) => {
                const name = value.trim();
                if (name === "") return t("acct.tax.errors.legalNameRequired");
                if (Array.from(name).length > LEGAL_NAME_MAX) {
                  return t("acct.tax.errors.legalNameTooLong", { max: LEGAL_NAME_MAX });
                }
                return true;
              },
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
            {t("acct.tax.dialog.cancel")}
          </Button>
          <Button type="submit" loading={pending}>
            {editing ? t("acct.tax.dialog.submitEdit") : t("acct.tax.dialog.submitCreate")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

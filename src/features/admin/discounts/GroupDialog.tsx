import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConflictBanner } from "../ui/ConflictBanner";
import { isStaleVersion } from "../lib/versioned";
import { createGroup, updateGroup } from "./api";
import {
  groupFieldErrors,
  groupFormFrom,
  validateGroupForm,
  type GroupFormValues,
} from "./GroupsLogic";
import { useDiscountMutation, useInvalidateDiscounts } from "./hooks";
import type { CustomerGroup, GroupInput } from "./types";

const F = "admin.discounts.groups.form" as const;

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = grupo nuevo. */
  group: CustomerGroup | null;
  /** Todos los grupos (para avisar de un nombre repetido antes de enviar). */
  existing: readonly CustomerGroup[];
}

function GroupForm({
  group,
  existing,
  onClose,
}: {
  group: CustomerGroup | null;
  existing: readonly CustomerGroup[];
  onClose: () => void;
}) {
  const [values, setValues] = useState<GroupFormValues>(() => groupFormFrom(group));
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  // Un nombre repetido que solo conoce la base (otra persona lo creó hace un instante) se muestra junto al campo.
  const [serverNameError, setServerNameError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const invalidate = useInvalidateDiscounts();

  const save = useDiscountMutation(async (input: GroupInput) =>
    group ? await updateGroup(group.id, group.updatedAt, input) : await createGroup(input),
  );

  const validation = validateGroupForm(values, { existing, editingId: group?.id ?? null });
  const messages = groupFieldErrors(submitted && !validation.ok ? validation.errors : {});

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    setServerNameError(null);
    setSubmitted(true);
    if (!validation.ok) {
      setAttempt((n) => n + 1);
      return;
    }
    try {
      await save.mutateAsync(validation.value);
      toast.success(
        t(
          group ? `admin.discounts.groups.toasts.updated` : `admin.discounts.groups.toasts.created`,
        ),
      );
      onClose();
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
        void invalidate();
        return;
      }
      const error = toAppError(e);
      if (error.code === "conflict") {
        setServerNameError(error.message);
        setAttempt((n) => n + 1);
      } else {
        setFormError(error.message);
      }
    }
  };

  const nameError = serverNameError ?? messages.name;

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
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
      <Field label={t(`${F}.name`)} hint={t(`${F}.nameHint`)} error={nameError}>
        <Input
          className="min-h-11"
          autoComplete="off"
          value={values.name}
          onChange={(e) => {
            setServerNameError(null);
            setValues((v) => ({ ...v, name: e.target.value }));
          }}
        />
      </Field>
      <Field
        label={t(`${F}.description`)}
        hint={t(`${F}.descriptionHint`)}
        error={messages.description}
      >
        <Textarea
          value={values.description}
          onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
        />
      </Field>
      <DialogFooter>
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
          {save.isPending ? t(`${F}.submitting`) : t(`${F}.submit`)}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Alta y edición (nombre y descripción) de un grupo de clientes. El formulario se reinicia cada vez que se abre. */
export function GroupDialog({ open, onOpenChange, group, existing }: GroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        // Un clic fuera no debe tirar a la basura lo escrito: se cierra con Cancelar, la X o Esc.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{group ? t(`${F}.editTitle`) : t(`${F}.createTitle`)}</DialogTitle>
          <DialogDescription>
            {group ? t(`${F}.editDescription`) : t(`${F}.createDescription`)}
          </DialogDescription>
        </DialogHeader>
        <GroupForm group={group} existing={existing} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

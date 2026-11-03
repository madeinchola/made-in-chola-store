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
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { FormAlert } from "../security/FormAlert";
import { useSingleFlight } from "../security/useSingleFlight";
import { useUpdateProfile } from "./hooks";

/** Mismo tope que la restricción `profiles_full_name_len` de la base. */
const NAME_MAX = 120;

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
}

/** Editar el nombre. El formulario solo existe mientras el diálogo está abierto: nunca arrastra lo de la vez anterior. */
export function NameDialog({ open, onOpenChange, currentName }: NameDialogProps) {
  const update = useUpdateProfile();
  const pending = update.isPending;
  return (
    <Dialog open={open} onOpenChange={(next) => (next || !pending) && onOpenChange(next)}>
      <DialogContent>
        {open && (
          <NameForm
            currentName={currentName}
            pending={pending}
            update={update.mutateAsync}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface NameFormProps {
  currentName: string;
  pending: boolean;
  update: (patch: { fullName: string }) => Promise<unknown>;
  onClose: () => void;
}

function NameForm({ currentName, pending, update, onClose }: NameFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const singleFlight = useSingleFlight();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ name: string }>({ defaultValues: { name: currentName } });

  const onSubmit = handleSubmit(({ name }) =>
    singleFlight(async () => {
      setFormError(null);
      try {
        await update({ fullName: name.trim() });
        toast.success(t("acct.profile.nameDialog.success"));
        onClose();
      } catch (error) {
        setFormError(toAppError(error).message);
      }
    }),
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("acct.profile.nameDialog.title")}</DialogTitle>
        <DialogDescription>{t("acct.profile.nameDialog.intro")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field label={t("acct.profile.nameDialog.label")} error={errors.name?.message}>
          <Input
            autoComplete="name"
            autoFocus
            {...register("name", {
              validate: (value) => {
                const name = value.trim();
                if (name === "") return t("acct.profile.nameDialog.required");
                if (Array.from(name).length > NAME_MAX) {
                  return t("acct.profile.nameDialog.tooLong", { max: NAME_MAX });
                }
                if (name === currentName.trim()) return t("acct.profile.nameDialog.unchanged");
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
            {t("acct.profile.nameDialog.cancel")}
          </Button>
          <Button type="submit" loading={pending}>
            {t("acct.profile.nameDialog.submit")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

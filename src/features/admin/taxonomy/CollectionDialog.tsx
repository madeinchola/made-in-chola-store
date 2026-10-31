import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import { slugify } from "@/features/catalog/slug";
import { t } from "@/i18n";
import { toLaPazInputValue } from "@/lib/datetime";
import { toAppError } from "@/lib/errors";
import { isStaleVersion } from "../lib/versioned";
import { useCreateCollection, useUpdateCollection } from "./hooks";
import { slugFeedback, useSlugAvailability } from "./slugAvailability";
import type { AdminCollection } from "./types";
import { collectionFormSchema, toCollectionInput, type CollectionFormValues } from "./validation";

export type CollectionDialogTarget =
  { kind: "create" } | { kind: "edit"; collection: AdminCollection };

interface CollectionDialogProps {
  target: CollectionDialogTarget | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
  onConflict: () => void;
}

/** Crear o editar una colección. Las fechas se escriben en hora de La Paz y se guardan en UTC. */
export function CollectionDialog({
  target,
  onOpenChange,
  onSaved,
  onConflict,
}: CollectionDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target && (
          <CollectionForm
            key={target.kind === "edit" ? target.collection.id : "new"}
            target={target}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
            onConflict={onConflict}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  target: CollectionDialogTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
  onConflict: () => void;
}

function CollectionForm({ target, onClose, onSaved, onConflict }: FormProps) {
  const editing = target.kind === "edit" ? target.collection : null;
  const create = useCreateCollection();
  const update = useUpdateCollection();
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(editing !== null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setError,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: {
      name: editing?.name ?? "",
      slug: editing?.slug ?? "",
      description: editing?.description ?? "",
      startsAt: toLaPazInputValue(editing?.startsAt),
      endsAt: toLaPazInputValue(editing?.endsAt),
    },
  });

  const name = watch("name");
  const slug = watch("slug");
  useEffect(() => {
    if (!slugTouched) setValue("slug", slugify(name), { shouldValidate: isSubmitted });
  }, [name, slugTouched, setValue, isSubmitted]);

  const slugState = useSlugAvailability({
    table: "collections",
    slug,
    ...(editing ? { excludeId: editing.id, originalSlug: editing.slug } : {}),
  });
  const feedback = slugFeedback(slugState);
  const pending = isSubmitting || create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (slugState === "taken") {
      setError("slug", { message: t("admin.taxonomy.slug.taken") });
      return;
    }
    const input = toCollectionInput(values);
    try {
      if (editing) {
        await update.mutateAsync({ collection: editing, input });
        onSaved(t("admin.taxonomy.collections.messages.updated"));
      } else {
        await create.mutateAsync(input);
        onSaved(t("admin.taxonomy.collections.messages.created"));
      }
      onClose();
    } catch (error) {
      if (isStaleVersion(error)) {
        onConflict();
        onClose();
        return;
      }
      setFormError(toAppError(error).message);
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing
            ? t("admin.taxonomy.collections.dialog.editTitle")
            : t("admin.taxonomy.collections.dialog.createTitle")}
        </DialogTitle>
        <DialogDescription>{t("admin.taxonomy.collections.dialog.windowHint")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {formError}
          </div>
        )}
        <Field label={t("admin.taxonomy.collections.dialog.name")} error={errors.name?.message}>
          <Input {...register("name")} autoComplete="off" maxLength={200} autoFocus />
        </Field>
        <div className="space-y-2">
          <Field
            label={t("admin.taxonomy.collections.dialog.slug")}
            error={errors.slug?.message ?? feedback.error}
            hint={feedback.hint}
          >
            <Input
              {...register("slug", { onChange: () => setSlugTouched(true) })}
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
            />
          </Field>
          {slugTouched && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setValue("slug", slugify(getValues("name")), { shouldValidate: true });
                setSlugTouched(false);
              }}
            >
              {t("admin.taxonomy.slug.auto")}
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("admin.taxonomy.collections.dialog.startsAt")}
            error={errors.startsAt?.message}
          >
            <Input type="datetime-local" {...register("startsAt")} />
          </Field>
          <Field
            label={t("admin.taxonomy.collections.dialog.endsAt")}
            error={errors.endsAt?.message}
          >
            <Input type="datetime-local" {...register("endsAt")} />
          </Field>
        </div>
        <Field
          label={t("admin.taxonomy.collections.dialog.description")}
          error={errors.description?.message}
        >
          <Textarea {...register("description")} rows={3} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            {t("admin.actions.cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending
              ? t("admin.taxonomy.collections.dialog.saving")
              : editing
                ? t("admin.taxonomy.collections.dialog.submitEdit")
                : t("admin.taxonomy.collections.dialog.submitCreate")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

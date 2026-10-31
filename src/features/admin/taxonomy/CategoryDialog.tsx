import { useEffect, useMemo, useState } from "react";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { slugify } from "@/features/catalog/slug";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { isStaleVersion } from "../lib/versioned";
import { useCreateCategory, useUpdateCategory } from "./hooks";
import { slugFeedback, useSlugAvailability } from "./slugAvailability";
import { validParents } from "./tree";
import type { AdminCategory } from "./types";
import { categoryFormSchema, toCategoryInput, type CategoryFormValues } from "./validation";

export type CategoryDialogTarget =
  { kind: "create"; parentId: string | null } | { kind: "edit"; category: AdminCategory };

interface CategoryDialogProps {
  target: CategoryDialogTarget | null;
  onOpenChange: (open: boolean) => void;
  categories: readonly AdminCategory[];
  /** Mensaje de éxito para mostrar (toast) tras guardar. */
  onSaved: (message: string) => void;
  /** Otra persona modificó la categoría mientras se editaba. */
  onConflict: () => void;
}

/** Crear o editar una categoría. El formulario se monta al abrir y se desmonta al cerrar: nunca arrastra datos de la vez anterior. */
export function CategoryDialog({
  target,
  onOpenChange,
  categories,
  onSaved,
  onConflict,
}: CategoryDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target && (
          <CategoryForm
            key={target.kind === "edit" ? target.category.id : `new:${target.parentId ?? ""}`}
            target={target}
            categories={categories}
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
  target: CategoryDialogTarget;
  categories: readonly AdminCategory[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onConflict: () => void;
}

function CategoryForm({ target, categories, onClose, onSaved, onConflict }: FormProps) {
  const editing = target.kind === "edit" ? target.category : null;
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [formError, setFormError] = useState<string | null>(null);
  // Al crear, el slug sigue al nombre hasta que la persona lo toca. Al editar nunca cambia solo (rompería enlaces).
  const [slugTouched, setSlugTouched] = useState(editing !== null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setError,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: editing?.name ?? "",
      slug: editing?.slug ?? "",
      description: editing?.description ?? "",
      parentId: editing
        ? (editing.parentId ?? "")
        : target.kind === "create"
          ? (target.parentId ?? "")
          : "",
    },
  });

  const name = watch("name");
  const slug = watch("slug");
  useEffect(() => {
    if (!slugTouched) setValue("slug", slugify(name), { shouldValidate: isSubmitted });
  }, [name, slugTouched, setValue, isSubmitted]);

  const slugState = useSlugAvailability({
    table: "categories",
    slug,
    ...(editing ? { excludeId: editing.id, originalSlug: editing.slug } : {}),
  });
  const feedback = slugFeedback(slugState);

  // Sin ella misma ni sus descendientes (ciclo) ni archivadas (la base no deja colgar una activa de una archivada).
  const parents = useMemo(() => {
    const options = validParents(categories, editing?.id ?? null, editing?.archived ?? false);
    const current = editing?.parentId;
    if (current && !options.some((o) => o.id === current)) {
      const c = categories.find((x) => x.id === current);
      if (c) options.push({ id: c.id, name: c.name, depth: 0, archived: c.archived });
    }
    return options;
  }, [categories, editing]);

  const pending = isSubmitting || create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (slugState === "taken") {
      setError("slug", { message: t("admin.taxonomy.slug.taken") });
      return;
    }
    const input = toCategoryInput(values);
    try {
      if (editing) {
        await update.mutateAsync({ category: editing, input });
        onSaved(t("admin.taxonomy.categories.messages.updated"));
      } else {
        await create.mutateAsync(input);
        onSaved(t("admin.taxonomy.categories.messages.created"));
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

  const labels = {
    title: editing
      ? t("admin.taxonomy.categories.dialog.editTitle")
      : t("admin.taxonomy.categories.dialog.createTitle"),
    submit: editing
      ? t("admin.taxonomy.categories.dialog.submitEdit")
      : t("admin.taxonomy.categories.dialog.submitCreate"),
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{labels.title}</DialogTitle>
        <DialogDescription>
          {editing
            ? t("admin.taxonomy.categories.dialog.editIntro")
            : t("admin.taxonomy.categories.dialog.createIntro")}
        </DialogDescription>
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
        <Field label={t("admin.taxonomy.categories.dialog.name")} error={errors.name?.message}>
          <Input {...register("name")} autoComplete="off" maxLength={200} autoFocus />
        </Field>
        <div className="space-y-2">
          <Field
            label={t("admin.taxonomy.categories.dialog.slug")}
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
        <Field
          label={t("admin.taxonomy.categories.dialog.parent")}
          error={errors.parentId?.message}
          hint={t("admin.taxonomy.categories.dialog.parentHint")}
        >
          <Select {...register("parentId")}>
            <option value="">{t("admin.taxonomy.categories.dialog.parentNone")}</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {"  ".repeat(p.depth)}
                {p.name}
                {p.archived ? ` (${t("admin.taxonomy.categories.archivedTag")})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("admin.taxonomy.categories.dialog.description")}
          error={errors.description?.message}
        >
          <Textarea {...register("description")} rows={3} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            {t("admin.actions.cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("admin.taxonomy.categories.dialog.saving") : labels.submit}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

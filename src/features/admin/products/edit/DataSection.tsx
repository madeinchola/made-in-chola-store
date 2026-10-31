import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { toAppError } from "@/lib/errors";
import { isStaleVersion } from "../../lib/versioned";
import { SectionCard } from "../../ui/PageHeader";
import { updateProductData } from "../api";
import { ProductDataFields } from "../ProductDataFields";
import { productDataSchema, toProductPatch, type ProductDataValues } from "../productSchema";
import { suggestSlug } from "../suggestSlug";
import type { SectionProps } from "./types";
import { valuesFrom } from "./valuesFrom";

/** Datos del producto. Guarda con control de versión: si otra persona guardó antes, no se pisa. */
export function DataSection({
  detail,
  onChanged,
  onError,
  onDirtyChange,
  discardToken = 0,
}: SectionProps) {
  const p = detail.product;
  const form = useForm<ProductDataValues>({
    resolver: zodResolver(productDataSchema),
    mode: "onTouched",
    defaultValues: valuesFrom(p),
  });

  // Llega una versión nueva del producto (tras guardar, o tras publicar/archivar/restaurar, que también la cambian): el
  // formulario toma lo nuevo SIN pisar lo que la persona está escribiendo (`keepDirtyValues`). Descartar lo escrito solo
  // ocurre cuando el usuario lo pide con "Recargar la versión actual" (`discardToken`).
  useEffect(() => {
    form.reset(valuesFrom(p), { keepDirtyValues: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.updatedAt]);
  useEffect(() => {
    if (discardToken > 0) form.reset(valuesFrom(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardToken]);

  const dirty = form.formState.isDirty;
  useEffect(() => onDirtyChange("data", dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange("data", false), [onDirtyChange]);

  const save = useMutation({
    mutationFn: (values: ProductDataValues) =>
      updateProductData(p.id, p.updatedAt, toProductPatch(values)),
    onSuccess: async () => {
      toast.success(t("admin.saved"));
      await onChanged();
    },
    onError: (e) => {
      if (!isStaleVersion(e))
        toast.error(t("admin.products.errors.unexpected"), { description: toAppError(e).message });
      onError(e);
    },
  });

  return (
    <SectionCard id="sec-data" title={t("admin.products.edit.sections.data")}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
        {save.isError && !isStaleVersion(save.error) && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {toAppError(save.error).message}
          </div>
        )}
        <ProductDataFields
          form={form}
          excludeId={p.id}
          originalSlug={p.slug}
          originalCode={p.code}
          onGenerateSlug={() =>
            form.setValue("slug", suggestSlug(form.getValues("name")), {
              shouldValidate: true,
              shouldDirty: true,
            })
          }
        />
        <Button type="submit" disabled={save.isPending || !dirty}>
          {save.isPending ? t("admin.actions.saving") : t("admin.products.data.save")}
        </Button>
      </form>
    </SectionCard>
  );
}

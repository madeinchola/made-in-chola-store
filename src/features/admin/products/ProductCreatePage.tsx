import { useEffect, useRef, useState, type FormEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toAppError } from "@/lib/errors";
import { PageHeader, SectionCard } from "../ui/PageHeader";
import { UnsavedChangesGuard } from "../ui/UnsavedChangesGuard";
import { parseAmount } from "../lib/amount";
import { PartialCreateError, createProduct } from "./api";
import { useDefaultOutOfStockBehavior } from "./hooks";
import { useInvalidateProduct } from "./invalidate";
import { ColorListEditor, SizeListEditor } from "./ListEditors";
import { suggestSlug } from "./suggestSlug";
import { ProductDataFields } from "./ProductDataFields";
import {
  amountErrorMessage,
  productDataSchema,
  toProductPatch,
  validateColors,
  validateSizes,
  type ColorDraft,
  type ListErrors,
  type ProductDataValues,
} from "./productSchema";

const DEFAULTS: ProductDataValues = {
  name: "",
  code: "",
  slug: "",
  model: "",
  description: "",
  materials: "",
  washcare: "",
  costBase: "",
  outOfStockBehavior: "sold_out",
  isNew: false,
  allowConvertedPrices: false,
};

/** Crear un producto: lo básico en una sola pantalla; fotos, stock y publicación se hacen luego al editarlo. */
export function ProductCreatePage() {
  const navigate = useNavigate();
  const invalidate = useInvalidateProduct();
  const form = useForm<ProductDataValues>({
    resolver: zodResolver(productDataSchema),
    mode: "onTouched",
    defaultValues: DEFAULTS,
  });
  const [price, setPrice] = useState("");
  const [priceError, setPriceError] = useState<string | undefined>();
  const [colors, setColors] = useState<ColorDraft[]>([{ name: "", hex: "" }]);
  const [colorErrors, setColorErrors] = useState<ListErrors>({});
  const [sizes, setSizes] = useState<string[]>([]);
  const [sizeErrors, setSizeErrors] = useState<ListErrors>({});
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const submittingRef = useRef(false);

  // El producto nuevo nace con el comportamiento sin stock que el admin fijó en Ajustes, salvo que ya haya elegido otro.
  const defaultBehavior = useDefaultOutOfStockBehavior();
  useEffect(() => {
    if (defaultBehavior.data && !form.formState.dirtyFields.outOfStockBehavior) {
      form.setValue("outOfStockBehavior", defaultBehavior.data);
    }
  }, [defaultBehavior.data, form]);

  const name = form.watch("name");
  useEffect(() => {
    if (!slugTouched) form.setValue("slug", suggestSlug(name), { shouldValidate: name !== "" });
  }, [name, slugTouched, form]);

  const dirty =
    form.formState.isDirty ||
    price !== "" ||
    colors.some((c) => c.name !== "" || c.hex !== "") ||
    sizes.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return; // doble clic: no se crea dos veces
    setFormError(undefined);

    const valuesOk = await form.trigger();
    const amount = parseAmount(price, { decimals: 2 });
    setPriceError(amount.ok ? undefined : amountErrorMessage(amount.problem, 2));
    const cErrors = validateColors(colors);
    const sErrors = validateSizes(sizes);
    setColorErrors(cErrors);
    setSizeErrors(sErrors);
    if (colors.length === 0) setFormError(t("admin.products.colorsSizes.noColors"));
    if (
      !valuesOk ||
      !amount.ok ||
      colors.length === 0 ||
      Object.keys(cErrors).length > 0 ||
      Object.keys(sErrors).length > 0
    ) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const { id } = await createProduct({
        data: toProductPatch(form.getValues()),
        priceBob: amount.value,
        colors,
        sizes,
      });
      await invalidate();
      toast.success(t("admin.products.create.created"));
      flushSync(() => setDone(true)); // la guarda de cambios sin guardar ya no debe bloquear esta salida
      navigate(`/admin/productos/${id}`);
    } catch (e) {
      if (e instanceof PartialCreateError) {
        await invalidate();
        toast.error(t("admin.products.create.partial", { message: e.message }));
        flushSync(() => setDone(true));
        navigate(`/admin/productos/${e.productId}`);
        return;
      }
      const message = toAppError(e).message;
      setFormError(message);
      toast.error(t("admin.products.create.errorTitle"), { description: message });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
      <UnsavedChangesGuard dirty={dirty && !done} />
      <PageHeader
        title={t("admin.products.create.title")}
        description={t("admin.products.create.intro")}
      />
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-6">
        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {formError}
          </div>
        )}
        <SectionCard id="create-data" title={t("admin.products.create.sections.data")}>
          <ProductDataFields
            form={form}
            onSlugEdited={() => setSlugTouched(true)}
            onGenerateSlug={() => {
              setSlugTouched(false);
              form.setValue("slug", suggestSlug(form.getValues("name")), { shouldValidate: true });
            }}
          />
        </SectionCard>
        <SectionCard
          id="create-price"
          title={t("admin.products.create.sections.price")}
          description={t("admin.products.prices.intro")}
        >
          <div className="max-w-xs">
            <Field label={t("admin.products.create.priceLabel")} error={priceError}>
              <Input
                inputMode="decimal"
                autoComplete="off"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
          </div>
        </SectionCard>
        <SectionCard id="create-colors" title={t("admin.products.create.sections.colors")}>
          <ColorListEditor colors={colors} onChange={setColors} errors={colorErrors} />
        </SectionCard>
        <SectionCard id="create-sizes" title={t("admin.products.create.sections.sizes")}>
          <SizeListEditor sizes={sizes} onChange={setSizes} errors={sizeErrors} />
        </SectionCard>
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? t("admin.products.create.submitting") : t("admin.products.create.submit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => navigate("/admin/productos")}
          >
            {t("admin.actions.cancel")}
          </Button>
        </div>
      </form>
    </>
  );
}

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ColorSwatch } from "@/components/store/ColorSwatch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { formatMoney, fromDecimal } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ListingFacets } from "@/features/storefront/types";
import {
  applyDraft,
  draftFromQuery,
  includesValue,
  toggleValue,
  type FilterDraft,
} from "./filterDraft";
import type { ListingQuery } from "./listParams";

export interface FacetsState {
  data: ListingFacets | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

interface FilterPanelProps {
  query: ListingQuery;
  facets: FacetsState;
  onApply: (query: ListingQuery) => void;
}

const EMPTY: FilterDraft = { colors: [], sizes: [], min: "", max: "", inStockOnly: false };
const bs = (amount: number) => formatMoney(fromDecimal(amount, "BOB"));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-3 border-0 p-0">
      <legend className="eyebrow mb-3 text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Panel de filtros (color, talla, precio, disponibilidad) que se muestra dentro del cajón. Edita un BORRADOR local y
 * solo toca la URL al pulsar «Aplicar» (mismo patrón en móvil y escritorio). Las secciones sin opciones no se pintan.
 * PROVISIONAL: no hay diseño de listado; sigue el estilo de los PDF.
 */
export function FilterPanel({ query, facets, onApply }: FilterPanelProps) {
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromQuery(query));
  const [errors, setErrors] = useState({ min: false, max: false });
  const stockId = useId();
  const colorId = useId();
  const data = facets.data;

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = applyDraft(query, draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({ min: false, max: false });
    onApply(result.query);
  }

  const range =
    data && data.priceMin !== null && data.priceMax !== null
      ? t("shop.listing.filters.priceRange", { min: bs(data.priceMin), max: bs(data.priceMax) })
      : undefined;

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6">
      <div className="flex-1 space-y-6">
        {facets.isPending && (
          <div role="status" className="space-y-2">
            <span className="sr-only">{t("shop.listing.filters.loading")}</span>
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        )}
        {facets.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("shop.listing.filters.unavailable")}{" "}
            <button type="button" className="underline underline-offset-4" onClick={facets.refetch}>
              {t("ui.state.retry")}
            </button>
          </p>
        )}

        {data && data.colors.length > 0 && (
          <Section title={t("shop.listing.filters.color")}>
            <ul className="space-y-1">
              {data.colors.map((color, index) => {
                const id = `${colorId}-${index}`;
                return (
                  <li key={color.name} className="flex items-center gap-3 py-1.5">
                    <Checkbox
                      id={id}
                      checked={includesValue(draft.colors, color.name)}
                      onCheckedChange={() =>
                        setDraft((d) => ({ ...d, colors: toggleValue(d.colors, color.name) }))
                      }
                    />
                    <label
                      htmlFor={id}
                      className="flex flex-1 cursor-pointer items-center gap-3 text-sm"
                    >
                      <span className="block h-5 w-5 shrink-0">
                        <ColorSwatch hex={color.hex} />
                      </span>
                      {t("shop.listing.filters.colorOption", {
                        name: color.name,
                        count: color.count,
                      })}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {data && data.sizes.length > 0 && (
          <Section title={t("shop.listing.filters.size")}>
            <div className="flex flex-wrap gap-2">
              {data.sizes.map((size) => {
                const pressed = includesValue(draft.sizes, size.label);
                return (
                  <button
                    key={size.label}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() =>
                      setDraft((d) => ({ ...d, sizes: toggleValue(d.sizes, size.label) }))
                    }
                    className={cn(
                      "min-h-11 min-w-11 rounded-md border px-3 text-sm transition-colors duration-fast",
                      pressed
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-muted",
                    )}
                  >
                    {size.label}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <Section title={t("shop.listing.filters.price")}>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("shop.listing.filters.priceMin")}
              error={errors.min ? t("shop.listing.filters.priceInvalid") : undefined}
            >
              <Input
                inputMode="decimal"
                autoComplete="off"
                value={draft.min}
                placeholder={data?.priceMin != null ? String(data.priceMin) : ""}
                onChange={(event) => setDraft((d) => ({ ...d, min: event.target.value }))}
              />
            </Field>
            <Field
              label={t("shop.listing.filters.priceMax")}
              error={errors.max ? t("shop.listing.filters.priceInvalid") : undefined}
            >
              <Input
                inputMode="decimal"
                autoComplete="off"
                value={draft.max}
                placeholder={data?.priceMax != null ? String(data.priceMax) : ""}
                onChange={(event) => setDraft((d) => ({ ...d, max: event.target.value }))}
              />
            </Field>
          </div>
          {range && <p className="text-xs text-muted-foreground">{range}</p>}
        </Section>

        <div className="flex items-center justify-between gap-4">
          <label htmlFor={stockId} className="cursor-pointer text-sm">
            {t("shop.listing.filters.inStock")}
          </label>
          <Switch
            id={stockId}
            checked={draft.inStockOnly}
            onCheckedChange={(checked) => setDraft((d) => ({ ...d, inStockOnly: checked }))}
          />
        </div>
      </div>

      <div className="sticky bottom-0 -mx-6 flex gap-3 border-t border-border bg-background px-6 py-4">
        <Button
          type="button"
          variant="outline"
          caps
          className="flex-1"
          onClick={() => {
            setDraft(EMPTY);
            setErrors({ min: false, max: false });
          }}
        >
          {t("shop.listing.filters.clear")}
        </Button>
        <Button type="submit" caps className="flex-1">
          {t("shop.listing.filters.apply")}
        </Button>
      </div>
    </form>
  );
}

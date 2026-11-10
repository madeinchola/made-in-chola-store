import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { t } from "@/i18n";
import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "../hooks";
import { listCategoryOptions, listCollectionOptions } from "../products/api";
import { categoryPaths } from "../products/edit/categoryPaths";
import { useCategoryOptions, useCollectionOptions, useRelatedSearch } from "../products/hooks";
import { adminKeys } from "../queryKeys";
import { LoadingState } from "../ui/StateViews";
import { listTargets } from "./api";
import type { PickedTarget } from "./discountForm";
import { discountKeys } from "./queryKeys";
import type { Discount, DiscountTarget } from "./types";

export type TargetScope = "product" | "category" | "collection";

const W = "admin.discounts.wizard.targets" as const;
/** La búsqueda de productos «relacionados» excluye un producto; aquí no se excluye ninguno (un uuid que no existe). */
const NO_PRODUCT = "00000000-0000-0000-0000-000000000000";
const CHUNK = 50;

const idOf = (target: DiscountTarget, scope: TargetScope): string | null =>
  scope === "product"
    ? target.productId
    : scope === "category"
      ? target.categoryId
      : target.collectionId;

/**
 * Nombres de productos por id (para mostrar los que un descuento ya tiene). Pide de 50 en 50: el filtro viaja en la
 * dirección de la consulta y miles de ids no caben.
 */
async function fetchProductNames(ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await getSupabase()
      .from("products")
      .select("id,name")
      .in("id", ids.slice(i, i + CHUNK));
    if (error) throw fromDbError(error);
    for (const row of data ?? []) names.set(row.id, row.name);
  }
  return names;
}

export interface HydratedTargets {
  status: "ready" | "loading" | "error";
  /** Lo que el descuento ya tiene elegido, con sus nombres. */
  picked: PickedTarget[];
  retry: () => void;
}

/**
 * Lo que un descuento YA tiene elegido (productos, categorías o colecciones) con sus nombres, listo para el formulario. Sin
 * descuento (alta) o con alcance «todo el pedido» no hay nada que leer y está listo de inmediato.
 */
// eslint-disable-next-line react-refresh/only-export-components -- el asistente necesita este gancho y solo se usa junto al selector
export function useHydratedTargets(discount: Discount | null): HydratedTargets {
  const scope = discount?.scope ?? "order";
  const wanted = discount !== null && scope !== "order" ? (scope as TargetScope) : null;
  const targets = useQuery({
    queryKey: discountKeys.targets(discount?.id ?? ""),
    queryFn: () => listTargets(discount?.id ?? ""),
    enabled: wanted !== null,
    staleTime: 0,
    gcTime: 0,
  });
  const ids = useMemo(
    () =>
      wanted === null
        ? []
        : (targets.data ?? []).flatMap((target) => {
            const id = idOf(target, wanted);
            return id === null ? [] : [id];
          }),
    [targets.data, wanted],
  );
  const categories = useQuery({
    queryKey: adminKeys.categoryOptions(),
    queryFn: listCategoryOptions,
    enabled: wanted === "category",
    staleTime: 60_000,
  });
  const collections = useQuery({
    queryKey: adminKeys.collectionOptions(),
    queryFn: listCollectionOptions,
    enabled: wanted === "collection",
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: [...discountKeys.all, "product-names", ids],
    queryFn: () => fetchProductNames(ids),
    enabled: wanted === "product" && ids.length > 0,
    staleTime: 0,
    gcTime: 0,
  });

  const names = useMemo(() => {
    if (wanted === "category") {
      return categoryPaths(categories.data ?? []);
    }
    if (wanted === "collection") {
      return new Map((collections.data ?? []).map((c) => [c.id, c.name]));
    }
    return products.data ?? new Map<string, string>();
  }, [wanted, categories.data, collections.data, products.data]);

  if (wanted === null) return { status: "ready", picked: [], retry: () => undefined };
  const queries = [
    targets,
    wanted === "category" ? categories : null,
    wanted === "collection" ? collections : null,
    wanted === "product" && ids.length > 0 ? products : null,
  ];
  const live = queries.filter((q) => q !== null);
  const retry = () => {
    for (const q of live) if (q.isError) void q.refetch();
  };
  if (live.some((q) => q.isError)) return { status: "error", picked: [], retry };
  if (live.some((q) => q.isPending)) return { status: "loading", picked: [], retry };
  return {
    status: "ready",
    picked: ids.map((id) => ({ id, label: names.get(id) ?? t(`${W}.unknownProduct`) })),
    retry,
  };
}

interface TargetsPickerProps {
  scope: TargetScope;
  value: readonly PickedTarget[];
  onChange: (next: PickedTarget[]) => void;
  /** Problema a mostrar (ya en texto). */
  error?: string | undefined;
}

function PickedList({
  value,
  onRemove,
}: {
  value: readonly PickedTarget[];
  onRemove: (id: string) => void;
}) {
  if (value.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(`${W}.none`)}</p>;
  }
  return (
    <ul className="space-y-1">
      {value.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm"
        >
          <span className="min-w-0 break-words">{item.label}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 shrink-0"
            aria-label={t(`${W}.remove`, { name: item.label })}
            onClick={() => onRemove(item.id)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Casillas de categorías o colecciones. Las archivadas solo aparecen si ya estaban elegidas (para poder quitarlas). */
function OptionsChecklist({ scope, value, onChange, error }: TargetsPickerProps) {
  const categories = useCategoryOptions();
  const collections = useCollectionOptions();
  const errorId = useId();
  const query = scope === "category" ? categories : collections;
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const chosen = new Set(value.map((x) => x.id));
  const options = (query.data ?? []).filter((o) => !o.archived || chosen.has(o.id));
  const labelOf = (id: string, name: string) =>
    scope === "category" ? (paths.get(id) ?? name) : name;

  const toggle = (id: string, label: string) =>
    onChange(chosen.has(id) ? value.filter((x) => x.id !== id) : [...value, { id, label }]);

  if (query.isPending) return <LoadingState />;
  if (options.length === 0 && value.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(`${W}.noOptions.${scope as "category" | "collection"}`)}
      </p>
    );
  }
  // Elegidos que ya no figuran entre las opciones (p. ej. no se pudo leer la lista): se pueden quitar igual.
  const orphans = value.filter((x) => !options.some((o) => o.id === x.id));
  return (
    <div>
      <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2">
        {options.map((o, index) => (
          <li key={o.id}>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={chosen.has(o.id)}
                aria-invalid={error && index === 0 ? true : undefined}
                aria-describedby={error && index === 0 ? errorId : undefined}
                onChange={() => toggle(o.id, labelOf(o.id, o.name))}
              />
              <span className="break-words">{labelOf(o.id, o.name)}</span>
              {o.archived && (
                <span className="text-muted-foreground">({t(`${W}.archivedTag`)})</span>
              )}
            </label>
          </li>
        ))}
        {orphans.map((o) => (
          <li key={o.id}>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked
                onChange={() => toggle(o.id, o.label)}
              />
              <span className="break-words">{o.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Búsqueda de productos por nombre o código (como la de «relacionados»), con la lista de los ya elegidos. */
function ProductSearch({ value, onChange, error }: TargetsPickerProps) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const search = useRelatedSearch(debounced, NO_PRODUCT);
  const searching = debounced.trim().length >= 2;
  const candidates = (search.data ?? []).filter((r) => !value.some((x) => x.id === r.id));

  return (
    <div className="space-y-3">
      <PickedList value={value} onRemove={(id) => onChange(value.filter((x) => x.id !== id))} />
      <div className="max-w-md">
        <Field label={t(`${W}.search`)} hint={t(`${W}.searchHint`)} error={error}>
          <Input
            type="search"
            className="min-h-11"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        {searching && search.isError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {t(`${W}.searchError`)}
          </p>
        )}
        {searching && !search.isError && search.isFetching && candidates.length === 0 && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {t(`${W}.searching`)}
          </p>
        )}
        {searching && search.isSuccess && !search.isFetching && candidates.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{t(`${W}.noResults`)}</p>
        )}
        {candidates.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-lg border p-2">
            {candidates.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 break-words">
                  {r.name} <span className="text-muted-foreground">{r.code}</span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto min-h-11 shrink-0"
                  aria-label={t(`${W}.addNamed`, { name: r.name })}
                  onClick={() => {
                    onChange([...value, { id: r.id, label: r.name }]);
                    setQuery("");
                  }}
                >
                  {t(`${W}.add`)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Elige a qué productos, categorías o colecciones alcanza un descuento. Controlado: el formulario guarda lo elegido. */
export function TargetsPicker(props: TargetsPickerProps) {
  const { scope } = props;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t(`${W}.legend.${scope}`)}</legend>
      <p className="text-xs text-muted-foreground">{t(`${W}.hint.${scope}`)}</p>
      {scope === "product" ? <ProductSearch {...props} /> : <OptionsChecklist {...props} />}
    </fieldset>
  );
}

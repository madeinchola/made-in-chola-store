import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "../../hooks";
import { LoadingState } from "../../ui/StateViews";
import { SectionCard } from "../../ui/PageHeader";
import { setProductCategories, setProductCollections, setProductRelated } from "../api";
import { useCategoryOptions, useCollectionOptions, useRelatedSearch } from "../hooks";
import type { RelatedProduct, TaxonomyOption } from "../types";
import { categoryPaths } from "./categoryPaths";
import type { SectionProps } from "./types";

const MAX_RELATED = 24;
const sameSet = (a: ReadonlySet<string>, b: readonly string[]) =>
  a.size === b.length && b.every((id) => a.has(id));

function CheckList({
  legend,
  options,
  selected,
  labelOf,
  onToggle,
  empty,
}: {
  legend: string;
  options: readonly TaxonomyOption[];
  selected: ReadonlySet<string>;
  labelOf: (o: TaxonomyOption) => string;
  onToggle: (id: string) => void;
  empty: string;
}) {
  // Las archivadas solo se ofrecen si el producto aún está asociado a ellas (para poder quitarlas).
  const visible = options.filter((o) => !o.archived || selected.has(o.id));
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2">
          {visible.map((o) => (
            <li key={o.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selected.has(o.id)}
                  onChange={() => onToggle(o.id)}
                />
                {labelOf(o)}
                {o.archived && (
                  <span className="text-muted-foreground">
                    ({t("admin.products.organize.archivedTag")})
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** Categorías, colecciones y productos relacionados. Se guarda todo junto, pero solo lo que cambió. */
export function OrganizeSection({ detail, onChanged, onError, onDirtyChange }: SectionProps) {
  const productId = detail.product.id;
  const categories = useCategoryOptions();
  const collections = useCollectionOptions();
  const [catIds, setCatIds] = useState<Set<string>>(() => new Set(detail.categoryIds));
  const [colIds, setColIds] = useState<Set<string>>(() => new Set(detail.collectionIds));
  const [related, setRelated] = useState<RelatedProduct[]>(detail.related);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const search = useRelatedSearch(debounced, productId);

  const savedKey = [
    detail.categoryIds.join(),
    detail.collectionIds.join(),
    detail.related.map((r) => r.id).join(),
  ].join("|");
  useEffect(() => {
    setCatIds(new Set(detail.categoryIds));
    setColIds(new Set(detail.collectionIds));
    setRelated(detail.related);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const dirty =
    !sameSet(catIds, detail.categoryIds) ||
    !sameSet(colIds, detail.collectionIds) ||
    related.map((r) => r.id).join() !== detail.related.map((r) => r.id).join();
  useEffect(() => onDirtyChange("organize", dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange("organize", false), [onDirtyChange]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const moveRelated = (from: number, to: number) =>
    setRelated((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });

  const save = useMutation({
    mutationFn: async () => {
      if (!sameSet(catIds, detail.categoryIds)) await setProductCategories(productId, [...catIds]);
      if (!sameSet(colIds, detail.collectionIds))
        await setProductCollections(productId, [...colIds]);
      if (related.map((r) => r.id).join() !== detail.related.map((r) => r.id).join()) {
        await setProductRelated(
          productId,
          related.map((r) => r.id),
        );
      }
    },
    onSuccess: async () => {
      toast.success(t("admin.products.organize.saved"));
      await onChanged();
    },
    onError: async (e) => {
      toast.error(t("admin.products.errors.unexpected"), { description: toAppError(e).message });
      onError(e);
      await onChanged();
    },
  });

  const candidates = (search.data ?? []).filter((r) => !related.some((x) => x.id === r.id));

  return (
    <SectionCard id="sec-organize" title={t("admin.products.edit.sections.organize")}>
      {categories.isPending || collections.isPending ? (
        <LoadingState />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <CheckList
            legend={t("admin.products.organize.categories")}
            options={categories.data ?? []}
            selected={catIds}
            labelOf={(o) => paths.get(o.id) ?? o.name}
            onToggle={(id) => setCatIds((s) => toggle(s, id))}
            empty={t("admin.products.organize.noCategories")}
          />
          <CheckList
            legend={t("admin.products.organize.collections")}
            options={collections.data ?? []}
            selected={colIds}
            labelOf={(o) => o.name}
            onToggle={(id) => setColIds((s) => toggle(s, id))}
            empty={t("admin.products.organize.noCollections")}
          />
          <div className="lg:col-span-2">
            <h3 className="mb-1 text-sm font-semibold">{t("admin.products.organize.related")}</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("admin.products.organize.relatedHint")}
            </p>
            {related.length === 0 ? (
              <p className="mb-3 text-sm text-muted-foreground">
                {t("admin.products.organize.relatedNone")}
              </p>
            ) : (
              <ol className="mb-3 space-y-1">
                {related.map((r, i) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 rounded border px-2 py-1 text-sm"
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">{r.code}</span>
                    <span className="ml-auto flex">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={i === 0}
                        aria-label={`${t("admin.products.images.moveUp")}: ${r.name}`}
                        onClick={() => moveRelated(i, i - 1)}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={i === related.length - 1}
                        aria-label={`${t("admin.products.images.moveDown")}: ${r.name}`}
                        onClick={() => moveRelated(i, i + 1)}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("admin.products.organize.relatedRemove", { name: r.name })}
                        onClick={() => setRelated((l) => l.filter((x) => x.id !== r.id))}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {related.length < MAX_RELATED && (
              <div className="max-w-md">
                <Field label={t("admin.products.organize.relatedSearch")}>
                  <Input
                    type="search"
                    value={query}
                    autoComplete="off"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </Field>
                {candidates.length > 0 && (
                  <ul className="mt-2 space-y-1 rounded-lg border p-2">
                    {candidates.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-sm">
                        <span>
                          {r.name} <span className="text-muted-foreground">{r.code}</span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                          aria-label={t("admin.products.organize.relatedAdd", { name: r.name })}
                          onClick={() => {
                            setRelated((l) => [...l, r]);
                            setQuery("");
                          }}
                        >
                          {t("admin.actions.add")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <Button
        type="button"
        className="mt-4"
        disabled={save.isPending || !dirty}
        onClick={() => save.mutate()}
      >
        {save.isPending ? t("admin.actions.saving") : t("admin.products.organize.save")}
      </Button>
    </SectionCard>
  );
}

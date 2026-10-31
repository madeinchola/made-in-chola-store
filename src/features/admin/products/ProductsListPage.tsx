import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import { formatMoney, fromDecimal } from "@/lib/money";
import { useDebouncedValue } from "../hooks";
import { DataTable, type Column } from "../ui/DataTable";
import { Pagination } from "../ui/Pagination";
import { pageCount } from "../ui/pageCount";
import { PageHeader } from "../ui/PageHeader";
import { EmptyState } from "../ui/StateViews";
import { ProductStateBadge, StockLightBadge } from "../ui/badges";
import { useAdminProducts, useCategoryOptions, useCollectionOptions } from "./hooks";
import {
  applyPatch,
  hasActiveFilters,
  parseListParams,
  toSearchParams,
  type ListPatch,
} from "./listParams";
import type { AdminProductRow, ListSort, StateFilter } from "./types";

const STATE_OPTIONS: readonly StateFilter[] = ["all", "active", "draft", "soldout", "archived"];
const SORT_OPTIONS: readonly ListSort[] = ["newest", "updated", "name", "code"];
const STOCK_OPTIONS = ["all", "alert", "ok", "low", "critical", "out"] as const;

function Cover({ path }: { path: string | null }) {
  if (!path) {
    return (
      <div
        role="img"
        aria-label={t("admin.products.list.noPhoto")}
        className="flex h-14 w-11 items-center justify-center rounded bg-muted text-muted-foreground"
      >
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={productImageUrl(path)}
      alt=""
      loading="lazy"
      className="h-14 w-11 rounded object-cover"
    />
  );
}

const priceText = (value: string | null): string =>
  value === null ? t("admin.products.list.noPrice") : formatMoney(fromDecimal(value, "BOB"));

/** Listado del panel: búsqueda, filtros, orden y paginación en el servidor; todo el estado vive en la URL. */
export function ProductsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parseListParams(searchParams), [searchParams]);
  const categories = useCategoryOptions();
  const collections = useCollectionOptions();
  const query = useAdminProducts(params);

  const update = (patch: ListPatch, replace = false) => {
    setSearchParams(toSearchParams(applyPatch(params, patch)), { replace });
  };

  // Buscador: el texto se escribe libremente y se aplica a la URL con retraso (una consulta por pausa, no por tecla).
  const [text, setText] = useState(params.search ?? "");
  const debounced = useDebouncedValue(text, 300);
  const lastPushed = useRef(params.search ?? "");
  useEffect(() => {
    const value = debounced.trim();
    if (value === lastPushed.current) return;
    lastPushed.current = value;
    setSearchParams(toSearchParams(applyPatch(params, { search: value || undefined })), {
      replace: true,
    });
    // `params` se lee fresco; depender de él reiniciaría la escritura en cada cambio de URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // Si la URL cambia desde fuera (botón atrás, "Quitar filtros"), el campo la sigue.
  useEffect(() => {
    const fromUrl = params.search ?? "";
    if (fromUrl !== lastPushed.current) {
      lastPushed.current = fromUrl;
      setText(fromUrl);
    }
  }, [params.search]);

  // Si la página pedida ya no existe (URL a mano, o se archivó el último producto de la última página), se vuelve a la última.
  const total = query.data?.total;
  const isBeyondEnd =
    query.data !== undefined &&
    query.data.rows.length === 0 &&
    params.page > 1 &&
    !query.isFetching;
  useEffect(() => {
    if (isBeyondEnd && total !== undefined) {
      update({ page: pageCount(total, params.pageSize) }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBeyondEnd, total]);

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );

  const columns: Column<AdminProductRow>[] = [
    {
      id: "photo",
      header: t("admin.products.list.columns.photo"),
      cell: (r) => <Cover path={r.coverPath} />,
      className: "w-16",
    },
    {
      id: "name",
      header: t("admin.products.list.columns.name"),
      cell: (r) => (
        <Link
          to={`/admin/productos/${r.id}`}
          aria-label={t("admin.products.list.edit", { name: r.name })}
          className="font-medium hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    { id: "code", header: t("admin.products.list.columns.code"), cell: (r) => r.code },
    {
      id: "categories",
      header: t("admin.products.list.columns.categories"),
      cell: (r) => {
        const names = r.categoryIds.flatMap((id) => categoryName.get(id) ?? []);
        if (names.length === 0)
          return (
            <span className="text-muted-foreground">{t("admin.products.list.noCategories")}</span>
          );
        return names.length > 2
          ? `${names.slice(0, 2).join(", ")} +${names.length - 2}`
          : names.join(", ");
      },
    },
    {
      id: "price",
      header: t("admin.products.list.columns.price"),
      cell: (r) => priceText(r.priceBob),
      className: "whitespace-nowrap",
    },
    {
      id: "stock",
      header: t("admin.products.list.columns.stock"),
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <span>{t("admin.products.list.units", { count: r.totalOnHand })}</span>
          <StockLightBadge light={r.worstLight} />
        </div>
      ),
    },
    {
      id: "state",
      header: t("admin.products.list.columns.state"),
      cell: (r) => <ProductStateBadge state={r.displayState} />,
    },
  ];

  const filtered = hasActiveFilters(params);
  const clearFilters = () => {
    setText("");
    lastPushed.current = "";
    setSearchParams(new URLSearchParams(), { replace: false });
  };

  return (
    <>
      <PageHeader
        title={t("admin.products.list.title")}
        actions={
          <Button asChild>
            <Link to="/admin/productos/nuevo">{t("admin.products.list.new")}</Link>
          </Button>
        }
      />

      <form
        role="search"
        aria-label={t("admin.products.list.filters")}
        onSubmit={(e) => e.preventDefault()}
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="sm:col-span-2 lg:col-span-4">
          <Field label={t("admin.products.list.searchLabel")}>
            <Input
              type="search"
              value={text}
              placeholder={t("admin.products.list.searchPlaceholder")}
              maxLength={100}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("admin.products.list.state")}>
          <Select
            value={params.state}
            onChange={(e) => update({ state: e.target.value as StateFilter })}
          >
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`admin.products.list.states.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.products.list.category")}>
          <Select
            value={params.categoryId ?? ""}
            onChange={(e) => update({ categoryId: e.target.value || undefined })}
          >
            <option value="">{t("admin.products.list.allFeminine")}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? ` (${t("admin.products.organize.archivedTag")})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.products.list.collection")}>
          <Select
            value={params.collectionId ?? ""}
            onChange={(e) => update({ collectionId: e.target.value || undefined })}
          >
            <option value="">{t("admin.products.list.allFeminine")}</option>
            {(collections.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? ` (${t("admin.products.organize.archivedTag")})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.products.list.stock")}>
          <Select
            value={params.stockLight ?? "all"}
            onChange={(e) =>
              update({
                stockLight:
                  e.target.value === "all"
                    ? undefined
                    : (e.target.value as NonNullable<typeof params.stockLight>),
              })
            }
          >
            {STOCK_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "alert" ? t("admin.bell.label") : t(`admin.products.list.stockFilters.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.products.list.sort")}>
          <Select
            value={params.sort}
            onChange={(e) => update({ sort: e.target.value as ListSort })}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`admin.products.list.sorts.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        {filtered && (
          <div className="flex items-end">
            <Button type="button" variant="ghost" onClick={clearFilters}>
              {t("admin.products.list.clearFilters")}
            </Button>
          </div>
        )}
      </form>

      <DataTable
        caption={t("admin.products.list.title")}
        columns={columns}
        rows={query.data?.rows ?? []}
        getRowId={(r) => r.id}
        loading={query.isPending}
        refreshing={query.isFetching && !query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={
          filtered ? (
            <EmptyState
              action={
                <Button type="button" variant="outline" onClick={clearFilters}>
                  {t("admin.products.list.clearFilters")}
                </Button>
              }
            >
              {t("admin.products.list.emptyFiltered")}
            </EmptyState>
          ) : (
            <EmptyState
              action={
                <Button asChild>
                  <Link to="/admin/productos/nuevo">{t("admin.products.list.new")}</Link>
                </Button>
              }
            >
              {t("admin.products.list.empty")}
            </EmptyState>
          )
        }
      />
      {query.data && query.data.total > 0 && (
        <Pagination
          page={params.page}
          pageSize={params.pageSize}
          total={query.data.total}
          onPageChange={(page) => update({ page })}
        />
      )}
    </>
  );
}

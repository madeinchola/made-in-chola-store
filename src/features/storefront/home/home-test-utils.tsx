/* Utilidades SOLO de tests de la portada (exportan datos y funciones junto a componentes de apoyo). */
/* eslint-disable react-refresh/only-export-components */
import type { ReactElement } from "react";
import { configure, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type {
  Category,
  CategoryNode,
  Collection,
  HomeMedia,
  HomeSection,
  HomeSectionItem,
  ProductSummary,
} from "@/features/catalog/types";
import { money } from "@/lib/money";

// Las pantallas esperan datos asíncronos simulados: con la máquina cargada 1 s se queda corto.
configure({ asyncUtilTimeout: 4000 });

export const NO_MEDIA: HomeMedia = { kind: "none", path: null, alt: null };
export const image = (path: string, alt: string | null = null): HomeMedia => ({
  kind: "image",
  path,
  alt,
});
export const video = (path: string): HomeMedia => ({ kind: "video", path, alt: null });

export function section(over: Partial<HomeSection> = {}): HomeSection {
  return {
    id: "s1",
    kind: "hero",
    sortOrder: 1,
    title: null,
    body: null,
    ctaLabel: null,
    ctaUrl: null,
    media: NO_MEDIA,
    source: { type: "none", categoryId: null, collectionId: null },
    itemLimit: 4,
    items: [],
    ...over,
  };
}

export function item(over: Partial<HomeSectionItem> = {}): HomeSectionItem {
  return {
    id: "i1",
    sortOrder: 1,
    label: null,
    linkUrl: null,
    media: NO_MEDIA,
    productId: null,
    categoryId: null,
    collectionId: null,
    ...over,
  };
}

export const product = (n: number, over: Partial<ProductSummary> = {}): ProductSummary => ({
  id: `p${n}`,
  slug: `producto-${n}`,
  name: `Chakra ${n}`,
  isNew: false,
  price: money(8000, "BOB"),
  colorsCount: 5,
  soldOut: false,
  coverPath: `p${n}.jpg`,
  coverAlt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

const base = { parentId: null, description: null, sortOrder: 0 };
export const CATEGORY: Category = { ...base, id: "cat-1", name: "Sombreros", slug: "sombreros" };
export const TREE: CategoryNode[] = [
  {
    ...CATEGORY,
    children: [
      { ...base, id: "cat-2", name: "Carteras", slug: "carteras", parentId: "cat-1", children: [] },
    ],
  },
];
export const COLLECTION: Collection = {
  id: "col-1",
  name: "Nadas",
  slug: "nadas",
  description: null,
  startsAt: null,
  endsAt: null,
  sortOrder: 0,
};

export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

/** Renderiza con QueryClient (sin reintentos: los fallos se ven al instante) y router en memoria. */
export function renderHome(ui: ReactElement, { path = "/" }: { path?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

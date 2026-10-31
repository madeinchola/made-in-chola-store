/* Utilidades SOLO de tests del listado (exportan datos y funciones junto a componentes de apoyo). */
/* eslint-disable react-refresh/only-export-components */
import { StrictMode } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { renderWithApp } from "@/components/layout/layout-test-utils";
import type { CategoryNode, Collection, ProductSummary } from "@/features/catalog/types";
import type { ListingFacets } from "@/features/storefront/types";
import { money } from "@/lib/money";
import { CategoryPage, CollectionPage, SearchPage, ShopPage } from "./ListingPages";

export const TOTAL = 50; // con 24 por página = 3 páginas

export function product(n: number, over: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: `id-${n}`,
    slug: `p-${n}`,
    name: `Producto ${n}`,
    isNew: false,
    price: money(10_000 + n * 100, "BOB"),
    colorsCount: 2,
    soldOut: false,
    coverPath: `c/${n}.jpg`,
    coverAlt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export const ALL_PRODUCTS = Array.from({ length: TOTAL }, (_, i) => product(i + 1));

const node = (id: string, name: string, over: Partial<CategoryNode> = {}): CategoryNode => ({
  id,
  parentId: null,
  name,
  slug: name.toLowerCase(),
  description: null,
  sortOrder: 0,
  children: [],
  ...over,
});

/** Ropa (con la hija Chaquetas) y Sombreros. */
export const CATEGORIES: CategoryNode[] = [
  node("c1", "Ropa", {
    description: "Prendas hechas a mano.",
    children: [node("c1a", "Chaquetas", { parentId: "c1" })],
  }),
  node("c2", "Sombreros"),
];

export const COLLECTIONS: Collection[] = [
  {
    id: "k1",
    name: "Verano 2027",
    slug: "verano-2027",
    description: "Lo nuevo de la temporada.",
    startsAt: null,
    endsAt: null,
    sortOrder: 0,
  },
];

export const FACETS: ListingFacets = {
  colors: [
    { name: "Azul", hex: "#0000C0", count: 1 },
    { name: "Rojo", hex: "#C00000", count: 2 },
  ],
  sizes: [
    { label: "S", count: 1 },
    { label: "M", count: 2 },
  ],
  priceMin: 50,
  priceMax: 400,
};

function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Atrás (prueba)
    </button>
  );
}

/** Portada de prueba: da una entrada ANTERIOR en el historial para comprobar qué hace «atrás» desde el listado. */
function Start() {
  return (
    <>
      <Link to="/tienda?pagina=99">Ir a una página lejana (prueba)</Link>
      <Link to="/buscar?q=poncho">Ir a la búsqueda (prueba)</Link>
    </>
  );
}

/** Monta las 4 rutas del listado en la URL dada (con un botón «Atrás» de prueba y la sonda de ubicación). */
export function renderListing(path: string, options: { strict?: boolean } = {}) {
  const tree = (
    <>
      <BackButton />
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/tienda" element={<ShopPage />} />
        <Route path="/categoria/:slug" element={<CategoryPage />} />
        <Route path="/coleccion/:slug" element={<CollectionPage />} />
        <Route path="/buscar" element={<SearchPage />} />
      </Routes>
    </>
  );
  // `strict`: como en desarrollo, donde React ejecuta cada efecto dos veces al montar.
  return renderWithApp(options.strict ? <StrictMode>{tree}</StrictMode> : tree, { path });
}

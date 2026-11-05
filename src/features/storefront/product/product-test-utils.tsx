/* Utilidades SOLO de tests de la ficha (exportan datos y funciones junto a componentes de apoyo). */
/* eslint-disable react-refresh/only-export-components */
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CartProvider } from "@/features/cart/CartProvider";
import { CartSpy, FakeCartServer } from "@/features/cart/cart-test-utils";
import type { CartContextValue } from "@/features/cart/cart-context";
import { memoryCartStorage } from "@/features/cart/storage";
import { fakeAuth, WithAuth } from "@/test/auth-test-utils";
import type {
  ProductDetail,
  ProductImage,
  ProductSummary,
  ProductVariant,
  PublicStockStatus,
  StoreSettings,
} from "@/features/catalog/types";
import { money } from "@/lib/money";

export const COLORS = {
  blanco: { id: "c-blanco", name: "Blanco", hex: "#F5F4EE", sortOrder: 1 },
  negro: { id: "c-negro", name: "Negro", hex: "#1F1F1F", sortOrder: 2 },
  rojo: { id: "c-rojo", name: "Rojo", hex: "#C0392B", sortOrder: 3 },
} as const;

export const SIZES = {
  xs: { id: "s-xs", label: "XS", sortOrder: 1 },
  s: { id: "s-s", label: "S", sortOrder: 2 },
  m: { id: "s-m", label: "M", sortOrder: 3 },
  l: { id: "s-l", label: "L", sortOrder: 4 },
} as const;

type Cell = PublicStockStatus | undefined;

/**
 * Matriz de variantes del producto de prueba (color × talla):
 *   Blanco: XS en stock · S pocas · M agotada · L en stock
 *   Negro:  todas agotadas
 *   Rojo:   XS, S, M en stock · SIN talla L (esa variante no existe)
 */
export const MATRIX: Record<keyof typeof COLORS, Record<keyof typeof SIZES, Cell>> = {
  blanco: { xs: "in_stock", s: "low", m: "out", l: "in_stock" },
  negro: { xs: "out", s: "out", m: "out", l: "out" },
  rojo: { xs: "in_stock", s: "in_stock", m: "in_stock", l: undefined },
};

export function variantsFrom(matrix: typeof MATRIX): ProductVariant[] {
  const out: ProductVariant[] = [];
  for (const [colorKey, row] of Object.entries(matrix) as [
    keyof typeof COLORS,
    (typeof MATRIX)["blanco"],
  ][]) {
    for (const [sizeKey, status] of Object.entries(row) as [keyof typeof SIZES, Cell][]) {
      if (status === undefined) continue;
      out.push({
        id: `v-${colorKey}-${sizeKey}`,
        colorId: COLORS[colorKey].id,
        sizeId: SIZES[sizeKey].id,
        stockStatus: status,
      });
    }
  }
  return out;
}

export const image = (
  id: string,
  colorId: string | null,
  sortOrder: number,
  alt: string | null = null,
): ProductImage => ({
  id,
  colorId,
  path: `products/p1/${id}.jpg`,
  alt,
  sortOrder,
});

const summary = (id: string, name: string, price: number): ProductSummary => ({
  id,
  slug: `rel-${id}`,
  name,
  isNew: false,
  price: money(price, "BOB"),
  colorsCount: 1,
  soldOut: false,
  coverPath: null,
  coverAlt: null,
  createdAt: "2026-01-01T00:00:00Z",
});

/** Producto de prueba: «Chaqueta Japandi», 3 colores, 4 tallas, imágenes generales y por color, 2 relacionados. */
export function productFixture(
  over: Partial<ProductDetail> = {},
  productOver: Partial<ProductDetail["product"]> = {},
): ProductDetail {
  return {
    product: {
      id: "p1",
      slug: "chaqueta-japandi",
      name: "Chaqueta Japandi",
      isNew: false,
      price: money(56000, "BOB"),
      colorsCount: 3,
      soldOut: false,
      coverPath: "products/p1/g1.jpg",
      coverAlt: null,
      createdAt: "2026-01-01T00:00:00Z",
      model: "Japandi",
      description: "Chaqueta de cuero vegano.\nCorte holgado.",
      materials: "100 % poliuretano",
      washcare: "Lavar a mano",
      ...productOver,
    },
    colors: [COLORS.blanco, COLORS.negro, COLORS.rojo].map((c) => ({ ...c })),
    sizes: [SIZES.xs, SIZES.s, SIZES.m, SIZES.l].map((s) => ({ ...s })),
    variants: variantsFrom(MATRIX),
    images: [
      image("g1", null, 1),
      image("b1", COLORS.blanco.id, 1),
      image("b2", COLORS.blanco.id, 2),
      image("n1", COLORS.negro.id, 1),
    ],
    related: [summary("r1", "Sombrero Chakra", 45050), summary("r2", "Cartera Verde", 30000)],
    ...over,
  };
}

export const SETTINGS: StoreSettings = {
  business_name: "Made In Chola",
  whatsapp_orders: "+59167528677",
  pdp_shipping_return_text: "Envíos a todo el país.\nCambios en 7 días.",
  pdp_assistance_text: "Escríbenos por WhatsApp.",
};

/** Muestra la ruta actual para comprobar redirecciones. */
export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

/**
 * Renderiza una pantalla dentro de QueryClient + sesión falsa + `CartProvider` REAL (con un servidor de mentira, sin red)
 * + router en memoria (sin reintentos: los fallos se ven al instante). `server` y `cart()` dejan comprobar «Agregar a la
 * bolsa».
 */
export function renderAt(
  ui: ReactElement,
  path: string | string[] = "/producto/chaqueta-japandi",
  routePath = "/producto/:slug",
) {
  const entries = Array.isArray(path) ? path : [path];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const server = new FakeCartServer(null);
  const cart: { current: CartContextValue | null } = { current: null };
  return {
    queryClient,
    server,
    cart: () => cart.current as CartContextValue,
    ...render(
      <QueryClientProvider client={queryClient}>
        <WithAuth value={fakeAuth()}>
          <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
            <CartProvider api={server.api} storage={memoryCartStorage()}>
              <CartSpy into={cart} />
              <Routes>
                <Route path={routePath} element={ui} />
                <Route path="*" element={<p>otra ruta</p>} />
              </Routes>
              <LocationProbe />
            </CartProvider>
          </MemoryRouter>
        </WithAuth>
      </QueryClientProvider>,
    ),
  };
}

/** Simula `matchMedia` de escritorio (≥ 1024 px) o de móvil. */
export function setViewport(kind: "desktop" | "mobile") {
  window.matchMedia = ((query: string) => ({
    matches: kind === "desktop" && query.includes("min-width: 1024px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

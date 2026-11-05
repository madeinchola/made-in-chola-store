import { storeRoutes } from "@/components/layout/storeRoutes";

/** Rutas que usa la ficha (una sola fuente: las de los layouts). */
export const storeRoutesForProduct = {
  home: storeRoutes.home,
  shop: storeRoutes.shop,
  product: (slug: string) => storeRoutes.product(slug),
} as const;

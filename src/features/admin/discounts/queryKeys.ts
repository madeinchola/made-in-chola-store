import { adminKeys } from "../queryKeys";

/** Claves de caché del panel de Descuentos. Cuelgan de ["admin", "discounts"]. */
export const discountKeys = {
  all: [...adminKeys.all, "discounts"] as const,
  list: () => [...discountKeys.all, "list"] as const,
  usage: () => [...discountKeys.all, "usage"] as const,
  targets: (discountId: string) => [...discountKeys.all, "targets", discountId] as const,
  coupons: (discountId: string) => [...discountKeys.all, "coupons", discountId] as const,
  groups: () => [...discountKeys.all, "groups"] as const,
  members: (groupId: string) => [...discountKeys.all, "members", groupId] as const,
  redemptions: (discountId: string | null) =>
    [...discountKeys.all, "redemptions", discountId ?? "all"] as const,
  profiles: (query: string) => [...discountKeys.all, "profiles", query] as const,
};

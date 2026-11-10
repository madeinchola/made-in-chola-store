/** Modelo del panel de Descuentos (S9), en camelCase. Toda fila lleva `updatedAt` (la versión para no pisar ediciones ajenas). */

export const DISCOUNT_KINDS = [
  "percent",
  "fixed",
  "free_shipping",
  "bogo",
  "volume",
  "group_price",
  "flash",
  "first_purchase",
] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const DISCOUNT_SCOPES = ["order", "product", "category", "collection"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

export interface VolumeTier {
  /** Unidades mínimas (entre todas las líneas elegibles) para entrar en el tramo; ≥ 2. */
  minQty: number;
  /** Porcentaje (0, 100]. */
  percent: number;
}

/** Parámetros por tipo (en la base van en `params` jsonb; aquí tipados). */
export type DiscountParams =
  | {
      kind: "percent" | "flash" | "group_price" | "first_purchase";
      /** (0, 100]. */
      percent: number;
      /** Tope del descuento en moneda del descuento; null = sin tope. */
      maxAmount: number | null;
    }
  | { kind: "fixed"; amount: number }
  | { kind: "free_shipping" }
  /** «Llévate `take`, paga `pay`»: 2×1 = take 2, pay 1. */
  | { kind: "bogo"; take: number; pay: number }
  | { kind: "volume"; tiers: VolumeTier[] };

export interface Discount {
  id: string;
  name: string;
  kind: DiscountKind;
  /** null si el JSON guardado no tiene la forma de su tipo (no debería pasar: la base lo valida). */
  params: DiscountParams | null;
  scope: DiscountScope;
  currency: string;
  minOrderAmount: number | null;
  customerGroupId: string | null;
  /** Pide código (hay cupones) o es automático. */
  requiresCoupon: boolean;
  stackableWithAutomatic: boolean;
  excludeSaleItems: boolean;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  priority: number;
  /** Instante ISO (UTC); la pantalla lo muestra en hora de La Paz. */
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface DiscountInput {
  name: string;
  kind: DiscountKind;
  params: DiscountParams;
  scope: DiscountScope;
  currency: string;
  minOrderAmount: number | null;
  customerGroupId: string | null;
  requiresCoupon: boolean;
  stackableWithAutomatic: boolean;
  excludeSaleItems: boolean;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}
/** El tipo, el alcance y la moneda no se cambian después de crear el descuento. */
export type DiscountUpdateInput = Omit<DiscountInput, "kind" | "scope" | "currency">;

/** Un producto, categoría o colección a la que alcanza un descuento (exactamente uno de los tres ids). */
export interface DiscountTarget {
  id: string;
  discountId: string;
  productId: string | null;
  categoryId: string | null;
  collectionId: string | null;
  archived: boolean;
  updatedAt: string;
}
export type TargetInput =
  | { discountId: string; productId: string }
  | { discountId: string; categoryId: string }
  | { discountId: string; collectionId: string };

export interface Coupon {
  id: string;
  discountId: string;
  /** Tal como lo escribió el admin (o lo generó el sistema). */
  code: string;
  /** Forma normalizada con la que se compara lo que escribe la clienta (mayúsculas, sin separadores, 0/O y 1/I/L unificados). */
  codeNormalized: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Usos de ESTE código (1 = de un solo uso); null = sin tope propio. */
  usageLimit: number | null;
  archived: boolean;
  updatedAt: string;
}
export interface CouponInput {
  discountId: string;
  code: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
}
export type CouponUpdateInput = Omit<CouponInput, "discountId" | "code">;

export interface CustomerGroup {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  updatedAt: string;
}
export interface GroupInput {
  name: string;
  description: string | null;
}

export interface GroupMember {
  id: string;
  groupId: string;
  profileId: string;
  fullName: string | null;
  email: string | null;
  archived: boolean;
  updatedAt: string;
}

/** Una persona encontrada al buscar para agregarla a un grupo. */
export interface ProfileHit {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export type RedemptionStatus = "reserved" | "applied" | "reverted";
export interface Redemption {
  id: string;
  discountId: string;
  discountName: string | null;
  couponId: string | null;
  couponCode: string | null;
  profileId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  ownerType: "order" | "cart" | "manual";
  ownerId: string;
  amount: number;
  currency: string;
  status: RedemptionStatus;
  createdAt: string;
}

/** Usos vigentes de un descuento (reservados o aplicados), de la vista `discount_usage`. */
export interface DiscountUsage {
  discountId: string;
  used: number;
  customers: number;
  /** Suma de lo descontado en esos usos (moneda del descuento). */
  amount: number;
}

/** Estado que muestra el listado: lo que ve la clienta HOY. */
export type DiscountStatus =
  "active" | "scheduled" | "expired" | "exhausted" | "inactive" | "archived";

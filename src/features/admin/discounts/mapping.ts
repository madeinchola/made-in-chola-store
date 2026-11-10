import type { Database, Json } from "@/lib/database.types";
import {
  DISCOUNT_KINDS,
  DISCOUNT_SCOPES,
  type Coupon,
  type CouponInput,
  type CouponUpdateInput,
  type CustomerGroup,
  type Discount,
  type DiscountInput,
  type DiscountKind,
  type DiscountParams,
  type DiscountScope,
  type DiscountTarget,
  type DiscountUpdateInput,
  type DiscountUsage,
  type GroupInput,
  type GroupMember,
  type ProfileHit,
  type Redemption,
  type RedemptionStatus,
  type TargetInput,
} from "./types";

type Tables = Database["public"]["Tables"];

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const isDiscountKind = (v: string): v is DiscountKind =>
  (DISCOUNT_KINDS as readonly string[]).includes(v);
export const isDiscountScope = (v: string): v is DiscountScope =>
  (DISCOUNT_SCOPES as readonly string[]).includes(v);

/** Lee el JSON de `params` según el tipo del descuento; null si no tiene la forma esperada. */
export function paramsFromJson(kind: string, json: unknown): DiscountParams | null {
  if (!isRec(json) || !isDiscountKind(kind)) return null;
  switch (kind) {
    case "percent":
    case "flash":
    case "group_price":
    case "first_purchase":
      return isNum(json.percent)
        ? {
            kind,
            percent: json.percent,
            maxAmount: isNum(json.max_amount) ? json.max_amount : null,
          }
        : null;
    case "fixed":
      return isNum(json.amount) ? { kind, amount: json.amount } : null;
    case "free_shipping":
      return { kind };
    case "bogo":
      return isNum(json.take) && isNum(json.pay) ? { kind, take: json.take, pay: json.pay } : null;
    case "volume": {
      if (!Array.isArray(json.tiers)) return null;
      const tiers = [];
      for (const t of json.tiers) {
        if (!isRec(t) || !isNum(t.min_qty) || !isNum(t.percent)) return null;
        tiers.push({ minQty: t.min_qty, percent: t.percent });
      }
      return { kind, tiers };
    }
  }
}

/** El JSON que guarda la base (sin claves vacías: la base rechaza las desconocidas y exige números). */
export function paramsToJson(p: DiscountParams): Json {
  switch (p.kind) {
    case "percent":
    case "flash":
    case "group_price":
    case "first_purchase": {
      const out: Record<string, Json> = { percent: p.percent };
      if (p.maxAmount !== null) out.max_amount = p.maxAmount;
      return out;
    }
    case "fixed":
      return { amount: p.amount };
    case "free_shipping":
      return {};
    case "bogo":
      return { take: p.take, pay: p.pay };
    case "volume":
      return { tiers: p.tiers.map((t) => ({ min_qty: t.minQty, percent: t.percent })) };
  }
}

// ── Descuentos ─────────────────────────────────────────────────────────────────────────────
export function fromDiscountRow(row: Tables["discounts"]["Row"]): Discount {
  return {
    id: row.id,
    name: row.name,
    kind: (isDiscountKind(row.kind) ? row.kind : "percent") as DiscountKind,
    params: paramsFromJson(row.kind, row.params),
    scope: (isDiscountScope(row.scope) ? row.scope : "order") as DiscountScope,
    currency: row.currency,
    minOrderAmount: row.min_order_amount,
    customerGroupId: row.customer_group_id,
    requiresCoupon: row.requires_coupon,
    stackableWithAutomatic: row.stackable_with_automatic,
    excludeSaleItems: row.exclude_sale_items,
    usageLimitTotal: row.usage_limit_total,
    usageLimitPerCustomer: row.usage_limit_per_customer,
    priority: row.priority,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: row.is_active,
    archived: row.archived_at !== null,
    updatedAt: row.updated_at,
  };
}

export function toDiscountUpdate(input: DiscountUpdateInput): Tables["discounts"]["Update"] {
  return {
    name: input.name.trim(),
    params: paramsToJson(input.params),
    min_order_amount: input.minOrderAmount,
    customer_group_id: input.customerGroupId,
    requires_coupon: input.requiresCoupon,
    stackable_with_automatic: input.stackableWithAutomatic,
    exclude_sale_items: input.excludeSaleItems,
    usage_limit_total: input.usageLimitTotal,
    usage_limit_per_customer: input.usageLimitPerCustomer,
    priority: input.priority,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    is_active: input.isActive,
  };
}

export function toDiscountInsert(input: DiscountInput): Tables["discounts"]["Insert"] {
  return {
    ...toDiscountUpdate(input),
    name: input.name.trim(),
    kind: input.kind,
    params: paramsToJson(input.params),
    scope: input.scope,
    currency: input.currency,
  };
}

// ── Objetivos ──────────────────────────────────────────────────────────────────────────────
export function fromTargetRow(row: Tables["discount_targets"]["Row"]): DiscountTarget {
  return {
    id: row.id,
    discountId: row.discount_id,
    productId: row.product_id,
    categoryId: row.category_id,
    collectionId: row.collection_id,
    archived: row.archived_at !== null,
    updatedAt: row.updated_at,
  };
}
export function toTargetInsert(input: TargetInput): Tables["discount_targets"]["Insert"] {
  if ("productId" in input) return { discount_id: input.discountId, product_id: input.productId };
  if ("categoryId" in input)
    return { discount_id: input.discountId, category_id: input.categoryId };
  return { discount_id: input.discountId, collection_id: input.collectionId };
}

// ── Cupones ────────────────────────────────────────────────────────────────────────────────
export function fromCouponRow(row: Tables["coupons"]["Row"]): Coupon {
  return {
    id: row.id,
    discountId: row.discount_id,
    code: row.code,
    // Columna generada (siempre con valor): el generador de tipos la marca nula.
    codeNormalized: row.code_normalized ?? "",
    isActive: row.is_active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    usageLimit: row.usage_limit,
    archived: row.archived_at !== null,
    updatedAt: row.updated_at,
  };
}
export const toCouponInsert = (input: CouponInput): Tables["coupons"]["Insert"] => ({
  discount_id: input.discountId,
  code: input.code.trim(),
  is_active: input.isActive,
  starts_at: input.startsAt,
  ends_at: input.endsAt,
  usage_limit: input.usageLimit,
});
export const toCouponUpdate = (input: CouponUpdateInput): Tables["coupons"]["Update"] => ({
  is_active: input.isActive,
  starts_at: input.startsAt,
  ends_at: input.endsAt,
  usage_limit: input.usageLimit,
});

// ── Grupos de clientes ─────────────────────────────────────────────────────────────────────
export const fromGroupRow = (row: Tables["customer_groups"]["Row"]): CustomerGroup => ({
  id: row.id,
  name: row.name,
  description: row.description,
  archived: row.archived_at !== null,
  updatedAt: row.updated_at,
});
export const toGroupRow = (input: GroupInput): Tables["customer_groups"]["Insert"] => ({
  name: input.name.trim(),
  description:
    input.description === null || input.description.trim() === "" ? null : input.description.trim(),
});

type MemberRow = Tables["customer_group_members"]["Row"] & {
  profiles: { full_name: string; email: string | null } | null;
};
export const fromMemberRow = (row: MemberRow): GroupMember => ({
  id: row.id,
  groupId: row.group_id,
  profileId: row.profile_id,
  fullName: row.profiles?.full_name ?? null,
  email: row.profiles?.email ?? null,
  archived: row.archived_at !== null,
  updatedAt: row.updated_at,
});

export const fromProfileHit = (row: {
  id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
}): ProfileHit => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone_e164,
});

// ── Redenciones ────────────────────────────────────────────────────────────────────────────
type RedemptionRow = Tables["discount_redemptions"]["Row"] & {
  discounts: { name: string } | null;
  coupons: { code: string } | null;
  profiles: { full_name: string; email: string | null } | null;
};
const STATUSES: readonly RedemptionStatus[] = ["reserved", "applied", "reverted"];
export const fromRedemptionRow = (row: RedemptionRow): Redemption => ({
  id: row.id,
  discountId: row.discount_id,
  discountName: row.discounts?.name ?? null,
  couponId: row.coupon_id,
  couponCode: row.coupons?.code ?? null,
  profileId: row.profile_id,
  customerName: row.profiles?.full_name ?? null,
  customerEmail: row.profiles?.email ?? null,
  ownerType: row.owner_type as Redemption["ownerType"],
  ownerId: row.owner_id,
  amount: row.amount,
  currency: row.currency,
  status: STATUSES.includes(row.status as RedemptionStatus)
    ? (row.status as RedemptionStatus)
    : "reserved",
  createdAt: row.created_at,
});

export const fromUsageRow = (row: {
  discount_id: string | null;
  used: number | null;
  customers: number | null;
  amount: number | null;
}): DiscountUsage => ({
  discountId: row.discount_id ?? "",
  used: row.used ?? 0,
  customers: row.customers ?? 0,
  amount: row.amount ?? 0,
});

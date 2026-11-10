import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import { updateVersioned } from "../lib/versioned";
import {
  fromCouponRow,
  fromDiscountRow,
  fromGroupRow,
  fromMemberRow,
  fromProfileHit,
  fromRedemptionRow,
  fromTargetRow,
  fromUsageRow,
  toCouponInsert,
  toCouponUpdate,
  toDiscountInsert,
  toDiscountUpdate,
  toGroupRow,
  toTargetInsert,
} from "./mapping";
import type {
  Coupon,
  CouponInput,
  CouponUpdateInput,
  CustomerGroup,
  Discount,
  DiscountInput,
  DiscountTarget,
  DiscountUpdateInput,
  DiscountUsage,
  GroupInput,
  GroupMember,
  ProfileHit,
  Redemption,
  TargetInput,
} from "./types";

/**
 * Capa de datos del panel de Descuentos. La seguridad la pone la RLS (solo el admin lee y escribe estas tablas; un cliente
 * no ve ni los cupones). Nada se borra: «eliminar» es archivar. Cada cambio exige la versión (`updatedAt`) leída, así que
 * dos personas no se pisan en silencio, y devuelve la versión NUEVA.
 */

const archiveNow = (archived: boolean) => ({
  archived_at: archived ? new Date().toISOString() : null,
});

// ── Descuentos ─────────────────────────────────────────────────────────────────────────────
export async function listDiscounts(): Promise<Discount[]> {
  const { data, error } = await getSupabase()
    .from("discounts")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromDiscountRow);
}
export async function listDiscountUsage(): Promise<DiscountUsage[]> {
  const { data, error } = await getSupabase().from("discount_usage").select("*");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromUsageRow).filter((u) => u.discountId !== "");
}
export async function createDiscount(input: DiscountInput): Promise<Discount> {
  const { data, error } = await getSupabase()
    .from("discounts")
    .insert(toDiscountInsert(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromDiscountRow(data);
}
export const updateDiscount = (id: string, updatedAt: string, input: DiscountUpdateInput) =>
  updateVersioned("discounts", id, updatedAt, toDiscountUpdate(input));
export const setDiscountActive = (id: string, updatedAt: string, isActive: boolean) =>
  updateVersioned("discounts", id, updatedAt, { is_active: isActive });
export const setDiscountArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("discounts", id, updatedAt, archiveNow(archived));

// ── Objetivos (productos, categorías o colecciones a las que alcanza un descuento) ─────────
export async function listTargets(discountId: string): Promise<DiscountTarget[]> {
  const { data, error } = await getSupabase()
    .from("discount_targets")
    .select("*")
    .eq("discount_id", discountId)
    .is("archived_at", null)
    .order("created_at")
    .order("id");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromTargetRow);
}
/** Todos los objetivos vigentes (para resumir el alcance de cada descuento en el listado). */
export async function listAllTargets(): Promise<DiscountTarget[]> {
  const { data, error } = await getSupabase()
    .from("discount_targets")
    .select("*")
    .is("archived_at", null)
    .order("created_at")
    .order("id");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromTargetRow);
}
export async function addTarget(input: TargetInput): Promise<DiscountTarget> {
  const { data, error } = await getSupabase()
    .from("discount_targets")
    .insert(toTargetInsert(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromTargetRow(data);
}
export const setTargetArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("discount_targets", id, updatedAt, archiveNow(archived));

// ── Cupones (códigos) ──────────────────────────────────────────────────────────────────────
export async function listCoupons(discountId: string): Promise<Coupon[]> {
  const { data, error } = await getSupabase()
    .from("coupons")
    .select("*")
    .eq("discount_id", discountId)
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromCouponRow);
}
export async function createCoupon(input: CouponInput): Promise<Coupon> {
  const { data, error } = await getSupabase()
    .from("coupons")
    .insert(toCouponInsert(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromCouponRow(data);
}
export const updateCoupon = (id: string, updatedAt: string, input: CouponUpdateInput) =>
  updateVersioned("coupons", id, updatedAt, toCouponUpdate(input));
export const setCouponArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("coupons", id, updatedAt, archiveNow(archived));

/** Genera códigos ALEATORIOS (sin 0, O, 1, I, L) para un descuento con cupón; devuelve los códigos nuevos. Hasta 500. */
export async function generateCouponCodes(args: {
  discountId: string;
  count: number;
  prefix?: string | null;
  length?: number;
  usageLimit?: number | null;
}): Promise<string[]> {
  const { data, error } = await getSupabase().rpc("admin_generate_coupon_codes", {
    p_discount_id: args.discountId,
    p_count: args.count,
    ...(args.prefix ? { p_prefix: args.prefix } : {}),
    ...(args.length !== undefined ? { p_length: args.length } : {}),
    ...(args.usageLimit !== undefined && args.usageLimit !== null
      ? { p_usage_limit: args.usageLimit }
      : {}),
  });
  if (error) throw fromDbError(error);
  return data ?? [];
}

// ── Grupos de clientes ─────────────────────────────────────────────────────────────────────
export async function listGroups(): Promise<CustomerGroup[]> {
  const { data, error } = await getSupabase()
    .from("customer_groups")
    .select("*")
    .order("created_at")
    .order("id");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromGroupRow);
}
export async function createGroup(input: GroupInput): Promise<CustomerGroup> {
  const { data, error } = await getSupabase()
    .from("customer_groups")
    .insert(toGroupRow(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromGroupRow(data);
}
export const updateGroup = (id: string, updatedAt: string, input: GroupInput) =>
  updateVersioned("customer_groups", id, updatedAt, toGroupRow(input));
export const setGroupArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("customer_groups", id, updatedAt, archiveNow(archived));

export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await getSupabase()
    .from("customer_group_members")
    .select("*, profiles(full_name, email)")
    .eq("group_id", groupId)
    .is("archived_at", null)
    .order("created_at")
    .order("id");
  if (error) throw fromDbError(error);
  return (data ?? []).map((row) => fromMemberRow(row as Parameters<typeof fromMemberRow>[0]));
}
export async function addMember(groupId: string, profileId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("customer_group_members")
    .insert({ group_id: groupId, profile_id: profileId });
  if (error) throw fromDbError(error);
}
export const setMemberArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("customer_group_members", id, updatedAt, archiveNow(archived));

/** Busca clientas para sumarlas a un grupo (por nombre o correo). Hasta 10; la consulta se limpia de comodines. */
export async function searchProfiles(query: string): Promise<ProfileHit[]> {
  const q = query.replace(/[%*,()\\]/g, " ").trim();
  if (q.length < 2) return [];
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, full_name, email, phone_e164")
    .eq("role", "customer")
    .eq("is_active", true)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order("full_name")
    .limit(10);
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromProfileHit);
}

// ── Redenciones (quién, cuándo, cuánto) ────────────────────────────────────────────────────
export async function listRedemptions(
  discountId: string | null,
  limit = 1000,
): Promise<Redemption[]> {
  let query = getSupabase()
    .from("discount_redemptions")
    .select("*, discounts(name), coupons(code), profiles(full_name, email)")
    .order("created_at", { ascending: false })
    .order("id")
    .limit(limit);
  if (discountId !== null) query = query.eq("discount_id", discountId);
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return (data ?? []).map((row) =>
    fromRedemptionRow(row as Parameters<typeof fromRedemptionRow>[0]),
  );
}

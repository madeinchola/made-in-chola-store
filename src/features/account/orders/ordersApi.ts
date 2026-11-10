import { AppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { t } from "@/i18n";

/**
 * Lectura de pedidos. La RLS deja ver a cada clienta SOLO los suyos; además cada consulta filtra por `profile_id` (un
 * admin sí puede leer todos y, sin el filtro, vería los ajenos en su propia lista). Nada se escribe desde aquí: los
 * pedidos los crea y cambia únicamente el servidor.
 */
export interface OrderRow {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotal: number;
  discount_total: number;
  shipping_cost: number;
  shipping_discount: number;
  total: number;
  contact_name: string;
  shipping_method: { code?: string; name?: string; kind?: string } | null;
  shipping_address: {
    line1?: string;
    line2?: string | null;
    city?: string;
    department?: string | null;
  } | null;
  delivery_slot: { date?: string; start?: string | null; end?: string | null } | null;
  payment_method: string;
  coupon_code: string | null;
  created_at: string;
  order_items?: {
    id: string;
    line_no: number;
    product_name: string;
    color_name: string | null;
    size_label: string | null;
    qty: number;
    unit_price: number;
    final_total: number;
  }[];
  order_status_history?: { id: number; to_status: string; created_at: string }[];
}

export const SUMMARY_COLUMNS = "id, number, status, currency, total, created_at";
export const DETAIL_COLUMNS =
  "id, number, status, currency, subtotal, discount_total, shipping_cost, shipping_discount, total, contact_name, " +
  "shipping_method, shipping_address, delivery_slot, payment_method, coupon_code, created_at, " +
  "order_items(id, line_no, product_name, color_name, size_label, qty, unit_price, final_total), " +
  "order_status_history(id, to_status, created_at)";

const fail = (error: { message?: string }) =>
  new AppError("unknown", t("acct.orders.error.title"), { cause: error });

/** Los pedidos de la clienta, el más reciente primero (tope razonable: los últimos 100). */
export async function listOrders(profileId: string): Promise<OrderRow[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select(SUMMARY_COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw fail(error);
  return (data ?? []) as unknown as OrderRow[];
}

/** Un pedido por su id (el de la URL de «Mis pedidos»). null si no existe o no es de esta clienta. */
export async function getOrderById(profileId: string, id: string): Promise<OrderRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await getSupabase()
    .from("orders")
    .select(DETAIL_COLUMNS)
    .eq("profile_id", profileId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fail(error);
  return (data as unknown as OrderRow | null) ?? null;
}

/** Un pedido por su número («MIC-000123»), el de la pantalla de confirmación. */
export async function getOrderByNumber(
  profileId: string,
  number: string,
): Promise<OrderRow | null> {
  if (!/^[A-Z]{2,5}-[0-9]{6,}$/.test(number)) return null;
  const { data, error } = await getSupabase()
    .from("orders")
    .select(DETAIL_COLUMNS)
    .eq("profile_id", profileId)
    .eq("number", number)
    .maybeSingle();
  if (error) throw fail(error);
  return (data as unknown as OrderRow | null) ?? null;
}

import { fromDbError } from "@/lib/db-errors";
import { AppError, toAppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { isStaleVersion, updateVersioned } from "../lib/versioned";
import type { BannerPayload } from "./bannerLogic";
import type { RateRow } from "./rates";
import type { SettingType } from "./settingsSchema";
import type {
  Banner,
  CountryRow,
  CurrencyRow,
  ImpactCandidates,
  RateHistoryPage,
  SettingRow,
} from "./types";

const SETTING_TYPES: readonly SettingType[] = ["text", "int", "bool", "url", "email", "phone_e164"];
const asSettingType = (v: string): SettingType => SETTING_TYPES.find((t) => t === v) ?? "text";

// ── Ajustes ────────────────────────────────────────────────────────────────────────────────

/** Todos los ajustes (el admin ve también los no públicos). */
export async function listSettings(): Promise<SettingRow[]> {
  const { data, error } = await getSupabase()
    .from("store_settings")
    .select("key,value,value_type,is_public,description,updated_at")
    .order("key");
  if (error) throw fromDbError(error);
  return (data ?? []).map((r) => ({
    key: r.key,
    value: r.value,
    valueType: asSettingType(r.value_type),
    isPublic: r.is_public,
    description: r.description,
    updatedAt: r.updated_at,
  }));
}

export interface SettingChange {
  key: string;
  /** Con su tipo JSON correcto: número para `int`, texto para el resto. */
  value: string | number;
  /** `updated_at` leído al cargar (texto tal cual). */
  updatedAt: string;
}

export type SettingSaveResult =
  | { key: string; ok: true; updatedAt: string }
  | { key: string; ok: false; stale: boolean; error: AppError };

/**
 * Guarda los cambios EN EL ORDEN RECIBIDO (importa con los umbrales: ver `orderChanges`), uno por uno, cada uno con control
 * de versión. Un fallo no detiene a los demás: se devuelve un resultado por clave, sin lanzar.
 */
export async function saveSettings(
  changes: readonly SettingChange[],
): Promise<SettingSaveResult[]> {
  const results: SettingSaveResult[] = [];
  for (const c of changes) {
    try {
      const updatedAt = await updateVersioned(
        "store_settings",
        c.key,
        c.updatedAt,
        { value: c.value },
        "key",
      );
      results.push({ key: c.key, ok: true, updatedAt });
    } catch (e) {
      results.push({ key: c.key, ok: false, stale: isStaleVersion(e), error: toAppError(e) });
    }
  }
  return results;
}

// ── Banner de noticias ─────────────────────────────────────────────────────────────────────

const mapBanner = (b: {
  id: string;
  message: string;
  link_url: string | null;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}): Banner => ({
  id: b.id,
  message: b.message,
  linkUrl: b.link_url,
  isActive: b.is_active,
  startsAt: b.starts_at,
  endsAt: b.ends_at,
  archived: b.archived_at !== null,
  createdAt: b.created_at,
  updatedAt: b.updated_at,
});

/** Todos los banners, incluidos los archivados, del más reciente al más antiguo. */
export async function listBanners(): Promise<Banner[]> {
  const { data, error } = await getSupabase()
    .from("news_banners")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw fromDbError(error);
  return (data ?? []).map(mapBanner);
}

export async function createBanner(payload: BannerPayload): Promise<Banner> {
  const { data, error } = await getSupabase()
    .from("news_banners")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return mapBanner(data);
}

export const updateBanner = (banner: Banner, payload: BannerPayload) =>
  updateVersioned("news_banners", banner.id, banner.updatedAt, payload);

export const setBannerActive = (banner: Banner, isActive: boolean) =>
  updateVersioned("news_banners", banner.id, banner.updatedAt, { is_active: isActive });

export const setBannerArchived = (banner: Banner, archived: boolean) =>
  updateVersioned("news_banners", banner.id, banner.updatedAt, {
    archived_at: archived ? new Date().toISOString() : null,
  });

// ── Monedas ────────────────────────────────────────────────────────────────────────────────

export async function listCurrencies(): Promise<CurrencyRow[]> {
  const { data, error } = await getSupabase()
    .from("currencies")
    .select("code,name,symbol,decimals,enabled,updated_at")
    .order("code");
  if (error) throw fromDbError(error);
  return (data ?? []).map((c) => ({
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    decimals: c.decimals,
    enabled: c.enabled,
    updatedAt: c.updated_at,
  }));
}

export async function listCountries(): Promise<CountryRow[]> {
  const { data, error } = await getSupabase()
    .from("countries")
    .select("code,name,currency_code,enabled")
    .order("name");
  if (error) throw fromDbError(error);
  return (data ?? []).map((c) => ({
    code: c.code,
    name: c.name,
    currencyCode: c.currency_code,
    enabled: c.enabled,
  }));
}

/** Activa o desactiva una moneda. La base impide desactivar BOB (CHECK `currencies_base_enabled`). */
export const setCurrencyEnabled = (currency: CurrencyRow, enabled: boolean) =>
  updateVersioned("currencies", currency.code, currency.updatedAt, { enabled }, "code");

// ── Tipos de cambio (libro inmutable: solo se agregan filas) ──────────────────────────────

type RateDbRow = {
  id: number;
  from_currency: string;
  to_currency: string;
  rate: number;
  mode: string;
  valid_from: string;
  created_at: string;
};

const mapRate = (r: RateDbRow): RateRow & { createdAt: string } => ({
  id: r.id,
  fromCurrency: r.from_currency,
  toCurrency: r.to_currency,
  // Se pasa por texto: la base devuelve numeric(18,8) como número JSON y el texto evita notación científica en los extremos.
  rate: String(r.rate),
  mode: r.mode === "variable" ? "variable" : "fixed",
  validFrom: r.valid_from,
  createdAt: r.created_at,
});

/**
 * La tasa VIGENTE de BOB hacia cada moneda pedida: la de `valid_from` más reciente que ya empezó (desempata el id), igual
 * que `current_rate()` en SQL (esa función no es ejecutable desde el navegador). Usa el reloj del navegador para "ahora".
 */
export async function getCurrentRates(
  codes: readonly string[],
  now: Date = new Date(),
): Promise<Record<string, RateRow | null>> {
  const sb = getSupabase();
  const entries = await Promise.all(
    codes.map(async (code) => {
      const { data, error } = await sb
        .from("exchange_rates")
        .select("id,from_currency,to_currency,rate,mode,valid_from,created_at")
        .eq("from_currency", "BOB")
        .eq("to_currency", code)
        .lte("valid_from", now.toISOString())
        .order("valid_from", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (error) throw fromDbError(error);
      const row = data?.[0];
      return [code, row ? mapRate(row) : null] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Historial completo (más reciente primero), paginado en el servidor con total exacto. */
export async function listRateHistory(page: number, pageSize: number): Promise<RateHistoryPage> {
  const from = (Math.max(1, page) - 1) * pageSize;
  const { data, error, count } = await getSupabase()
    .from("exchange_rates")
    .select("id,from_currency,to_currency,rate,mode,valid_from,created_at", { count: "exact" })
    .order("valid_from", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []).map(mapRate), total: count ?? 0 };
}

export interface NewExchangeRate {
  toCurrency: string;
  /** Texto decimal ya validado con `parseRate`. */
  rate: string;
  mode: "fixed" | "variable";
  /** ISO UTC; null = ahora (lo pone la base). */
  validFrom: string | null;
}

/** Agrega una fila al libro (BOB → moneda). Nunca se edita ni se borra: un error se supera con otra fila. */
export async function createExchangeRate(input: NewExchangeRate): Promise<void> {
  const { error } = await getSupabase()
    .from("exchange_rates")
    .insert({
      from_currency: "BOB",
      to_currency: input.toCurrency,
      // numeric(18,8) viaja como TEXTO: un `number` de JavaScript no representa exactamente los extremos (10 enteros + 8 decimales).
      rate: input.rate as unknown as number,
      mode: input.mode,
      ...(input.validFrom ? { valid_from: input.validFrom } : {}),
    });
  if (error) throw fromDbError(error);
}

const CANDIDATE_LIMIT = 100;
const SHOWN_PRODUCTS = 10;

/**
 * Productos a los que el precio convertido se les aplicaría: publicados, no archivados, con `allow_converted_prices`,
 * precio general en BOB y SIN precio propio en la moneda destino (con precio propio, `price_for` lo devuelve tal cual y el
 * tipo de cambio no cambia nada). Revisa los primeros 100 por nombre y muestra 10.
 */
export async function listImpactCandidates(targetCurrency: string): Promise<ImpactCandidates> {
  const sb = getSupabase();
  const products = await sb
    .from("products")
    .select("id,code,name")
    .eq("allow_converted_prices", true)
    .eq("status", "active")
    .is("archived_at", null)
    .order("name")
    .limit(CANDIDATE_LIMIT);
  if (products.error) throw fromDbError(products.error);
  const candidates = products.data ?? [];
  if (candidates.length === 0) return { products: [], total: 0, truncated: false };

  const prices = await sb
    .from("product_prices")
    .select("product_id,currency,amount")
    .in(
      "product_id",
      candidates.map((p) => p.id),
    )
    .is("country", null)
    .in("currency", ["BOB", targetCurrency]);
  if (prices.error) throw fromDbError(prices.error);

  const bob = new Map<string, string>();
  const explicit = new Set<string>();
  for (const p of prices.data ?? []) {
    if (p.currency === "BOB") bob.set(p.product_id, String(p.amount));
    else explicit.add(p.product_id);
  }
  const affected = candidates.flatMap((p) => {
    const priceBob = bob.get(p.id);
    return priceBob !== undefined && !explicit.has(p.id)
      ? [{ id: p.id, code: p.code, name: p.name, priceBob }]
      : [];
  });
  return {
    products: affected.slice(0, SHOWN_PRODUCTS),
    total: affected.length,
    truncated: candidates.length >= CANDIDATE_LIMIT,
  };
}

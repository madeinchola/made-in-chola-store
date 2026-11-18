import { callFunction } from "@/lib/functions";
import { getSupabase } from "@/lib/supabase";

/**
 * De dónde llegó la persona (utm_*, tipo de clic, página de entrada y sitio de procedencia). Solo se guarda con el consentimiento de
 * ANALÍTICA y se borra al retirarlo. NO se guarda el identificador del clic (fbclid/gclid), solo de qué tipo era. Al crear un pedido se
 * anota una vez junto a él (`record_order_attribution`); el servidor vuelve a limpiar y acotar todo.
 */
export const ATTRIBUTION_KEY = "mic_attribution";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  click_id_kind?: "fbclid" | "gclid";
  landing_path?: string;
  referrer_host?: string;
  at: number;
}

const clean = (value: string | null): string | undefined => {
  // `\p{Cc}`: los caracteres de control (nulo, escape, retorno de carro…), que no tienen nada que hacer en un texto de la dirección.
  const text = (value ?? "")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .toLowerCase()
    .slice(0, 100);
  return text === "" ? undefined : text;
};

/** Lo que dice la dirección y el sitio de procedencia, sin guardar nada. `null` si no trae nada de marketing ni viene de otro sitio. */
export function attributionFromLocation(
  location: { search: string; pathname: string; hostname: string },
  referrer: string,
  now = Date.now(),
): Attribution | null {
  const params = new URLSearchParams(location.search);
  const found: Attribution = { at: now };
  for (const key of UTM) {
    const value = clean(params.get(key));
    if (value) found[key] = value;
  }
  if (params.has("fbclid")) found.click_id_kind = "fbclid";
  else if (params.has("gclid")) found.click_id_kind = "gclid";
  let host: string | undefined;
  try {
    host = referrer ? new URL(referrer).hostname.toLowerCase() : undefined;
  } catch {
    host = undefined;
  }
  if (host && host !== location.hostname.toLowerCase() && /^[a-z0-9.-]+$/.test(host)) {
    found.referrer_host = host.slice(0, 100);
  }
  const marketing = UTM.some((key) => found[key]) || found.click_id_kind;
  if (!marketing && !found.referrer_host) return null;
  found.landing_path = location.pathname.slice(0, 200);
  return found;
}

export function readAttribution(now = Date.now()): Attribution | null {
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Attribution;
    if (typeof value?.at !== "number" || now - value.at > TTL_MS) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Guarda el origen de esta visita si trae algo de marketing (utm o clic de anuncio): el último que trae algo gana. Una visita que solo
 * viene de otro sitio, sin parámetros, no pisa un origen de campaña que ya había; solo se guarda si todavía no hay ninguno.
 */
export function captureAttribution(
  location: { search: string; pathname: string; hostname: string },
  referrer: string,
): void {
  const found = attributionFromLocation(location, referrer);
  if (!found) return;
  const hasCampaign = UTM.some((key) => found[key]) || found.click_id_kind;
  if (!hasCampaign && readAttribution()) return;
  try {
    window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(found));
  } catch {
    /* sin almacenamiento: no hay atribución, y no pasa nada */
  }
}

export function clearAttribution(): void {
  try {
    window.localStorage.removeItem(ATTRIBUTION_KEY);
  } catch {
    /* nada */
  }
}

/** Anota el origen junto al pedido recién creado. Mejor esfuerzo: un fallo no afecta a la compra. */
export async function recordOrderAttribution(orderNumber: string): Promise<void> {
  const stored = readAttribution();
  if (!stored) return;
  const { at: _at, ...data } = stored;
  try {
    await (
      getSupabase().rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => PromiseLike<unknown>
    )("record_order_attribution", { p_number: orderNumber, p_data: data });
  } catch {
    /* mejor esfuerzo */
  }
}

/** Avisa a la API de conversiones de Meta (servidor) de un pedido recién creado: solo con consentimiento de marketing. Mejor esfuerzo. */
export async function sendMetaPurchase(
  orderNumber: string,
  eventId: string,
  token: string,
): Promise<void> {
  const cookie = (name: string) =>
    document.cookie
      .split(";")
      .map((pair) => pair.trim())
      .find((pair) => pair.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  await callFunction(
    "meta-capi",
    {
      order_number: orderNumber,
      event_id: eventId,
      fbp: cookie("_fbp")?.slice(0, 100),
      fbc: cookie("_fbc")?.slice(0, 200),
      source_url: window.location.href.split("?")[0]?.split("#")[0],
    },
    { token },
  );
}

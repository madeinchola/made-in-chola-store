import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createFakeProvider, createResendProvider, type EmailProvider } from "./providers.ts";
import type {
  Channel,
  CompleteInfo,
  Outcome,
  OutboxRow,
  RowContext,
  SiteContext,
  TemplateRow,
} from "./types.ts";
import type { WorkerDeps, WorkerLog, WorkerSettings } from "./worker.ts";

/** Conecta el núcleo del worker (puro) con la base de datos real. Sin lógica de negocio: solo lecturas y las dos funciones SQL. */

const SETTING_KEYS = [
  "notify_enabled",
  "notify_email_provider",
  "notify_from_name",
  "notify_from_email",
  "notify_reply_to",
  "notify_whatsapp_mode",
  "business_name",
] as const;

export const DEFAULT_SITE_URL = "https://made-in-chola-store.vercel.app";

/** Dirección pública de la tienda para los enlaces: `SITE_URL`, o el primer origen permitido que no sea local, o la de Vercel. */
export function resolveSiteUrl(
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): string {
  const explicit = (env("SITE_URL") ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[^\s/]+$/.test(explicit)) return explicit;
  const origin = (env("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .find((value) => /^https:\/\/[^\s/]+$/.test(value) && !/localhost|127\.0\.0\.1/.test(value));
  return origin ?? DEFAULT_SITE_URL;
}

export async function loadSettings(
  service: SupabaseClient,
): Promise<WorkerSettings & { storeName: string }> {
  const { data, error } = await service
    .from("store_settings")
    .select("key, value")
    .in("key", [...SETTING_KEYS]);
  if (error) throw error;
  const values = new Map<string, unknown>(
    (data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]),
  );
  const text = (key: string, fallback: string) =>
    typeof values.get(key) === "string" ? (values.get(key) as string) : fallback;
  const provider = text("notify_email_provider", "none");
  const mode = text("notify_whatsapp_mode", "manual");
  return {
    enabled: values.get("notify_enabled") !== false,
    emailProvider: provider === "resend" || provider === "fake" ? provider : "none",
    fromName: text("notify_from_name", "Made In Chola"),
    fromEmail: text("notify_from_email", ""),
    replyTo: text("notify_reply_to", ""),
    whatsappMode: mode === "official" ? "official" : "manual",
    storeName: text("business_name", "Made In Chola"),
  };
}

/** Adaptador del proveedor elegido. `resend` necesita el secreto `RESEND_API_KEY` (lo pone el dueño en el panel de Supabase). */
export function providerFactory(
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
) {
  const fake = createFakeProvider();
  return (kind: "resend" | "fake"): EmailProvider | null => {
    if (kind === "fake") return fake;
    const key = env("RESEND_API_KEY");
    return key ? createResendProvider(key) : null;
  };
}

export function createWorkerDeps(
  service: SupabaseClient,
  log: WorkerLog,
  siteUrl = resolveSiteUrl(),
): WorkerDeps & { siteUrl: string } {
  const site: SiteContext = { siteUrl, storeName: "Made In Chola" };
  const currencyCache = new Map<string, { symbol: string; decimals: number } | null>();
  const settingsPromise = loadSettings(service);
  const providers = providerFactory();

  const currency = async (code: unknown) => {
    if (typeof code !== "string") return null;
    if (!currencyCache.has(code)) {
      const { data } = await service
        .from("currencies")
        .select("symbol, decimals")
        .eq("code", code)
        .maybeSingle();
      currencyCache.set(
        code,
        data ? { symbol: String(data.symbol), decimals: Number(data.decimals) } : null,
      );
    }
    return currencyCache.get(code) ?? null;
  };

  return {
    siteUrl,
    site,
    async settings() {
      const settings = await settingsPromise;
      // El nombre de la tienda viene de los ajustes; se refleja en el contexto del sitio.
      site.storeName = settings.storeName;
      return settings;
    },
    async claim({ limit, worker, ids, channels }) {
      const { data, error } = await service.rpc("claim_notifications", {
        p_limit: limit,
        p_worker: worker,
        p_ids: ids,
        p_channels: channels,
      });
      if (error) throw error;
      return (data ?? []) as OutboxRow[];
    },
    async complete(id: number, worker: string, outcome: Outcome, info: CompleteInfo) {
      const { data, error } = await service.rpc("complete_notification", {
        p_id: id,
        p_worker: worker,
        p_outcome: outcome,
        p_provider: info.provider ?? null,
        p_message_id: info.messageId ?? null,
        p_error: info.error ?? null,
        p_retry_after_seconds: info.retryAfterSeconds ?? null,
        p_subject: info.subject ?? null,
        p_body: info.body ?? null,
      });
      if (error) throw error;
      return String(data);
    },
    async template(key: string, channel: Channel) {
      const { data, error } = await service
        .from("notification_templates")
        .select("key, channel, locale, audience, subject, body, cta_label, active")
        .eq("key", key)
        .eq("channel", channel)
        .eq("locale", "es")
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TemplateRow | null;
    },
    async context(row: OutboxRow): Promise<RowContext> {
      let customerName: string | null = null;
      if (row.profile_id) {
        const { data } = await service
          .from("profiles")
          .select("full_name")
          .eq("id", row.profile_id)
          .maybeSingle();
        customerName = (data?.full_name as string | null | undefined) ?? null;
      }
      let paymentExpiresAt: string | null = null;
      if (row.type === "payment_expiring" && row.order_id) {
        const { data } = await service
          .from("payments")
          .select("expires_at")
          .eq("order_id", row.order_id)
          .in("status", ["initiated", "pending"])
          .order("attempt", { ascending: false })
          .limit(1)
          .maybeSingle();
        paymentExpiresAt = (data?.expires_at as string | null | undefined) ?? null;
      }
      return { customerName, currency: await currency(row.payload.currency), paymentExpiresAt };
    },
    async alertRecipients() {
      const { data, error } = await service.rpc("alert_recipients");
      if (error) throw error;
      return (data ?? []) as string[];
    },
    async raiseTemplateAlert(key: string, channel: Channel, reason: "missing" | "syntax") {
      const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const { error } = await service.from("notification_outbox").insert({
        type: "template_fallback",
        channel: "email",
        recipient: null,
        payload: { template_key: key, channel, reason },
        dedupe_key: `template_fallback:${key}:${channel}:${day}`,
      });
      // 23505 = ya se alertó hoy de esta plantilla: es lo esperado (una alerta por plantilla y día).
      if (error && error.code !== "23505") throw error;
    },
    emailProvider: providers,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log,
  };
}

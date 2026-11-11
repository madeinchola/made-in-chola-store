import { t } from "@/i18n";
import { charLength, btrimSpaces, EMAIL_RE, HTTPS_URL_RE, INT_RE, PHONE_E164_RE } from "./pgText";

export type SettingType = "text" | "int" | "bool" | "url" | "email" | "phone_e164";
export type SettingSection =
  "business" | "social" | "pdp" | "inventory" | "customers" | "cart" | "shipping" | "orders";
export type SettingControl = "input" | "textarea" | "number" | "select";

export interface SettingDef {
  /** Clave en `store_settings` (las define el código; el admin solo cambia el valor). */
  key: string;
  type: SettingType;
  section: SettingSection;
  control: SettingControl;
  /** Solo lectura: se muestra pero no se edita. */
  readOnly?: true;
  /** Opciones del select (valores). */
  options?: readonly string[];
  /** Obligatorio en la interfaz aunque la base acepte vacío (no es una regla de la base). */
  requiredUi?: true;
  /** Rango [mínimo, máximo] que la base impone a un entero (su trigger lo rechaza fuera de él): el panel dice lo mismo. */
  range?: readonly [min: number, max: number];
}

/** Ajustes que el panel muestra, por sección y en este orden. */
export const SETTING_DEFS: readonly SettingDef[] = [
  { key: "business_name", type: "text", section: "business", control: "input", requiredUi: true },
  { key: "contact_email", type: "email", section: "business", control: "input" },
  { key: "contact_phone", type: "phone_e164", section: "business", control: "input" },
  { key: "whatsapp_orders", type: "phone_e164", section: "business", control: "input" },
  { key: "base_currency", type: "text", section: "business", control: "input", readOnly: true },
  { key: "social_instagram", type: "url", section: "social", control: "input" },
  { key: "social_facebook", type: "url", section: "social", control: "input" },
  { key: "social_tiktok", type: "url", section: "social", control: "input" },
  { key: "social_youtube", type: "url", section: "social", control: "input" },
  { key: "pdp_assistance_text", type: "text", section: "pdp", control: "textarea" },
  { key: "pdp_shipping_return_text", type: "text", section: "pdp", control: "textarea" },
  { key: "stock_low_threshold", type: "int", section: "inventory", control: "number" },
  { key: "stock_critical_threshold", type: "int", section: "inventory", control: "number" },
  {
    key: "default_out_of_stock_behavior",
    type: "text",
    section: "inventory",
    control: "select",
    options: ["sold_out", "hide"],
  },
  {
    key: "reservation_ttl_minutes",
    type: "int",
    section: "inventory",
    control: "number",
    readOnly: true,
  },
  {
    key: "tax_id_validation",
    type: "text",
    section: "customers",
    control: "select",
    options: ["strict", "lenient"],
  },
  // Carrito (S7). `reserve_on_add_to_cart` es booleano: se muestra como «Sí / No» y se guarda como true/false.
  {
    key: "reserve_on_add_to_cart",
    type: "bool",
    section: "cart",
    control: "select",
    options: ["true", "false"],
  },
  { key: "cart_max_qty_per_variant", type: "int", section: "cart", control: "number" },
  { key: "cart_max_lines", type: "int", section: "cart", control: "number" },
  { key: "cart_max_reserved_units", type: "int", section: "cart", control: "number" },
  { key: "price_guarantee_days", type: "int", section: "cart", control: "number" },
  { key: "guest_cart_retention_days", type: "int", section: "cart", control: "number" },
  // Cupo de unidades retenidas por red (D-02): estaba en la base y en la documentación, pero no en el panel.
  { key: "cart_max_units_per_ip", type: "int", section: "cart", control: "number" },
  // Envíos y entregas (S8).
  { key: "shipping_route_factor_pct", type: "int", section: "shipping", control: "number" },
  { key: "delivery_min_lead_hours", type: "int", section: "shipping", control: "number" },
  { key: "delivery_max_days_ahead", type: "int", section: "shipping", control: "number" },
  // Pedidos (S10).
  { key: "order_reminder_hours", type: "int", section: "orders", control: "number" },
  { key: "open_orders_max", type: "int", section: "orders", control: "number" },
  // Pagos con QR (S11).
  // Los rangos son los de `store_settings_validate_s11()` en la base.
  {
    key: "payment_reminder_hours",
    type: "int",
    section: "orders",
    control: "number",
    range: [0, 720],
  },
  { key: "payment_proofs_max", type: "int", section: "orders", control: "number", range: [1, 20] },
];

export const SECTIONS: readonly SettingSection[] = [
  "business",
  "social",
  "pdp",
  "inventory",
  "customers",
  "cart",
  "shipping",
  "orders",
];

export const LOW_KEY = "stock_low_threshold";
export const CRITICAL_KEY = "stock_critical_threshold";

export type SettingProblem =
  "required" | "too_long" | "int" | "range" | "url" | "email" | "phone" | "option";

/**
 * Deja el texto como la base lo acepta: recorta espacios; el correo va en minúsculas (la base exige `lower(btrim())`); el
 * teléfono pierde espacios, guiones, puntos y paréntesis ("+591 7123-4567" → "+59171234567").
 */
export function normalizeSetting(def: SettingDef, raw: string): string {
  const trimmed = raw.trim();
  switch (def.type) {
    case "email":
      return trimmed.toLowerCase();
    case "phone_e164":
      return trimmed.replace(/[\s().-]/g, "");
    default:
      return trimmed;
  }
}

/** Valida un valor YA normalizado con las mismas reglas que `store_settings_validate()`. Devuelve el problema, o null. */
export function settingProblem(def: SettingDef, value: string): SettingProblem | null {
  if (def.readOnly) return null;
  if (def.options) return def.options.includes(value) ? null : "option";
  switch (def.type) {
    case "text":
      if (def.requiredUi && value === "") return "required";
      return charLength(value) > 4000 ? "too_long" : null;
    case "int": {
      if (!INT_RE.test(value)) return "int";
      if (def.range && (Number(value) < def.range[0] || Number(value) > def.range[1]))
        return "range";
      return null;
    }
    case "url":
      if (value === "") return "required";
      return charLength(value) > 2048 || !HTTPS_URL_RE.test(value) ? "url" : null;
    case "email":
      if (value === "") return "required";
      return charLength(value) > 254 ||
        value !== btrimSpaces(value).toLowerCase() ||
        !EMAIL_RE.test(value)
        ? "email"
        : null;
    case "phone_e164":
      if (value === "") return "required";
      return PHONE_E164_RE.test(value) ? null : "phone";
    case "bool":
      return null;
  }
}

export function settingMessage(problem: SettingProblem, def?: SettingDef): string {
  switch (problem) {
    case "range":
      return def?.range
        ? t("admin.config.settings.errors.range", { min: def.range[0], max: def.range[1] })
        : t("admin.config.settings.errors.int");
    case "required":
      return t("admin.config.settings.errors.required");
    case "too_long":
      return t("admin.config.settings.errors.tooLong");
    case "int":
      return t("admin.config.settings.errors.int");
    case "url":
      return t("admin.config.settings.errors.url");
    case "email":
      return t("admin.config.settings.errors.email");
    case "phone":
      return t("admin.config.settings.errors.phone");
    case "option":
      return t("admin.config.settings.errors.option");
  }
}

/** Valor JSON con su tipo correcto (la base exige número para `int`, booleano para `bool`, texto para el resto). */
export function toJsonValue(def: SettingDef, value: string): string | number | boolean {
  if (def.type === "bool") return value === "true";
  return def.type === "int" ? Number(value) : value;
}

/** El umbral crítico no puede superar al de aviso (igualdad permitida). Solo si ambos son enteros válidos. */
export function thresholdProblem(low: string, critical: string): string | null {
  if (!INT_RE.test(low) || !INT_RE.test(critical)) return null;
  return Number(critical) > Number(low)
    ? t("admin.config.settings.errors.thresholdOrder", {
        critical: Number(critical),
        low: Number(low),
      })
    : null;
}

export interface ThresholdChange {
  key: string;
  value: string | number | boolean;
}

/**
 * La base valida cada umbral contra el OTRO valor ya guardado, así que si se cambian los dos a la vez el orden importa.
 * Si el nuevo crítico cabe bajo el aviso VIEJO se guarda primero el crítico (al bajar ambos); si no, primero el aviso
 * (al subir ambos). Los demás cambios conservan su orden relativo.
 */
export function orderChanges<T extends ThresholdChange>(
  changes: readonly T[],
  oldLow: string,
): T[] {
  const low = changes.find((c) => c.key === LOW_KEY);
  const critical = changes.find((c) => c.key === CRITICAL_KEY);
  if (!low || !critical) return [...changes];
  const criticalFirst = Number(critical.value) <= Number(oldLow);
  const first = criticalFirst ? critical : low;
  const second = criticalFirst ? low : critical;
  const rest = changes.filter((c) => c !== low && c !== critical);
  return [...rest, first, second];
}

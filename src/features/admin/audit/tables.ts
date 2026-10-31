/** Tablas que dejan rastro en `audit_log` (las que tienen el trigger `audit_changes`), con su nombre técnico. */
export const AUDIT_TABLES = [
  "products",
  "product_colors",
  "product_sizes",
  "product_variants",
  "product_images",
  "product_prices",
  "product_categories",
  "product_collections",
  "product_related",
  "categories",
  "collections",
  "news_banners",
  "store_settings",
  "currencies",
  "countries",
  "exchange_rates",
  "home_sections",
  "home_section_items",
  "profiles",
] as const;

export type AuditTable = (typeof AUDIT_TABLES)[number];

export const isAuditTable = (value: string | null | undefined): value is AuditTable =>
  AUDIT_TABLES.some((t) => t === value);

export const AUDIT_ACTIONS = ["INSERT", "UPDATE", "DELETE"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const isAuditAction = (value: string | null | undefined): value is AuditAction =>
  AUDIT_ACTIONS.some((a) => a === value);

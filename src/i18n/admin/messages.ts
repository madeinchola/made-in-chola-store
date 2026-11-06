import { adminAudit } from "./audit";
import { adminCommon } from "./common";
import { adminConfig } from "./config";
import { adminProducts } from "./products";
import { adminShipping } from "./shipping";
import { adminTaxonomy } from "./taxonomy";

/**
 * Todos los textos del panel de administración. NO entran en la entrada pública: `es.admin` nace vacío y los llena
 * `register.ts` cuando se carga el panel (ver ahí). Solo aquí se listan las secciones del panel.
 */
export const adminMessages = {
  ...adminCommon,
  products: adminProducts,
  taxonomy: adminTaxonomy,
  config: adminConfig,
  audit: adminAudit,
  shipping: adminShipping,
} as const;

export type AdminMessages = typeof adminMessages;

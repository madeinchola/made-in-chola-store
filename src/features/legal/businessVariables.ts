import type { Variables } from "./renderLegal";

/** Los datos del negocio que los textos pueden citar con `{{razon_social}}`, `{{nit}}`, `{{direccion}}`, `{{correo}}` y `{{telefono}}`. */
export function businessVariables(
  settings: Record<string, string | number | boolean> | undefined,
): Variables {
  const get = (key: string) =>
    typeof settings?.[key] === "string" ? (settings[key] as string) : "";
  return {
    razon_social: get("business_name"),
    nit: get("legal_tax_id"),
    direccion: get("legal_address"),
    correo: get("contact_email"),
    telefono: get("contact_phone"),
  };
}

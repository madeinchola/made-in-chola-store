import { useStoreSettings } from "@/features/catalog/hooks";
import { businessVariables } from "@/features/legal/businessVariables";
import { BUSINESS_VARIABLES } from "./logic";

/** Qué datos del negocio faltan en Ajustes (los textos los citan con {{razon_social}}, {{nit}}…). */
export function useBusinessData() {
  const settings = useStoreSettings();
  const vars = businessVariables(settings.data);
  const missing = BUSINESS_VARIABLES.filter((name) => (vars[name] ?? "").trim() === "");
  return { vars, missing, loading: settings.isPending };
}

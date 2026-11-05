import { useEffect } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { useOptionalCart } from "./cart-context";
import { mergeDescription } from "./mergeMessage";

/**
 * Avisos globales del carrito, sin pintar nada en la página (usan los toasts de la tienda). Va UNA vez en el layout.
 *  · Fusión: tras iniciar sesión, «Juntamos tu bolsa de invitado con tu cuenta» (+ lo ajustado u omitido) y se descarta
 *    el informe para no repetirlo.
 */
export function CartEffects() {
  const cart = useOptionalCart();
  const store = cart?.store;
  const mergeReport = cart?.state.mergeReport ?? null;

  useEffect(() => {
    if (!store || !mergeReport) return;
    const description = mergeDescription(mergeReport.adjusted, mergeReport.skipped);
    toast(t("cart.merge.title"), description ? { description } : {});
    store.dismissMergeReport();
  }, [store, mergeReport]);

  return null;
}

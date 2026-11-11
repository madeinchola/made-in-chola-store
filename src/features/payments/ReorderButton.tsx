import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { Button } from "@/components/ui/button";
import { useCart } from "@/features/cart/cart-context";
import { t } from "@/i18n";
import { listOrderLines } from "./paymentsApi";

/**
 * «Volver a pedir»: un pedido vencido o cancelado no se revive (su stock ya volvió al inventario y los precios pudieron
 * cambiar): se vuelven a poner sus productos en la bolsa y se pasa otra vez por el checkout, que revalida stock y precios de
 * forma atómica y crea un pedido NUEVO con su propio cobro y su propia ventana. Las cantidades no se suman (repetirlo no suma de
 * más) y tampoco rebajan lo que ya había en la bolsa: queda el mayor.
 */
export function ReorderButton({ orderId }: { orderId: string }) {
  const cart = useCart();
  const navigate = useNavigate();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<"empty" | "failed" | null>(null);

  async function onClick() {
    if (working) return;
    setWorking(true);
    setProblem(null);
    try {
      const lines = await listOrderLines(orderId);
      if (lines.length === 0) {
        setProblem("empty");
        return;
      }
      // Lo que la clienta ya tenía en la bolsa no se rebaja: queda el MAYOR entre lo que había y lo que pedía (volver a pedir dos
      // veces no suma de más, y una prenda que ya llevaba en mayor cantidad no se pisa con la del pedido viejo).
      const inBag = new Map(
        (cart.store.getState().snapshot?.lines ?? []).map((l) => [l.variant_id, l.qty] as const),
      );
      for (const line of lines) {
        cart.store.setQty(line.variantId, Math.max(inBag.get(line.variantId) ?? 0, line.qty));
      }
      toast.success(t("pay.reorder.done"));
      navigate(storeRoutes.cart);
    } catch {
      setProblem("failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={() => void onClick()} disabled={working}>
        {working ? t("pay.reorder.working") : t("pay.reorder.action")}
      </Button>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {t(`pay.reorder.${problem}`)}
        </p>
      )}
    </div>
  );
}

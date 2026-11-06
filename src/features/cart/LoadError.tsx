import { CloudOff } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import { RescueButton } from "./RescueButton";

/**
 * La bolsa no se pudo LEER (sin red o error del servidor): se dice con claridad y se deja reintentar. Reemplaza al falso
 * «Tu bolsa está vacía», que hacía creer que se habían perdido los productos.
 */
export function LoadError({ className }: { className?: string }) {
  const { store } = useCart();
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-3 px-4 py-10 text-center", className)}
    >
      <CloudOff aria-hidden="true" className="h-10 w-10 text-muted-foreground" strokeWidth={1.25} />
      <p className="font-display text-display-sm">{t("cart.loadError.title")}</p>
      <p className="text-sm text-muted-foreground">{t("cart.loadError.description")}</p>
      <RescueButton
        type="button"
        variant="outline"
        className="mt-2 min-h-11"
        onClick={() => store.retryNow()}
      >
        {t("cart.loadError.action")}
      </RescueButton>
    </div>
  );
}

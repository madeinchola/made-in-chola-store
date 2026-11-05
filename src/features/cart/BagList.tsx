import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import { CartLineItem } from "./CartLineItem";
import { pendingAdds } from "./viewState";

/** Fila provisional de un producto recién agregado que el servidor aún no confirma (evita el parpadeo del estado vacío). */
function PendingAddRow({ compact }: { compact: boolean }) {
  return (
    <li
      aria-busy="true"
      className={cn("flex gap-3 border-b border-border", compact ? "py-4" : "gap-4 py-6 sm:gap-6")}
    >
      <Skeleton
        className={cn("aspect-[5/7] shrink-0 rounded-none", compact ? "w-16" : "w-20 sm:w-28")}
      />
      <div className="min-w-0 flex-1 space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <p role="status" className="text-sm text-muted-foreground">
          {t("cart.adding")}
        </p>
      </div>
    </li>
  );
}

/** Lista de líneas de la bolsa (página y cajón): una `CartLineItem` por línea más las altas pendientes. */
export function BagList({ variant = "page" }: { variant?: "page" | "compact" }) {
  const { lines, state } = useCart();
  const adding = pendingAdds(state);
  return (
    <ul aria-label={t("cart.listLabel")} className="border-t border-border">
      {lines.map((line) => (
        <CartLineItem key={line.variant_id} line={line} variant={variant} />
      ))}
      {adding.map((variantId) => (
        <PendingAddRow key={variantId} compact={variant === "compact"} />
      ))}
    </ul>
  );
}

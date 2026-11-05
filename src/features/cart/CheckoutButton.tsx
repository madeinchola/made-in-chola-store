import { useId } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button-variants";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import { checkoutBlockReason } from "./viewState";

/**
 * Botón «Pagar». Si `!canCheckout` NO se usa `disabled`: queda `aria-disabled="true"` (sigue en el orden de tabulación,
 * no navega) y la razón se lee por `aria-describedby`. Con sesión lleva a `/checkout`; sin sesión, a iniciar sesión con
 * regreso a la bolsa (BR-ACC-01: se agrega sin cuenta, la cuenta se pide al pagar; `LoginPage` lee `state.from`).
 */
export function CheckoutButton({ className }: { className?: string }) {
  const { state, canCheckout } = useCart();
  const { session } = useAuth();
  const reasonId = useId();
  const reason = checkoutBlockReason(state);
  const blocked = !canCheckout;
  const to = session ? storeRoutes.checkout : storeRoutes.login;
  const classes = cn(buttonVariants({ size: "lg", caps: true }), "w-full", className);
  return (
    <>
      {blocked ? (
        // Un enlace con `aria-disabled` sigue teniendo `href`: el clic con botón medio, «abrir en pestaña nueva» o la
        // pulsación larga en el móvil lo abren igual. Sin enlace no hay nada que abrir; sigue enfocable y explica por qué.
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={reason ? reasonId : undefined}
          onClick={(event) => event.preventDefault()}
          className={cn(classes, "cursor-not-allowed opacity-60")}
        >
          {t("cart.checkout.pay")}
        </button>
      ) : (
        <Link
          to={to}
          {...(session ? {} : { state: { from: storeRoutes.cart } })}
          className={classes}
        >
          {t("cart.checkout.pay")}
        </Link>
      )}
      {blocked && reason && (
        <p id={reasonId} className="mt-2 text-sm text-muted-foreground">
          {t(`cart.checkout.reason.${reason}`)}
        </p>
      )}
    </>
  );
}

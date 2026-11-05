import { lazy, Suspense, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button-variants";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { t } from "@/i18n";
import { useOptionalCart } from "./cart-context";
import { DrawerBoundary } from "./DrawerBoundary";
import { loadMiniCartContent } from "./miniCartLoader";

// El contenido (líneas, cuenta regresiva, botones) va en su propio fragmento: la entrada pública solo lleva este armazón.
const MiniCartContent = lazy(() =>
  loadMiniCartContent().then((module) => ({ default: module.MiniCartContent })),
);

/**
 * Cajón lateral de la bolsa, controlado por `open`/`setOpen` del carrito. Va UNA vez en el layout público. Es un diálogo
 * modal (`Sheet`): foco atrapado, Esc lo cierra y el foco vuelve a quien lo abrió. Solo se abre tras agregar un producto
 * y se cierra al navegar. Fuera de `CartProvider` no pinta nada.
 */
export function MiniCartDrawer() {
  const cart = useOptionalCart();
  const location = useLocation();
  const setOpen = cart?.setOpen;
  useEffect(() => {
    setOpen?.(false);
  }, [location.pathname, location.search, setOpen]);

  if (!cart) return null;
  return (
    <Sheet open={cart.open} onOpenChange={cart.setOpen}>
      <SheetContent
        side="right"
        bodyClassName="flex flex-col"
        closeClassName="right-2 top-2 flex h-11 w-11 items-center justify-center p-0"
      >
        <SheetTitle data-cart-heading="" tabIndex={-1} className="px-6 pb-4 pr-14 pt-6">
          {t("cart.drawer.title")}
        </SheetTitle>
        <SheetDescription className="sr-only">{t("cart.drawer.description")}</SheetDescription>
        <DrawerBoundary
          viewBag={
            <Link
              to={storeRoutes.cart}
              onClick={() => cart.setOpen(false)}
              className={buttonVariants({ variant: "outline", caps: true, className: "min-h-11" })}
            >
              {t("cart.drawer.viewBag")}
            </Link>
          }
        >
          <Suspense
            fallback={
              <p role="status" className="px-6 py-8 text-sm text-muted-foreground">
                {t("cart.drawer.loading")}
              </p>
            }
          >
            <MiniCartContent />
          </Suspense>
        </DrawerBoundary>
      </SheetContent>
    </Sheet>
  );
}

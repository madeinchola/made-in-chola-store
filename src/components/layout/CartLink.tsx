import { Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { cartBadge } from "./cartCount";
import { iconClass } from "./headerStyles";
import { storeRoutes } from "./storeRoutes";

/**
 * Bolsa con contador como en el diseño: icono + «(0)». El número exacto va en el nombre accesible («Bolsa, 124
 * productos»); el texto visible es decorativo y muestra «99+» desde 100, así que 3 dígitos no deforman la cabecera.
 */
export function CartLink({ count, overlay = false }: { count: number; overlay?: boolean }) {
  const badge = cartBadge(count);
  const label =
    badge.count === 0
      ? t("layout.header.cart")
      : badge.count === 1
        ? t("layout.header.cartCountOne")
        : t("layout.header.cartCountMany", { count: badge.count });
  return (
    <Link to={storeRoutes.cart} aria-label={label} className={cn(iconClass(overlay), "px-1")}>
      <ShoppingBag className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      <span aria-hidden="true" data-testid="cart-count" className="text-xs tabular-nums">
        ({badge.text})
      </span>
    </Link>
  );
}

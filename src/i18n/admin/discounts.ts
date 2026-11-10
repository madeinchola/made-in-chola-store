import { adminDiscountsCoupons } from "./discountsCoupons";
import { adminDiscountsGroups } from "./discountsGroups";
import { adminDiscountsList } from "./discountsList";
import { adminDiscountsRedemptions } from "./discountsRedemptions";
import { adminDiscountsWizard } from "./discountsWizard";

/** Panel de Descuentos (S9): el marco común (título y pestañas); cada pantalla tiene su propio archivo de textos. */
export const adminDiscounts = {
  title: "Descuentos y cupones",
  description:
    "Ofertas automáticas y cupones con código: porcentaje, monto fijo, envío gratis, 2×1, volumen, precio por tipo de cliente, ofertas flash y primera compra. Una clienta usa un solo cupón por pedido.",
  tabs: {
    label: "Secciones de descuentos",
    discounts: "Descuentos",
    redemptions: "Redenciones",
    groups: "Grupos de clientes",
  },
  list: adminDiscountsList,
  wizard: adminDiscountsWizard,
  coupons: adminDiscountsCoupons,
  redemptions: adminDiscountsRedemptions,
  groups: adminDiscountsGroups,
} as const;

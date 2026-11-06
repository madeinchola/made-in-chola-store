import { adminShippingDelivery } from "./shippingDelivery";
import { adminShippingRates } from "./shippingRates";
import { adminShippingStore } from "./shippingStore";

/** Panel de Envíos (S8): el marco común (título y pestañas); cada pantalla tiene su propio archivo de textos. */
export const adminShipping = {
  title: "Envíos y entregas",
  description:
    "Dónde sale tu pedido, a qué zonas entregas, cuánto cuesta por distancia y en qué franjas. El simulador te deja probarlo todo antes de que lo vea una clienta.",
  tabs: {
    label: "Secciones de envíos",
    store: "Tienda y métodos",
    zones: "Zonas",
    rates: "Tarifas",
    delivery: "Entregas",
    simulator: "Simulador",
  },
  store: adminShippingStore,
  rates: adminShippingRates,
  delivery: adminShippingDelivery,
} as const;

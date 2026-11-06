/** Claves de caché de lo que la TIENDA pregunta sobre envíos (cotizaciones). El panel invalida esta raíz al guardar. */
export const shippingQuoteKeys = {
  all: ["shipping"] as const,
  quote: (params: object) => [...shippingQuoteKeys.all, "quote", params] as const,
};

/** Palabras de la base (estados, métodos…) en el idioma de la tienda. Lo desconocido se muestra tal cual: nunca se inventa un nombre. */
const SALE_STATUS: Record<string, string> = {
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  preparing: "Preparando",
  shipped: "Enviado",
  delivered: "Entregado",
  completed: "Completado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};
const PAYMENT_STATUS: Record<string, string> = {
  initiated: "Iniciado",
  pending: "Pendiente",
  paid: "Pagado",
  failed: "Fallido",
  cancelled: "Cancelado",
  expired: "Vencido",
  refunded: "Reembolsado",
  disputed: "En disputa",
};
const REFUND_STATUS: Record<string, string> = {
  requested: "Solicitado",
  approved: "Aprobado",
  processed: "Devuelto",
  rejected: "Rechazado",
  open: "Abierta",
  closed: "Cerrada",
};
const STOCK_LIGHT: Record<string, string> = {
  ok: "Bien",
  low: "Bajo",
  critical: "Crítico",
  out: "Agotado",
};
const PRODUCT_STATUS: Record<string, string> = {
  active: "Publicado",
  draft: "Borrador",
  archived: "Archivado",
};
const DISCOUNT_KIND: Record<string, string> = {
  percent: "Porcentaje",
  fixed: "Monto fijo",
  bogo: "Lleva 2, paga 1",
  volume: "Por volumen",
  group_price: "Precio de grupo",
  flash: "Oferta relámpago",
  free_shipping: "Envío gratis",
};
const REFUND_METHOD: Record<string, string> = {
  same_method: "Mismo método de pago",
  bank_transfer: "Transferencia",
  cash: "Efectivo",
  provider: "Proveedor",
  other: "Otro",
};
const PROVIDER: Record<string, string> = {
  whatsapp: "WhatsApp",
  manual_qr: "QR manual",
  cash_on_delivery: "Contra entrega",
};

const pick = (dictionary: Record<string, string>, value: string): string =>
  dictionary[value] ?? value;

export const saleStatusLabel = (v: string) => pick(SALE_STATUS, v);
export const paymentStatusLabel = (v: string) => pick(PAYMENT_STATUS, v);
export const refundStatusLabel = (v: string) => pick(REFUND_STATUS, v);
export const stockLightLabel = (v: string) => pick(STOCK_LIGHT, v);
export const productStatusLabel = (v: string) => pick(PRODUCT_STATUS, v);
export const discountKindLabel = (v: string) => pick(DISCOUNT_KIND, v);
export const refundMethodLabel = (v: string) => pick(REFUND_METHOD, v);
export const providerLabel = (v: string) => pick(PROVIDER, v);

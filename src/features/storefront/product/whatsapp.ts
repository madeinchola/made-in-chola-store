import { t } from "@/i18n";

/** Solo se acepta el enlace base que arma `contactLinks` (`https://wa.me/<dígitos>`): nada más llega a un `href`. */
const WA_BASE = /^https:\/\/wa\.me\/[1-9]\d{7,14}$/;

export interface WhatsappInquiry {
  name: string;
  /** Precio ya formateado («Bs 560,00»). */
  price: string;
  color?: string | null;
  size?: string | null;
  /** URL de la ficha (sin parámetros de seguimiento). */
  url: string;
}

/** Mensaje de consulta: producto, color, talla, precio y enlace, una cosa por línea. */
export function whatsappMessage(inquiry: WhatsappInquiry): string {
  const lines = [
    t("shop.product.whatsappMessage.intro"),
    t("shop.product.whatsappMessage.name", { name: inquiry.name }),
    ...(inquiry.color ? [t("shop.product.whatsappMessage.color", { color: inquiry.color })] : []),
    ...(inquiry.size ? [t("shop.product.whatsappMessage.size", { size: inquiry.size })] : []),
    t("shop.product.whatsappMessage.price", { price: inquiry.price }),
    inquiry.url,
  ];
  return lines.join("\n");
}

/** `https://wa.me/591…?text=<mensaje codificado>`; null si la base no es un enlace de WhatsApp válido. */
export function whatsappHref(base: string | null | undefined, message: string): string | null {
  if (!base || !WA_BASE.test(base)) return null;
  return `${base}?text=${encodeURIComponent(message)}`;
}

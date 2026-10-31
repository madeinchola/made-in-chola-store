import type { StoreSettings } from "@/features/catalog/types";
import { safeLink } from "./safeLink";

export interface ContactLink {
  /** Texto visible (el número o el correo tal cual; las redes llevan su nombre). */
  label: string;
  href: string;
}

export interface SocialLink extends ContactLink {
  key: string;
}

export interface ContactLinks {
  email: ContactLink | null;
  phone: ContactLink | null;
  whatsapp: ContactLink | null;
  socials: SocialLink[];
}

// Formatos que ya exige la base (store_settings_validate); se repiten aquí porque el valor llega al navegador
// y un dato corrupto no debe convertirse en un enlace `mailto:`/`tel:`/`wa.me` raro.
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Redes que muestra el pie, en este orden. La clave es la de `store_settings`. */
const SOCIALS = [
  { key: "social_instagram", label: "Instagram" },
  { key: "social_tiktok", label: "TikTok" },
  { key: "social_facebook", label: "Facebook" },
  { key: "social_youtube", label: "YouTube" },
] as const;

const text = (settings: StoreSettings, key: string) => {
  const value = settings[key];
  return typeof value === "string" ? value.trim() : null;
};

/** Convierte los ajustes públicos en enlaces de contacto. Lo que falte o sea inválido simplemente no aparece. */
export function contactLinks(settings: StoreSettings | undefined): ContactLinks {
  const s = settings ?? {};
  const email = text(s, "contact_email");
  const phone = text(s, "contact_phone");
  const whatsapp = text(s, "whatsapp_orders");

  const socials: SocialLink[] = [];
  for (const { key, label } of SOCIALS) {
    const link = safeLink(text(s, key), { httpsOnly: true });
    if (link?.kind === "external") socials.push({ key, label, href: link.href });
  }

  return {
    email:
      email && email.length <= 254 && EMAIL.test(email)
        ? { label: email, href: `mailto:${email}` }
        : null,
    phone: phone && E164.test(phone) ? { label: phone, href: `tel:${phone}` } : null,
    whatsapp:
      whatsapp && E164.test(whatsapp)
        ? { label: whatsapp, href: `https://wa.me/${whatsapp.slice(1)}` }
        : null,
    socials,
  };
}

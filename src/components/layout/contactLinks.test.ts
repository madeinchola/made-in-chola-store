import { describe, expect, it } from "vitest";
import { contactLinks } from "./contactLinks";

const FULL = {
  contact_email: "info@madeinchola.com",
  contact_phone: "+541140893614",
  whatsapp_orders: "+59167528677",
  social_instagram: "https://www.instagram.com/madeinchola/",
  social_tiktok: "https://www.tiktok.com/@madeinchola",
  social_facebook: "https://www.facebook.com/MIC.MADEINCHOLA",
  social_youtube: "https://www.youtube.com/@madeinchola9876",
};

describe("contactLinks", () => {
  it("convierte los ajustes públicos en enlaces mailto/tel/wa.me y redes en orden fijo", () => {
    expect(contactLinks(FULL)).toEqual({
      email: { label: "info@madeinchola.com", href: "mailto:info@madeinchola.com" },
      phone: { label: "+541140893614", href: "tel:+541140893614" },
      whatsapp: { label: "+59167528677", href: "https://wa.me/59167528677" },
      socials: [
        {
          key: "social_instagram",
          label: "Instagram",
          href: "https://www.instagram.com/madeinchola/",
        },
        { key: "social_tiktok", label: "TikTok", href: "https://www.tiktok.com/@madeinchola" },
        {
          key: "social_facebook",
          label: "Facebook",
          href: "https://www.facebook.com/MIC.MADEINCHOLA",
        },
        {
          key: "social_youtube",
          label: "YouTube",
          href: "https://www.youtube.com/@madeinchola9876",
        },
      ],
    });
  });

  it("sin ajustes (cargando o con error) no hay nada", () => {
    const empty = { email: null, phone: null, whatsapp: null, socials: [] };
    expect(contactLinks(undefined)).toEqual(empty);
    expect(contactLinks({})).toEqual(empty);
  });

  it("lo que falta simplemente no aparece y el resto sí", () => {
    const { social_tiktok: _t, contact_phone: _p, ...partial } = FULL;
    const links = contactLinks(partial);
    expect(links.phone).toBeNull();
    expect(links.socials.map((s) => s.label)).toEqual(["Instagram", "Facebook", "YouTube"]);
    expect(links.email?.href).toBe("mailto:info@madeinchola.com");
  });

  it.each([
    ["sin arroba", "no-es-correo"],
    ["sin dominio", "ana@"],
    ["con espacio", "ana @x.com"],
    ["vacío", ""],
  ])("correo inválido (%s) → null", (_name, value) => {
    expect(contactLinks({ contact_email: value }).email).toBeNull();
  });

  it.each([
    ["sin +", "59167528677"],
    ["empieza en 0", "+059167528677"],
    ["muy corto (7 dígitos)", "+5916752"],
    ["muy largo (16 dígitos)", "+5916752867712345"],
    ["con espacios", "+591 67528677"],
    ["con letras", "+59167x28677"],
  ])("teléfono inválido (%s) → null para teléfono y WhatsApp", (_name, value) => {
    const links = contactLinks({ contact_phone: value, whatsapp_orders: value });
    expect(links.phone).toBeNull();
    expect(links.whatsapp).toBeNull();
  });

  it("acepta los extremos válidos de E.164: 8 y 15 dígitos", () => {
    expect(contactLinks({ contact_phone: "+12345678" }).phone?.href).toBe("tel:+12345678");
    expect(contactLinks({ contact_phone: "+123456789012345" }).phone?.href).toBe(
      "tel:+123456789012345",
    );
  });

  it("redes: solo https; http, javascript y valores no texto se descartan", () => {
    const links = contactLinks({
      social_instagram: "http://www.instagram.com/x",
      social_tiktok: "javascript:alert(1)",
      social_facebook: 42,
      social_youtube: "https://www.youtube.com/@canal",
    });
    expect(links.socials).toEqual([
      { key: "social_youtube", label: "YouTube", href: "https://www.youtube.com/@canal" },
    ]);
  });
});

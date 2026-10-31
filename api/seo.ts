import { handleSeo } from "../src/server/seo/handlers";

export const config = { runtime: "edge" };

/** Vista para bots (Googlebot, WhatsApp, Facebook…) de portada, tienda, categorías, colecciones y productos. */
export default function handler(request: Request): Promise<Response> {
  return handleSeo(request, {
    env: {
      SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
      SITE_URL: process.env.VITE_SITE_URL,
    },
    fetch,
  });
}

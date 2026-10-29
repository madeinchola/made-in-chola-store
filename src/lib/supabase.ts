import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env";
import type { Database } from "./database.types";

let client: SupabaseClient<Database> | undefined;

/** Cliente tipado, creado bajo demanda para que la app arranque (y falle claro) sin tocar la red. */
export function getSupabase(): SupabaseClient<Database> {
  if (!client) {
    const env = getEnv();
    client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

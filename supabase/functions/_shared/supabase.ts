import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variable de entorno faltante: ${name}`);
  return value;
}

/** Cliente con el JWT del usuario que llama: respeta RLS. */
export function userClient(req: Request) {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
}

/** Cliente de servicio: ignora RLS. Solo para tareas de sistema (webhooks, cron); nunca con datos sin validar. */
export function serviceClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

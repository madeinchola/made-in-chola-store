import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";

/** Pide a la base los datos de la persona con sesión (`my_data_export`). */
export async function fetchMyData(): Promise<Record<string, unknown>> {
  const { data, error } = await (
    getSupabase().rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  )("my_data_export", {});
  if (error) throw fromDbError(error as { message: string; code?: string });
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw new Error("respuesta inesperada");
  return data as Record<string, unknown>;
}

/** El nombre del archivo: `mis-datos-made-in-chola-2026-11-17.json` (la fecha de hoy en La Paz). */
export function myDataFileName(now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/La_Paz" }).format(now);
  return `mis-datos-made-in-chola-${day}.json`;
}

/** El JSON legible (con sangría) y con los acentos como están. */
export const serializeMyData = (data: Record<string, unknown>): string =>
  `${JSON.stringify(data, null, 2)}\n`;

/** Pide los datos y los guarda como archivo en el navegador. */
export async function downloadMyData(): Promise<void> {
  const data = await fetchMyData();
  const blob = new Blob([serializeMyData(data)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = myDataFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // el navegador ya tiene el archivo en marcha; soltar la dirección un instante después evita cortar la descarga
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

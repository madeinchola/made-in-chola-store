import { es, type MessageKey } from "./es";

export type { MessageKey };

export function resolveMessage(key: string, dict: unknown = es): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Traduce una clave tipada e interpola `{param}`.
 * Una clave inexistente devuelve la propia clave (visible en pantalla, no un hueco silencioso).
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = resolveMessage(key);
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match,
  );
}

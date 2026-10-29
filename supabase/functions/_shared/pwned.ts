// Contraseñas filtradas (HaveIBeenPwned, modelo k-anonymity): solo se envían 5 caracteres del hash SHA-1.
// Ante cualquier fallo del servicio NO se bloquea el registro (`unavailable: true`).

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

export async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export interface PwnedCheck {
  /** true solo si HIBP confirmó la filtración. */
  pwned: boolean;
  count: number;
  /** true si no se pudo consultar (red/timeout/HTTP). */
  unavailable: boolean;
}

export async function checkPasswordPwned(
  password: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<PwnedCheck> {
  if (!password) return { pwned: false, count: 0, unavailable: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
      signal: controller.signal,
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return { pwned: false, count: 0, unavailable: true };
    for (const line of (await res.text()).split("\n")) {
      const [candidate, countRaw] = line.trim().split(":");
      if (candidate === suffix) {
        const count = Number(countRaw) || 0;
        // El padding de HIBP añade sufijos falsos con count 0: solo cuentan los > 0.
        return { pwned: count > 0, count, unavailable: false };
      }
    }
    return { pwned: false, count: 0, unavailable: false };
  } catch {
    return { pwned: false, count: 0, unavailable: true };
  } finally {
    clearTimeout(timer);
  }
}

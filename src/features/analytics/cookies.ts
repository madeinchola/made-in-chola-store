/** Borra una cookie en el sitio y en los dominios padre (las de Google y Meta suelen quedar en «.dominio.com»). */
export function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  const host = window.location.hostname;
  const parts = host.split(".");
  const domains = new Set<string | null>([null, host]);
  for (let i = 1; i < parts.length - 1; i++) domains.add(`.${parts.slice(i).join(".")}`);
  for (const domain of domains) {
    document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}; SameSite=Lax`;
  }
}

/** Los nombres de las cookies del navegador que cumplen el patrón. */
export function cookieNames(pattern: RegExp): string[] {
  if (typeof document === "undefined") return [];
  return document.cookie
    .split(";")
    .map((pair) => pair.split("=")[0]!.trim())
    .filter((name) => name !== "" && pattern.test(name));
}

/** Borra todas las cookies cuyo nombre cumple el patrón. */
export function deleteCookies(pattern: RegExp): void {
  for (const name of cookieNames(pattern)) deleteCookie(name);
}

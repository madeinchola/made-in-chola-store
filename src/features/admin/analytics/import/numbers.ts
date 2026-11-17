/**
 * Un número escrito por una persona → el número canónico que entiende la base («1234.56»).
 *  - «1.234,56», «1,234.56», «1234,56», «1234.56», «1 234,56» y «Bs 1.234,56» son válidos.
 *  - Con los DOS separadores, el último es el decimal. Con uno repetido («1.234.567»), es de miles.
 *  - Con UNO solo seguido de EXACTAMENTE 3 dígitos («1.234», «12,500») no se puede saber si es miles o decimal: se pide aclararlo
 *    (adivinar cambiaría un precio de 12,5 a 12 500 sin que nadie se entere).
 *  - Lo que no es un número queda tal cual y la base lo rechaza con su motivo.
 */
export type NumberResult =
  { ok: true; value: string } | { ok: false; code: "ambiguous" | "invalid_format" };

const CURRENCY_NOISE = /^(?:bs\.?|bob|\$|usd|us\$)\s*|\s*(?:bs\.?|bob|\$|usd)$/i;

export function normalizeNumber(raw: string): NumberResult {
  const cleaned = raw.trim().replace(CURRENCY_NOISE, "").replace(/\s+/g, "");
  if (cleaned === "") return { ok: true, value: "" };
  if (!/^-?[0-9.,]+$/.test(cleaned)) return { ok: false, code: "invalid_format" };
  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;
  let canonical: string;
  if (dots > 0 && commas > 0) {
    const decimalSep = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    // el separador de miles solo puede aparecer ANTES del decimal, y cada grupo de miles tiene 3 dígitos
    const [int = "", frac = ""] = body.split(decimalSep);
    if (body.split(decimalSep).length !== 2 || frac.includes(thousandSep))
      return { ok: false, code: "invalid_format" };
    if (!/^[0-9]{1,3}(?:[.,][0-9]{3})*$/.test(int)) return { ok: false, code: "invalid_format" };
    canonical = `${int.split(thousandSep).join("")}.${frac}`;
  } else if (dots + commas === 0) {
    canonical = body;
  } else {
    const sep = dots > 0 ? "." : ",";
    const parts = body.split(sep);
    if (parts.length > 2) {
      // repetido: solo puede ser de miles («1.234.567»)
      if (!/^[0-9]{1,3}(?:[.,][0-9]{3})+$/.test(body)) return { ok: false, code: "invalid_format" };
      canonical = parts.join("");
    } else {
      const [int = "", frac = ""] = parts;
      if (int === "" || frac === "") return { ok: false, code: "invalid_format" };
      if (frac.length === 3 && int.length <= 3 && int !== "0")
        return { ok: false, code: "ambiguous" };
      canonical = `${int}.${frac}`;
    }
  }
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(canonical)) return { ok: false, code: "invalid_format" };
  return { ok: true, value: negative ? `-${canonical}` : canonical };
}

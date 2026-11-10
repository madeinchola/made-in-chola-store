import { t } from "@/i18n";
import { formatDateTime, fromLaPazInputValue, toLaPazInputValue } from "@/lib/datetime";
import { INT_RE } from "../config/pgText";
import { toCsv } from "./csv";
import type { Coupon, Redemption } from "./types";

/** Lógica PURA de los códigos (cupones) de un descuento: formato, comparación, estado, formularios y CSV. Sin React ni red. */

// ── Cómo compara la base los códigos ───────────────────────────────────────────────────────
/**
 * Réplica de `public._coupon_norm`: sin espacios, guiones ni guiones bajos, en mayúsculas y con los caracteres que se confunden
 * unificados (O→0, I→1, L→1). «Verano-10», «VERANO 10» y «VERAN0 1O» son el mismo código. La base es la que decide; esto
 * solo sirve para avisar antes de enviar y para buscar en la lista.
 */
export const normalizeCode = (code: string): string =>
  code
    .trim()
    .replace(/[\s_-]+/g, "")
    .toUpperCase()
    .replace(/[OIL]/g, (c) => (c === "O" ? "0" : "1"));

export type CodeProblem = "required" | "tooShort" | "tooLong" | "chars" | "start";

/**
 * Réplica de las restricciones de `coupons.code`, con un mensaje distinto para cada caso: la forma
 * `^[A-Za-z0-9][A-Za-z0-9-]{2,31}$` y `coupons_code_norm_len` (al normalizar, mínimo 4 caracteres: «A--» o «1-0» pasan la forma
 * pero se adivinan en decenas de intentos).
 */
export function codeProblem(raw: string): CodeProblem | null {
  const code = raw.trim();
  if (code === "") return "required";
  if (!/^[A-Za-z0-9-]+$/.test(code)) return "chars";
  if (code.length < 3) return "tooShort";
  if (code.length > 32) return "tooLong";
  if (!/^[A-Za-z0-9]/.test(code)) return "start";
  if (normalizeCode(code).length < 4) return "tooShort";
  return null;
}

// ── Estado y usos ──────────────────────────────────────────────────────────────────────────
export type CouponStatus =
  "active" | "inactive" | "archived" | "expired" | "scheduled" | "exhausted";

/**
 * Lo que vería una clienta HOY con este código. El inicio es INCLUSIVO y el fin EXCLUSIVO (a la hora exacta de `endsAt` ya no
 * sirve). «Agotado» necesita saber los usos (`null` = no se pudieron leer: no se adivina).
 */
export function couponStatus(coupon: Coupon, uses: number | null, now: Date): CouponStatus {
  if (coupon.archived) return "archived";
  if (!coupon.isActive) return "inactive";
  const instant = now.getTime();
  if (coupon.endsAt !== null && instant >= Date.parse(coupon.endsAt)) return "expired";
  if (coupon.startsAt !== null && instant < Date.parse(coupon.startsAt)) return "scheduled";
  if (coupon.usageLimit !== null && uses !== null && uses >= coupon.usageLimit) return "exhausted";
  return "active";
}

/** Usos VIGENTES de cada código (reservados o aplicados; los devueltos no cuentan, igual que en la base). */
export function usesByCoupon(redemptions: readonly Redemption[]): Map<string, number> {
  const uses = new Map<string, number>();
  for (const r of redemptions) {
    if (r.couponId === null || r.status === "reverted") continue;
    uses.set(r.couponId, (uses.get(r.couponId) ?? 0) + 1);
  }
  return uses;
}

// ── Lista ──────────────────────────────────────────────────────────────────────────────────
/** Los vigentes primero y los archivados al final; dentro de cada bloque se respeta el orden de la base (los más nuevos arriba). */
export function sortCoupons(coupons: readonly Coupon[]): Coupon[] {
  return [...coupons.filter((c) => !c.archived), ...coupons.filter((c) => c.archived)];
}

/**
 * Búsqueda por código: lo que escribe la persona se compara tal cual (sin importar mayúsculas) y también normalizado, así
 * «verano 10» encuentra «VERANO-10». Una búsqueda de solo separadores («-») se compara tal cual.
 */
export function filterCoupons(coupons: readonly Coupon[], query: string): Coupon[] {
  const raw = query.trim().toLowerCase();
  if (raw === "") return [...coupons];
  const normalized = normalizeCode(query);
  return coupons.filter(
    (c) =>
      (normalized !== "" && c.codeNormalized.includes(normalized)) ||
      c.code.toLowerCase().includes(raw),
  );
}

/** «5 nov 2026, 14:30» en hora de La Paz; un texto que no es fecha se devuelve tal cual (la pantalla no se rompe). */
export function formatLaPaz(iso: string): string {
  try {
    return formatDateTime(iso, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

/** «2026-11-05 14:30» (La Paz) para el CSV; vacío si no hay fecha o no es válida. */
export const laPazStamp = (iso: string | null): string =>
  iso === null ? "" : toLaPazInputValue(iso).replace("T", " ");

export function validityText(coupon: Pick<Coupon, "startsAt" | "endsAt">): string {
  const { startsAt, endsAt } = coupon;
  const K = "admin.discounts.coupons.validity" as const;
  if (startsAt !== null && endsAt !== null)
    return t(`${K}.range`, { from: formatLaPaz(startsAt), until: formatLaPaz(endsAt) });
  if (startsAt !== null) return t(`${K}.from`, { date: formatLaPaz(startsAt) });
  if (endsAt !== null) return t(`${K}.until`, { date: formatLaPaz(endsAt) });
  return t(`${K}.none`);
}

export function usesText(coupon: Pick<Coupon, "usageLimit">, used: number | null): string {
  const K = "admin.discounts.coupons.uses" as const;
  if (used === null) return t(`${K}.unknown`);
  if (coupon.usageLimit === null) return t(`${K}.unlimited`, { used });
  if (coupon.usageLimit === 1) return t(`${K}.singleUse`, { used });
  return t(`${K}.limited`, { used, limit: coupon.usageLimit });
}

// ── Formulario de un código (a mano) y de su vigencia/tope (edición) ───────────────────────
export interface CouponFormValues {
  code: string;
  isActive: boolean;
  /** Valor de `<input type="datetime-local">` en hora de La Paz ("" = sin fecha). */
  startsAt: string;
  endsAt: string;
  /** Entero ≥ 1 escrito como texto ("" = sin tope). */
  usageLimit: string;
}

export interface CouponFormErrors {
  code?: CodeProblem | "duplicate";
  startsAt?: "invalid";
  endsAt?: "invalid" | "beforeStart";
  usageLimit?: "invalid";
}

export interface CouponFormValue {
  code: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
}

export type CouponFormResult =
  | { ok: true; value: CouponFormValue }
  | { ok: false; errors: CouponFormErrors; duplicateOf?: string };

/** Los mensajes de cada campo (texto ya traducido), listos para `Field`. */
export function couponFieldErrors(
  errors: CouponFormErrors,
  duplicateOf?: string,
): { code?: string; startsAt?: string; endsAt?: string; usageLimit?: string } {
  const K = "admin.discounts.coupons.errors" as const;
  const out: { code?: string; startsAt?: string; endsAt?: string; usageLimit?: string } = {};
  switch (errors.code) {
    case "required":
      out.code = t(`${K}.codeRequired`);
      break;
    case "tooShort":
      out.code = t(`${K}.codeTooShort`);
      break;
    case "tooLong":
      out.code = t(`${K}.codeTooLong`);
      break;
    case "chars":
      out.code = t(`${K}.codeChars`);
      break;
    case "start":
      out.code = t(`${K}.codeStart`);
      break;
    case "duplicate":
      out.code =
        duplicateOf === undefined
          ? t(`${K}.codeDuplicate`)
          : t(`${K}.codeDuplicateOf`, { other: duplicateOf });
      break;
    case undefined:
      break;
  }
  if (errors.startsAt) out.startsAt = t(`${K}.dateInvalid`);
  if (errors.endsAt)
    out.endsAt = errors.endsAt === "beforeStart" ? t(`${K}.endBeforeStart`) : t(`${K}.dateInvalid`);
  if (errors.usageLimit) out.usageLimit = t(`${K}.limitInvalid`);
  return out;
}

export const emptyCouponForm = (): CouponFormValues => ({
  code: "",
  isActive: true,
  startsAt: "",
  endsAt: "",
  usageLimit: "",
});

export const couponFormFrom = (coupon: Coupon): CouponFormValues => ({
  code: coupon.code,
  isActive: coupon.isActive,
  startsAt: toLaPazInputValue(coupon.startsAt),
  endsAt: toLaPazInputValue(coupon.endsAt),
  usageLimit: coupon.usageLimit === null ? "" : String(coupon.usageLimit),
});

function instantOf(local: string): { ok: true; iso: string | null } | { ok: false } {
  try {
    return { ok: true, iso: fromLaPazInputValue(local.trim()) };
  } catch {
    return { ok: false };
  }
}

/**
 * Valida el formulario. Al CREAR se revisa el formato del código y que no choque (ya normalizado) con otro de este descuento,
 * archivados incluidos: la base los compara a todos (los de OTROS descuentos solo los conoce ella y responde con su error).
 * Al EDITAR el código no se toca. El fin debe ser posterior al inicio (la base lo exige).
 */
export function validateCouponForm(
  values: CouponFormValues,
  options: { mode: "create" | "edit"; existing: readonly Coupon[] },
): CouponFormResult {
  const errors: CouponFormErrors = {};
  let duplicateOf: string | undefined;

  if (options.mode === "create") {
    const problem = codeProblem(values.code);
    if (problem) errors.code = problem;
    else {
      const clash = options.existing.find((c) => c.codeNormalized === normalizeCode(values.code));
      if (clash) {
        errors.code = "duplicate";
        duplicateOf = clash.code;
      }
    }
  }

  const starts = instantOf(values.startsAt);
  const ends = instantOf(values.endsAt);
  if (!starts.ok) errors.startsAt = "invalid";
  if (!ends.ok) errors.endsAt = "invalid";
  if (
    starts.ok &&
    ends.ok &&
    starts.iso !== null &&
    ends.iso !== null &&
    Date.parse(ends.iso) <= Date.parse(starts.iso)
  )
    errors.endsAt = "beforeStart";

  let usageLimit: number | null = null;
  const limitText = values.usageLimit.trim();
  if (limitText !== "") {
    if (INT_RE.test(limitText) && Number(limitText) >= 1) usageLimit = Number(limitText);
    else errors.usageLimit = "invalid";
  }

  if (Object.keys(errors).length > 0)
    return { ok: false, errors, ...(duplicateOf !== undefined ? { duplicateOf } : {}) };
  return {
    ok: true,
    value: {
      code: values.code.trim(),
      isActive: values.isActive,
      startsAt: starts.ok ? starts.iso : null,
      endsAt: ends.ok ? ends.iso : null,
      usageLimit,
    },
  };
}

// ── Formulario del generador ───────────────────────────────────────────────────────────────
export interface GenerateFormValues {
  count: string;
  prefix: string;
  length: string;
  singleUse: boolean;
}
export interface GenerateFormErrors {
  count?: "required" | "invalid";
  prefix?: "invalid";
  length?: "invalid";
}
/** Lo que se envía a `generateCouponCodes` (sin el id del descuento). */
export interface GenerateParams {
  count: number;
  prefix: string | null;
  length: number;
  usageLimit: number | null;
}
export type GenerateFormResult =
  { ok: true; value: GenerateParams } | { ok: false; errors: GenerateFormErrors };

export const MAX_GENERATED = 500;

export function generateFieldErrors(errors: GenerateFormErrors): {
  count?: string;
  prefix?: string;
  length?: string;
} {
  const K = "admin.discounts.coupons.generate.errors" as const;
  const out: { count?: string; prefix?: string; length?: string } = {};
  if (errors.count)
    out.count = errors.count === "required" ? t(`${K}.countRequired`) : t(`${K}.countInvalid`);
  if (errors.prefix) out.prefix = t(`${K}.prefixInvalid`);
  if (errors.length) out.length = t(`${K}.lengthInvalid`);
  return out;
}
export const emptyGenerateForm = (): GenerateFormValues => ({
  count: "",
  prefix: "",
  length: "8",
  singleUse: false,
});

const wholeNumber = (text: string, min: number, max: number): number | null =>
  INT_RE.test(text) && Number(text) >= min && Number(text) <= max ? Number(text) : null;

/** Réplica de las reglas de `admin_generate_coupon_codes`: 1–500 códigos, largo 6–20 y prefijo de hasta 8 letras o números. */
export function validateGenerateForm(values: GenerateFormValues): GenerateFormResult {
  const errors: GenerateFormErrors = {};
  const countText = values.count.trim();
  const count = wholeNumber(countText, 1, MAX_GENERATED);
  if (countText === "") errors.count = "required";
  else if (count === null) errors.count = "invalid";

  const prefix = values.prefix.trim();
  if (!/^[A-Za-z0-9]{0,8}$/.test(prefix)) errors.prefix = "invalid";

  const length = wholeNumber(values.length.trim(), 6, 20);
  if (length === null) errors.length = "invalid";

  if (Object.keys(errors).length > 0 || count === null || length === null)
    return { ok: false, errors };
  return {
    ok: true,
    value: {
      count,
      prefix: prefix === "" ? null : prefix,
      length,
      usageLimit: values.singleUse ? 1 : null,
    },
  };
}

// ── CSV ────────────────────────────────────────────────────────────────────────────────────
export type CouponCsvRow = Pick<Coupon, "code" | "usageLimit" | "startsAt" | "endsAt">;

/** Código, tope de usos y vigencia (hora de La Paz) de cada código; sin tope o sin fecha, la celda va vacía. */
export function couponsCsv(coupons: readonly CouponCsvRow[]): string {
  const K = "admin.discounts.coupons.csv" as const;
  return toCsv([
    [t(`${K}.code`), t(`${K}.limit`), t(`${K}.startsAt`), t(`${K}.endsAt`)],
    ...coupons.map((c) => [
      c.code,
      c.usageLimit === null ? "" : String(c.usageLimit),
      laPazStamp(c.startsAt),
      laPazStamp(c.endsAt),
    ]),
  ]);
}

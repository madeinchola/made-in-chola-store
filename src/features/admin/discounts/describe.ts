import { t } from "@/i18n";
import { toLaPazInputValue } from "@/lib/datetime";
import { formatAmount } from "../shipping/RatesLogic";
import type { Discount, DiscountScope } from "./types";

/**
 * Frases en lenguaje claro para el listado y la vista previa del asistente. Son funciones puras: lo que dicen sale de los
 * valores del descuento (nunca de promesas de la pantalla), con los números EXACTOS que se guardarían.
 */

/** Lo mínimo de un descuento que hace falta para describirlo (el asistente lo arma aun a medio llenar). */
export type Describable = Pick<
  Discount,
  | "kind"
  | "params"
  | "scope"
  | "currency"
  | "minOrderAmount"
  | "customerGroupId"
  | "requiresCoupon"
  | "stackableWithAutomatic"
  | "excludeSaleItems"
  | "usageLimitTotal"
  | "usageLimitPerCustomer"
  | "startsAt"
  | "endsAt"
>;

/** Los nombres que la pantalla conoce y el descuento solo guarda como identificadores. */
export interface DiscountNames {
  /**
   * Nombres de los productos, categorías o colecciones a los que alcanza. `null` = no se pudieron leer: se habla de «los
   * elegidos» sin inventar cuántos. Una lista vacía significa «todavía no se eligió ninguno».
   */
  targets: readonly string[] | null;
  /** Cuántos objetivos hay cuando se sabe pero no sus nombres (los productos en el listado). */
  targetCount?: number;
  /** Nombre del grupo de clientes del precio por tipo de cliente. */
  group: string | null;
}

const D = "admin.discounts.list.describe" as const;
const MAX_NAMES = 3;

type TargetScope = Exclude<DiscountScope, "order">;

/** Porcentaje con coma decimal: 10 → «10 %», 12.5 → «12,5 %». */
export const formatPercent = (value: number): string =>
  t(`${D}.percent`, { value: String(value).replace(".", ",") });

/** «A», «A, B y C» (sin tope: para listas cortas que se muestran enteras). */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return t(`${D}.join.and`, {
    head: items.slice(0, -1).join(", "),
    last: items[items.length - 1] as string,
  });
}

/** Hasta tres nombres; el resto se resume: «A, B, C y 2 más». */
function joinNames(names: readonly string[], total: number): string {
  const shown = names.slice(0, MAX_NAMES);
  const extra = Math.max(total, names.length) - shown.length;
  if (extra > 0) return t(`${D}.join.more`, { names: shown.join(", "), count: extra });
  return joinAnd(shown);
}

/** Cuántos objetivos hay, o `undefined` si no se sabe. */
function targetTotal(names: DiscountNames): number | undefined {
  if (names.targets !== null && names.targets.length > 0) {
    return Math.max(names.targetCount ?? 0, names.targets.length);
  }
  if (names.targetCount !== undefined) return names.targetCount;
  return names.targets === null ? undefined : 0;
}

/**
 * A qué alcanza el descuento, para dentro de una frase. «Largo»: «los productos de la categoría Verano»; «corto»:
 * «la categoría Verano» (el 2×1 habla de la categoría o la colección, no de «los productos de»).
 */
function scopePhrase(scope: TargetScope, names: DiscountNames, long: boolean): string {
  const given = names.targets ?? [];
  const total = targetTotal(names);
  let phrase: string;
  if (given.length > 0) {
    phrase = t(`${D}.scope.${scope}Named${Math.max(total ?? 0, given.length) === 1 ? "1" : "N"}`, {
      names: joinNames(given, total ?? given.length),
    });
  } else if (total === undefined) {
    phrase = t(`${D}.scope.${scope}Unknown`);
  } else if (total === 0) {
    phrase = t(`${D}.scope.${scope}Pending`);
  } else {
    phrase = t(`${D}.scope.${scope}Count${total === 1 ? "1" : "N"}`, { count: total });
  }
  // Las categorías y colecciones agrupan productos: «los productos de la categoría Verano».
  return long && scope !== "product" ? t(`${D}.scope.productsOf`, { where: phrase }) : phrase;
}

/** El alcance dentro de una frase: «toda la bolsa» o lo que corresponda. */
const wherePhrase = (d: Pick<Describable, "scope">, names: DiscountNames, long = true): string =>
  d.scope === "order" ? t(`${D}.everything`) : scopePhrase(d.scope, names, long);

const inWhere = (d: Pick<Describable, "scope">, names: DiscountNames): string =>
  d.scope === "order" ? "" : t(`${D}.in`, { where: wherePhrase(d, names) });

/** La columna «Alcance» del listado: «Todo el pedido», «Categoría: Verano», «3 productos»… */
export function describeScope(d: Pick<Describable, "scope">, names: DiscountNames): string {
  if (d.scope === "order") return t(`${D}.column.order`);
  const given = names.targets ?? [];
  const total = targetTotal(names);
  if (given.length > 0) {
    return t(`${D}.column.${d.scope}Named${Math.max(total ?? 0, given.length) === 1 ? "1" : "N"}`, {
      names: joinNames(given, total ?? given.length),
    });
  }
  if (total === undefined) return t(`${D}.column.unknown`);
  if (total === 0) return t(`${D}.column.none`);
  return t(`${D}.column.${d.scope}Count${total === 1 ? "1" : "N"}`, { count: total });
}

const monthsShort = (): string[] => t(`${D}.monthsShort`).split("|");

/** Un instante en hora de La Paz: «1 de dic. 06:00» (sin año, para frases) o «1 dic. 2026, 06:00» (con año, para tablas). */
export function formatMoment(iso: string, withYear = false): string {
  const local = toLaPazInputValue(iso); // «2026-12-01T06:00»
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(local);
  if (!match) return iso;
  const [, year = "", month = "", day = "", time = ""] = match;
  const params = {
    day: Number(day),
    month: monthsShort()[Number(month) - 1] ?? month,
    year,
    time,
  };
  return withYear ? t(`${D}.momentYear`, params) : t(`${D}.moment`, params);
}

/** «Vale del 1 de dic. 06:00 al 5 de dic. 18:00 (hora de La Paz)», o que no tiene fechas. */
export function describeWindow(d: Pick<Describable, "startsAt" | "endsAt">): string {
  const { startsAt, endsAt } = d;
  if (startsAt === null && endsAt === null) return t(`${D}.window.always`);
  if (startsAt !== null && endsAt === null) {
    return t(`${D}.window.from`, { date: formatMoment(startsAt) });
  }
  if (startsAt === null && endsAt !== null) {
    return t(`${D}.window.until`, { date: formatMoment(endsAt) });
  }
  return t(`${D}.window.range`, {
    from: formatMoment(startsAt as string),
    to: formatMoment(endsAt as string),
  });
}

export interface DiscountDescription {
  /** Lo que hace el descuento, con el mínimo y el tope si los tiene. */
  effect: string;
  /** Usos y forma de combinarse con las ofertas. */
  details: string[];
}

/** El efecto del descuento en una frase. */
function describeEffect(d: Describable, names: DiscountNames): string {
  const p = d.params;
  if (p === null) return t(`${D}.unreadable`);
  const money = (value: number) => formatAmount(value, d.currency);
  const code = d.requiresCoupon ? t(`${D}.withCode`) : "";
  const min =
    d.minOrderAmount !== null && d.minOrderAmount > 0
      ? t(`${D}.min`, { amount: money(d.minOrderAmount) })
      : "";
  const cap = (maxAmount: number | null) =>
    maxAmount === null ? "" : t(`${D}.cap`, { amount: money(maxAmount) });

  switch (p.kind) {
    case "percent":
      return (
        t(`${D}.percentOff`, { pct: formatPercent(p.percent), where: wherePhrase(d, names) }) +
        code +
        cap(p.maxAmount) +
        min
      );
    case "fixed":
      return (
        t(`${D}.fixedOff`, { amount: money(p.amount), where: wherePhrase(d, names) }) + code + min
      );
    case "free_shipping":
      // El mínimo es parte de la promesa («desde Bs 200»), no una condición aparte.
      return (
        (d.minOrderAmount !== null && d.minOrderAmount > 0
          ? t(`${D}.freeShippingFrom`, { min: money(d.minOrderAmount) })
          : t(`${D}.freeShippingAll`)) + code
      );
    case "bogo": {
      const gifts = p.take - p.pay;
      return (
        t(`${D}.bogo`, {
          take: p.take,
          pay: p.pay,
          where: wherePhrase(d, names, false),
          gift: gifts === 1 ? t(`${D}.giftOne`) : t(`${D}.giftMany`, { count: gifts }),
        }) + min
      );
    }
    case "volume": {
      const tiers = [...p.tiers].sort((a, b) => a.minQty - b.minQty);
      const parts = tiers.map((tier, i) =>
        t(i === 0 ? `${D}.tierFirst` : `${D}.tierNext`, {
          pct: formatPercent(tier.percent),
          qty: tier.minQty,
        }),
      );
      return joinAnd(parts) + inWhere(d, names) + min;
    }
    case "group_price": {
      const pct = formatPercent(p.percent);
      const text =
        names.group !== null
          ? t(`${D}.groupNamed`, { pct, group: names.group })
          : d.customerGroupId !== null
            ? t(`${D}.groupUnknown`, { pct })
            : t(`${D}.groupPending`, { pct });
      return text + inWhere(d, names) + cap(p.maxAmount) + min;
    }
    case "flash": {
      const pct = formatPercent(p.percent);
      const where = inWhere(d, names);
      const text =
        d.startsAt !== null && d.endsAt !== null
          ? t(`${D}.flash`, {
              pct,
              inWhere: where,
              from: formatMoment(d.startsAt),
              to: formatMoment(d.endsAt),
            })
          : t(`${D}.flashNoDates`, { pct, inWhere: where });
      return text + cap(p.maxAmount) + min;
    }
    case "first_purchase": {
      const pct = formatPercent(p.percent);
      const text =
        d.scope === "order"
          ? t(`${D}.firstPurchase`, { pct })
          : t(`${D}.firstPurchaseIn`, { pct, where: wherePhrase(d, names) });
      return text + code + cap(p.maxAmount) + min;
    }
  }
}

/** Usos máximos y forma de combinarse: lo que se agrega a la frase principal. */
function describeDetails(d: Describable): string[] {
  const details: string[] = [];
  if (d.usageLimitTotal !== null) {
    details.push(
      d.usageLimitTotal === 1
        ? t(`${D}.limitTotalOne`)
        : t(`${D}.limitTotalMany`, { count: d.usageLimitTotal }),
    );
  }
  if (d.usageLimitPerCustomer !== null) {
    details.push(t(`${D}.limitPerCustomer`, { count: d.usageLimitPerCustomer }));
  }
  // Solo un cupón que descuenta producto se combina (o no) con las ofertas; el envío gratis se resuelve aparte.
  if (d.requiresCoupon && d.kind !== "free_shipping") {
    details.push(d.stackableWithAutomatic ? t(`${D}.stacks`) : t(`${D}.noStack`));
    if (d.excludeSaleItems) details.push(t(`${D}.excludeSale`));
  }
  return details;
}

export function describeParts(d: Describable, names: DiscountNames): DiscountDescription {
  return { effect: describeEffect(d, names), details: describeDetails(d) };
}

/** La frase completa: «10 % en toda la bolsa con el código · máx. 100 usos · 1 por clienta · se suma a las ofertas». */
export function describeDiscount(d: Describable, names: DiscountNames): string {
  const { effect, details } = describeParts(d, names);
  return [effect, ...details].join(t(`${D}.separator`));
}

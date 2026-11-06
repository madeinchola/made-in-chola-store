import { t } from "@/i18n";
import { formatCartMoney } from "./format";
import type { DisplayLine } from "./selectors";
import type { CartLimits, ItemResult } from "./types";

export type NoticeTone = "info" | "warning" | "danger";
export type NoticeActionKind = "remove" | "adjust" | "accept";

/** Un aviso ya decidido (qué decir, con qué gravedad y qué botón ofrecer). La pantalla solo lo pinta. */
export interface NoticeSpec {
  key: string;
  tone: NoticeTone;
  /** Impide pagar: se anuncia como alerta (`role="alert"`); si no, entra en la región viva (`NoticeRegion`). */
  blocking: boolean;
  message: string;
  action?: { kind: NoticeActionKind; label: string };
  /** El aviso viene de un resultado (`state.results`) y se puede cerrar. */
  dismissible?: boolean;
}

/** La tienda vende en Bolivia: el día de la garantía es el de allá (UTC−4), no el del navegador ni el de UTC. */
let guaranteeDay: Intl.DateTimeFormat | null | undefined;

/**
 * «10 de noviembre»: el día (en hora de Bolivia) en que vence la garantía de precio (`price_locked_until`, un instante en
 * UTC). Null si no es una fecha válida o el entorno no conoce la zona horaria: el aviso se dice entonces sin fecha en vez
 * de escribir «Invalid Date» (o de romper la carga del módulo).
 */
export function formatGuaranteeDate(iso: string): string | null {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return null;
  if (guaranteeDay === undefined) {
    try {
      guaranteeDay = new Intl.DateTimeFormat("es-BO", {
        day: "numeric",
        month: "long",
        timeZone: "America/La_Paz",
      });
    } catch {
      guaranteeDay = null;
    }
  }
  return guaranteeDay ? guaranteeDay.format(instant) : null;
}

/** Avisos de la propia línea (estado y precio). Todo viene decidido por el servidor: aquí solo se traduce a texto. */
function statusNotices(line: DisplayLine, currency: string): NoticeSpec[] {
  const specs: NoticeSpec[] = [];
  const remove = { kind: "remove", label: t("cart.line.remove") } as const;

  if (line.status === "unavailable") {
    specs.push({
      key: "status",
      tone: "danger",
      blocking: line.blocking,
      message: t("cart.notice.unavailable"),
      action: remove,
    });
    return specs;
  }
  if (line.status === "out_of_stock") {
    specs.push({
      key: "status",
      tone: "danger",
      blocking: line.blocking,
      message: t("cart.notice.outOfStock"),
      action: remove,
    });
    return specs;
  }
  if (line.status === "low_stock") {
    specs.push({
      key: "status",
      tone: "warning",
      blocking: line.blocking,
      message: t("cart.notice.lowStock", { n: line.available }),
      action:
        line.available > 0
          ? { kind: "adjust", label: t("cart.notice.adjustTo", { n: line.available }) }
          : remove,
    });
  }

  const accept = { kind: "accept", label: t("cart.notice.acceptPrice") } as const;
  const guaranteedUntil = formatGuaranteeDate(line.price_locked_until);
  switch (line.price_notice) {
    case "dropped":
      specs.push({
        key: "price",
        tone: "info",
        blocking: false,
        message: t("cart.notice.priceDropped", {
          price: formatCartMoney(line.unit_price, currency),
        }),
      });
      break;
    case "guaranteed":
      specs.push({
        key: "price",
        tone: "info",
        blocking: false,
        // Dice hasta cuándo: sin la fecha, «te respetamos el precio» no permite saber cuánto se puede esperar.
        message: guaranteedUntil
          ? t("cart.notice.priceGuaranteedUntil", { date: guaranteedUntil })
          : t("cart.notice.priceGuaranteed"),
      });
      break;
    case "expired_raised":
      specs.push({
        key: "price",
        tone: "warning",
        blocking: true,
        message: t("cart.notice.priceRaised", {
          price: formatCartMoney(line.current_price ?? line.unit_price, currency),
        }),
        action: accept,
      });
      break;
    case "expired_dropped":
      specs.push({
        key: "price",
        tone: "info",
        blocking: false,
        message: t("cart.notice.priceLowered", {
          price: formatCartMoney(line.current_price ?? line.unit_price, currency),
        }),
        action: accept,
      });
      break;
    case null:
      break;
  }
  return specs;
}

/** Aviso del último cambio pedido sobre esta línea (se ajustó la cantidad, hay un tope…). Null si no hace falta. */
function resultNotice(
  line: DisplayLine,
  result: ItemResult | undefined,
  limits: CartLimits,
): NoticeSpec | null {
  if (!result) return null;
  const base = { key: "result", tone: "warning", blocking: false, dismissible: true } as const;
  switch (result.outcome) {
    case "adjusted":
      return {
        ...base,
        message:
          result.applied === 1
            ? t("cart.result.adjustedOne")
            : t("cart.result.adjustedMany", { n: result.applied }),
      };
    case "capped_variant":
      return {
        ...base,
        message: t("cart.result.cappedVariant", { n: limits.max_qty_per_variant }),
      };
    case "capped_units":
      return {
        ...base,
        message: t("cart.result.cappedUnits", { max: limits.max_units, n: result.applied }),
      };
    case "limit_lines":
      return { ...base, message: t("cart.result.limitLines", { max: limits.max_lines }) };
    case "limit_units":
      return { ...base, message: t("cart.result.limitUnits", { max: limits.max_units }) };
    case "out_of_stock":
      // Si la línea ya muestra «Se agotó», repetirlo sería ruido.
      return line.status === "out_of_stock"
        ? null
        : { ...base, message: t("cart.result.outOfStock") };
    case "unavailable":
      return line.status === "unavailable"
        ? null
        : { ...base, message: t("cart.result.unavailable") };
    case "token_retired":
      return { ...base, message: t("cart.result.tokenRetired") };
    case "ok":
    case "removed":
      return null;
  }
}

/** Todos los avisos de una línea, en el orden en que se muestran (estado y precio primero, luego el último cambio). */
export function lineNotices(
  line: DisplayLine,
  result: ItemResult | undefined,
  currency: string,
  limits: CartLimits,
): NoticeSpec[] {
  const specs = statusNotices(line, currency);
  const fromResult = resultNotice(line, result, limits);
  if (fromResult) specs.push(fromResult);
  return specs;
}

/**
 * Aviso de un cambio que NO dejó ninguna línea (no se pudo agregar: tope de productos, agotado…). Como no hay línea a la
 * que colgarlo ni nombre de producto, el texto es genérico y va arriba de la lista.
 */
export function orphanNotice(result: ItemResult, limits: CartLimits | null): NoticeSpec | null {
  const prefix = t("cart.orphan.prefix");
  const base = { key: "orphan", tone: "warning", blocking: false, dismissible: true } as const;
  switch (result.outcome) {
    case "ok":
    case "removed":
      return null;
    case "token_retired":
      return { ...base, message: t("cart.result.tokenRetired") };
    case "out_of_stock":
      return { ...base, message: `${prefix} ${t("cart.orphan.outOfStock")}` };
    case "unavailable":
      return { ...base, message: `${prefix} ${t("cart.orphan.unavailable")}` };
    case "limit_lines":
      return {
        ...base,
        message: `${prefix} ${limits ? t("cart.orphan.limitLines", { max: limits.max_lines }) : t("cart.orphan.generic")}`,
      };
    case "limit_units":
    case "capped_units":
      return {
        ...base,
        message: `${prefix} ${limits ? t("cart.orphan.limitUnits", { max: limits.max_units }) : t("cart.orphan.generic")}`,
      };
    case "adjusted":
    case "capped_variant":
      return { ...base, message: `${prefix} ${t("cart.orphan.generic")}` };
  }
}

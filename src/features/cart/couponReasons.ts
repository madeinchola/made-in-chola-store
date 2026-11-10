import { t, type MessageKey } from "@/i18n";
import { formatCartMoney } from "./format";
import type { CouponClientReason, CouponReason } from "./types";

/** Todo motivo por el que un cupón no se aplica: los del servidor (`COUPON_REASONS`) y los que pone el cliente. */
export type CouponAnyReason = CouponReason | CouponClientReason;

/**
 * Motivo → clave del texto. El tipo `Record` obliga a escribir el texto en cuanto se agrega un motivo a `COUPON_REASONS` (o
 * a `CouponClientReason`): sin él, `tsc` falla; y la prueba recorre `COUPON_REASONS` y falla si falta la entrada o la clave
 * no resuelve a un texto. Nunca hay un «caso por omisión» que pase desapercibido.
 */
export const COUPON_REASON_KEYS: Record<CouponAnyReason, MessageKey> = {
  invalid_code: "cart.coupon.reason.invalid_code",
  expired: "cart.coupon.reason.expired",
  wrong_currency: "cart.coupon.reason.wrong_currency",
  login_required: "cart.coupon.reason.login_required",
  sold_out: "cart.coupon.reason.sold_out",
  already_used: "cart.coupon.reason.already_used",
  not_first_purchase: "cart.coupon.reason.not_first_purchase",
  not_eligible_customer: "cart.coupon.reason.not_eligible_customer",
  not_applicable: "cart.coupon.reason.not_applicable",
  min_not_reached: "cart.coupon.reason.min_not_reached",
  not_combinable: "cart.coupon.reason.not_combinable",
  coupon_already_applied: "cart.coupon.reason.coupon_already_applied",
  unavailable: "cart.coupon.reason.unavailable",
  rate_limited: "cart.coupon.reason.rate_limited",
};

/**
 * El texto de un motivo. `missing` es lo que falta para el mínimo (importe del servidor, solo con `min_not_reached`): sin
 * un número válido no se inventa uno, se dice sin cifra. Un motivo que este código no conoce (un servidor más nuevo) se lee
 * como «no pudimos aplicar el cupón», nunca como un hueco.
 */
export function couponReasonText(
  reason: CouponAnyReason | null,
  missing: number | null,
  currency: string,
): string {
  // `hasOwn`: un motivo raro del servidor («constructor», «toString») no debe resolver a algo heredado del prototipo.
  const known = reason !== null && Object.prototype.hasOwnProperty.call(COUPON_REASON_KEYS, reason);
  if (!known) return t(COUPON_REASON_KEYS.unavailable);
  const key = COUPON_REASON_KEYS[reason];
  if (reason === "min_not_reached") {
    if (missing === null || !Number.isFinite(missing) || missing <= 0) {
      return t("cart.coupon.minUnknown");
    }
    return t(key, { missing: formatCartMoney(missing, currency) });
  }
  return t(key);
}

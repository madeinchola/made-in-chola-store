import { forwardRef } from "react";
import { t } from "@/i18n";
import { formatCartMoney } from "@/features/cart/format";
import { ChoiceCard } from "./ChoiceCard";
import type { PaymentMethodOption } from "./types";

/**
 * «Pago»: los métodos los dirige la configuración por país (BR-PAY-02). Uno no disponible (tope de monto, restricción de la
 * cuenta) sigue en la lista, deshabilitado y con el motivo en palabras. Nunca se dice POR QUÉ una cuenta no puede usar uno.
 */
export const PaymentSection = forwardRef<
  HTMLHeadingElement,
  {
    methods: readonly PaymentMethodOption[] | undefined;
    loading: boolean;
    selected: string | undefined;
    currency: string;
    error: string | undefined;
    onSelect: (code: string) => void;
  }
>(function PaymentSection({ methods, loading, selected, currency, error, onSelect }, headingRef) {
  return (
    <section aria-labelledby="checkout-payment" className="space-y-3">
      <h2
        id="checkout-payment"
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-display-sm"
      >
        {t("checkout.payment.title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("checkout.payment.secure")}</p>
      {loading && !methods ? (
        <p className="text-sm text-muted-foreground">{t("checkout.payment.loading")}</p>
      ) : !methods || methods.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("checkout.payment.none")}</p>
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="sr-only">{t("checkout.payment.legend")}</legend>
          {methods.map((method) => (
            <ChoiceCard
              key={method.code}
              name="checkout-payment"
              checked={selected === method.code}
              disabled={!method.available}
              onChange={() => onSelect(method.code)}
              title={method.name}
              detail={
                <>
                  {method.description}
                  {!method.available && (
                    <span className="block font-medium text-foreground">
                      {method.reason === "over_max_amount" && method.max_amount !== null
                        ? `${t("checkout.payment.unavailableOverAmount")} (${formatCartMoney(method.max_amount, currency)})`
                        : t("checkout.payment.unavailable")}
                    </span>
                  )}
                  {method.available && method.window_minutes !== null && (
                    <span className="block">
                      {t("checkout.payment.window", { minutes: method.window_minutes })}
                    </span>
                  )}
                </>
              }
            />
          ))}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
});

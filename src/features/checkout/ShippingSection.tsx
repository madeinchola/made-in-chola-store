import { forwardRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { Address } from "@/features/account/addresses/types";
import { formatCartMoney } from "@/features/cart/format";
import { formatEta } from "@/features/shipping/estimate";
import type { ScheduleChoice } from "@/features/shipping/destination";
import { DeliverySlotPicker } from "@/features/shipping/DeliverySlotPicker";
import { parseQuote } from "@/features/shipping/quote";
import { t } from "@/i18n";
import { ChoiceCard } from "./ChoiceCard";
import type { ShippingMethodOption } from "./checkoutHooks";
import type { CheckoutPreview } from "./types";

const hasPin = (address: Pick<Address, "lat" | "lng">) =>
  address.lat !== null && address.lng !== null;

/** Lo que se muestra a la derecha de la forma de entrega elegida: su costo YA calculado por el servidor. */
function costAside(preview: CheckoutPreview | undefined, pickup: boolean): string | null {
  if (!preview) return null;
  const { shipping, shipping_discount } = preview.totals;
  if (pickup) return t("checkout.delivery.pickupFree");
  if (shipping === null) return null;
  if (shipping > 0 && shipping_discount >= shipping) return t("checkout.delivery.shippingFree");
  return formatCartMoney(shipping, preview.currency);
}

export const ShippingSection = forwardRef<
  HTMLHeadingElement,
  {
    methods: readonly ShippingMethodOption[] | undefined;
    methodsLoading: boolean;
    methodsError: boolean;
    method: string | undefined;
    onMethod: (code: string) => void;
    addresses: readonly Address[] | undefined;
    addressesLoading: boolean;
    addressesError: boolean;
    addressId: string | undefined;
    onAddress: (id: string) => void;
    onAddAddress: () => void;
    onLocateAddress: (address: Address) => void;
    preview: CheckoutPreview | undefined;
    schedule: ScheduleChoice | null;
    onSchedule: (choice: ScheduleChoice | null) => void;
    /** Mensajes de error de las secciones de entrega y franja (del servidor). */
    deliveryErrors: readonly string[];
    scheduleErrors: readonly string[];
  }
>(function ShippingSection(props, headingRef) {
  const { methods, method, addresses, addressId, preview, schedule } = props;
  const current = methods?.find((m) => m.code === method);
  const isDelivery = current?.kind === "delivery";
  // Una cotización mal formada NO tira abajo el checkout: se ignora (sin franjas) y el servidor sigue siendo quien valida.
  const quote = useMemo(() => {
    if (!preview?.shipping.quote) return null;
    try {
      return parseQuote(preview.shipping.quote);
    } catch {
      return null;
    }
  }, [preview]);
  const slots = quote?.slots ?? [];

  return (
    <section aria-labelledby="checkout-delivery" className="space-y-5">
      <h2
        id="checkout-delivery"
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-display-sm"
      >
        {t("checkout.delivery.title")}
      </h2>

      {props.methodsLoading ? (
        <p className="text-sm text-muted-foreground">{t("checkout.delivery.methodsLoading")}</p>
      ) : props.methodsError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("checkout.delivery.methodsError")}
        </p>
      ) : !methods || methods.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("checkout.delivery.methodsEmpty")}</p>
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="mb-2 text-sm font-medium">
            {t("checkout.delivery.methodLegend")}
          </legend>
          {methods.map((option) => {
            const eta = formatEta(option.etaMin, option.etaMax);
            const place =
              option.kind === "pickup"
                ? [option.pickupName, option.pickupAddress, option.pickupCity]
                    .filter(Boolean)
                    .join(", ")
                : null;
            return (
              <ChoiceCard
                key={option.code}
                name="checkout-shipping-method"
                checked={method === option.code}
                onChange={() => props.onMethod(option.code)}
                title={option.name}
                detail={
                  <>
                    {option.description}
                    {place && (
                      <span className="block">{t("checkout.delivery.pickupAt", { place })}</span>
                    )}
                    {option.kind === "pickup" && option.pickupHours && (
                      <span className="block">{option.pickupHours}</span>
                    )}
                    {eta && <span className="block">{eta}</span>}
                  </>
                }
                aside={method === option.code ? costAside(preview, option.kind === "pickup") : null}
              />
            );
          })}
        </fieldset>
      )}

      {isDelivery && (
        <div className="space-y-3">
          {props.addressesLoading ? (
            <p className="text-sm text-muted-foreground">
              {t("checkout.delivery.addressesLoading")}
            </p>
          ) : props.addressesError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("checkout.delivery.addressesError")}
            </p>
          ) : !addresses || addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("checkout.delivery.noAddresses")}</p>
          ) : (
            <fieldset className="min-w-0 space-y-2">
              <legend className="mb-2 text-sm font-medium">
                {t("checkout.delivery.addressLegend")}
              </legend>
              {addresses.map((address) => (
                <div key={address.id} className="space-y-1">
                  <ChoiceCard
                    name="checkout-address"
                    checked={addressId === address.id}
                    onChange={() => props.onAddress(address.id)}
                    title={address.label}
                    detail={
                      <>
                        <span className="block">{address.recipient}</span>
                        <span className="block">
                          {[address.line1, address.line2, address.city].filter(Boolean).join(", ")}
                        </span>
                        {!hasPin(address) && (
                          <span className="block font-medium text-foreground">
                            {t("checkout.delivery.noPin")}
                          </span>
                        )}
                      </>
                    }
                  />
                  {!hasPin(address) && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => props.onLocateAddress(address)}
                    >
                      {t("checkout.delivery.editAddress", { label: address.label })}
                    </Button>
                  )}
                </div>
              ))}
            </fieldset>
          )}
          <Button type="button" variant="outline" className="min-h-11" onClick={props.onAddAddress}>
            {t("checkout.delivery.addAddress")}
          </Button>
        </div>
      )}

      <div aria-live="polite" className="space-y-1">
        {props.deliveryErrors.map((message) => (
          <p key={message} className="text-sm text-destructive">
            {message}
          </p>
        ))}
      </div>

      {isDelivery && slots.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{t("checkout.delivery.scheduleTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("checkout.delivery.scheduleHelp")}</p>
          <DeliverySlotPicker slots={slots} choice={schedule} onChoose={props.onSchedule} />
          {schedule && (
            <Button
              type="button"
              variant="link"
              className="min-h-11 px-0"
              onClick={() => props.onSchedule(null)}
            >
              {t("checkout.delivery.scheduleNone")}
            </Button>
          )}
          <div aria-live="polite" className="space-y-1">
            {props.scheduleErrors.map((message) => (
              <p key={message} className="text-sm text-destructive">
                {message}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
});

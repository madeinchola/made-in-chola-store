import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import type { CartState } from "./cartStore";
import { couponReasonText } from "./couponReasons";
import { formatCartMoney } from "./format";
import { discountsOf } from "./selectors";

/** Largo máximo de un código (el mismo que corta el servidor). */
const MAX_CODE_LENGTH = 40;

/** Qué se ve: el formulario, un cupón que ya baja algo, o uno guardado que hoy no baja nada (con su motivo). */
type Mode = "form" | "applied" | "saved";

const modeOf = (state: CartState): Mode => {
  const { status } = discountsOf(state.snapshot).coupon;
  return status === "applied" ? "applied" : status === "rejected" ? "saved" : "form";
};

/** Adónde va el foco cuando el control que lo tenía desaparece (o cuando el rechazo pide corregir el código). */
type FocusTarget = "field" | "card";

/**
 * «¿Tienes un cupón?» (S9), en el resumen de la bolsa. El servidor decide TODO (si el código existe, si vale, cuánto baja):
 * aquí solo se escribe el código, se pide aplicarlo o quitarlo (`store.applyCoupon` / `store.removeCoupon`) y se muestra lo
 * que la foto del servidor dice (`snapshot.discounts.coupon`) o el rechazo (`state.coupon.notice`). Ningún importe se calcula.
 *
 * Estados: sin cupón (campo + «Aplicar») · cupón aplicado (nombre, código, lo que baja y «Quitar») · cupón GUARDADO que hoy no
 * baja nada (motivo, p. ej. «Te faltan Bs 50,00…», y «Quitar») · rechazo sin guardar (mensaje junto al campo, `role="alert"`,
 * el texto se conserva y el foco vuelve al campo).
 *
 * Accesibilidad: una región viva PERSISTENTE (siempre montada, su texto cambia) dice «Cupón aplicado…» / «Cupón quitado»;
 * cuando el control que tenía el foco desaparece (el campo al aplicar, «Quitar» al quitar) el foco pasa a la tarjeta del cupón
 * o al campo; todos los controles miden al menos 44 px y nada depende solo del color.
 */
export function CouponForm({ className }: { className?: string }) {
  const { state, store } = useCart();
  const ids = useId();
  const inputId = `${ids}-code`;
  const errorId = `${ids}-error`;
  const titleId = `${ids}-title`;
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLParagraphElement>(null);
  const [code, setCode] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);

  // El foco se mueve DESPUÉS de pintar: la tarjeta o el campo ya existen cuando esto corre (el cambio sale del almacén, que ya
  // tiene el estado nuevo antes de que se pida este).
  useEffect(() => {
    if (focusTarget === null) return;
    (focusTarget === "field" ? inputRef : cardRef).current?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const snapshot = state.snapshot;
  if (!snapshot) return null;

  const { currency } = snapshot;
  const discounts = discountsOf(snapshot);
  const coupon = discounts.coupon;
  const mode = modeOf(state);
  const busy = state.coupon.busy;
  const notice = state.coupon.notice;
  const noticeText = notice ? couponReasonText(notice.reason, notice.missing, currency) : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // El estado se lee del almacén (no de este render): un segundo Intro antes de repintar no manda otra petición.
    if (store.getState().coupon.busy || code.trim() === "") return;
    setAnnouncement("");
    await store.applyCoupon(code);
    const after = store.getState();
    if (after.coupon.notice) {
      // El texto escrito se conserva para corregirlo; el foco vuelve al campo (si venía del botón, no se queda en el aire).
      setFocusTarget("field");
      return;
    }
    const placed = discountsOf(after.snapshot).coupon;
    const currencyNow = after.snapshot?.currency ?? currency;
    setCode("");
    if (modeOf(after) === "applied") {
      setAnnouncement(t("cart.coupon.announceApplied", { name: placed.name ?? placed.code ?? "" }));
      setFocusTarget("card");
    } else if (modeOf(after) === "saved") {
      // Guardado pero sin efecto hoy (p. ej. mínimo no alcanzado): se dice por qué, no un «aplicado» que no es cierto.
      setAnnouncement(
        t("cart.coupon.announceSaved", {
          code: placed.code ?? "",
          reason: couponReasonText(placed.reason, placed.missing, currencyNow),
        }),
      );
      setFocusTarget("card");
    }
  };

  const remove = async () => {
    if (store.getState().coupon.busy) return;
    setAnnouncement("");
    await store.removeCoupon();
    // Solo si de verdad se quitó: si falló (sin conexión), «Quitar» sigue ahí con el foco y el aviso de conexión lo explica.
    if (modeOf(store.getState()) === "form") {
      setAnnouncement(t("cart.coupon.announceRemoved"));
      setFocusTarget("field");
    }
  };

  const edit = (event: ChangeEvent<HTMLInputElement>) => {
    setCode(event.target.value);
    // Quien corrige el código ya leyó el rechazo: se retira (no queda un error de lo que ya cambió).
    if (store.getState().coupon.notice) store.dismissCouponNotice();
  };

  // Lo que baja el CUPÓN (su propia entrada en `applied`); si el servidor no la separa, lo que baja la bolsa en total.
  const own = discounts.applied.find((entry) => entry.coupon_id !== null);
  const saving =
    own?.free_shipping === true
      ? t("cart.coupon.freeShipping")
      : own && own.amount > 0
        ? t("cart.coupon.saves", { amount: formatCartMoney(own.amount, currency) })
        : snapshot.totals.discount !== null
          ? t("cart.coupon.saves", { amount: formatCartMoney(snapshot.totals.discount, currency) })
          : discounts.free_shipping
            ? t("cart.coupon.freeShipping")
            : null;

  const removeButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      loading={busy}
      aria-label={t("cart.coupon.removeLabel", { code: coupon.code ?? "" })}
      onClick={() => void remove()}
      className="min-h-11 shrink-0 px-3"
    >
      {t("cart.coupon.remove")}
    </Button>
  );

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={cn("space-y-3 border-t border-border pt-5", className)}
    >
      <h3 id={titleId} className="eyebrow">
        {mode === "form" ? t("cart.coupon.title") : t("cart.coupon.titleActive")}
      </h3>
      {/* Siempre montada (vacía hasta que hay algo que decir): un lector de pantalla anuncia lo que ENTRA en una región viva
          que ya existía, no la que nace con su texto. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      {mode === "form" ? (
        <form onSubmit={(event) => void submit(event)} noValidate className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium">
            {t("cart.coupon.label")}
          </label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              ref={inputRef}
              type="text"
              value={code}
              onChange={edit}
              maxLength={MAX_CODE_LENGTH}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              readOnly={busy}
              aria-invalid={notice ? true : undefined}
              aria-describedby={notice ? errorId : undefined}
              className="h-11 min-h-11 min-w-0 flex-1"
            />
            <Button
              type="submit"
              loading={busy}
              disabled={code.trim() === ""}
              className="min-h-11 shrink-0 px-5"
            >
              {t("cart.coupon.apply")}
            </Button>
          </div>
          {noticeText && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {noticeText}
            </p>
          )}
        </form>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
            <div className="min-w-0 space-y-0.5">
              {mode === "applied" ? (
                <>
                  <p ref={cardRef} tabIndex={-1} className="break-words font-medium">
                    {coupon.name ?? coupon.code ?? ""}
                  </p>
                  <p className="break-all text-sm text-muted-foreground">
                    {t("cart.coupon.code", { code: coupon.code ?? "" })}
                  </p>
                  {saving && <p className="text-sm text-success">{saving}</p>}
                </>
              ) : (
                <>
                  <p ref={cardRef} tabIndex={-1} className="break-all font-medium">
                    {t("cart.coupon.code", { code: coupon.code ?? "" })}
                  </p>
                  <p className="break-words text-sm text-muted-foreground">
                    {couponReasonText(coupon.reason, coupon.missing, currency)}
                  </p>
                </>
              )}
            </div>
            {removeButton}
          </div>
          {noticeText && (
            <p role="alert" className="text-sm text-destructive">
              {noticeText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

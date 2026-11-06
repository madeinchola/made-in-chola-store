import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Trash2 } from "lucide-react";
import { ImagePlaceholder } from "@/components/store/ImagePlaceholder";
import { QuantityStepper } from "@/components/store/QuantityStepper";
import { Button } from "@/components/ui/button";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import { HEADING_FOCUS, NEIGHBOUR_FOCUS } from "./focus";
import { formatCartMoney, limitReason, maxQtyFor, productHref } from "./format";
import { LineNotice } from "./LineNotice";
import type { DisplayLine } from "./selectors";

interface CartLineItemProps {
  line: DisplayLine;
  /** `compact`: la versión del cajón (foto y tipografía más pequeñas). */
  variant?: "page" | "compact";
}

/**
 * Una línea de la bolsa: foto (marcador provisional mientras no haya fotografía), nombre enlazado a la ficha, color y
 * talla, precio por unidad, total de la línea, cantidad con tope, «Quitar» y los avisos. Los importes salen TAL CUAL del
 * servidor (`unit_price`, `line_total`): aquí solo se les da formato. Mientras hay un cambio en camino (`syncing`) el
 * total se atenúa y aparece un indicador en un hueco reservado, así que nada se mueve.
 */
export function CartLineItem({ line, variant = "page" }: CartLineItemProps) {
  const { state, store, setOpen } = useCart();
  const compact = variant === "compact";
  const hintId = useId();
  const itemRef = useRef<HTMLLIElement>(null);
  const nameRef = useRef<HTMLAnchorElement>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const snapshot = state.snapshot;
  if (!snapshot) return null;

  const { currency, limits } = snapshot;
  const unavailable = line.status === "unavailable" || line.status === "out_of_stock";
  const maxQty = maxQtyFor(line, limits);
  const atMax = line.shownQty >= maxQty;
  const showHint = !unavailable && atMax && maxQty > 0;
  const showImage = line.image_path !== null && !imageFailed;
  const priceDiffers = line.price_notice !== null && line.price_at_add !== line.unit_price;
  const variantParts = [
    line.color_name ? t("cart.line.color", { name: line.color_name }) : null,
    line.size_label ? t("cart.line.size", { label: line.size_label }) : null,
  ].filter((part): part is string => part !== null);

  // Al quitar una línea, el botón que tenía el foco desaparece: el foco pasa a la línea vecina (o al título) para que
  // quien navega con teclado o lector de pantalla no se quede en el aire.
  const quitar = () => {
    const item = itemRef.current;
    const neighbour = (item?.nextElementSibling ??
      item?.previousElementSibling) as HTMLElement | null;
    const target =
      neighbour?.querySelector<HTMLElement>(NEIGHBOUR_FOCUS) ??
      (item?.closest('[role="dialog"]') ?? document).querySelector<HTMLElement>(HEADING_FOCUS);
    store.remove(line.variant_id);
    target?.focus();
  };
  // Tras ajustar o aceptar, el botón del aviso desaparece cuando el servidor responde: el foco vuelve al nombre.
  const ajustar = () => {
    store.setQty(line.variant_id, line.available);
    nameRef.current?.focus();
  };
  const aceptar = () => {
    void store.acceptPrices(line.variant_id);
    nameRef.current?.focus();
  };

  return (
    // Sin `aria-busy`: dentro vive la región viva «Actualizando…», y algunos lectores no anuncian lo que hay en un contenedor
    // ocupado. El indicador visual (atenuado + círculo) y el texto hablado bastan.
    <li
      ref={itemRef}
      className={cn("flex gap-3 border-b border-border", compact ? "py-4" : "gap-4 py-6 sm:gap-6")}
    >
      <Link
        to={productHref(line)}
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={cn(
          "relative block aspect-[5/7] shrink-0 self-start overflow-hidden bg-secondary",
          compact ? "w-16" : "w-20 sm:w-28",
        )}
      >
        {showImage ? (
          <img
            src={productImageUrl(line.image_path as string)}
            alt=""
            width={500}
            height={700}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImagePlaceholder />
        )}
      </Link>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p
              className={cn(
                "break-words font-display leading-snug",
                compact ? "text-base" : "text-lg",
              )}
            >
              <Link
                ref={nameRef}
                // Adonde va el foco cuando se quita la línea de al lado: un ENLACE, nunca un botón destructivo (un segundo
                // Intro, la repetición de tecla o un doble toque quitaría también esa línea).
                data-line-focus=""
                to={productHref(line)}
                onClick={() => setOpen(false)}
                className="rounded-sm hover:underline"
              >
                {line.name}
              </Link>
            </p>
            {variantParts.length > 0 && (
              <p className="break-words text-sm text-muted-foreground">
                {variantParts.join(" · ")}
              </p>
            )}
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums">
              {priceDiffers && (
                <s className="text-muted-foreground">
                  <span className="sr-only">{t("cart.line.priceAtAdd")} </span>
                  {formatCartMoney(line.price_at_add, currency)}
                </s>
              )}
              <span>
                <span className="sr-only">{t("cart.line.unitPrice")} </span>
                {formatCartMoney(line.unit_price, currency)}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Hueco reservado: el indicador aparece sin mover nada. */}
            <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center">
              {line.syncing && <Loader2 className="h-4 w-4 animate-spin" />}
            </span>
            <p className={cn("font-medium tabular-nums", line.syncing && "opacity-60")}>
              <span className="sr-only">{t("cart.line.total")} </span>
              {formatCartMoney(line.line_total, currency)}
            </p>
            <span role="status" className="sr-only">
              {line.syncing ? t("cart.line.updating") : ""}
            </span>
          </div>
        </div>

        <LineNotice line={line} onRemove={quitar} onAdjust={ajustar} onAccept={aceptar} />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {unavailable ? (
            <p className="text-sm text-muted-foreground">
              {t("cart.line.quantity", { n: line.shownQty })}
            </p>
          ) : (
            <QuantityStepper
              value={line.shownQty}
              min={1}
              max={Math.max(maxQty, line.shownQty)}
              increaseDescribedBy={showHint ? hintId : undefined}
              labels={{
                group: t("cart.line.quantityOf", { name: line.name }),
                input: t("cart.line.quantityOf", { name: line.name }),
                decrease: t("cart.line.decreaseOf", { name: line.name }),
                increase: t("cart.line.increaseOf", { name: line.name }),
                live: (n) => t("cart.line.quantityLive", { name: line.name, n }),
              }}
              onChange={(next) => store.setQty(line.variant_id, next)}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("cart.line.removeLabel", { name: line.name })}
            onClick={quitar}
            className="min-h-11 gap-1.5 px-3"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            {t("cart.line.remove")}
          </Button>
        </div>
        {showHint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {limitReason(line, limits) === "stock"
              ? t("cart.line.limitStock")
              : t("cart.line.limitVariant", { max: limits.max_qty_per_variant })}
          </p>
        )}
      </div>
    </li>
  );
}

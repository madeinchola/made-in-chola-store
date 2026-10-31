import type { MouseEvent } from "react";
import { buttonVariants } from "@/components/ui/button-variants";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PurchaseState } from "./variantSelection";

interface PurchaseButtonProps {
  state: PurchaseState;
  /** Enlace `wa.me` ya armado; null si no hay WhatsApp configurado o inválido. */
  whatsappHref: string | null;
  className?: string;
}

const base = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-[4.25rem] w-full border-[1.5px] border-foreground text-base",
);

const blocked = (event: MouseEvent) => event.preventDefault();

/**
 * Botón principal del diseño (contorno marrón, a todo el ancho). Hasta S7 no hay carrito, así que ofrece «Consultar
 * por WhatsApp». Los estados no disponibles usan `aria-disabled` (no `disabled`): siguen en el orden de tabulación y
 * su mensaje explicativo (`aria-describedby`) se lee.
 *
 * S7 (carrito): aquí se añade «Agregar a la bolsa» como botón principal cuando `state === "ready"`, y la consulta por
 * WhatsApp pasa a ser un enlace secundario.
 */
export function PurchaseButton({ state, whatsappHref, className }: PurchaseButtonProps) {
  if (state === "ready" && whatsappHref) {
    return (
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(base, "hover:bg-primary hover:text-primary-foreground", className)}
      >
        {t("shop.product.cta.whatsapp")}
        {/* el espacio va FUERA del span (dentro se pierde en el nombre accesible) */}{" "}
        <span className="sr-only">{t("shop.product.cta.whatsappOpensNewTab")}</span>
      </a>
    );
  }

  const content: Record<
    Exclude<PurchaseState, "ready"> | "soon",
    { label: string; hint: string | null }
  > = {
    sold_out: { label: t("shop.product.cta.soldOut"), hint: null },
    color_sold_out: {
      label: t("shop.product.cta.colorSoldOut"),
      hint: t("shop.product.cta.colorSoldOutHint"),
    },
    choose_size: {
      label: t("shop.product.cta.chooseSize"),
      hint: t("shop.product.cta.chooseSizeHint"),
    },
    soon: { label: t("shop.product.cta.soon"), hint: t("shop.product.cta.soonHint") },
  };
  const { label, hint } = content[state === "ready" ? "soon" : state];
  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        {...(hint ? { "aria-describedby": "purchase-hint" } : {})}
        onClick={blocked}
        className={cn(base, className)}
      >
        {label}
      </button>
      {hint && (
        <p id="purchase-hint" role="status" className="mt-2 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </>
  );
}

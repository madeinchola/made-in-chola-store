import type { MouseEvent } from "react";
import { buttonVariants } from "@/components/ui/button-variants";
import { useCart } from "@/features/cart/cart-context";
import { preloadMiniCart } from "@/features/cart/miniCartLoader";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { track, type TrackedItem } from "../analytics/track";
import type { PurchaseState } from "./variantSelection";

/** Lo que se agrega a la bolsa: la variante elegida en la ficha y los datos del evento `add_to_cart`. */
export interface PurchaseSelection {
  variantId: string;
  item: TrackedItem;
  variant?: { color?: string; size?: string };
}

type PurchaseButtonProps = {
  /** Enlace `wa.me` ya armado; null si no hay WhatsApp configurado o inválido. */
  whatsappHref: string | null;
  className?: string;
} & (
  | { state: "ready"; selection: PurchaseSelection }
  | { state: Exclude<PurchaseState, "ready">; selection?: undefined }
);

const base = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-[4.25rem] w-full border-[1.5px] border-foreground text-base",
);

const blocked = (event: MouseEvent) => event.preventDefault();

/** «Consultar por WhatsApp»: enlace secundario bajo el botón principal. */
function WhatsAppLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 flex min-h-11 items-center justify-center rounded-sm text-sm underline underline-offset-4 transition-colors duration-fast hover:text-muted-foreground"
    >
      {t("shop.product.cta.whatsapp")}
      {/* el espacio va FUERA del span (dentro se pierde en el nombre accesible) */}{" "}
      <span className="sr-only">{t("shop.product.cta.whatsappOpensNewTab")}</span>
    </a>
  );
}

/**
 * «Agregar a la bolsa»: suma UNA unidad de la variante elegida (cantidad absoluta = la que ya hay en la bolsa + 1; el
 * servidor confirma y ajusta), emite `add_to_cart` y abre el cajón. Si ya hay unidades pendientes de confirmar cuenta
 * también esas, así que dos clics seguidos suman 2.
 */
function AddToBag({
  selection,
  whatsappHref,
  className,
}: {
  selection: PurchaseSelection;
  whatsappHref: string | null;
  className?: string | undefined;
}) {
  const { store, setOpen } = useCart();
  const { variantId } = selection;

  const add = (event: MouseEvent<HTMLButtonElement>) => {
    // Safari y Firefox (macOS) no enfocan un botón al hacer clic: sin esto el cajón no sabría a quién devolver el foco.
    event.currentTarget.focus();
    // El almacén suma UNA a lo que realmente hay (y espera a leer la bolsa si aún no se leyó): calcularlo aquí con una
    // bolsa sin cargar mandaba «1» y dejaba en 1 una bolsa que tenía 3, en silencio.
    void store.addOne(variantId);
    track({
      name: "add_to_cart",
      item: selection.item,
      quantity: 1,
      ...(selection.variant ? { variant: selection.variant } : {}),
    });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={add}
        onPointerEnter={preloadMiniCart}
        onFocus={preloadMiniCart}
        className={cn(base, "hover:bg-primary hover:text-primary-foreground", className)}
      >
        {t("cart.purchase.add")}
      </button>
      {whatsappHref && <WhatsAppLink href={whatsappHref} />}
    </>
  );
}

/**
 * Botón principal del diseño (contorno marrón, a todo el ancho). Con la variante lista es «Agregar a la bolsa» y la
 * consulta por WhatsApp queda como enlace secundario debajo. Los estados no disponibles usan `aria-disabled` (no
 * `disabled`): siguen en el orden de tabulación y su mensaje explicativo (`aria-describedby`) se lee.
 */
export function PurchaseButton(props: PurchaseButtonProps) {
  if (props.state === "ready") {
    return (
      <AddToBag
        selection={props.selection}
        whatsappHref={props.whatsappHref}
        className={props.className}
      />
    );
  }

  const content: Record<Exclude<PurchaseState, "ready">, { label: string; hint: string | null }> = {
    sold_out: { label: t("shop.product.cta.soldOut"), hint: null },
    color_sold_out: {
      label: t("shop.product.cta.colorSoldOut"),
      hint: t("shop.product.cta.colorSoldOutHint"),
    },
    choose_size: {
      label: t("shop.product.cta.chooseSize"),
      hint: t("shop.product.cta.chooseSizeHint"),
    },
  };
  const { label, hint } = content[props.state];
  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        {...(hint ? { "aria-describedby": "purchase-hint" } : {})}
        onClick={blocked}
        className={cn(base, props.className)}
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

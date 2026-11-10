import { Link } from "react-router-dom";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCartMoney } from "@/features/cart/format";
import { lineProblems, type Revalidation } from "./revalidation";
import { t } from "@/i18n";

/**
 * BR-CHK-04: antes de crear el pedido se revalidan stock y precio y se MUESTRA cualquier diferencia. Nada se creó ni se cobró.
 *  · `changed` por total o descuento: se ve «antes / ahora» y la persona confirma con el nuevo total o revisa su bolsa.
 *  · `changed` por descuento: el servidor no puede dar el total nuevo (el descuento que falló seguía en la cuenta); se cierra el
 *    aviso y el formulario ya muestra el total recalculado para volver a enviar a sabiendas.
 *  · `changed` por precio, o `unavailable`: hay que corregir la bolsa (aceptar el precio, quitar lo agotado): solo se ofrece volver.
 */
export function RevalidationDialog({
  result,
  currency,
  pending,
  waiting = false,
  onConfirm,
  onClose,
}: {
  result: Revalidation | null;
  currency: string;
  pending: boolean;
  /** La vista previa se está recalculando: «Confirmar» espera (un clic ahora se perdería sin avisar). */
  waiting?: boolean;
  onConfirm: (newTotal: number) => void;
  onClose: () => void;
}) {
  const canConfirm =
    result?.outcome === "changed" && result.reason !== "price" && result.actual_total !== undefined;
  const title =
    result?.outcome === "unavailable"
      ? t("checkout.revalidate.unavailableTitle")
      : result?.reason === "price"
        ? t("checkout.revalidate.priceTitle")
        : t("checkout.revalidate.changedTitle");
  const body =
    result?.outcome === "unavailable"
      ? t("checkout.revalidate.unavailableBody")
      : result?.reason === "price"
        ? t("checkout.revalidate.priceBody")
        : result?.reason === "discount"
          ? t("checkout.revalidate.discountBody")
          : t("checkout.revalidate.changedBody");
  const problems = result ? lineProblems(result.lines, currency) : [];
  return (
    <Dialog
      open={result !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {problems.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {result?.outcome === "changed" &&
          result.expected_total !== undefined &&
          result.actual_total !== undefined && (
            <dl className="space-y-1 rounded-card border border-border p-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt>{t("checkout.revalidate.before")}</dt>
                <dd className="tabular-nums line-through">
                  {formatCartMoney(result.expected_total, currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 font-medium">
                <dt>{t("checkout.revalidate.now")}</dt>
                <dd className="tabular-nums">{formatCartMoney(result.actual_total, currency)}</dd>
              </div>
            </dl>
          )}
        <DialogFooter>
          <Link
            to={storeRoutes.cart}
            className={buttonVariants({ variant: "outline" })}
            onClick={onClose}
          >
            {t("checkout.revalidate.review")}
          </Link>
          {result?.outcome === "changed" && result.reason === "discount" && (
            <Button type="button" onClick={onClose}>
              {t("checkout.revalidate.seeNewTotal")}
            </Button>
          )}
          {canConfirm && result?.outcome === "changed" && result.actual_total !== undefined && (
            <Button
              type="button"
              disabled={pending || waiting}
              onClick={() => onConfirm(result.actual_total as number)}
            >
              {pending ? t("checkout.submit.sending") : t("checkout.revalidate.confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

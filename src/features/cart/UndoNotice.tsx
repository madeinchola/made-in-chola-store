import { t } from "@/i18n";
import { useCart } from "./cart-context";
import { NoticeBanner } from "./NoticeBanner";
import { RescueButton } from "./RescueButton";

/**
 * «Quitaste X. Deshacer», EN LÍNEA: en la página de la bolsa y dentro del cajón. Antes era un toast, que va al final del
 * documento (con teclado solo se llega con un atajo que nadie conoce) y, en un diálogo modal, queda fuera. En línea se
 * alcanza con el orden normal de tabulación. Desaparece solo a los 8 s (lo decide el almacén, no este componente). Va dentro
 * de la `NoticeRegion` (región viva persistente); al pulsar «Deshacer» el aviso se va y el foco pasa al título.
 */
export function UndoNotice() {
  const { state, store } = useCart();
  const removed = state.lastRemoved;
  if (!removed) return null;
  return (
    <NoticeBanner
      tone="info"
      message={t("cart.undo.removed", { name: removed.name })}
      actions={
        <RescueButton
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => store.undoRemove()}
        >
          {t("cart.undo.action")}
        </RescueButton>
      }
    />
  );
}

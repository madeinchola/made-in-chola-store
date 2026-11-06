import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useCart } from "./cart-context";
import { lineNotices, type NoticeSpec, orphanNotice } from "./lineNotices";
import { NoticeBanner } from "./NoticeBanner";
import { NoticeRegion } from "./NoticeRegion";
import type { DisplayLine } from "./selectors";

interface LineNoticeProps {
  line: DisplayLine;
  onRemove: () => void;
  onAdjust: () => void;
  onAccept: () => void;
}

/**
 * Avisos de UNA línea: se agotó, ya no está disponible, quedan pocas unidades, cambió el precio y el resultado del último
 * cambio (se ajustó la cantidad, hay un tope…). Qué decir y si bloquea lo decide el servidor (`status`, `blocking`,
 * `price_notice`); aquí solo se traduce a texto y se ofrece la acción. Un aviso que bloquea es `role="alert"` (se anuncia
 * al insertarse). Los demás entran en una `NoticeRegion` PROPIA de la línea, que existe aunque no haya ningún aviso: un
 * aviso que nace ya con su `role="status"` no se anuncia de forma fiable, uno que entra en una región viva existente sí.
 * Cada acción es un botón (funciona con teclado).
 */
export function LineNotice({ line, onRemove, onAdjust, onAccept }: LineNoticeProps) {
  const { state, store } = useCart();
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const specs = lineNotices(
    line,
    state.results[line.variant_id],
    snapshot.currency,
    snapshot.limits,
  );
  const handlers = { remove: onRemove, adjust: onAdjust, accept: onAccept } as const;
  const banner = (spec: NoticeSpec) => (
    <NoticeBanner
      key={spec.key}
      tone={spec.tone}
      blocking={spec.blocking}
      message={spec.message}
      actions={
        spec.action && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            aria-label={
              spec.action.kind === "remove"
                ? t("cart.notice.removeLabel", { name: line.name })
                : spec.action.kind === "adjust"
                  ? t("cart.notice.adjustToLabel", { n: line.available, name: line.name })
                  : t("cart.notice.acceptPriceLabel", { name: line.name })
            }
            onClick={handlers[spec.action.kind]}
          >
            {spec.action.label}
          </Button>
        )
      }
      onDismiss={spec.dismissible ? () => store.dismissResult(line.variant_id) : undefined}
    />
  );
  const urgent = specs.filter((spec) => spec.blocking);
  return (
    <>
      {urgent.length > 0 && <div className="space-y-2">{urgent.map(banner)}</div>}
      {/* Sin avisos mide 0 y no suma separación (`empty:!mt-0`): la línea se ve igual que antes. */}
      <NoticeRegion className="space-y-2 empty:!mt-0">
        {specs.filter((spec) => !spec.blocking).map(banner)}
      </NoticeRegion>
    </>
  );
}

/**
 * Avisos de cambios que no dejaron ninguna línea (no se pudo agregar: tope de productos, agotado…). Van arriba de la
 * lista porque no hay una línea a la que colgarlos, DENTRO de la `NoticeRegion` de la página o del cajón (que debe
 * existir antes de que aparezcan; por eso no pintan su propio contenedor).
 */
export function OrphanNotices() {
  const { state, store } = useCart();
  const known = new Set((state.snapshot?.lines ?? []).map((line) => line.variant_id));
  const specs = Object.entries(state.results)
    .filter(([variantId]) => !known.has(variantId))
    .flatMap(([variantId, result]) => {
      const spec = orphanNotice(result, state.snapshot?.limits ?? null);
      return spec ? [{ variantId, spec }] : [];
    });
  return (
    <>
      {specs.map(({ variantId, spec }) => (
        <NoticeBanner
          key={variantId}
          tone={spec.tone}
          message={spec.message}
          onDismiss={() => store.dismissResult(variantId)}
        />
      ))}
    </>
  );
}

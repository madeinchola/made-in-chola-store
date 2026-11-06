import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { EMPTY_PIN, toPinText } from "@/components/map/coords";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Address } from "@/features/account/addresses/types";
import { formatCartMoney } from "@/features/cart/format";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { DeliverySlotPicker } from "./DeliverySlotPicker";
import type { DestinationSheetProps, SheetContext } from "./DestinationSheet";
import { LazyMount } from "./LazyMount";
import type { SavedAddressesProps } from "./SavedAddresses";
import type { Destination, ScheduleChoice } from "./destination";
import type { QuoteView, ScheduleView } from "./estimate";
import { formatSlotDate, formatSlotRange } from "./slotDates";
import type { ShippingEstimate } from "./useShippingEstimate";

// Cada parte pesada va en su propio fragmento: la libreta de direcciones solo para quien tiene sesión, y el cajón con el
// mapa (que a su vez descarga Leaflet) solo cuando se abre. La página de la bolsa no carga ninguno de los dos.
const loadSavedAddresses = () => import("./SavedAddresses");
const loadDestinationSheet = () => import("./DestinationSheet");

/** Adelanta la descarga del cajón del mapa (al pasar por el botón que lo abre). Solo baja el cajón, no Leaflet. */
const preloadSheet = () => {
  loadDestinationSheet().catch(() => undefined);
};

/**
 * Región viva PERSISTENTE: existe desde el primer pintado (vacía) y su contenido cambia. Un lector de pantalla anuncia de
 * forma fiable lo que ENTRA en una región que ya existía; un nodo que nace con `role="status"` y su texto, no.
 * `aria-atomic`: cada cambio se lee entero.
 */
function StatusRegion({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={cn("text-sm", className)}>
      {children}
    </div>
  );
}

function QuoteMessage({ quote, total }: { quote: QuoteView; total: number | null }) {
  switch (quote.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />
          {t("shipping.estimator.calculating")}
        </p>
      );
    case "failed":
      return <p>{t("shipping.errors.unexpected")}</p>;
    case "rejected":
      return (
        <>
          <p>{quote.error.message}</p>
          {quote.error.help && <p className="mt-1 text-muted-foreground">{quote.error.help}</p>}
        </>
      );
    case "ok":
      return (
        <>
          <p className="font-medium">
            {quote.cost === 0
              ? t("shipping.estimator.free")
              : t("shipping.estimator.cost", { cost: formatCartMoney(quote.cost, quote.currency) })}
          </p>
          {quote.eta && <p className="text-muted-foreground">{quote.eta}</p>}
          {total !== null && (
            <span className="sr-only">
              {t("shipping.estimator.total", { total: formatCartMoney(total, quote.currency) })}
            </span>
          )}
        </>
      );
  }
}

function ScheduleMessage({
  view,
  choice,
  removed,
}: {
  view: ScheduleView;
  choice: ScheduleChoice | null;
  removed: boolean;
}) {
  switch (view.kind) {
    case "none":
      return removed && choice === null ? <p>{t("shipping.slots.removed")}</p> : null;
    case "checking":
      return (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />
          {t("shipping.slots.checking")}
        </p>
      );
    case "failed":
      return <p>{t("shipping.errors.unexpected")}</p>;
    case "rejected":
      return <p>{view.error.message}</p>;
    case "confirmed": {
      const date = formatSlotDate(view.date);
      return (
        <p className="font-medium">
          {view.start !== null && view.end !== null
            ? t("shipping.slots.confirmed", { date, range: formatSlotRange(view.start, view.end) })
            : t("shipping.slots.confirmedDate", { date })}
        </p>
      );
    }
  }
}

/**
 * Estimador de envío de la bolsa: la clienta elige a dónde envía (una dirección guardada, o un punto en el mapa) y se le
 * dice cuánto cuesta y en cuánto llega; opcionalmente prueba una fecha y franja. TODO lo que dice sale de `quote_shipping`
 * (el servidor); el pedido lo recalcula al pagar. Sin destino no se pregunta nada al servidor.
 *
 * Accesibilidad: dos regiones vivas persistentes (cotización y franja) anuncian los cambios; el cajón del mapa es un
 * diálogo modal que devuelve el foco al botón que lo abrió; todos los controles miden al menos 44 px.
 */
export function ShippingEstimator({
  estimate,
  className,
}: {
  estimate: ShippingEstimate;
  className?: string;
}) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const panelId = `${ids}-slots`;
  const { ready, userId, destination, quote, schedule, scheduleCheck, slots, total } = estimate;

  const [sheet, setSheet] = useState<{ opened: boolean; open: boolean; context: SheetContext }>({
    opened: false,
    open: false,
    context: { label: null, addressId: null, city: "", pin: EMPTY_PIN },
  });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const mapDestination =
    destination !== null && destination.addressId === null ? destination : null;

  const openSheet = (context: SheetContext) => setSheet({ opened: true, open: true, context });
  const openFromButton = () =>
    openSheet({
      label: null,
      addressId: null,
      city: mapDestination?.city ?? "",
      pin: mapDestination ? toPinText(mapDestination) : EMPTY_PIN,
    });
  const locateAddress = (address: Address) =>
    openSheet({ label: address.label, addressId: address.id, city: address.city, pin: EMPTY_PIN });

  const confirmSheet: DestinationSheetProps["onConfirm"] = (values) => {
    const next: Destination = {
      lat: values.lat,
      lng: values.lng,
      city: values.city,
      label: sheet.context.label,
      addressId: sheet.context.addressId,
    };
    estimate.setDestination(next);
    setSheet((current) => ({ ...current, open: false }));
  };

  const openerLabel = mapDestination
    ? t("shipping.estimator.destination.change")
    : userId !== null
      ? t("shipping.estimator.destination.other")
      : t("shipping.estimator.destination.pickOnMap");

  const retry = () => {
    estimate.retry();
    // El botón desaparece al pasar a «calculando»: el foco se queda en el título de la sección (sin él caería al <body>).
    titleRef.current?.focus();
  };
  const showRetry =
    quote.kind === "failed" || (quote.kind === "rejected" && quote.error.action === "retry");

  const choose = (choice: ScheduleChoice) => {
    setRemoved(false);
    estimate.setSchedule(choice);
  };
  const removeChoice = () => {
    setRemoved(true);
    estimate.setSchedule(null);
    toggleRef.current?.focus();
  };

  const savedProps: SavedAddressesProps = {
    userId: userId ?? "",
    destination,
    onSelect: estimate.setDestination,
    onLocate: locateAddress,
    onReconcile: estimate.setDestination,
  };
  const sheetProps: DestinationSheetProps = {
    open: sheet.open,
    onOpenChange: (open) => setSheet((current) => ({ ...current, open })),
    context: sheet.context,
    onConfirm: confirmSheet,
  };

  return (
    <section
      aria-labelledby={titleId}
      className={cn("space-y-4 border-t border-border pt-5", className)}
    >
      <h3 id={titleId} ref={titleRef} tabIndex={-1} className="eyebrow outline-none">
        {t("shipping.estimator.title")}
      </h3>

      {!ready ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="space-y-3">
          {destination === null && (
            <p className="text-sm text-muted-foreground">{t("shipping.estimator.invite")}</p>
          )}
          {userId !== null && (
            <LazyMount
              load={loadSavedAddresses}
              props={savedProps}
              loadingText={t("shipping.estimator.destination.loading")}
              failedText={t("shipping.estimator.destination.loadError")}
            />
          )}
          {mapDestination && (
            <p className="text-sm">
              {t("shipping.estimator.destination.mapPlace", { city: mapDestination.city })}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={openFromButton}
            onPointerEnter={preloadSheet}
            onFocus={preloadSheet}
          >
            {openerLabel}
          </Button>
          {sheet.opened && (
            <LazyMount
              load={loadDestinationSheet}
              props={sheetProps}
              loadingText={t("shipping.estimator.destination.loadingMap")}
              failedText={t("shipping.estimator.destination.mapLoadFailed")}
            />
          )}
        </div>
      )}

      <StatusRegion>
        <QuoteMessage quote={quote} total={total} />
      </StatusRegion>
      {showRetry && (
        <Button type="button" variant="outline" className="min-h-11" onClick={retry}>
          {t("shipping.estimator.retry")}
        </Button>
      )}

      {quote.kind === "ok" && slots.length > 0 && (
        <div className="space-y-3">
          <Button
            ref={toggleRef}
            type="button"
            variant="outline"
            className="min-h-11 w-full justify-between"
            aria-expanded={scheduleOpen}
            aria-controls={panelId}
            onClick={() => setScheduleOpen((open) => !open)}
          >
            {t("shipping.slots.toggle")}
            <ChevronDown
              aria-hidden="true"
              className={cn("h-4 w-4 shrink-0 transition-transform", scheduleOpen && "rotate-180")}
            />
          </Button>
          <div id={panelId} hidden={!scheduleOpen}>
            {scheduleOpen && (
              <DeliverySlotPicker slots={slots} choice={schedule} onChoose={choose} />
            )}
          </div>
        </div>
      )}
      <StatusRegion>
        <ScheduleMessage view={scheduleCheck} choice={schedule} removed={removed} />
      </StatusRegion>
      {scheduleCheck.kind === "failed" && (
        <Button type="button" variant="outline" className="min-h-11" onClick={retry}>
          {t("shipping.estimator.retry")}
        </Button>
      )}
      {schedule !== null && quote.kind === "ok" && (
        <Button type="button" variant="ghost" className="min-h-11" onClick={removeChoice}>
          {t("shipping.slots.remove")}
        </Button>
      )}
    </section>
  );
}

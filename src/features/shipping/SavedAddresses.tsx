import { useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { useActiveAddresses } from "@/features/account/addresses/hooks";
import type { Address } from "@/features/account/addresses/types";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  addressHasPin,
  destinationFromAddress,
  reconcileDestination,
  shippingAddresses,
  type Destination,
} from "./destination";

export interface SavedAddressesProps {
  /** Id de la clienta (el de su libreta). */
  userId: string;
  /** El destino recordado: si es de la libreta se marca, y se pone al día con lo que diga la libreta. */
  destination: Destination | null;
  /** Una dirección con pin: ya es un destino. */
  onSelect: (destination: Destination) => void;
  /** Una dirección SIN pin: hay que ubicarla en el mapa antes de poder cotizar. */
  onLocate: (address: Address) => void;
  /** La libreta cambió lo que se recordaba (la dirección ya no está, o cambió de ubicación). */
  onReconcile: (destination: Destination | null) => void;
}

/**
 * Las direcciones guardadas de la clienta para elegir a dónde se envía. Vive en su propio fragmento: la libreta (consulta,
 * mapeo, tipos) solo se descarga para quien tiene sesión. Una dirección sin pin no se puede cotizar: al elegirla se pide
 * ubicarla en el mapa (el punto solo sirve para esta estimación; la libreta no se modifica).
 */
export default function SavedAddresses({
  userId,
  destination,
  onSelect,
  onLocate,
  onReconcile,
}: SavedAddressesProps) {
  const ids = useId();
  const query = useActiveAddresses(userId);
  const { data, refetch } = query;

  // La libreta manda: si la dirección recordada ya no existe o cambió de lugar, lo recordado se corrige.
  useEffect(() => {
    if (!data) return;
    const next = reconcileDestination(destination, data);
    if (next !== destination) onReconcile(next);
  }, [data, destination, onReconcile]);

  if (query.isPending) {
    return (
      <p className="text-sm text-muted-foreground">{t("shipping.estimator.destination.loading")}</p>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t("shipping.estimator.destination.loadError")}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void refetch()}>
          {t("shipping.estimator.retry")}
        </Button>
      </div>
    );
  }
  const addresses = shippingAddresses(data ?? []);
  if (addresses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("shipping.estimator.destination.empty")}</p>
    );
  }
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{t("shipping.estimator.destination.legend")}</legend>
      {addresses.map((address) => {
        const hasPin = addressHasPin(address);
        const noteId = `${ids}-${address.id}-note`;
        return (
          <label
            key={address.id}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-input p-3 text-sm hover:bg-muted",
              destination?.addressId === address.id && "border-primary bg-muted",
            )}
          >
            <input
              type="radio"
              name={`${ids}-address`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={destination?.addressId === address.id}
              aria-describedby={hasPin ? undefined : noteId}
              onChange={() => {
                const next = destinationFromAddress(address);
                if (next) onSelect(next);
                else onLocate(address);
              }}
            />
            <span className="min-w-0 break-words">
              <span className="block font-medium">{address.label}</span>
              <span className="block text-muted-foreground">
                {address.line1}, {address.city}
              </span>
              {!hasPin && (
                <span id={noteId} className="block text-xs text-muted-foreground">
                  {t("shipping.estimator.destination.noPin")}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

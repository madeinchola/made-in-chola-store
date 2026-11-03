import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { formatPhoneDisplay } from "./phone";
import type { Address } from "./types";

interface AddressCardProps {
  address: Address;
  /** Nombre del país ya resuelto (de `public_countries`). */
  countryName: string;
  /** `active`: editar / predeterminada / archivar. `archived`: solo restaurar. */
  mode: "active" | "archived";
  /** Una acción de esta tarjeta está en curso (muestra «cargando» sin quitar el foco). */
  busy?: boolean;
  /** Ya hay el máximo de activas: restaurar no se puede (el botón se explica en vez de fallar). */
  restoreBlocked?: boolean;
  /** Id del aviso que explica el bloqueo (para `aria-describedby`). */
  restoreBlockedId?: string | undefined;
  onEdit?: (address: Address) => void;
  onMakeDefault?: (address: Address) => void;
  onArchive?: (address: Address) => void;
  onRestore?: (address: Address) => void;
}

/** Tarjeta de una dirección. Todo el texto del usuario se pinta como texto (React lo escapa): nunca como HTML. */
export function AddressCard({
  address,
  countryName,
  mode,
  busy = false,
  restoreBlocked = false,
  restoreBlockedId,
  onEdit,
  onMakeDefault,
  onArchive,
  onRestore,
}: AddressCardProps) {
  const titleId = `address-${address.id}-title`;
  const place = [address.city, address.department, countryName].filter(Boolean).join(", ");
  const hasPin = address.lat !== null && address.lng !== null;
  return (
    <article
      id={`address-${address.id}`}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="space-y-3 rounded-card border border-border bg-card p-4 text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="min-w-0 break-words font-display text-display-sm">
          {address.label}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {address.isDefault && <Badge tone="solid">{t("acct.addresses.card.default")}</Badge>}
          {address.forShipping && <Badge>{t("acct.addresses.card.shipping")}</Badge>}
          {address.forBilling && <Badge>{t("acct.addresses.card.billing")}</Badge>}
        </div>
      </div>

      <div className="space-y-0.5 break-words text-sm">
        <p className="font-medium">{address.recipient}</p>
        <p>{address.line2 ? `${address.line1}, ${address.line2}` : address.line1}</p>
        <p>{place}</p>
        {address.phone && (
          <p>{t("acct.addresses.card.phone", { phone: formatPhoneDisplay(address.phone) })}</p>
        )}
        {address.referenceText && (
          <p className="text-muted-foreground">
            {t("acct.addresses.card.reference", { text: address.referenceText })}
          </p>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {hasPin ? t("acct.addresses.card.withPin") : t("acct.addresses.card.withoutPin")}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        {mode === "active" ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("acct.addresses.card.editAria", { label: address.label })}
              onClick={() => onEdit?.(address)}
            >
              {t("acct.addresses.card.edit")}
            </Button>
            {!address.isDefault && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={busy}
                aria-label={t("acct.addresses.card.makeDefaultAria", { label: address.label })}
                onClick={() => onMakeDefault?.(address)}
              >
                {t("acct.addresses.card.makeDefault")}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("acct.addresses.card.archiveAria", { label: address.label })}
              onClick={() => onArchive?.(address)}
            >
              {t("acct.addresses.card.archive")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busy}
            aria-disabled={restoreBlocked || undefined}
            aria-describedby={restoreBlocked ? restoreBlockedId : undefined}
            aria-label={t("acct.addresses.card.restoreAria", { label: address.label })}
            onClick={() => {
              if (restoreBlocked) return;
              onRestore?.(address);
            }}
          >
            {t("acct.addresses.card.restore")}
          </Button>
        )}
      </div>
    </article>
  );
}

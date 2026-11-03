import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, MapPin, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { COUNTRIES } from "@/lib/countries";
import { toAppError } from "@/lib/errors";
import { AddressCard } from "./AddressCard";
import { AddressFormSheet, type AddressFormTarget } from "./AddressFormSheet";
import { ArchiveDialog } from "./ArchiveDialog";
import {
  useActiveAddresses,
  useArchiveAddress,
  useArchivedAddresses,
  useDeliveryCountries,
  useRestoreAddress,
  useSetDefaultAddress,
} from "./hooks";
import { MAX_ACTIVE_ADDRESSES, type Address } from "./types";

/** A dónde mandar el foco cuando el botón que lo tenía desaparece (archivar, restaurar, marcar predeterminada). */
type PendingFocus = { kind: "card"; id: string } | null;

/**
 * «Mi cuenta» · Direcciones: libreta de direcciones del cliente. Lista las activas (con la predeterminada primero), deja
 * crear, editar, marcar la predeterminada y archivar (NUNCA borrar: se pueden restaurar desde «Archivadas»). El tope de
 * {@link MAX_ACTIVE_ADDRESSES} activas lo impone la base; aquí se explica ANTES de que falle.
 */
export function AddressesPage() {
  const { profile } = useAuth();
  const profileId = profile?.id;
  const active = useActiveAddresses(profileId);
  const archived = useArchivedAddresses(profileId);
  const { countries } = useDeliveryCountries();
  const makeDefault = useSetDefaultAddress(profileId);
  const archive = useArchiveAddress(profileId);
  const restore = useRestoreAddress(profileId);

  const [formTarget, setFormTarget] = useState<AddressFormTarget | null>(null);
  const [archiving, setArchiving] = useState<Address | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const ids = useId();
  const limitNoticeId = `${ids}-limit`;
  const archivedPanelId = `${ids}-archived`;

  const addresses = active.data ?? [];
  const archivedList = archived.data ?? [];
  const limitReached = addresses.length >= MAX_ACTIVE_ADDRESSES;

  const countryName = useCallback(
    (code: string) =>
      countries.find((c) => c.code === code)?.name ??
      COUNTRIES.find((c) => c.code === code)?.name ??
      code,
    [countries],
  );

  // Mueve el foco a la tarjeta cuando ya está en pantalla (tras refrescar la lista).
  useEffect(() => {
    if (!pendingFocus) return;
    const element = document.getElementById(`address-${pendingFocus.id}`);
    if (!element) return;
    element.focus();
    setPendingFocus(null);
  }, [pendingFocus, active.data]);

  const openCreate = () => {
    if (limitReached) return; // el botón se explica con el aviso (aria-disabled), no falla
    setFormTarget({ kind: "create" });
  };

  const onSaved = (message: string) => {
    toast.success(message);
    setFormTarget(null);
  };

  const onMakeDefault = async (address: Address) => {
    if (busyId) return;
    setBusyId(address.id);
    try {
      await makeDefault.mutateAsync(address.id);
      toast.success(t("acct.addresses.messages.defaulted", { label: address.label }));
      setPendingFocus({ kind: "card", id: address.id });
    } catch (error) {
      toast.error(toAppError(error).message);
    } finally {
      setBusyId(null);
    }
  };

  const onRestore = async (address: Address) => {
    if (busyId || limitReached) return;
    setBusyId(address.id);
    try {
      await restore.mutateAsync(address.id);
      toast.success(t("acct.addresses.messages.restored"));
      setPendingFocus({ kind: "card", id: address.id });
    } catch (error) {
      toast.error(toAppError(error).message);
    } finally {
      setBusyId(null);
    }
  };

  const onConfirmArchive = async (address: Address) => {
    if (archive.isPending) return;
    setArchiveError(null);
    try {
      await archive.mutateAsync(address.id);
      toast.success(t("acct.addresses.messages.archived"));
      setArchiving(null);
    } catch (error) {
      setArchiveError(toAppError(error).message);
    }
  };

  const closeArchive = () => {
    setArchiving(null);
    setArchiveError(null);
  };

  // Al cerrar el diálogo, si el botón «Archivar» ya no existe (la tarjeta se fue), el foco va al título de la sección.
  const onArchiveCloseAutoFocus = (event: Event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    headingRef.current?.focus();
  };

  return (
    <section aria-labelledby={`${ids}-title`} className="space-y-8">
      <header className="space-y-2">
        <h2
          id={`${ids}-title`}
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-display-md outline-none"
        >
          {t("acct.addresses.title")}
        </h2>
        <p className="text-muted-foreground">{t("acct.addresses.intro")}</p>
      </header>

      {active.isPending ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">{t("acct.addresses.loading")}</span>
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : active.isError && !active.data ? (
        <ErrorState
          title={t("acct.addresses.loadError.title")}
          description={t("acct.addresses.loadError.body")}
          onRetry={() => void active.refetch()}
        />
      ) : addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t("acct.addresses.empty.title")}
          description={t("acct.addresses.empty.body")}
          action={
            <Button type="button" onClick={openCreate}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("acct.addresses.add")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {t("acct.addresses.count", { n: addresses.length, max: MAX_ACTIVE_ADDRESSES })}
            </p>
            <Button
              type="button"
              aria-disabled={limitReached || undefined}
              aria-describedby={limitReached ? limitNoticeId : undefined}
              onClick={openCreate}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("acct.addresses.add")}
            </Button>
          </div>
          {limitReached && (
            <p
              id={limitNoticeId}
              role="status"
              className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning"
            >
              {t("acct.addresses.limitNotice", { max: MAX_ACTIVE_ADDRESSES })}
            </p>
          )}
          <ul aria-label={t("acct.addresses.listLabel")} className="grid gap-4 lg:grid-cols-2">
            {addresses.map((address) => (
              <li key={address.id} className="min-w-0">
                <AddressCard
                  address={address}
                  countryName={countryName(address.country)}
                  mode="active"
                  busy={busyId === address.id}
                  onEdit={(a) => setFormTarget({ kind: "edit", address: a })}
                  onMakeDefault={(a) => void onMakeDefault(a)}
                  onArchive={(a) => {
                    setArchiveError(null);
                    setArchiving(a);
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {archived.isError && !archived.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p>{t("acct.addresses.archived.loadError")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void archived.refetch()}>
            {t("acct.addresses.archived.retry")}
          </Button>
        </div>
      ) : (
        archivedList.length > 0 && (
          <section className="space-y-4 border-t border-border pt-6">
            <h3 className="font-display text-display-sm">
              <button
                type="button"
                aria-expanded={archivedOpen}
                aria-controls={archivedPanelId}
                onClick={() => setArchivedOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-2 rounded-sm text-left"
              >
                {t("acct.addresses.archived.toggle", { n: archivedList.length })}
                <ChevronDown
                  aria-hidden="true"
                  className={`h-5 w-5 shrink-0 transition-transform duration-fast ${archivedOpen ? "rotate-180" : ""}`}
                />
              </button>
            </h3>
            <div id={archivedPanelId} hidden={!archivedOpen} className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("acct.addresses.archived.hint")}</p>
              {limitReached && (
                <p className="text-sm text-warning">
                  {t("acct.addresses.archived.restoreBlocked", { max: MAX_ACTIVE_ADDRESSES })}
                </p>
              )}
              <ul className="grid gap-4 lg:grid-cols-2">
                {archivedList.map((address) => (
                  <li key={address.id} className="min-w-0">
                    <AddressCard
                      address={address}
                      countryName={countryName(address.country)}
                      mode="archived"
                      busy={busyId === address.id}
                      restoreBlocked={limitReached}
                      restoreBlockedId={limitNoticeId}
                      onRestore={(a) => void onRestore(a)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )
      )}

      <AddressFormSheet
        onCloseAutoFocus={(event) => {
          // El botón que abrió el cajón ya no existe (p. ej. «Agregar» del estado vacío tras crear la primera): sin esto el
          // foco caería en <body> y un lector de pantalla o el teclado empezarían de cero. Va al título, como al archivar.
          if (document.activeElement === document.body || document.activeElement === null) {
            event.preventDefault();
            headingRef.current?.focus();
          }
        }}
        target={formTarget}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        countries={countries}
        activeCount={addresses.length}
        onSaved={onSaved}
      />
      <ArchiveDialog
        address={archiving}
        pending={archive.isPending}
        error={archiveError}
        onConfirm={(a) => void onConfirmArchive(a)}
        onClose={closeArchive}
        onCloseAutoFocus={onArchiveCloseAutoFocus}
      />
    </section>
  );
}

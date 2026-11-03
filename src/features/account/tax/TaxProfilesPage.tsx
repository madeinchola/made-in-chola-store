import { useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoreSettings } from "@/features/catalog/hooks";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { FormAlert } from "../security/FormAlert";
import { useSingleFlight } from "../security/useSingleFlight";
import {
  useArchiveTaxProfile,
  useRestoreTaxProfile,
  useSetDefaultTaxProfile,
  useTaxProfiles,
} from "./hooks";
import { TaxProfileDialog, type TaxDialogTarget } from "./TaxProfileDialog";
import { parseTaxIdMode } from "./taxId";
import { MAX_ACTIVE_TAX_PROFILES, type TaxProfile } from "./types";

type ActionKind = "default" | "restore";

interface RowProps {
  profile: TaxProfile;
  /** Acción en vuelo (de esta u otra fila): mientras haya una, las demás se ignoran. */
  busy: { id: string; kind: ActionKind } | null;
  capReached: boolean;
  /** Id de la nota «llegaste al máximo», que explica por qué no se puede restaurar. */
  capNoteId: string;
  onEdit: (profile: TaxProfile) => void;
  onArchive: (profile: TaxProfile) => void;
  onMakeDefault: (profile: TaxProfile) => void;
  onRestore: (profile: TaxProfile) => void;
}

function TaxRow({
  profile,
  busy,
  capReached,
  capNoteId,
  onEdit,
  onArchive,
  onMakeDefault,
  onRestore,
}: RowProps) {
  const name = `${t(`acct.tax.docTypesShort.${profile.docType}` as MessageKey)} ${profile.docNumber}`;
  const mine = busy?.id === profile.id ? busy.kind : null;
  const blocked = busy !== null;
  return (
    <li className="flex flex-col gap-3 rounded-card border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="eyebrow text-muted-foreground">
            {t(`acct.tax.docTypesShort.${profile.docType}` as MessageKey)}
          </span>
          <span className="break-all font-medium tabular-nums">{profile.docNumber}</span>
          {profile.isDefault && <Badge tone="solid">{t("acct.tax.defaultBadge")}</Badge>}
        </p>
        <p className="break-words text-sm text-muted-foreground">{profile.legalName}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {profile.archived ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("acct.tax.restoreNamed", { name })}
            aria-disabled={blocked || capReached || undefined}
            aria-describedby={capReached ? capNoteId : undefined}
            loading={mine === "restore"}
            onClick={() => !blocked && !capReached && onRestore(profile)}
          >
            {t("acct.tax.restore")}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("acct.tax.editNamed", { name })}
              onClick={() => onEdit(profile)}
            >
              {t("acct.tax.edit")}
            </Button>
            {!profile.isDefault && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("acct.tax.makeDefaultNamed", { name })}
                aria-disabled={blocked || undefined}
                loading={mine === "default"}
                onClick={() => !blocked && onMakeDefault(profile)}
              >
                {t("acct.tax.makeDefault")}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("acct.tax.archiveNamed", { name })}
              onClick={() => onArchive(profile)}
            >
              {t("acct.tax.archive")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * `/cuenta/datos-fiscales`: hasta 10 datos fiscales activos (tipo, documento y razón social), uno predeterminado. Nada se
 * borra: se archiva y se puede restaurar. PROVISIONAL en estilo (no hay diseño de cuenta).
 */
export function TaxProfilesPage() {
  const id = useId();
  const query = useTaxProfiles();
  const settings = useStoreSettings();
  const archive = useArchiveTaxProfile();
  const restore = useRestoreTaxProfile();
  const makeDefault = useSetDefaultTaxProfile();
  const mode = parseTaxIdMode(settings.data?.tax_id_validation);

  const [dialog, setDialog] = useState<TaxDialogTarget | null>(null);
  const [archiving, setArchiving] = useState<TaxProfile | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<{ id: string; kind: ActionKind } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const singleFlight = useSingleFlight();

  // Cuando quien abrió un diálogo o pulsó una acción ya no existe (la fila se movió o desapareció), el foco no se pierde:
  // vuelve al título de la sección.
  const focusHeading = () => headingRef.current?.focus();

  const all = query.data ?? [];
  const active = all.filter((p) => !p.archived);
  const archived = all.filter((p) => p.archived);
  const capReached = active.length >= MAX_ACTIVE_TAX_PROFILES;
  const capNoteId = `${id}-cap`;
  const archivedListId = `${id}-archived`;

  const run = async (
    profile: TaxProfile,
    kind: ActionKind,
    action: (id: string) => Promise<unknown>,
    message: MessageKey,
  ) => {
    // `singleFlight`: dos clics en el mismo instante (en esta fila o en otra) → una sola petición.
    await singleFlight(async () => {
      setBusy({ id: profile.id, kind });
      try {
        await action(profile.id);
        toast.success(t(message));
        focusHeading();
      } catch (error) {
        toast.error(toAppError(error).message);
      } finally {
        setBusy(null);
      }
    });
  };

  const confirmArchive = async () => {
    if (!archiving) return;
    await singleFlight(async () => {
      setArchiveError(null);
      try {
        await archive.mutateAsync(archiving.id);
        toast.success(t("acct.tax.messages.archived"));
        setArchiving(null);
      } catch (error) {
        setArchiveError(toAppError(error).message);
      }
    });
  };

  const addButton = (
    <Button
      type="button"
      aria-disabled={capReached || undefined}
      aria-describedby={capReached ? capNoteId : undefined}
      onClick={() => !capReached && setDialog({ kind: "create" })}
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
      {t("acct.tax.add")}
    </Button>
  );

  const rowProps = {
    busy,
    capReached,
    capNoteId,
    onEdit: (profile: TaxProfile) => setDialog({ kind: "edit", profile }),
    onArchive: (profile: TaxProfile) => {
      setArchiveError(null);
      setArchiving(profile);
    },
    onMakeDefault: (profile: TaxProfile) =>
      void run(profile, "default", makeDefault.mutateAsync, "acct.tax.messages.defaulted"),
    onRestore: (profile: TaxProfile) =>
      void run(profile, "restore", restore.mutateAsync, "acct.tax.messages.restored"),
  };

  let body;
  if (query.isPending) {
    body = (
      <div aria-busy="true" className="space-y-3">
        <p className="sr-only" role="status">
          {t("acct.tax.loading")}
        </p>
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        title={t("acct.tax.error.title")}
        description={t("acct.tax.error.description")}
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    body = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t("acct.tax.count", { n: active.length, max: MAX_ACTIVE_TAX_PROFILES })}
          </p>
          {active.length > 0 && addButton}
        </div>
        {capReached && (
          <p id={capNoteId} role="status" className="text-sm text-warning">
            {t("acct.tax.capReached", { max: MAX_ACTIVE_TAX_PROFILES })}
          </p>
        )}
        {active.length === 0 ? (
          <EmptyState
            title={t("acct.tax.empty.title")}
            description={t("acct.tax.empty.description")}
            action={addButton}
          />
        ) : (
          <ul aria-label={t("acct.tax.list.active")} className="space-y-3">
            {active.map((profile) => (
              <TaxRow key={profile.id} profile={profile} {...rowProps} />
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <div className="space-y-3">
            <Button
              type="button"
              variant="link"
              aria-expanded={showArchived}
              aria-controls={archivedListId}
              onClick={() => setShowArchived((v) => !v)}
            >
              {t(showArchived ? "acct.tax.archived.hide" : "acct.tax.archived.show", {
                n: archived.length,
              })}
            </Button>
            {showArchived && (
              <ul
                id={archivedListId}
                aria-label={t("acct.tax.list.archived")}
                className="space-y-3 opacity-90"
              >
                {archived.map((profile) => (
                  <TaxRow key={profile.id} profile={profile} {...rowProps} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-display-md focus:outline-none"
        >
          {t("acct.tax.title")}
        </h2>
        <p className="text-muted-foreground">
          {t("acct.tax.intro", { max: MAX_ACTIVE_TAX_PROFILES })}
        </p>
      </header>
      {body}

      <TaxProfileDialog
        target={dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        mode={mode}
        onCloseAutoFocus={(event) => {
          if (!event.defaultPrevented) {
            event.preventDefault();
            focusHeading();
          }
        }}
      />

      <Dialog
        open={archiving !== null}
        onOpenChange={(open) => !open && !archive.isPending && setArchiving(null)}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (!event.defaultPrevented) {
              event.preventDefault();
              focusHeading();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("acct.tax.archiveDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("acct.tax.archiveDialog.description")}
              {archiving?.isDefault && active.length > 1
                ? ` ${t("acct.tax.archiveDialog.defaultNote")}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {archiveError && <FormAlert>{archiveError}</FormAlert>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-disabled={archive.isPending || undefined}
              onClick={() => !archive.isPending && setArchiving(null)}
            >
              {t("acct.tax.archiveDialog.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={archive.isPending}
              onClick={() => void confirmArchive()}
            >
              {t("acct.tax.archiveDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

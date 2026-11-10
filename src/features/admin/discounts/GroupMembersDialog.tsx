import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ConflictBanner } from "../ui/ConflictBanner";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { useDebouncedValue } from "../hooks";
import { isStaleVersion } from "../lib/versioned";
import { addMember, setMemberArchived } from "./api";
import { MIN_SEARCH_LENGTH, memberName } from "./GroupsLogic";
import { useDiscountMutation, useInvalidateDiscounts, useMembers, useProfileSearch } from "./hooks";
import type { CustomerGroup, GroupMember, ProfileHit } from "./types";

const M = "admin.discounts.groups.membersDialog" as const;
/** Espera tras la última tecla antes de buscar (una consulta por cada tecla sería un abuso). */
export const SEARCH_DELAY_MS = 300;

function MembersBody({ group }: { group: CustomerGroup }) {
  const members = useMembers(group.id);
  const invalidate = useInvalidateDiscounts();
  const add = useDiscountMutation((hit: ProfileHit) => addMember(group.id, hit.id));
  const remove = useDiscountMutation((member: GroupMember) =>
    setMemberArchived(member.id, member.updatedAt, true),
  );

  const [text, setText] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [toRemove, setToRemove] = useState<GroupMember | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const typed = text.trim();
  const debounced = useDebouncedValue(typed, SEARCH_DELAY_MS);
  const search = useProfileSearch(debounced);
  const searchable = typed.length >= MIN_SEARCH_LENGTH;
  const waiting = searchable && (typed !== debounced || search.isFetching);

  const memberIds = useMemo(
    () => new Set((members.data ?? []).map((m) => m.profileId)),
    [members.data],
  );
  const readOnly = group.archived;

  useEffect(() => {
    if (status === "") return;
    const id = setTimeout(() => setStatus(""), 6000);
    return () => clearTimeout(id);
  }, [status]);

  const addHit = async (hit: ProfileHit) => {
    if (add.isPending) return;
    setAddError(null);
    try {
      await add.mutateAsync(hit);
      const message = t("admin.discounts.groups.toasts.memberAdded", { name: hit.fullName });
      setStatus(message);
      toast.success(message);
      // El botón «Agregar» se vuelve texto: el foco vuelve al buscador para seguir agregando.
      searchRef.current?.focus();
    } catch (e) {
      setAddError(toAppError(e).message);
    }
  };

  const removeMember = async (member: GroupMember) => {
    try {
      await remove.mutateAsync(member);
      const message = t("admin.discounts.groups.toasts.memberRemoved", {
        name: memberName(member.fullName),
      });
      setStatus(message);
      toast.success(message);
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
        void invalidate();
        return;
      }
      toast.error(toAppError(e).message);
      throw e;
    }
  };

  let searchResults = null;
  if (searchable && !waiting) {
    if (search.isError) {
      searchResults = (
        <ErrorState message={t(`${M}.searchError`)} onRetry={() => void search.refetch()} />
      );
    } else if (search.isSuccess && search.data.length === 0) {
      searchResults = <EmptyState>{t(`${M}.noResults`, { query: typed })}</EmptyState>;
    } else if (search.isSuccess) {
      searchResults = (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {search.data.length === 1
              ? t(`${M}.resultsCountOne`)
              : t(`${M}.resultsCount`, { count: search.data.length })}
          </p>
          <ul aria-label={t(`${M}.resultsLabel`)} className="grid gap-2">
            {search.data.map((hit) => (
              <li
                key={hit.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words font-medium">{hit.fullName}</p>
                  {hit.email && (
                    <p className="break-all text-xs text-muted-foreground">{hit.email}</p>
                  )}
                  {hit.phone && (
                    <p className="text-xs text-muted-foreground">
                      {t(`${M}.phone`, { phone: hit.phone })}
                    </p>
                  )}
                </div>
                {memberIds.has(hit.id) ? (
                  <span className="text-sm text-muted-foreground">{t(`${M}.alreadyIn`)}</span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    loading={add.isPending && add.variables?.id === hit.id}
                    disabled={add.isPending && add.variables?.id !== hit.id}
                    aria-label={t(`${M}.addNamed`, { name: hit.fullName })}
                    onClick={() => void addHit(hit)}
                  >
                    {add.isPending && add.variables?.id === hit.id
                      ? t(`${M}.adding`)
                      : t(`${M}.add`)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      );
    }
  }

  let list;
  if (members.isError)
    list = <ErrorState message={t(`${M}.loadError`)} onRetry={() => void members.refetch()} />;
  else if (members.isPending) list = <LoadingState />;
  else if (members.data.length === 0) list = <EmptyState>{t(`${M}.empty`)}</EmptyState>;
  else {
    list = (
      <ul aria-label={t(`${M}.listLabel`)} className="grid gap-2">
        {members.data.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-1"
          >
            <div className="min-w-0 flex-1 basis-48 py-1">
              <p className="break-words font-medium">{memberName(m.fullName)}</p>
              <p className="break-all text-xs text-muted-foreground">
                {m.email ?? t(`${M}.noEmail`)}
              </p>
            </div>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                aria-label={t(`${M}.removeNamed`, { name: memberName(m.fullName) })}
                onClick={() => setToRemove(m)}
              >
                {t(`${M}.remove`)}
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="grid gap-4">
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {status}
      </p>
      {readOnly && (
        <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          {t(`${M}.archivedGroup`)}
        </p>
      )}
      {conflict && (
        <ConflictBanner
          onReload={() => {
            setConflict(false);
            void invalidate();
          }}
        />
      )}

      {!readOnly && (
        <section className="grid gap-3">
          <Field label={t(`${M}.search`)} hint={t(`${M}.searchHint`)}>
            <Input
              ref={searchRef}
              className="min-h-11"
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setAddError(null);
              }}
            />
          </Field>
          {addError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {addError}
            </p>
          )}
          {waiting && (
            <p role="status" className="text-sm text-muted-foreground">
              {t(`${M}.searching`)}
            </p>
          )}
          {searchResults}
        </section>
      )}

      <section aria-labelledby={titleId} className="grid gap-2">
        <h3 id={titleId} className="font-display text-base font-semibold">
          {t(`${M}.listTitle`, { count: members.data?.length ?? 0 })}
        </h3>
        {list}
      </section>

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
        title={t(`${M}.confirmRemove.title`, { name: memberName(toRemove?.fullName ?? null) })}
        description={t(`${M}.confirmRemove.body`)}
        confirmLabel={t(`${M}.confirmRemove.confirm`)}
        destructive
        onConfirm={() => removeMember(toRemove as GroupMember)}
      />
    </div>
  );
}

interface GroupMembersDialogProps {
  group: CustomerGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Miembros de un grupo: quiénes están, búsqueda de clientas (mínimo 2 letras, con retardo) para agregarlas y quitar a quien ya
 * no corresponde. Los datos de las clientas viven solo en la memoria de esta pantalla (la búsqueda no se guarda en caché).
 */
export function GroupMembersDialog({ group, open, onOpenChange }: GroupMembersDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="break-words leading-tight">
            {t(`${M}.title`, { name: group?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t(`${M}.description`)}</DialogDescription>
        </DialogHeader>
        {group && <MembersBody group={group} />}
      </DialogContent>
    </Dialog>
  );
}

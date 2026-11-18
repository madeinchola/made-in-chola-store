import { useState } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LegalKind } from "@/features/legal/types";
import { usePublish } from "./hooks";
import { isoToLaPazLocal, laPazToIso, legalErrorKey, type BodyCheck } from "./logic";

const L = "admin.legal.publish" as const;

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: LegalKind;
  version: number;
  /** ¿Es la primera versión? Desde la segunda hay que decir qué cambió. */
  first: boolean;
  /** La nota que ya traía el borrador. */
  initialNote: string;
  /** Lo que impide publicar el texto (variables, marcas): si hay algo, no se ofrece publicar. */
  check: BodyCheck;
  onPublished: () => void;
}

/** Publicar el borrador: desde cuándo rige y qué cambió. Nada se publica sin esta confirmación y la versión queda inmutable. */
export function PublishDialog({
  open,
  onOpenChange,
  kind,
  version,
  first,
  initialNote,
  check,
  onPublished,
}: PublishDialogProps) {
  const publish = usePublish(kind);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [local, setLocal] = useState(() =>
    isoToLaPazLocal(new Date(Date.now() + 86_400_000).toISOString()),
  );
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [triedWithoutNote, setTriedWithoutNote] = useState(false);

  const effectiveAt = mode === "later" ? laPazToIso(local) : null;
  const dateInvalid = mode === "later" && effectiveAt === null;
  const noteMissing = !first && note.trim() === "";

  const blockers: string[] = [
    ...(check.unknown.length > 0
      ? [t("admin.legal.editor.problems.unknown", { list: check.unknown.join(", ") })]
      : []),
    ...(check.empty.length > 0
      ? [t("admin.legal.editor.problems.empty", { list: check.empty.join(", ") })]
      : []),
    ...(check.pending.length > 0
      ? [t("admin.legal.editor.problems.pending", { list: check.pending.join(", ") })]
      : []),
  ];

  const confirm = async () => {
    setError(null);
    if (noteMissing) {
      setTriedWithoutNote(true);
      return;
    }
    try {
      const result = await publish.mutateAsync({
        effectiveAt,
        note: note.trim() === "" ? null : note.trim(),
      });
      toast.success(t(`${L}.done`, { version: result.version }));
      onOpenChange(false);
      onPublished();
    } catch (e) {
      setError(t(legalErrorKey(e) as MessageKey));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !publish.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${L}.title`, { version })}</DialogTitle>
          <DialogDescription>{t(`${L}.description`)}</DialogDescription>
        </DialogHeader>
        {blockers.length > 0 ? (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            <p className="font-medium text-destructive">{t(`${L}.blocked`)}</p>
            <ul className="list-disc space-y-1 pl-5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t(`${L}.when`)}</legend>
              {(["now", "later"] as const).map((value) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="legal-when"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  {t(value === "now" ? `${L}.now` : `${L}.later`)}
                </label>
              ))}
            </fieldset>
            {mode === "later" && (
              <Field
                label={t(`${L}.date`)}
                error={dateInvalid ? t("admin.legal.errors.effective_in_past") : undefined}
              >
                <Input
                  type="datetime-local"
                  value={local}
                  min={isoToLaPazLocal(new Date().toISOString())}
                  onChange={(event) => setLocal(event.target.value)}
                />
              </Field>
            )}
            <Field
              label={t(`${L}.note`)}
              hint={t(`${L}.noteHelp`)}
              error={
                noteMissing && triedWithoutNote
                  ? t("admin.legal.errors.change_note_required")
                  : undefined
              }
            >
              <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={publish.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t(`${L}.cancel`)}
          </Button>
          {blockers.length === 0 && (
            <Button
              type="button"
              disabled={publish.isPending || dateInvalid}
              onClick={() => void confirm()}
            >
              {publish.isPending ? t(`${L}.publishing`) : t(`${L}.confirm`)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

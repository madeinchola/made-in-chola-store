import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "../ui/PageHeader";
import { addNote } from "./api";
import { useEdits, useHistory, useNotes, useOrderMutation } from "./hooks";
import { errorText, formatDateTime, formatMoney, statusLabel, validateText } from "./logic";
import { NOTE_OK, resultCode, succeeded } from "./outcomes";
import type { EditRow } from "./types";

const D = "admin.orders.detail" as const;

function Loading() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {t("admin.states.loading")}
    </p>
  );
}

/** Línea de tiempo: cada cambio de estado con quién lo hizo y por qué (el navegador no puede leer el motivo: lo da una función). */
export function HistoryCard({ orderId }: { orderId: string }) {
  const history = useHistory(orderId);
  return (
    <SectionCard id="history" title={t(`${D}.history.title`)}>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("admin.states.errorTitle")}
        </p>
      ) : (
        <ol className="space-y-3 border-l pl-4 text-sm">
          {history.data.map((h) => (
            <li key={h.id} className="relative">
              <span
                className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-primary"
                aria-hidden="true"
              />
              <p className="font-medium">
                {h.fromStatus
                  ? t(`${D}.history.change`, {
                      from: statusLabel(h.fromStatus),
                      to: statusLabel(h.toStatus),
                    })
                  : t(`${D}.history.created`)}
              </p>
              <p className="text-muted-foreground">
                {formatDateTime(h.createdAt)} ·{" "}
                {h.actorKind === "admin"
                  ? (h.actorName ?? t(`${D}.history.admin`))
                  : t(`${D}.history.${h.actorKind}` as MessageKey)}
              </p>
              {h.reason && h.reason !== "created" && (
                <p>{t(`${D}.history.reason`, { reason: h.reason })}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

/** Notas internas: solo las ve el equipo (la clienta no las lee ni por la API). */
export function NotesCard({ orderId }: { orderId: string }) {
  const notes = useNotes(orderId);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = useOrderMutation((body: string) => addNote(orderId, body));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const parsed = validateText(text, 2000);
    if (!parsed.ok) {
      setProblem(t(`${D}.notes.${parsed.problem}`));
      return;
    }
    setProblem(null);
    try {
      const result = await save.mutateAsync(parsed.value);
      if (succeeded(result, NOTE_OK)) {
        setText("");
        toast.success(t(`${D}.notes.added`));
      } else {
        toast.error(errorText(resultCode(result)));
      }
    } catch (error) {
      toast.error(toAppError(error).message);
    }
  }

  return (
    <SectionCard id="notes" title={t(`${D}.notes.title`)} description={t(`${D}.notes.description`)}>
      <form onSubmit={(event) => void submit(event)} noValidate className="mb-4 grid gap-3">
        <Field label={t(`${D}.notes.label`)} {...(problem ? { error: problem } : {})}>
          <Textarea
            rows={2}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" size="sm" loading={save.isPending}>
            {t(`${D}.notes.add`)}
          </Button>
        </div>
      </form>
      {notes.isPending ? (
        <Loading />
      ) : notes.data && notes.data.length > 0 ? (
        <ul className="space-y-3 text-sm">
          {notes.data.map((n) => (
            <li key={n.id} className="rounded-md border p-3">
              <p className="whitespace-pre-wrap break-words">{n.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {n.authorName ?? t(`${D}.history.admin`)} · {formatDateTime(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${D}.notes.empty`)}</p>
      )}
    </SectionCard>
  );
}

function editSummary(edit: EditRow): string[] {
  const lines: string[] = [];
  const items = Array.isArray(edit.diff.items)
    ? (edit.diff.items as Record<string, unknown>[])
    : [];
  for (const i of items) {
    const op = String(i.op ?? "");
    const name = String(i.name ?? "");
    if (op === "added") lines.push(t(`${D}.edits.added`, { name, qty: Number(i.qty_after ?? 0) }));
    else if (op === "removed") lines.push(t(`${D}.edits.removed`, { name }));
    else
      lines.push(
        t(`${D}.edits.changed`, {
          name,
          from: Number(i.qty_before ?? 0),
          to: Number(i.qty_after ?? 0),
        }),
      );
  }
  if (edit.diff.contact_changed === true) lines.push(t(`${D}.edits.contact`));
  if (edit.diff.address_changed === true) lines.push(t(`${D}.edits.address`));
  if (edit.diff.shipping_cost_changed === true) lines.push(t(`${D}.edits.shipping`));
  return lines;
}

/** Libro de ediciones: qué cambió, quién y por qué. De los datos personales solo consta que cambiaron. */
export function EditsCard({ orderId, currency }: { orderId: string; currency: string }) {
  const edits = useEdits(orderId);
  if (!edits.data || edits.data.length === 0) return null;
  return (
    <SectionCard id="edits" title={t(`${D}.edits.title`)}>
      <ul className="space-y-3 text-sm">
        {edits.data.map((e) => (
          <li key={e.id} className="rounded-md border p-3">
            <p className="font-medium">
              {t(`${D}.edits.total`, {
                from: formatMoney(Number(e.before.total ?? 0), currency),
                to: formatMoney(Number(e.after.total ?? 0), currency),
              })}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {editSummary(e).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-1">{t(`${D}.edits.reason`, { reason: e.reason })}</p>
            <p className="text-xs text-muted-foreground">
              {e.actorName ?? t(`${D}.history.admin`)} · {formatDateTime(e.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

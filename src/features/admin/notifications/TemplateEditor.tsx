import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isStaleVersion } from "../lib/versioned";
import { FormDialog } from "../ui/FormDialog";
import { FunctionError, previewTemplate, saveTemplate, sendTestEmail } from "./api";
import { channelLabel, draftOf, isDirty, typeLabel } from "./logic";
import type { PreviewResponse, TemplateDraft, TemplateRow } from "./types";

const L = "admin.notifications.editor" as const;
const DEBOUNCE_MS = 500;

interface Props {
  template: TemplateRow | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Editor de una plantilla: texto con variables, la vista previa (armada por la MISMA función que envía) y el envío de prueba a tu
 * propio correo. No deja guardar una plantilla con errores (llaves sueltas, variables que no existen) porque casi seguro es un
 * error de tipeo que dejaría un hueco en el mensaje de la clienta.
 */
export function TemplateEditor({ template, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [response, setResponse] = useState<PreviewResponse | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const sequence = useRef(0);

  useEffect(() => {
    setDraft(template ? draftOf(template) : null);
    setResponse(null);
    setPreviewFailed(false);
  }, [template]);

  // Vista previa con espera: no se llama a la función en cada tecla, y una respuesta tardía de una versión vieja no pisa la nueva.
  useEffect(() => {
    if (!template || !draft) return;
    const mine = ++sequence.current;
    const timer = setTimeout(() => {
      previewTemplate({
        channel: template.channel,
        audience: template.audience,
        subject: draft.subject,
        body: draft.body,
        ctaLabel: draft.ctaLabel,
      })
        .then((value) => {
          if (sequence.current !== mine) return;
          setResponse(value);
          setPreviewFailed(false);
        })
        .catch(() => {
          if (sequence.current === mine) setPreviewFailed(true);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [template, draft]);

  if (!template || !draft) return null;
  const isEmail = template.channel === "email";
  const preview = response?.preview ?? null;
  const set = (patch: Partial<TemplateDraft>) => setDraft({ ...draft, ...patch });

  /** Inserta {{variable}} donde está el cursor del cuerpo (o al final si no hay foco). */
  function insertVariable(name: string) {
    const area = bodyRef.current;
    const token = `{{${name}}}`;
    if (!area || !draft) return set({ body: `${draft?.body ?? ""}${token}` });
    const start = area.selectionStart ?? draft.body.length;
    const end = area.selectionEnd ?? start;
    set({ body: `${draft.body.slice(0, start)}${token}${draft.body.slice(end)}` });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function submit(): Promise<string | null> {
    if (!template || !draft) return null;
    if (!preview) return t(`${L}.errors.waitPreview`);
    if (!preview.ok) return t(`${L}.errors.fix`);
    try {
      await saveTemplate(template, draft);
    } catch (error) {
      if (isStaleVersion(error)) return t(`${L}.errors.stale`);
      throw error;
    }
    toast.success(t(`${L}.saved`));
    onSaved();
    return null;
  }

  async function sendTest() {
    if (!template || !draft || sending) return;
    setSending(true);
    try {
      const result = await sendTestEmail({
        channel: template.channel,
        audience: template.audience,
        subject: draft.subject,
        body: draft.body,
        ctaLabel: draft.ctaLabel,
      });
      if (result.sent) toast.success(t(`${L}.test.sent`));
      else toast.message(t(`${L}.test.skipped`));
    } catch (error) {
      const app = toAppError(error);
      const known =
        `${L}.test.errors.${error instanceof FunctionError ? error.serverCode : app.code}` as MessageKey;
      const text = t(known);
      toast.error(text === known ? app.message : text);
    } finally {
      setSending(false);
    }
  }

  return (
    <FormDialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title={t(`${L}.title`, {
        name: typeLabel(template.key),
        channel: channelLabel(template.channel),
      })}
      description={t(`${L}.description`)}
      submitLabel={t(`${L}.save`)}
      busyLabel={t(`${L}.saving`)}
      onSubmit={submit}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {template.isDefault && (
            <p className="rounded-md border border-info/40 bg-info/10 p-3 text-sm">
              {t(`${L}.defaultNote`)}
            </p>
          )}
          {isEmail && (
            <Field label={t(`${L}.subject`)}>
              <Input
                value={draft.subject}
                maxLength={200}
                onChange={(event) => set({ subject: event.target.value })}
              />
            </Field>
          )}
          <Field label={t(`${L}.body`)} hint={t(`${L}.bodyHint`)}>
            <Textarea
              ref={bodyRef}
              rows={10}
              value={draft.body}
              onChange={(event) => set({ body: event.target.value })}
            />
          </Field>
          {isEmail && (
            <Field label={t(`${L}.cta`)} hint={t(`${L}.ctaHint`)}>
              <Input
                value={draft.ctaLabel}
                maxLength={60}
                onChange={(event) => set({ ctaLabel: event.target.value })}
              />
            </Field>
          )}
          <div className="flex items-center gap-3">
            <Switch
              id="tpl-active"
              checked={draft.active}
              onCheckedChange={(checked) => set({ active: checked })}
            />
            <label htmlFor="tpl-active" className="text-sm">
              {draft.active ? t(`${L}.active`) : t(`${L}.inactive`)}
            </label>
          </div>
          {!draft.active && (
            <p className="text-sm text-muted-foreground">{t(`${L}.inactiveHint`)}</p>
          )}

          <section aria-labelledby="tpl-vars" className="space-y-2">
            <h3 id="tpl-vars" className="text-sm font-semibold">
              {t(`${L}.variables`)}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {(response?.variables ?? []).map((info) => (
                <li key={info.name}>
                  <button
                    type="button"
                    title={info.description}
                    aria-label={t(`${L}.insertVariable`, {
                      name: info.name,
                      description: info.description,
                    })}
                    onClick={() => insertVariable(info.name)}
                    className="min-h-9 rounded-pill border bg-background px-3 font-mono text-xs hover:bg-muted"
                  >
                    {`{{${info.name}}}`}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-3" aria-live="polite">
          <h3 className="text-sm font-semibold">{t(`${L}.preview`)}</h3>
          {previewFailed && <p className="text-sm text-destructive">{t(`${L}.previewFailed`)}</p>}
          {!preview && !previewFailed && (
            <p className="text-sm text-muted-foreground">{t(`${L}.previewLoading`)}</p>
          )}
          {preview && (
            <>
              {preview.errors.length > 0 && (
                <ul className="list-disc space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 pl-7 text-sm">
                  {preview.errors.map((error) => (
                    <li key={error}>
                      {t(`${L}.errors.${error}` as MessageKey, {
                        variables: preview.unknown.join(", "),
                      })}
                    </li>
                  ))}
                </ul>
              )}
              {preview.warnings.map((warning) => (
                <p key={warning} className="text-sm text-muted-foreground">
                  {t(`${L}.warnings.${warning}` as MessageKey)}
                </p>
              ))}
              {isEmail ? (
                <>
                  <p className="text-sm">
                    <span className="font-medium">{t(`${L}.previewSubject`)}: </span>
                    {preview.subject}
                  </p>
                  <iframe
                    title={t(`${L}.previewFrame`)}
                    sandbox=""
                    srcDoc={preview.html ?? ""}
                    className="h-[28rem] w-full rounded-md border bg-white"
                  />
                </>
              ) : (
                <div className="max-w-sm whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted p-4 text-sm">
                  {preview.text}
                </div>
              )}
              {!isEmail && (
                <p className="text-xs text-muted-foreground">
                  {t(`${L}.whatsappCount`, { count: preview.length })}
                </p>
              )}
            </>
          )}
          {isEmail && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={sending || !preview?.ok}
              onClick={() => void sendTest()}
            >
              {sending ? t(`${L}.test.sending`) : t(`${L}.test.button`)}
            </Button>
          )}
          {isDirty(template, draft) && (
            <p className="text-xs text-muted-foreground">{t(`${L}.unsaved`)}</p>
          )}
        </div>
      </div>
    </FormDialog>
  );
}

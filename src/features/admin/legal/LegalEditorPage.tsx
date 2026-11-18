import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { renderLegal } from "@/features/legal/renderLegal";
import { STARTER_TEXTS } from "@/features/legal/starterTexts";
import { LEGAL_KINDS, type LegalKind } from "@/features/legal/types";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { PageHeader } from "../ui/PageHeader";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { UnsavedChangesGuard } from "../ui/UnsavedChangesGuard";
import { BusinessDataNotice } from "./BusinessData";
import { useBusinessData } from "./useBusinessData";
import { PublishDialog } from "./PublishDialog";
import { VersionHistory } from "./VersionHistory";
import { useDiscardDraft, useLegalOverview, useLegalVersion, useSaveDraft } from "./hooks";
import { checkBody, draftVersion, formatDate, legalErrorKey, validateBody } from "./logic";
import type { VersionDetail } from "./types";

const L = "admin.legal.editor" as const;
const MAX = 60_000;

const isKind = (value: string | undefined): value is LegalKind =>
  LEGAL_KINDS.includes(value as LegalKind);

type Source = { mode: "draft" | "published" | "starter"; body: string; note: string };

/** De dónde sale el texto del editor: el borrador, si no la última versión (para partir de ella) o el texto de partida. */
function sourceOf(kind: LegalKind, latest: VersionDetail | null | undefined): Source {
  if (!latest) return { mode: "starter", body: STARTER_TEXTS[kind], note: "" };
  return {
    mode: latest.status === "draft" ? "draft" : "published",
    body: latest.body,
    note: latest.status === "draft" ? (latest.changeNote ?? "") : "",
  };
}

export function LegalEditorPage() {
  const { kind } = useParams();
  if (!isKind(kind)) {
    return (
      <>
        <PageHeader title={t("admin.legal.title")} />
        <p role="alert" className="text-sm text-destructive">
          {t(`${L}.notFound`)}
        </p>
        <Link to="/admin/legal" className="mt-4 inline-block underline underline-offset-2">
          {t(`${L}.back`)}
        </Link>
      </>
    );
  }
  // Una clave por documento: al pasar de uno a otro el editor nace de cero (nada de texto ajeno en la caja).
  return <Editor key={kind} kind={kind} />;
}

function Editor({ kind }: { kind: LegalKind }) {
  const overview = useLegalOverview();
  const latest = useLegalVersion(kind);
  const business = useBusinessData();
  const save = useSaveDraft(kind);
  const discard = useDiscardDraft(kind);

  const row = overview.data?.find((r) => r.kind === kind);
  const source = sourceOf(kind, latest.data);
  // Mientras no se toca nada, el editor sigue lo que hay en el servidor; al escribir, el texto es de quien edita (un refresco al
  // volver a la pestaña no puede pisarlo).
  const [edit, setEdit] = useState<{ body: string; note: string } | null>(null);
  const body = edit?.body ?? source.body;
  const note = edit?.note ?? source.note;
  const dirty = edit !== null && (edit.body !== source.body || edit.note !== source.note);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (overview.isError || latest.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void overview.refetch();
          void latest.refetch();
        }}
      />
    );
  }
  if (!row || latest.isPending) return <LoadingState />;

  const next = draftVersion(row);
  const first = row.versions.length === 0 || (row.versions.length === 1 && row.hasDraft);
  const check = checkBody(body, business.vars);
  const needsSave = source.mode !== "draft" || dirty;
  const canPublish = source.mode === "draft" && !dirty;

  const onSave = async () => {
    setFormError(null);
    const invalid = validateBody(body);
    if (invalid) {
      setFormError(t(`admin.legal.errors.${invalid}` as MessageKey));
      return;
    }
    try {
      await save.mutateAsync({ body, note: note.trim() === "" ? null : note.trim() });
      setEdit(null);
      toast.success(t(`${L}.saved`));
    } catch (e) {
      setFormError(t(legalErrorKey(e)));
    }
  };

  const sourceText =
    source.mode === "draft"
      ? t(`${L}.source.draft`, { version: next })
      : source.mode === "published"
        ? t(`${L}.source.published`, { version: next - 1, next })
        : t(`${L}.source.starter`);

  return (
    <>
      <UnsavedChangesGuard dirty={dirty} />
      <p className="mb-3">
        <Link
          to="/admin/legal"
          className="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t(`${L}.back`)}
        </Link>
      </p>
      <PageHeader
        title={row.title}
        description={
          row.currentVersion !== null && row.currentEffectiveAt
            ? t(`${L}.current`, {
                version: row.currentVersion,
                date: formatDate(row.currentEffectiveAt),
              })
            : t(`${L}.nothingCurrent`)
        }
      />
      <div className="space-y-6">
        <BusinessDataNotice />
        <p role="status" className="text-sm text-muted-foreground">
          {sourceText}
        </p>

        <div
          role="group"
          aria-label={t(`${L}.tabs.label`)}
          className="inline-flex gap-1 rounded-md bg-muted p-1 text-sm"
        >
          {(["edit", "preview"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              className={`min-h-11 rounded-sm px-4 font-medium ${tab === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {t(`${L}.tabs.${value}`)}
            </button>
          ))}
        </div>

        {tab === "edit" ? (
          <div className="space-y-4">
            <Field label={t(`${L}.body`)} hint={t(`${L}.bodyHelp`)}>
              <Textarea
                rows={24}
                spellCheck
                className="font-mono text-sm"
                value={body}
                onChange={(event) => setEdit({ body: event.target.value, note })}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              <span className={body.length > MAX ? "text-destructive" : ""}>
                {t(`${L}.counter`, { count: body.length.toLocaleString("es-BO") })}
              </span>
            </p>
            <Field label={t(`${L}.note`)} hint={t(`${L}.noteHelp`)}>
              <Textarea
                rows={3}
                value={note}
                onChange={(event) => setEdit({ body, note: event.target.value })}
              />
            </Field>
          </div>
        ) : (
          <section
            aria-label={t(`${L}.tabs.preview`)}
            className="rounded-lg border bg-background p-4 sm:p-6"
          >
            <p className="mb-4 text-xs text-muted-foreground">{t(`${L}.previewNote`)}</p>
            {body.trim() === "" ? (
              <p className="text-sm text-muted-foreground">{t(`${L}.previewEmpty`)}</p>
            ) : (
              <div className="max-w-3xl text-[15px]" data-testid="preview-body">
                {renderLegal(body, business.vars, t("legal.page.missingData"))}
              </div>
            )}
          </section>
        )}

        {!check.ok && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {check.unknown.length > 0 && (
              <li>{t(`${L}.problems.unknown`, { list: check.unknown.join(", ") })}</li>
            )}
            {check.empty.length > 0 && (
              <li>{t(`${L}.problems.empty`, { list: check.empty.join(", ") })}</li>
            )}
            {check.pending.length > 0 && (
              <li>{t(`${L}.problems.pending`, { list: check.pending.join(", ") })}</li>
            )}
          </ul>
        )}

        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        {dirty && (
          <p role="status" className="text-sm text-warning">
            {t(`${L}.unsaved`)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={save.isPending || !needsSave}
            onClick={() => void onSave()}
          >
            {save.isPending ? t(`${L}.saving`) : t(`${L}.save`)}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canPublish}
            onClick={() => setPublishing(true)}
          >
            {t(`${L}.publish`)}
          </Button>
          {source.mode === "draft" && (
            <Button type="button" variant="ghost" onClick={() => setDiscarding(true)}>
              {t(`${L}.discard`)}
            </Button>
          )}
          {source.mode === "starter" && dirty && (
            <Button type="button" variant="ghost" onClick={() => setEdit(null)}>
              {t(`${L}.startOver`)}
            </Button>
          )}
          {!canPublish && (
            <span className="text-xs text-muted-foreground">{t(`${L}.publishNeedsSave`)}</span>
          )}
        </div>

        <VersionHistory
          kind={kind}
          versions={row.versions}
          vars={business.vars}
          onUseAsBase={(text, versionNote) => {
            setEdit({ body: text, note: versionNote });
            setTab("edit");
          }}
        />
      </div>

      {publishing && (
        <PublishDialog
          open
          onOpenChange={(open) => !open && setPublishing(false)}
          kind={kind}
          version={next}
          first={first}
          initialNote={source.note}
          check={check}
          onPublished={() => setEdit(null)}
        />
      )}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t(`${L}.discardTitle`)}
        description={t(`${L}.discardBody`, { version: next })}
        confirmLabel={t(`${L}.discard`)}
        destructive
        onConfirm={async () => {
          try {
            await discard.mutateAsync();
            setEdit(null);
            toast.success(t(`${L}.discarded`));
          } catch (e) {
            toast.error(t(legalErrorKey(e)));
            throw e;
          }
        }}
      />
    </>
  );
}

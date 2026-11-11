import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConflictBanner } from "../ui/ConflictBanner";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { qrPublicUrl, updateMethod, uploadQrImage } from "./api";
import { useMethods, usePaymentMutation } from "./hooks";
import {
  isQrProvider,
  methodFormFrom,
  providerLabel,
  qrExtension,
  QR_MAX_BYTES,
  validateMethodForm,
  visibleMethods,
  windowText,
  type MethodErrors,
  type MethodForm,
} from "./logic";
import type { MethodRow } from "./types";

const M = "admin.payments.methods" as const;
const K = "admin.payments.methods.dialog" as const;

function MethodEditForm({
  method,
  onClose,
  onSaved,
}: {
  method: MethodRow;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [form, setForm] = useState<MethodForm>(() => methodFormFrom(method));
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrProblem, setQrProblem] = useState<MessageKey | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<MethodErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  const qr = isQrProvider(method.provider);

  const save = usePaymentMutation(async (patch: object) => {
    // La imagen nueva se sube primero; si el guardado falla, ese archivo queda huérfano pero NO se usa (nada apunta a él).
    let qrPath = method.qrImagePath;
    if (qrFile) {
      const ext = qrExtension(qrFile.type);
      if (!ext) throw new Error("qr-type");
      qrPath = await uploadQrImage(qrFile, ext);
    }
    return updateMethod(method.id, method.updatedAt, { ...patch, qr_image_path: qrPath });
  });

  useEffect(() => {
    if (!qrFile || typeof URL.createObjectURL !== "function") {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(qrFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [qrFile]);

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const set = <Key extends keyof MethodForm>(key: Key, value: MethodForm[Key]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const err = (key: keyof MethodErrors) => (errors[key] ? t(errors[key] as MessageKey) : undefined);

  function pickQr(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setQrProblem(null);
    if (!file) return setQrFile(null);
    if (!qrExtension(file.type)) {
      setQrFile(null);
      return setQrProblem(`${M}.errors.qrType`);
    }
    if (file.size > QR_MAX_BYTES) {
      setQrFile(null);
      return setQrProblem(`${M}.errors.qrSize`);
    }
    setQrFile(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    // Con una imagen nueva elegida, ya hay QR aunque el método no tuviera.
    const check = validateMethodForm(form, {
      provider: method.provider,
      qrImagePath: qrFile ? "nueva" : method.qrImagePath,
    });
    if (!check.ok) {
      setErrors(check.errors);
      setAttempt((n) => n + 1);
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync(check.patch);
      onSaved(t(`${K}.done`));
      onClose();
    } catch (error) {
      if (isStaleVersion(error)) setConflict(true);
      else setFormError(toAppError(error).message);
    }
  }

  const shown = preview ?? (method.qrImagePath ? qrPublicUrl(method.qrImagePath) : null);
  return (
    <form ref={formRef} onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
      {conflict && <ConflictBanner onReload={onClose} />}
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <Field label={t(`${K}.name`)} hint={t(`${K}.nameHelp`)} error={err("name")}>
        <Input value={form.name} maxLength={90} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label={t(`${K}.descriptionLabel`)} error={err("description")}>
        <Textarea
          value={form.description}
          maxLength={320}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {t(`${K}.isActive`)}
      </label>
      {qr && (
        <Field label={t(`${K}.window`)} hint={t(`${K}.windowHelp`)} error={err("windowMinutes")}>
          <Input
            inputMode="numeric"
            value={form.windowMinutes}
            onChange={(e) => set("windowMinutes", e.target.value)}
          />
        </Field>
      )}
      <Field label={t(`${K}.maxAmount`)} hint={t(`${K}.maxAmountHelp`)} error={err("maxAmount")}>
        <Input
          inputMode="decimal"
          value={form.maxAmount}
          onChange={(e) => set("maxAmount", e.target.value)}
        />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={form.blockedForBlacklisted}
          onChange={(e) => set("blockedForBlacklisted", e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {t(`${K}.blacklisted`)}
      </label>
      {qr && (
        <>
          <Field
            label={t(`${K}.account`)}
            hint={t(`${K}.accountHelp`)}
            error={err("accountDetails")}
          >
            <Textarea
              value={form.accountDetails}
              maxLength={520}
              onChange={(e) => set("accountDetails", e.target.value)}
            />
          </Field>
          <Field
            label={t(`${K}.qr`)}
            hint={t(`${K}.qrHelp`)}
            error={qrProblem ? t(qrProblem) : err("qr")}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={pickQr}
              className="block min-h-11 w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-background file:px-4 file:text-sm file:font-medium"
            />
          </Field>
          <div>
            {shown ? (
              <img
                src={shown}
                alt={t(`${K}.qrAlt`)}
                className="h-40 w-40 rounded-md border border-border bg-white object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t(`${K}.qrNone`)}</p>
            )}
            {qrFile && <p className="mt-1 text-xs text-muted-foreground">{t(`${K}.qrNew`)}</p>}
          </div>
        </>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={save.isPending}
          onClick={onClose}
        >
          {t("admin.actions.cancel")}
        </Button>
        <Button type="submit" className="min-h-11" loading={save.isPending} disabled={conflict}>
          {save.isPending ? t(`${K}.submitting`) : t(`${K}.submit`)}
        </Button>
      </DialogFooter>
    </form>
  );
}

function MethodDialog({
  method,
  onClose,
  onSaved,
}: {
  method: MethodRow | null;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  return (
    <Dialog open={method !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="break-words">
            {t(`${K}.title`, { name: method?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t(`${K}.description`)}</DialogDescription>
        </DialogHeader>
        {method && (
          <MethodEditForm
            key={method.id + method.updatedAt}
            method={method}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Métodos de pago: cómo te pagan tus clientas. Un método QR solo puede estar encendido si tiene su QR y los datos de la cuenta. */
export function MethodsPage() {
  const query = useMethods();
  const [editing, setEditing] = useState<MethodRow | null>(null);
  const [status, setStatus] = useState("");
  const saved = (message: string) => {
    setStatus(message);
    toast.success(message);
  };

  const columns: Column<MethodRow>[] = [
    {
      id: "name",
      header: t(`${M}.columns.name`),
      cell: (r) => (
        <div className="min-w-[10rem]">
          <p className="break-words font-medium">{r.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{r.code}</p>
        </div>
      ),
    },
    {
      id: "provider",
      header: t(`${M}.columns.provider`),
      cell: (r) => providerLabel(r.provider),
    },
    { id: "window", header: t(`${M}.columns.window`), cell: (r) => windowText(r.windowMinutes) },
    {
      id: "state",
      header: t(`${M}.columns.state`),
      cell: (r) => (
        <Badge tone={r.isActive ? "success" : "neutral"}>
          {r.isActive ? t(`${M}.active`) : t(`${M}.inactive`)}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${M}.columns.actions`)}</span>,
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t(`${M}.editLabel`, { name: r.name })}
          onClick={() => setEditing(r)}
        >
          {t(`${M}.edit`)}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <p className="text-sm text-muted-foreground">{t(`${M}.description`)}</p>
      <p className="text-sm text-muted-foreground">{t(`${M}.example`)}</p>
      <DataTable
        caption={t(`${M}.caption`)}
        columns={columns}
        rows={visibleMethods(query.data ?? [])}
        getRowId={(r) => r.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={<EmptyState>{t(`${M}.empty`)}</EmptyState>}
      />
      <MethodDialog method={editing} onClose={() => setEditing(null)} onSaved={saved} />
    </div>
  );
}

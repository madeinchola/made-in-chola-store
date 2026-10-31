import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
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
import { toAppError } from "@/lib/errors";
import { duplicateProduct } from "../api";
import { CODE_RE } from "../productSchema";
import type { AdminProductData } from "../types";

interface Props {
  product: AdminProductData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDuplicated: (newId: string) => void;
}

/** Duplica la estructura del producto (sin imágenes ni stock) con un código y nombre nuevos. Nace como borrador. */
export function DuplicateDialog({ product, open, onOpenChange, onDuplicated }: Props) {
  const [code, setCode] = useState(`${product.code}-COPIA`.slice(0, 40));
  const [name, setName] = useState(`${product.name} (copia)`.slice(0, 160));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string | undefined>();
  const [nameError, setNameError] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const cleanCode = code.trim();
    const cleanName = name.trim();
    const cErr = CODE_RE.test(cleanCode) ? undefined : t("admin.products.errors.codeFormat");
    const nErr =
      cleanName === ""
        ? t("admin.products.errors.nameRequired")
        : cleanName.length > 160
          ? t("admin.products.errors.nameTooLong")
          : undefined;
    setCodeError(cErr);
    setNameError(nErr);
    setError(undefined);
    if (cErr || nErr) return;
    setBusy(true);
    try {
      const id = await duplicateProduct(product.id, cleanCode, cleanName);
      toast.success(t("admin.products.edit.duplicated"));
      onOpenChange(false);
      onDuplicated(id);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("admin.products.edit.duplicateDialog.title")}</DialogTitle>
            <DialogDescription>{t("admin.products.edit.duplicateDialog.body")}</DialogDescription>
          </DialogHeader>
          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <Field
            label={t("admin.products.edit.duplicateDialog.code")}
            error={codeError}
            hint={t("admin.products.data.codeHint")}
          >
            <Input
              value={code}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label={t("admin.products.edit.duplicateDialog.name")} error={nameError}>
            <Input
              value={name}
              maxLength={160}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("admin.actions.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy
                ? t("admin.products.edit.duplicateDialog.submitting")
                : t("admin.products.edit.duplicateDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

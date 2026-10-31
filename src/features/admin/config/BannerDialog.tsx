import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toLaPazInputValue } from "@/lib/datetime";
import { toAppError } from "@/lib/errors";
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
import { isStaleVersion } from "../lib/versioned";
import { createBanner, updateBanner } from "./api";
import {
  MAX_BANNER_MESSAGE,
  validateBanner,
  type BannerErrors,
  type BannerFormValues,
} from "./bannerLogic";
import { charLength } from "./pgText";
import type { Banner } from "./types";

interface BannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = banner nuevo. */
  banner: Banner | null;
  /** Se llama tras guardar bien (para refrescar la lista). */
  onSaved: () => void | Promise<void>;
}

const initialValues = (b: Banner | null): BannerFormValues => ({
  message: b?.message ?? "",
  linkUrl: b?.linkUrl ?? "",
  startsAt: toLaPazInputValue(b?.startsAt),
  endsAt: toLaPazInputValue(b?.endsAt),
  isActive: b?.isActive ?? true,
});

function BannerForm({
  banner,
  onClose,
  onSaved,
}: {
  banner: Banner | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [values, setValues] = useState<BannerFormValues>(() => initialValues(banner));
  const [errors, setErrors] = useState<BannerErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof BannerFormValues>(key: K, value: BannerFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    const result = validateBanner(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (banner) await updateBanner(banner, result.payload);
      else await createBanner(result.payload);
      toast.success(
        banner
          ? t("admin.config.banners.toasts.updated")
          : t("admin.config.banners.toasts.created"),
      );
      await onSaved();
      onClose();
    } catch (e) {
      setFormError(isStaleVersion(e) ? t("admin.conflict.body") : toAppError(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <Field
        label={t("admin.config.banners.form.message")}
        hint={t("admin.config.banners.form.messageHint")}
        {...(errors.message ? { error: errors.message } : {})}
      >
        <Textarea
          rows={2}
          value={values.message}
          onChange={(e) => set("message", e.target.value)}
        />
      </Field>
      <p className="-mt-3 text-right text-xs text-muted-foreground" aria-hidden="true">
        {t("admin.config.banners.form.counter", {
          count: charLength(values.message.trim()),
          max: MAX_BANNER_MESSAGE,
        })}
      </p>
      <Field
        label={t("admin.config.banners.form.link")}
        hint={t("admin.config.banners.form.linkHint")}
        {...(errors.linkUrl ? { error: errors.linkUrl } : {})}
      >
        <Input
          type="text"
          inputMode="url"
          autoComplete="off"
          value={values.linkUrl}
          onChange={(e) => set("linkUrl", e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("admin.config.banners.form.startsAt")}
          {...(errors.startsAt ? { error: errors.startsAt } : {})}
        >
          <Input
            type="datetime-local"
            value={values.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </Field>
        <Field
          label={t("admin.config.banners.form.endsAt")}
          {...(errors.endsAt ? { error: errors.endsAt } : {})}
        >
          <Input
            type="datetime-local"
            value={values.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {t("admin.config.banners.form.datesHint")}
      </p>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={values.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
        />
        {t("admin.config.banners.form.active")}
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
          {t("admin.actions.cancel")}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving
            ? t("admin.config.banners.form.submitting")
            : t("admin.config.banners.form.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Diálogo de alta/edición de un banner. El formulario vive dentro del contenido: se reinicia cada vez que se abre. */
export function BannerDialog({ open, onOpenChange, banner, onSaved }: BannerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {banner
              ? t("admin.config.banners.form.editTitle")
              : t("admin.config.banners.form.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.config.banners.description")}</DialogDescription>
        </DialogHeader>
        <BannerForm banner={banner} onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

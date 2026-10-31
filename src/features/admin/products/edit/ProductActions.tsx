import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { toAppError } from "@/lib/errors";
import { isStaleVersion } from "../../lib/versioned";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { setProductArchived, setProductStatus } from "../api";
import { publishChecks } from "../publishChecks";
import { DuplicateDialog } from "./DuplicateDialog";
import { PublishChecklist } from "./PublishChecklist";
import type { SectionProps } from "./types";

type Pending = "publish" | "unpublish" | "archive" | "restore" | null;

interface Props extends Pick<SectionProps, "detail" | "onChanged" | "onError"> {
  onDuplicated: (newId: string) => void;
}

/** Publicar, pasar a borrador, archivar/restaurar y duplicar. Toda acción con efecto pide confirmación explícita. */
export function ProductActions({ detail, onChanged, onError, onDuplicated }: Props) {
  const p = detail.product;
  const checks = publishChecks(detail);
  const [pending, setPending] = useState<Pending>(null);
  const [duplicating, setDuplicating] = useState(false);

  const change = useMutation({
    mutationFn: (action: "publish" | "unpublish" | "archive" | "restore") => {
      switch (action) {
        case "publish":
          return setProductStatus(p.id, p.updatedAt, "active");
        case "unpublish":
          return setProductStatus(p.id, p.updatedAt, "draft");
        case "archive":
          return setProductArchived(p.id, p.updatedAt, true);
        case "restore":
          return setProductArchived(p.id, p.updatedAt, false);
      }
    },
    onSuccess: async (_data, action) => {
      toast.success(
        action === "publish"
          ? t("admin.products.edit.published")
          : action === "unpublish"
            ? t("admin.products.edit.unpublished")
            : action === "archive"
              ? t("admin.products.edit.archived")
              : t("admin.products.edit.restored"),
      );
      await onChanged();
    },
    onError: (e) => {
      if (!isStaleVersion(e))
        toast.error(t("admin.products.errors.unexpected"), { description: toAppError(e).message });
      onError(e);
    },
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!p.archived &&
          (p.status === "draft" ? (
            <Button type="button" disabled={change.isPending} onClick={() => setPending("publish")}>
              {t("admin.products.edit.publish")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={change.isPending}
              onClick={() => setPending("unpublish")}
            >
              {t("admin.products.edit.unpublish")}
            </Button>
          ))}
        <Button
          type="button"
          variant="outline"
          disabled={change.isPending}
          onClick={() => setDuplicating(true)}
        >
          {t("admin.products.edit.duplicate")}
        </Button>
        {p.archived ? (
          <Button
            type="button"
            variant="outline"
            disabled={change.isPending}
            onClick={() => setPending("restore")}
          >
            {t("admin.products.edit.restore")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={change.isPending}
            onClick={() => setPending("archive")}
          >
            {t("admin.products.edit.archive")}
          </Button>
        )}
        <Button asChild variant="ghost">
          <a href="#sec-preview">{t("admin.products.edit.preview")}</a>
        </Button>
      </div>

      <Dialog open={pending === "publish"} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.products.edit.confirmPublish.title")}</DialogTitle>
            <DialogDescription>{t("admin.products.edit.confirmPublish.body")}</DialogDescription>
          </DialogHeader>
          <PublishChecklist checks={checks} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              {t("admin.actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!checks.canPublish || change.isPending}
              onClick={() => {
                setPending(null);
                change.mutate("publish");
              }}
            >
              {t("admin.products.edit.confirmPublish.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pending === "unpublish"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("admin.products.edit.confirmUnpublish.title")}
        description={t("admin.products.edit.confirmUnpublish.body")}
        confirmLabel={t("admin.products.edit.confirmUnpublish.confirm")}
        onConfirm={() => change.mutateAsync("unpublish").then(() => undefined)}
      />
      <ConfirmDialog
        open={pending === "archive"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("admin.products.edit.confirmArchive.title")}
        description={t("admin.products.edit.confirmArchive.body")}
        confirmLabel={t("admin.products.edit.confirmArchive.confirm")}
        destructive
        onConfirm={() => change.mutateAsync("archive").then(() => undefined)}
      />
      <ConfirmDialog
        open={pending === "restore"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("admin.products.edit.confirmRestore.title")}
        description={t("admin.products.edit.confirmRestore.body")}
        confirmLabel={t("admin.products.edit.confirmRestore.confirm")}
        onConfirm={() => change.mutateAsync("restore").then(() => undefined)}
      />
      {duplicating && (
        <DuplicateDialog
          product={p}
          open
          onOpenChange={(open) => !open && setDuplicating(false)}
          onDuplicated={onDuplicated}
        />
      )}
    </>
  );
}

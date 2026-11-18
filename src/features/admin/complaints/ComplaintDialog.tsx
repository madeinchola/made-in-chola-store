import { useState } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateComplaint } from "./hooks";
import { complaintErrorKey, formatDate, isDirty, mailtoLink, telLink, whatsappLink } from "./logic";
import type { ComplaintRow, ComplaintStatus } from "./types";

const L = "admin.complaints.detail" as const;
const STATUSES: readonly ComplaintStatus[] = ["new", "in_review", "answered", "closed"];

/** Un reclamo completo: quién es, lo que cuenta (como texto, nunca como HTML), cómo contestarle y el registro de lo que se respondió. */
export function ComplaintDialog({ row, onClose }: { row: ComplaintRow; onClose: () => void }) {
  const update = useUpdateComplaint();
  const [status, setStatus] = useState<ComplaintStatus>(row.status);
  const [response, setResponse] = useState(row.response ?? "");
  const [error, setError] = useState<string | null>(null);
  const mail = mailtoLink(row.contactEmail, row.number);
  const wa = whatsappLink(row.contactPhone);
  const tel = telLink(row.contactPhone);
  const dirty = isDirty(row, status, response);

  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        id: row.id,
        status,
        response: response.trim() === "" ? null : response.trim(),
      });
      toast.success(t(`${L}.saved`));
      onClose();
    } catch (e) {
      setError(t(complaintErrorKey(e)));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !update.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(`${L}.title`, { number: row.number })}</DialogTitle>
          <DialogDescription>
            {t(`${L}.description`, { date: formatDate(row.createdAt) })}
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">{t(`${L}.from`)}</dt>
            <dd>
              {row.contactName}{" "}
              <span className="text-muted-foreground">
                {row.hasAccount ? t(`${L}.account`) : t(`${L}.noAccount`)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="font-medium">{t(`${L}.contact`)}</dt>
            <dd className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {row.contactEmail && <span>{row.contactEmail}</span>}
              {row.contactPhone && <span>{row.contactPhone}</span>}
              {mail && (
                <a
                  href={mail}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "min-h-11",
                  })}
                >
                  {t(`${L}.mail`)}
                </a>
              )}
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "min-h-11",
                  })}
                >
                  {t(`${L}.whatsapp`)}
                </a>
              )}
              {tel && (
                <a
                  href={tel}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "min-h-11",
                  })}
                >
                  {t(`${L}.call`)}
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium">{t(`${L}.order`)}</dt>
            <dd>
              {row.orderNumber ?? (
                <span className="text-muted-foreground">{t(`${L}.noOrder`)}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium">{t(`${L}.kind`)}</dt>
            <dd>{t(`admin.complaints.kinds.${row.kind}` as MessageKey)}</dd>
          </div>
          <div>
            <dt className="font-medium">{t(`${L}.detail`)}</dt>
            {/* Texto de quien reclama: se muestra como texto (con sus saltos de línea), nunca como HTML. */}
            <dd
              data-testid="complaint-detail"
              className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3"
            >
              {row.detail}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {row.status === "new" || row.status === "in_review"
            ? t(`${L}.due`, { date: formatDate(row.dueAt) })
            : row.answeredAt
              ? t(`${L}.answeredAt`, { date: formatDate(row.answeredAt) })
              : null}
        </p>
        <div className="space-y-4">
          <Field label={t(`${L}.statusLabel`)}>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as ComplaintStatus)}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.complaints.status.${value}` as MessageKey)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t(`${L}.response`)} hint={t(`${L}.responseHint`)}>
            <Textarea
              rows={5}
              maxLength={2000}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={update.isPending} onClick={onClose}>
            {t(`${L}.close`)}
          </Button>
          <Button type="button" disabled={!dirty || update.isPending} onClick={() => void save()}>
            {update.isPending ? t(`${L}.saving`) : t(`${L}.save`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

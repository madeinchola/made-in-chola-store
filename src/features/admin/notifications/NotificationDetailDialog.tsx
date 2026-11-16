import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelNotification, markNotificationSent, resendNotification } from "./api";
import { useInvalidateNotifications, useThread } from "./hooks";
import {
  canCancel,
  canMarkSent,
  canResend,
  channelLabel,
  errorLabel,
  formatDateTime,
  statusLabel,
  statusTone,
  typeLabel,
  whatsappLink,
} from "./logic";
import type { ActionResult, NotificationRow } from "./types";

const L = "admin.notifications.detail" as const;

interface Props {
  row: NotificationRow | null;
  onClose: () => void;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/** El detalle de un aviso: a quién, cuándo, qué se envió y qué pasó; y lo que el administrador puede hacer con él. */
export function NotificationDetailDialog({ row, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const thread = useThread(row);
  const invalidate = useInvalidateNotifications();

  async function run(action: (id: number) => Promise<ActionResult>, doneKey: string) {
    if (!row || busy) return;
    setBusy(true);
    try {
      const result = await action(row.id);
      const outcomeKey = `${L}.outcome.${result.outcome}`;
      const text = t(outcomeKey as never);
      if (["queued", "sent", "cancelled"].includes(result.outcome))
        toast.success(t(doneKey as never));
      else toast.error(text === outcomeKey ? result.outcome : text);
      await invalidate();
      if (result.outcome !== "queued") onClose();
    } catch (error) {
      toast.error(toAppError(error).message);
    } finally {
      setBusy(false);
    }
  }

  const link =
    row && row.channel === "whatsapp" ? whatsappLink(row.recipient, row.renderedBody) : null;
  const others = (thread.data ?? []).filter((item) => item.id !== row?.id);

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>{typeLabel(row.type)}</DialogTitle>
              <DialogDescription>
                {t(`${L}.description`, { id: row.id, channel: channelLabel(row.channel) })}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Fact label={t(`${L}.status`)}>
                <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
              </Fact>
              <Fact label={t(`${L}.recipient`)}>
                {row.recipient ?? t("admin.notifications.log.admins")}
              </Fact>
              <Fact label={t(`${L}.order`)}>
                {row.orderId ? (
                  <Link
                    to={`/admin/pedidos/${row.orderId}`}
                    className="underline underline-offset-2"
                  >
                    {row.orderNumber ?? t(`${L}.openOrder`)}
                  </Link>
                ) : (
                  t("admin.none")
                )}
              </Fact>
              <Fact label={t(`${L}.attempts`)}>{row.attempts}</Fact>
              <Fact label={t(`${L}.created`)}>{formatDateTime(row.createdAt)}</Fact>
              {row.status === "pending" && (
                <Fact label={t(`${L}.nextTry`)}>{formatDateTime(row.nextRetryAt)}</Fact>
              )}
              {row.sentAt && <Fact label={t(`${L}.sentAt`)}>{formatDateTime(row.sentAt)}</Fact>}
              {row.provider && (
                <Fact label={t(`${L}.provider`)}>
                  {row.provider}
                  {row.providerMessageId ? ` · ${row.providerMessageId}` : ""}
                </Fact>
              )}
              {row.lastError && <Fact label={t(`${L}.error`)}>{errorLabel(row.lastError)}</Fact>}
            </dl>

            <section aria-labelledby="notif-message" className="mt-2 space-y-2">
              <h3 id="notif-message" className="text-sm font-semibold">
                {t(`${L}.message`)}
              </h3>
              {row.renderedBody ? (
                <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
                  {row.renderedSubject && <p className="font-medium">{row.renderedSubject}</p>}
                  <p className="whitespace-pre-wrap">{row.renderedBody}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t(`${L}.noMessage`)}</p>
              )}
            </section>

            {others.length > 0 && (
              <section aria-labelledby="notif-thread" className="mt-2 space-y-2">
                <h3 id="notif-thread" className="text-sm font-semibold">
                  {t(`${L}.thread`)}
                </h3>
                <ul className="space-y-1 text-sm">
                  {others.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">
                        {t(`${L}.threadItem`, {
                          id: item.id,
                          date: formatDateTime(item.createdAt),
                        })}
                      </span>
                      <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t(`${L}.openWhatsapp`)}
                </a>
              )}
              {canMarkSent(row.status) && (
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => void run(markNotificationSent, `${L}.done.sent`)}
                >
                  {t(`${L}.markSent`)}
                </Button>
              )}
              {canResend(row.status) && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => void run(resendNotification, `${L}.done.queued`)}
                >
                  {t(`${L}.resend`)}
                </Button>
              )}
              {canCancel(row.status) && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => void run(cancelNotification, `${L}.done.cancelled`)}
                >
                  {t(`${L}.discard`)}
                </Button>
              )}
            </div>
            {row.channel === "whatsapp" && row.status === "manual" && (
              <p className="text-xs text-muted-foreground">{t(`${L}.manualHint`)}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

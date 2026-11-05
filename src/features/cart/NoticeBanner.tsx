import type { ReactNode } from "react";
import { Ban, Info, TriangleAlert, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { NoticeTone } from "./lineNotices";

const TONES = {
  info: { box: "border-info/40 bg-info-soft text-info", Icon: Info },
  warning: { box: "border-warning/40 bg-warning-soft text-warning", Icon: TriangleAlert },
  danger: { box: "border-destructive/40 bg-destructive-soft text-destructive", Icon: Ban },
} as const;

interface NoticeBannerProps {
  tone: NoticeTone;
  /** Impide pagar: `role="alert"`. Si no, `role="status"` (se anuncia con educación). */
  blocking?: boolean;
  message: string;
  /** Botones o enlaces de acción (cada uno ≥ 44 px de alto). */
  actions?: ReactNode;
  onDismiss?: (() => void) | undefined;
  className?: string;
}

/**
 * Aviso en banda del carrito. El significado NUNCA va solo en el color: lleva un icono distinto por gravedad y el texto
 * dice qué pasa. Los botones y el de cerrar miden al menos 44 px (objetivo táctil).
 */
export function NoticeBanner({
  tone,
  blocking = false,
  message,
  actions,
  onDismiss,
  className,
}: NoticeBannerProps) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      role={blocking ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 basis-40 break-words">{message}</p>
      {actions}
      {onDismiss && (
        <button
          type="button"
          aria-label={t("cart.notice.dismiss")}
          onClick={onDismiss}
          className="-my-1 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors duration-fast hover:bg-foreground/10"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

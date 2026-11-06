import { type ReactNode, useRef } from "react";
import { Ban, Info, TriangleAlert, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useRescueFocus } from "./focus";
import type { NoticeTone } from "./lineNotices";

const TONES = {
  info: { box: "border-info/40 bg-info-soft text-info", Icon: Info },
  warning: { box: "border-warning/40 bg-warning-soft text-warning", Icon: TriangleAlert },
  danger: { box: "border-destructive/40 bg-destructive-soft text-destructive", Icon: Ban },
} as const;

interface NoticeBannerProps {
  tone: NoticeTone;
  /**
   * Impide pagar: `role="alert"` (se anuncia al insertarse). Si no, NO lleva rol: va dentro de una `NoticeRegion`, la región
   * viva que ya existía y que es la que lo anuncia con educación (un nodo que nace con `role="status"` no se anuncia de
   * forma fiable).
   */
  blocking?: boolean;
  message: string;
  /** Botones o enlaces de acción (cada uno ≥ 44 px de alto). */
  actions?: ReactNode;
  onDismiss?: (() => void) | undefined;
  className?: string;
}

/**
 * Aviso en banda del carrito. El significado NUNCA va solo en el color: lleva un icono distinto por gravedad y el texto
 * dice qué pasa. Los botones y el de cerrar miden al menos 44 px (objetivo táctil). Si se cierra con el foco en «Cerrar»,
 * el foco pasa al producto de su línea o al título de la bolsa (no cae al `<body>`).
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
  const dismissRef = useRef<HTMLButtonElement>(null);
  useRescueFocus(dismissRef);
  return (
    <div
      role={blocking ? "alert" : undefined}
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
          ref={dismissRef}
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

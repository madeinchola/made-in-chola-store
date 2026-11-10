import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

interface CouponCopyButtonProps {
  /** Lo que va al portapapeles (el código, o varios separados por saltos de línea). */
  text: string;
  /** Lo que se anuncia si se copió. */
  successMessage: string;
  /** Avisa el resultado (el llamador lo muestra en una región `role="status"` DENTRO del diálogo: los avisos de fuera quedan ocultos para los lectores mientras hay un diálogo abierto). */
  onResult: (message: string, ok: boolean) => void;
  children: ReactNode;
  "aria-label"?: string;
  className?: string;
}

/**
 * Copia al portapapeles solo cuando la persona pulsa (nunca por su cuenta). Si el navegador no lo permite (página sin HTTPS,
 * permiso negado) lo dice y deja el texto visible para copiarlo a mano. No guarda ni registra el texto en ningún otro lado.
 */
export function CouponCopyButton({
  text,
  successMessage,
  onResult,
  children,
  className,
  ...rest
}: CouponCopyButtonProps) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onResult(successMessage, true);
    } catch {
      onResult(t("admin.discounts.coupons.copy.failed"), false);
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("min-h-11", className)}
      onClick={() => void copy()}
      {...rest}
    >
      {children}
    </Button>
  );
}

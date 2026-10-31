import { Shirt } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Baldosa para un producto sin imagen o con imagen rota.
 * PROVISIONAL: el icono genérico (camiseta) es un marcador hasta que haya fotografía/diseño definitivo; no pertenece al diseño.
 */
export function ImagePlaceholder({
  className,
  as: Tag = "div",
}: {
  className?: string;
  /** `span` cuando va dentro de un `<button>` (solo admite contenido de frase). */
  as?: "div" | "span";
}) {
  return (
    <Tag
      data-placeholder
      className={cn(
        "flex h-full w-full items-center justify-center bg-secondary text-muted-foreground",
        className,
      )}
    >
      <Shirt aria-hidden="true" className="h-1/4 max-h-16 w-1/4 max-w-16" strokeWidth={1.25} />
      <span className="sr-only">{t("store.card.noImage")}</span>
    </Tag>
  );
}

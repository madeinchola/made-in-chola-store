import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Una opción de un grupo excluyente (radio nativo: una sola parada con el teclado y flechas para moverse). Toda la tarjeta
 * es el objetivo táctil (≥ 44 px). El estado se dice con texto y con el propio radio, nunca solo con el color del borde.
 */
export function ChoiceCard({
  name,
  checked,
  disabled = false,
  onChange,
  title,
  detail,
  aside,
  className,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: ReactNode;
  detail?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 items-start gap-3 rounded-card border border-input p-3 text-sm",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted",
        checked && "border-primary bg-muted",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1">
        <span className="block break-words font-medium">{title}</span>
        {detail && (
          <span className="mt-0.5 block break-words text-xs text-muted-foreground">{detail}</span>
        )}
      </span>
      {aside && <span className="shrink-0 text-right text-sm tabular-nums">{aside}</span>}
    </label>
  );
}

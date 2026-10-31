import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Nombre accesible (obligatorio: el interruptor no tiene texto visible). */
  label: string;
  disabled?: boolean;
}

/** Interruptor accesible (`role="switch"`, operable con teclado). El estado también se dice con texto fuera de él. */
export function Switch({ checked, onCheckedChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primary bg-primary" : "border-input bg-muted",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

import { useId } from "react";

interface RatesCheckboxProps {
  label: string;
  /** Explicación breve que se lee junto a la casilla. */
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Casilla con su texto y su ayuda enlazados; toda la fila (≥ 44 px de alto) es clicable. */
export function RatesCheckbox({ label, hint, checked, onChange }: RatesCheckboxProps) {
  const hintId = useId();
  return (
    <div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={checked}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

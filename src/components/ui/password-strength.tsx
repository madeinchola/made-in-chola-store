import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PasswordContext } from "@shared/password-policy";
import { assessPassword, type StrengthLevel } from "./password-strength-score";

interface PasswordStrengthProps {
  password: string;
  /** Email/teléfono de la persona: una contraseña que los contiene se considera débil (misma política que el servidor). */
  context?: PasswordContext;
  /** Para enlazarlo con `aria-describedby` del campo de contraseña. */
  id?: string;
  /** Muestra la lista de reglas que faltan (texto, no solo color). Por defecto no. */
  showHints?: boolean;
  className?: string;
}

const FILL: Record<Exclude<StrengthLevel, "empty">, string> = {
  weak: "bg-destructive",
  fair: "bg-warning",
  good: "bg-success",
  strong: "bg-success",
};

const SEGMENTS = [1, 2, 3, 4] as const;

/**
 * Indicador de fortaleza de contraseña, accesible: el medidor de colores es decorativo (`aria-hidden`) y el significado
 * va SIEMPRE en el texto («Seguridad de la contraseña: Débil»).
 *
 * El texto vive en un `role="status"` (educado, `aria-live="polite"`) pero solo cambia al cambiar de NIVEL, no con
 * cada pulsación: un lector de pantalla no anuncia nada mientras se sigue en el mismo nivel. La región existe aunque la
 * contraseña esté vacía (vacía), porque un `status` solo anuncia si ya estaba en la página cuando cambió.
 *
 * La puntuación está documentada en `assessPassword` (`password-strength-score.ts`). Los textos están en
 * `acct.security.strength.*`.
 */
export function PasswordStrength({
  password,
  context,
  id,
  showHints = false,
  className,
}: PasswordStrengthProps) {
  const { level, segments, failures, predictable } = assessPassword(password, context);
  return (
    <div id={id} className={cn("space-y-2", className)}>
      <div aria-hidden="true" className="flex gap-1">
        {SEGMENTS.map((n) => (
          <span
            key={n}
            data-filled={n <= segments}
            className={cn(
              "h-1.5 flex-1 rounded-pill bg-muted",
              n <= segments && level !== "empty" && FILL[level],
            )}
          />
        ))}
      </div>
      <p role="status" data-level={level} className="min-h-5 text-sm text-muted-foreground">
        {level === "empty"
          ? ""
          : `${t("acct.security.strength.label")}: ${t(`acct.security.strength.levels.${level}` as MessageKey)}`}
      </p>
      {showHints && predictable && (
        <p className="text-xs text-muted-foreground">{t("acct.security.strength.predictable")}</p>
      )}
      {showHints && failures.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <p>{t("acct.security.strength.hintsTitle")}</p>
          <ul className="list-disc pl-4">
            {failures.map((failure) => (
              <li key={failure}>{t(`auth.password.${failure}` as MessageKey)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

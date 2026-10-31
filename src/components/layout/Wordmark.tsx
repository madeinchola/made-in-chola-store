import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Logotipo «MADE IN CHOLA» del diseño: las letras en serif repartidas en tres filas que descienden en diagonal.
 * Posiciones medidas sobre el PDF de Inicio (1366 px de ancho, letra de 15 px) y expresadas en `em`, de modo que el
 * conjunto escala con el tamaño de la letra (`text-[…]`). Hereda el color (`currentColor`): blanco sobre el hero,
 * marrón sobre el fondo claro. PROVISIONAL hasta recibir el logotipo en SVG de la diseñadora.
 */
const LETTERS: readonly { char: string; x: number; y: number }[] = [
  { char: "M", x: 0, y: 0 },
  { char: "A", x: 2.27, y: 0 },
  { char: "D", x: 4.47, y: 0 },
  { char: "E", x: 6.73, y: 0 },
  { char: "I", x: 2.27, y: 1.53 },
  { char: "N", x: 4.47, y: 1.53 },
  { char: "C", x: 4.47, y: 3.13 },
  { char: "H", x: 6.73, y: 3.13 },
  { char: "O", x: 8.53, y: 4.13 },
  { char: "L", x: 10.4, y: 3.13 },
  { char: "A", x: 12.53, y: 3.6 },
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label={t("app.name")}
      className={cn("relative block h-[5.4em] w-[13.6em] font-display leading-none", className)}
    >
      {LETTERS.map((letter, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="absolute"
          style={{ left: `${letter.x}em`, top: `${letter.y}em` }}
        >
          {letter.char}
        </span>
      ))}
    </span>
  );
}

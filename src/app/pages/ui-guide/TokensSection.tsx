import { useEffect, useState } from "react";
import { contrastRatio, hslToRgb } from "@/styles/contrast";
import { Block } from "./Block";

const SURFACES = ["background", "card", "muted", "secondary", "primary", "accent"] as const;
const TEXTS: [string, string][] = [
  ["foreground", "background"],
  ["muted-foreground", "background"],
  ["muted-foreground", "secondary"],
  ["primary-foreground", "primary"],
  ["success", "success-soft"],
  ["warning", "warning-soft"],
  ["destructive", "destructive-soft"],
  ["info", "info-soft"],
];

/** Lee el valor ACTUAL de una variable CSS: si se cambia tokens.css, la guía lo refleja sin tocar nada más. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

export function TokensSection() {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const names = new Set<string>([...SURFACES, ...TEXTS.flat()]);
    setValues(Object.fromEntries([...names].map((n) => [n, token(n)])));
  }, []);
  const ratio = (a: string, b: string) => {
    const fg = values[a];
    const bg = values[b];
    if (!fg || !bg) return null;
    return contrastRatio(hslToRgb(fg), hslToRgb(bg));
  };

  return (
    <Block
      id="tokens"
      title="Tokens"
      note="Un único archivo (src/styles/tokens.css) define color, tipografía, radios, sombras y movimiento. Los valores de abajo se leen en vivo del CSS."
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {SURFACES.map((name) => (
          <li key={name} className="space-y-1.5">
            <div
              className="h-16 rounded-card border"
              style={{ backgroundColor: `hsl(var(--${name}))` }}
              aria-hidden="true"
            />
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{values[name] ?? ""}</p>
          </li>
        ))}
      </ul>

      <table className="w-full max-w-2xl text-sm">
        <caption className="mb-2 text-left text-muted-foreground">
          Contraste de texto (WCAG AA exige 4.5:1)
        </caption>
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="py-2 pr-4 font-medium">
              Texto
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Fondo
            </th>
            <th scope="col" className="py-2 font-medium">
              Contraste
            </th>
          </tr>
        </thead>
        <tbody>
          {TEXTS.map(([fg, bg]) => {
            const value = ratio(fg, bg);
            return (
              <tr key={`${fg}-${bg}`} className="border-b">
                <td className="py-2 pr-4">{fg}</td>
                <td className="py-2 pr-4">{bg}</td>
                <td className="py-2 tabular-nums">
                  {value === null
                    ? "…"
                    : `${value.toFixed(2)}:1 ${value >= 4.5 ? "✓" : "✗ (< 4.5)"}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Block>
  );
}

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `twMerge` que conoce los nombres de los tokens propios (tailwind.config.ts). Sin esto trataría
 * `text-display-lg` como un COLOR y lo descartaría junto a `text-primary`, o dejaría `rounded-md` y
 * `rounded-card` a la vez (gana el orden del CSS, no el último).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display-xl", "display-lg", "display-md", "display-sm"] }],
    },
    theme: {
      radius: ["card", "pill"],
      tracking: ["eyebrow"],
      spacing: ["section", "header"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

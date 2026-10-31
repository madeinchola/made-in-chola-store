import type { HomeSection } from "@/features/catalog/types";
import { cleanText } from "../homeSections";
import { Spiral } from "../Spiral";

/**
 * Frase grande en serif a la izquierda (≈ 78 px a 1366 px, en dos líneas) con el símbolo espiral a la derecha, sobre
 * mucho aire, como el PDF de Inicio. Va como párrafo: es un lema, no un encabezado de sección.
 */
export function TaglineSection({ section }: { section: HomeSection }) {
  const title = cleanText(section.title);
  if (!title) return null; // un lema sin texto no tiene sentido: solo quedaría el símbolo suelto
  return (
    <section className="flex items-start justify-between gap-6 px-[var(--gutter)] pb-24 pt-10 lg:min-h-[30.8rem] lg:pl-[5.6vw] lg:pr-[8.4vw] lg:pt-16">
      <p className="max-w-[9em] text-balance font-display text-[clamp(2.5rem,1.4rem+4.5vw,4.875rem)] leading-[1.1]">
        {title}
      </p>
      <Spiral className="mt-2 h-14 w-14 sm:h-20 sm:w-20 lg:h-[7.1rem] lg:w-[7.1rem]" />
    </section>
  );
}

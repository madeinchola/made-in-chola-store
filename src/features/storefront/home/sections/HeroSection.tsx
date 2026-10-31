import { useId } from "react";
import type { HomeSection } from "@/features/catalog/types";
import { homeMediaUrl } from "@/features/catalog/mediaUrl";
import { cn } from "@/lib/utils";
import { HomeImage } from "../HomeImage";
import { HeroVideo } from "../HomeVideo";
import { cleanText } from "../homeSections";
import { heroHeightClass, mediaScrim, overMediaClass, overMediaRing } from "../homeStyles";
import { SectionLink } from "../SectionLink";

interface HeroSectionProps {
  section: HomeSection;
  /** Nivel del título: la PRIMERA portada lleva el único <h1> de la página; otra posterior, <h2>. */
  as?: "h1" | "h2";
}

/**
 * Hero a pantalla completa bajo la cabecera transparente (PDF de Inicio, ≈ 922 px a 1366 px): foto o video del admin,
 * título serif y «VER COLECCIÓN» subrayado abajo a la izquierda, párrafo justificado pequeño abajo a la derecha. Sin
 * medio, queda el fondo liso de la marca. Un degradado tenue bajo el texto garantiza la lectura sobre cualquier foto.
 */
export function HeroSection({ section, as: Heading = "h1" }: HeroSectionProps) {
  const id = useId();
  const title = cleanText(section.title);
  const body = cleanText(section.body);
  const cta = cleanText(section.ctaLabel);
  const videoSrc =
    section.media.kind === "video" ? homeMediaUrl("video", section.media.path) : null;
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className={cn(
        "relative isolate flex flex-col overflow-hidden bg-primary",
        overMediaClass,
        heroHeightClass,
      )}
    >
      {videoSrc ? (
        <HeroVideo src={videoSrc} />
      ) : (
        <div className="absolute inset-0">
          <HomeImage media={section.media} priority placeholder={false} />
        </div>
      )}
      <div aria-hidden="true" className={cn("absolute inset-0", mediaScrim)} />
      <div className="relative z-10 mt-auto flex flex-col gap-6 px-[var(--gutter)] pb-10 lg:flex-row lg:items-end lg:justify-between lg:pb-16 lg:pl-[6vw] lg:pr-[5vw]">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          {title && (
            <Heading
              id={id}
              className="font-display text-[clamp(1.75rem,1.2rem+1.6vw,2.25rem)] leading-none"
            >
              {title}
            </Heading>
          )}
          {cta && (
            <SectionLink
              url={section.ctaUrl}
              label={cta}
              className={cn(
                "eyebrow rounded-sm font-normal underline underline-offset-4 transition-opacity duration-fast hover:opacity-70",
                overMediaRing,
              )}
            />
          )}
        </div>
        {body && (
          <p className="max-w-[21.7rem] text-justify text-xs leading-snug [hyphens:auto]" lang="es">
            {body}
          </p>
        )}
      </div>
    </section>
  );
}

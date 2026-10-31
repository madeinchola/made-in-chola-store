import type { HomeSection } from "@/features/catalog/types";
import { homeMediaUrl } from "@/features/catalog/mediaUrl";
import { ImagePlaceholder } from "@/components/store/ImagePlaceholder";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { HomeImage } from "../HomeImage";
import { AboutVideo } from "../HomeVideo";
import { cleanText, sortItems } from "../homeSections";
import { mediaScrim, overMediaClass, overMediaRing } from "../homeStyles";
import { SectionLink } from "../SectionLink";

/**
 * «Sobre nosotros» (PDF de Inicio): dos baldosas a todo el ancho, mitad y mitad. A la izquierda la imagen con el título
 * abajo a la izquierda y un párrafo a la derecha; a la derecha el video con su botón de reproducir.
 * La imagen es la de la sección; el video, el primer elemento de la sección con un video.
 */
export function AboutSection({ section }: { section: HomeSection }) {
  const title = cleanText(section.title) ?? t("shop.home.about.fallbackTitle");
  const body = cleanText(section.body);
  const cta = cleanText(section.ctaLabel);
  const videoItem = sortItems(section.items).find((item) => item.media.kind === "video");
  const sectionVideo = section.media.kind === "video" ? section.media : null;
  const videoMedia = videoItem?.media ?? sectionVideo;
  const videoSrc = videoMedia ? homeMediaUrl("video", videoMedia.path) : null;
  const imageMedia =
    section.media.kind === "image"
      ? section.media
      : (sortItems(section.items).find((item) => item.media.kind === "image")?.media ??
        section.media);

  return (
    <section className="grid lg:grid-cols-2">
      <div
        className={cn("relative isolate aspect-[5/6] overflow-hidden bg-secondary", overMediaClass)}
      >
        <div className="absolute inset-0">
          <HomeImage media={imageMedia} />
        </div>
        <div aria-hidden="true" className={cn("absolute inset-0", mediaScrim)} />
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-[var(--gutter)] pb-10 lg:pb-24">
          <h2 className="font-display text-[clamp(1.75rem,1.2rem+1.6vw,2.25rem)] leading-none">
            {title}
          </h2>
          <div className="max-w-[18.75rem] space-y-3">
            {body && <p className="text-justify text-xs leading-snug">{body}</p>}
            {cta && (
              <SectionLink
                url={section.ctaUrl}
                label={cta}
                className={cn(
                  "eyebrow inline-block rounded-sm font-normal underline underline-offset-4 transition-opacity duration-fast hover:opacity-70",
                  overMediaRing,
                )}
              />
            )}
          </div>
        </div>
      </div>
      <div className="relative isolate aspect-[5/6] overflow-hidden bg-secondary">
        {videoSrc ? <AboutVideo src={videoSrc} /> : <ImagePlaceholder />}
      </div>
    </section>
  );
}

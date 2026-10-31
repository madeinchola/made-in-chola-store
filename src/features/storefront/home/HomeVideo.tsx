import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { t } from "@/i18n";
import { onReducedMotionChange, prefersReducedMotion, prefersSavingData } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { overMediaClass, overMediaRing } from "./homeStyles";

/** `#t=0.001` hace que el navegador muestre el primer fotograma sin necesidad de `poster`. */
const firstFrame = (src: string) => `${src}#t=0.001`;

/**
 * Video de fondo del hero. SIEMPRE mudo, en bucle y sin controles propios del navegador. Se reproduce solo si la persona
 * no pidió «reducir movimiento» ni activó el ahorro de datos (un video de fondo descargaría el archivo completo); en
 * esos casos (o si la reproducción automática falla) queda en pausa mostrando el primer fotograma. Si «reducir
 * movimiento» se activa con la página abierta, se pausa. Lleva un botón para pausar/reproducir (WCAG 2.2.2: nada que se
 * mueva más de 5 s sin poder pararlo).
 */
export function HeroVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion() && !prefersSavingData());

  useEffect(
    () =>
      onReducedMotionChange((reduced) => {
        if (reduced) setPlaying(false);
      }),
    [],
  );

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      Promise.resolve(video.play()).catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, [playing]);

  return (
    <>
      <video
        ref={ref}
        src={firstFrame(src)}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        className={cn("absolute inset-0 h-full w-full object-cover", className)}
      />
      <button
        type="button"
        aria-label={playing ? t("shop.home.video.pause") : t("shop.home.video.play")}
        onClick={() => setPlaying((value) => !value)}
        className={cn(
          "absolute right-[var(--gutter)] top-[calc(var(--header-height)+0.75rem)] z-10 inline-flex h-10 w-10 items-center justify-center rounded-pill bg-black/35 transition-opacity duration-fast hover:opacity-80",
          overMediaClass,
          overMediaRing,
        )}
      >
        {playing ? (
          <Pause aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Play aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
    </>
  );
}

/**
 * Video de «Sobre nosotros»: empieza en pausa con el botón de reproducir del diseño (círculo translúcido con el
 * triángulo); al pulsarlo se reproduce y aparecen los controles del navegador (pausa, volumen). Al terminar vuelve el botón.
 */
export function AboutVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const start = () => {
    setStarted(true);
    Promise.resolve(ref.current?.play()).catch(() => setStarted(false));
  };

  return (
    <>
      <video
        ref={ref}
        src={firstFrame(src)}
        playsInline
        preload="metadata"
        controls={started}
        onEnded={() => setStarted(false)}
        className={cn("absolute inset-0 h-full w-full object-cover", className)}
      />
      {!started && (
        <button
          type="button"
          aria-label={t("shop.home.video.play")}
          onClick={start}
          className={cn(
            "absolute left-1/2 top-1/2 inline-flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-pill bg-black/45 transition-opacity duration-fast hover:opacity-80",
            overMediaClass,
            overMediaRing,
          )}
        >
          <Play aria-hidden="true" className="ml-0.5 h-5 w-5 fill-current" />
        </button>
      )}
    </>
  );
}

import type { ReactNode } from "react";

/**
 * Región viva PERSISTENTE para los avisos que informan sin interrumpir (sin conexión, «Quitaste X», un producto que no
 * se pudo agregar, el aviso de una línea). Un lector de pantalla anuncia de forma fiable lo que ENTRA en una región viva
 * que ya existía; un nodo que nace con `role="status"` y su texto ya dentro, no. Por eso el contenedor se monta siempre
 * (vacío mientras no hay nada que decir) y los avisos entran y salen dentro de él.
 *
 * Va dentro del contenido que se pinta (la página y el cajón cada uno la suya): el cajón es un diálogo modal y todo lo
 * que queda fuera de él es inerte, así que una región global no se oiría desde dentro. `aria-atomic="false"` para que al
 * entrar un aviso NO se vuelvan a leer los que ya estaban. Los avisos que bloquean el pago NO van aquí: son `role="alert"`.
 */
export function NoticeRegion({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-atomic="false" className={className}>
      {children}
    </div>
  );
}

/**
 * Estado que solo oyen los lectores de pantalla («Agregando a tu bolsa…», «Cargando tu bolsa…»). Siempre montado: su
 * texto cambia, el nodo no nace con él. Es `sr-only` (fuera del flujo), así que no mueve nada en la página.
 */
export function LiveStatus({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

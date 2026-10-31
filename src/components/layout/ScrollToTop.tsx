import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Al ir a OTRA página (clic en un enlace) la ventana vuelve arriba; sin esto la ficha se abriría con el scroll de la
 * portada. No actúa cuando:
 *  · solo cambia la búsqueda de la URL (filtros, orden, color elegido en la ficha): cada pantalla decide su scroll;
 *  · se vuelve con «atrás»/«adelante» o se recarga (tipo POP): el navegador conserva la posición donde estaba;
 *  · la URL lleva un `#ancla`.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType === "POP" || hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    // Solo debe disparar al cambiar de página, no al cambiar la búsqueda ni el tipo de navegación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
}

import { Link } from "react-router-dom";
import { useNewsBanner } from "@/features/catalog/hooks";
import { t } from "@/i18n";
import { safeLink } from "./safeLink";

/**
 * Barra de aviso sobre la cabecera (texto editable por el administrador). Sin aviso, cargando o con error no pinta
 * NADA ni reserva altura: no deja un hueco vacío cuando no hay aviso.
 * Contrapartida conocida: CON aviso, la barra aparece al llegar la consulta y empuja la página ~36 px (CLS ≈ 0,04 medido
 * con Lighthouse en móvil, dentro del umbral «bueno» de 0,1). Si molesta: guardar en caché que hay aviso y reservar la
 * altura desde el primer pintado.
 * El enlace solo se activa si pasa `safeLink` (ruta interna o http/https): un `javascript:` queda como texto.
 */
export function AnnouncementBar() {
  const { data: banner } = useNewsBanner();
  if (!banner || banner.message.trim() === "") return null;

  const link = safeLink(banner.linkUrl);
  const text = <span className="text-balance">{banner.message}</span>;
  const linkClass = "underline-offset-4 hover:underline";

  return (
    <div
      role="region"
      aria-label={t("layout.announcement.label")}
      className="theme-inverse px-[var(--gutter)] py-2 text-center text-sm"
    >
      {link?.kind === "internal" ? (
        <Link to={link.to} className={linkClass}>
          {text}
        </Link>
      ) : link?.kind === "external" ? (
        <a href={link.href} rel="noopener noreferrer" className={linkClass}>
          {text}
        </a>
      ) : (
        text
      )}
    </div>
  );
}

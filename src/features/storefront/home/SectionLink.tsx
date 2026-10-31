import { Link } from "react-router-dom";
import { safeLink } from "@/components/layout/safeLink";

interface SectionLinkProps {
  /** URL que escribió el administrador: se valida; una ruta interna usa `Link`, una externa lleva `rel`. */
  url: string | null | undefined;
  label: string;
  /** Clases del enlace. */
  className?: string;
  /** Clases del texto cuando el destino NO es seguro (`javascript:`, `//otro.sitio`…): se ve, pero no es enlace. */
  textClassName?: string;
}

export function SectionLink({ url, label, className, textClassName }: SectionLinkProps) {
  const link = safeLink(url);
  if (link?.kind === "internal") {
    return (
      <Link to={link.to} className={className}>
        {label}
      </Link>
    );
  }
  if (link?.kind === "external") {
    return (
      <a href={link.href} rel="noopener noreferrer" className={className}>
        {label}
      </a>
    );
  }
  return <span className={textClassName}>{label}</span>;
}

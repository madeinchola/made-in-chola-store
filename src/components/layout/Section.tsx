import { useId, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Container } from "./Container";

interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Etiqueta del contenedor (por defecto `section`). */
  as?: ElementType;
  /** Rótulo pequeño en mayúsculas sobre el título. */
  eyebrow?: ReactNode;
  /** Título de la sección (`<h2>`). Con título, la sección se nombra a sí misma (`aria-labelledby`). */
  title?: ReactNode;
  /** Sin título ni etiqueta accesible una `section` no es un punto de referencia: dale `aria-label` si lo necesita. */
  children?: ReactNode;
}

/** Bloque vertical de una página: espaciado `py-section`, contenedor centrado y cabecera opcional. */
export function Section({
  as: Tag = "section",
  eyebrow,
  title,
  className,
  children,
  ...props
}: SectionProps) {
  const titleId = useId();
  return (
    <Tag
      aria-labelledby={title ? titleId : undefined}
      className={cn("py-section", className)}
      {...props}
    >
      <Container>
        {(eyebrow || title) && (
          <div className="mb-8 space-y-2 text-center">
            {eyebrow && <p className="eyebrow text-muted-foreground">{eyebrow}</p>}
            {title && (
              <h2 id={titleId} className="font-display text-display-md">
                {title}
              </h2>
            )}
          </div>
        )}
        {children}
      </Container>
    </Tag>
  );
}

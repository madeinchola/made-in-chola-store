import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Acciones a la derecha (botones). */
  actions?: ReactNode;
}

/** Encabezado de pantalla del panel: un único <h1>, con descripción y acciones opcionales. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

interface SectionCardProps {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  /** Acciones del encabezado de la sección. */
  actions?: ReactNode;
}

/** Sección de un formulario largo: cada una se guarda por separado, con su propio título accesible. */
export function SectionCard({ id, title, description, children, actions }: SectionCardProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="rounded-lg border bg-background p-4 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={headingId} className="font-display text-lg font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

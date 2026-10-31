import type { ReactNode } from "react";

/** Sección de la guía (herramienta interna de desarrollo: sus textos son documentación, no interfaz de la tienda). */
export function Block({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="space-y-4 border-t py-10">
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="font-display text-display-md">
          {title}
        </h2>
        {note && <p className="max-w-prose text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** Un estado concreto de un componente, con su nombre visible. */
export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

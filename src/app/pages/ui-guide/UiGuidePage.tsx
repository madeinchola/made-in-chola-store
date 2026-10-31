import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActionsSection } from "./ActionsSection";
import { FeedbackSection } from "./FeedbackSection";
import { FormsSection } from "./FormsSection";
import { NavigationSection } from "./NavigationSection";
import { OverlaysSection } from "./OverlaysSection";
import { StoreSection } from "./StoreSection";
import { TokensSection } from "./TokensSection";
import { TypographySection } from "./TypographySection";

const INDEX: [string, string][] = [
  ["tokens", "Tokens"],
  ["tipografia", "Tipografía"],
  ["botones", "Botones y etiquetas"],
  ["formularios", "Formularios"],
  ["superposiciones", "Diálogos y avisos"],
  ["navegacion", "Navegación"],
  ["producto", "Producto"],
  ["carga-carrusel", "Carga y carrusel"],
];

/**
 * Guía de componentes del sistema de diseño (solo desarrollo / E2E, ver `uiGuide.ts`). Documenta cada componente en
 * sus estados y sirve de banco de pruebas de accesibilidad y de maquetación (móvil, tableta, escritorio).
 */
export function UiGuidePage() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Guía de componentes · Made In Chola";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    // El TooltipProvider NO va en App: arrastraría floating-ui (~13 kB gzip) a todas las páginas. Se envuelve donde se usa.
    <TooltipProvider>
      <div className="container py-10">
        <header className="space-y-3 pb-8">
          <p className="eyebrow text-muted-foreground">Sistema de diseño</p>
          <h1 className="font-display text-display-lg">Guía de componentes</h1>
          <p className="max-w-prose text-muted-foreground">
            Interna y provisional: los componentes usan los tokens de{" "}
            <code>src/styles/tokens.css</code>. Cambiar un token cambia toda la interfaz, tienda y
            panel.
          </p>
          <nav aria-label="Secciones de la guía">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {INDEX.map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="underline underline-offset-4 hover:text-muted-foreground"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <TokensSection />
        <TypographySection />
        <ActionsSection />
        <FormsSection />
        <OverlaysSection />
        <NavigationSection />
        <StoreSection />
        <FeedbackSection />
      </div>
    </TooltipProvider>
  );
}

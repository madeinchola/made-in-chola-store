import { useRef, type MouseEvent } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

/** Estructura de las páginas públicas: aviso · cabecera · contenido · pie, con enlace para saltar al contenido. */
export function PublicLayout() {
  const main = useRef<HTMLElement>(null);
  // Solo la portada tiene un hero a pantalla completa bajo la cabecera (diseño de Inicio): allí es transparente.
  const overlay = useLocation().pathname === "/";

  // Sin tocar la URL (un `#contenido` en el historial confundiría al router): se enfoca `main` directamente.
  const skip = (event: MouseEvent) => {
    event.preventDefault();
    main.current?.focus();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#contenido"
        onClick={skip}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {t("layout.skipToContent")}
      </a>
      <AnnouncementBar />
      {/* La cabecera de la portada va superpuesta (absoluta) sobre el hero: este contenedor hace que empiece DEBAJO de la
          barra de anuncios en vez de taparla. */}
      <div className="relative flex flex-1 flex-col">
        <Header overlay={overlay} />
        <main
          ref={main}
          id="contenido"
          tabIndex={-1}
          className="flex-1 scroll-mt-header focus-visible:ring-0"
        >
          <Outlet />
        </main>
      </div>
      <Footer />
    </div>
  );
}

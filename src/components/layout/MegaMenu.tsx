import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useCategoryTree } from "@/features/catalog/hooks";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { navItemClass } from "./headerStyles";
import { storeRoutes } from "./storeRoutes";

/** Pausa antes de cerrar al sacar el ratón: permite cruzar el hueco entre el botón y el panel sin que se cierre. */
const CLOSE_DELAY_MS = 150;

/**
 * Menú «Tienda» de escritorio (≥ lg): un botón que despliega un panel con las categorías en columnas
 * (patrón *disclosure*, no un `role="menu"`: son enlaces de navegación). Se abre con clic, Intro/Espacio, flecha
 * abajo o al pasar el ratón; se cierra con Esc (y el foco vuelve al botón), al sacar el foco, al hacer clic fuera
 * y al navegar. Sin categorías o con error no pinta nada: la cabecera sigue funcionando.
 */
export function MegaMenu({ overlay = false }: { overlay?: boolean }) {
  const { data: tree, isLoading } = useCategoryTree();
  const location = useLocation();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const focusFirstOnOpen = useRef(false);
  // El ratón lo abrió al pasar por encima: el clic siguiente no debe cerrarlo (sería abrir y cerrar de un golpe).
  const openedByHover = useRef(false);
  // Abierto con el teclado: salir con el ratón no debe cerrarlo mientras el foco siga dentro (caería a <body>).
  const openedByKeyboard = useRef(false);

  const clearTimer = () => window.clearTimeout(closeTimer.current);

  // Navegar (incluso a la misma ruta con otra búsqueda) cierra el panel.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!open) {
      openedByHover.current = false;
      openedByKeyboard.current = false;
    }
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!open) return;
    if (focusFirstOnOpen.current) {
      focusFirstOnOpen.current = false;
      panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    }
    // Esc cierra también si el panel se abrió con el ratón y el foco está en otro sitio (WCAG 1.4.13).
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const focusInside = rootRef.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (focusInside) buttonRef.current?.focus();
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (isLoading) return <Skeleton className="hidden h-4 w-16 lg:block" />;
  if (!tree || tree.length === 0) return null;

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    if (open) panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    else {
      focusFirstOnOpen.current = true;
      openedByKeyboard.current = true;
      setOpen(true);
    }
  };
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimer();
    if (!open) openedByHover.current = true;
    setOpen(true);
  };
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimer();
    closeTimer.current = window.setTimeout(() => {
      if (openedByKeyboard.current && rootRef.current?.contains(document.activeElement)) return;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  return (
    <div
      ref={rootRef}
      className="hidden lg:block"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onBlur={(event) => {
        // Tab hacia fuera cierra; un clic en una zona no enfocable del panel (relatedTarget nulo) no.
        const next = event.relatedTarget;
        if (next instanceof Node && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={cn(navItemClass(overlay), "cursor-pointer rounded-sm")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          if (openedByHover.current) openedByHover.current = false;
          else {
            // `detail === 0`: el «clic» lo produjo el teclado (Intro/Espacio), no el ratón.
            if (!open) openedByKeyboard.current = event.detail === 0;
            setOpen((value) => !value);
          }
        }}
        onKeyDown={onButtonKeyDown}
      >
        {t("layout.megaMenu.trigger")}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-base ease-standard",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        role="region"
        aria-label={t("layout.megaMenu.panelLabel")}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b bg-background shadow-md duration-base animate-in fade-in-0 slide-in-from-top-1"
      >
        <div className="container grid grid-cols-2 gap-x-8 gap-y-8 py-8 xl:grid-cols-4">
          {tree.map((category) => (
            <div key={category.id}>
              <Link
                to={storeRoutes.category(category.slug)}
                onClick={() => setOpen(false)}
                className="font-display text-display-sm hover:underline"
              >
                {category.name}
              </Link>
              {category.children.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {category.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        to={storeRoutes.category(child.slug)}
                        onClick={() => setOpen(false)}
                        className="text-sm text-muted-foreground transition-colors duration-fast hover:text-foreground hover:underline"
                      >
                        {child.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

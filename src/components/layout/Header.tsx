import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";
import { CartLink } from "./CartLink";
import { CountrySelect } from "./CountrySelect";
import { navItemClass, toneClass } from "./headerStyles";
import { MegaMenu } from "./MegaMenu";
import { MobileMenu } from "./MobileMenu";
import { SearchSheet } from "./SearchSheet";
import { storeRoutes } from "./storeRoutes";
import { useCartCount } from "./useCartCount";
import { Wordmark } from "./Wordmark";

interface HeaderProps {
  /**
   * Cabecera transparente SOBRE el hero (la portada del diseño): texto blanco, sin borde, y un degradado oscuro tenue
   * detrás para que se lea sobre cualquier foto (desviación deliberada: el PDF no lo lleva y el blanco sobre una foto
   * clara no cumple el contraste). Sin `overlay`: barra sólida con línea inferior, como las páginas interiores.
   */
  overlay?: boolean;
}

/**
 * Cabecera del diseño (PDF de Inicio y de Check Out): a la izquierda «TIENDA ⌄» y «NOSOTROS»; en el centro el logotipo
 * disperso; a la derecha el país, la bolsa «(0)», la cuenta y la búsqueda. Mide 130 px a 1366 px de ancho.
 * Móvil (sin diseño, provisional): menú · logotipo reducido · bolsa, cuenta y búsqueda. Un único `nav` «Principal».
 */
export function Header({ overlay = false }: HeaderProps) {
  const cartCount = useCartCount();
  return (
    <header
      className={cn(
        "z-40",
        toneClass(overlay),
        overlay
          ? "absolute inset-x-0 top-0 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-gradient-to-b before:from-black/40 before:to-transparent"
          : "sticky top-0 border-b border-foreground bg-background lg:relative",
      )}
    >
      <nav
        aria-label={t("layout.header.nav")}
        className="mx-auto grid h-header w-full grid-cols-[1fr_auto_1fr] items-center gap-2 px-[var(--gutter)] lg:items-start lg:px-[6.9vw]"
      >
        <div className="flex items-center gap-8 lg:pt-[2.35rem]">
          <MobileMenu overlay={overlay} />
          <MegaMenu overlay={overlay} />
          <Link
            to={storeRoutes.about}
            className={cn(navItemClass(overlay), "hidden rounded-sm lg:inline-flex")}
          >
            {t("layout.header.about")}
          </Link>
        </div>
        <Link
          to={storeRoutes.home}
          className="justify-self-center rounded-sm text-[0.5625rem] sm:text-[0.6875rem] lg:mt-[2.5rem] lg:translate-x-[2vw] lg:text-[0.9375rem]"
        >
          <Wordmark />
        </Link>
        <div className="flex items-center justify-end gap-0.5 sm:gap-2 lg:gap-6 lg:pt-[2.3rem]">
          <CountrySelect overlay={overlay} />
          <CartLink count={cartCount} overlay={overlay} />
          <AccountMenu overlay={overlay} />
          <SearchSheet overlay={overlay} />
        </div>
      </nav>
    </header>
  );
}

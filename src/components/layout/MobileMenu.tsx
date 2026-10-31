import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { useCategoryTree } from "@/features/catalog/hooks";
import { t } from "@/i18n";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { iconClass } from "./headerStyles";
import { storeRoutes } from "./storeRoutes";

const rowClass =
  "eyebrow flex min-h-11 w-full items-center py-2 text-left transition-colors duration-fast hover:text-muted-foreground";
const subRowClass =
  "flex min-h-11 items-center py-2 text-sm text-muted-foreground transition-colors duration-fast hover:text-foreground";

/** Enlace del cajón: cierra el menú al pulsarlo (también cuando ya estás en esa ruta y la URL no cambia). */
function MenuLink({
  to,
  className,
  children,
}: {
  to: string;
  className: string;
  children: string;
}) {
  return (
    <SheetClose asChild>
      <Link to={to} className={className}>
        {children}
      </Link>
    </SheetClose>
  );
}

/**
 * Menú de móvil (< lg): cajón lateral con Inicio, las categorías en acordeón y los enlaces de cuenta. Se cierra al
 * navegar. Sin categorías (cargando, error o vacío) muestra solo los enlaces fijos; un fallo nunca rompe la cabecera.
 */
export function MobileMenu({ overlay = false }: { overlay?: boolean }) {
  const { data: tree, isLoading } = useCategoryTree();
  const { status, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search, location.hash]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("layout.header.openMenu")}
          className={`${iconClass(overlay)} cursor-pointer lg:hidden`}
        >
          <Menu className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        bodyClassName="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]"
      >
        <SheetTitle className="font-display text-display-sm">
          {t("layout.mobileMenu.title")}
        </SheetTitle>
        <SheetDescription className="sr-only">
          {t("layout.mobileMenu.description")}
        </SheetDescription>

        <nav aria-label={t("layout.mobileMenu.title")} className="mt-6">
          <ul className="divide-y divide-border border-y border-border">
            <li>
              <MenuLink to={storeRoutes.home} className={rowClass}>
                {t("nav.home")}
              </MenuLink>
            </li>
            <li>
              <MenuLink to={storeRoutes.about} className={rowClass}>
                {t("layout.header.about")}
              </MenuLink>
            </li>
          </ul>

          <h3 className="eyebrow mt-8 text-muted-foreground">{t("layout.mobileMenu.shop")}</h3>
          {isLoading ? (
            <div role="status" className="mt-3 space-y-3">
              <span className="sr-only">{t("layout.mobileMenu.loading")}</span>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : tree && tree.length > 0 ? (
            <Accordion type="single" collapsible className="mt-2 border-t border-border">
              {tree.map((category) =>
                category.children.length > 0 ? (
                  <AccordionItem key={category.id} value={category.id}>
                    <AccordionTrigger>{category.name}</AccordionTrigger>
                    <AccordionContent>
                      <ul>
                        <li>
                          <MenuLink
                            to={storeRoutes.category(category.slug)}
                            className={subRowClass}
                          >
                            {t("layout.mobileMenu.viewAll", { name: category.name })}
                          </MenuLink>
                        </li>
                        {category.children.map((child) => (
                          <li key={child.id}>
                            <MenuLink to={storeRoutes.category(child.slug)} className={subRowClass}>
                              {child.name}
                            </MenuLink>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ) : (
                  <div key={category.id} className="border-b border-border">
                    <MenuLink to={storeRoutes.category(category.slug)} className={rowClass}>
                      {category.name}
                    </MenuLink>
                  </div>
                ),
              )}
            </Accordion>
          ) : null}

          {status !== "loading" && (
            <>
              <h3 className="eyebrow mt-8 text-muted-foreground">
                {t("layout.mobileMenu.session")}
              </h3>
              <ul className="mt-2 divide-y divide-border border-y border-border">
                {status === "authenticated" ? (
                  <>
                    {isAdmin && (
                      <li>
                        <MenuLink to={storeRoutes.admin} className={rowClass}>
                          {t("nav.admin")}
                        </MenuLink>
                      </li>
                    )}
                    <li>
                      <MenuLink to={storeRoutes.account} className={rowClass}>
                        {t("nav.account")}
                      </MenuLink>
                    </li>
                    <li>
                      <SheetClose asChild>
                        <button type="button" className={rowClass} onClick={() => void signOut()}>
                          {t("nav.logout")}
                        </button>
                      </SheetClose>
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <MenuLink to={storeRoutes.login} className={rowClass}>
                        {t("nav.login")}
                      </MenuLink>
                    </li>
                    <li>
                      <MenuLink to={storeRoutes.register} className={rowClass}>
                        {t("nav.register")}
                      </MenuLink>
                    </li>
                  </>
                )}
              </ul>
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

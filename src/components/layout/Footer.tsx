import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCategoryTree, useStoreSettings } from "@/features/catalog/hooks";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";
import { contactLinks, type ContactLink } from "./contactLinks";
import { storeRoutes } from "./storeRoutes";

/** Enlace de columna: mayúsculas pequeñas con espaciado y casi sin interlineado, como en el diseño. */
const linkClass =
  "inline-flex min-h-6 max-w-full items-center text-xs uppercase leading-[1.35] tracking-[0.12em] [overflow-wrap:anywhere] underline-offset-4 transition-opacity duration-fast hover:underline";

/** Margen lateral del diseño a 1366 px (≈ 70 px); en pantallas pequeñas, el margen normal. */
const sideClass = "mx-auto w-full max-w-[1600px] px-[var(--gutter)] lg:px-[5.1vw]";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h2 className="border-b border-foreground pb-1 font-display text-lg leading-tight">
        {title}
      </h2>
      <ul className="mt-3">{children}</ul>
    </div>
  );
}

function Item({ to, children }: { to: string; children: ReactNode }) {
  return (
    <li>
      <Link to={to} className={linkClass}>
        {children}
      </Link>
    </li>
  );
}

/** Enlace a otro sitio (redes) o a un esquema (`mailto:`, `tel:`). Los externos avisan de que abren pestaña nueva. */
function OutsideItem({ link, newTab = false }: { link: ContactLink; newTab?: boolean }) {
  return (
    <li>
      <a
        href={link.href}
        className={linkClass}
        {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {link.label}
        {newTab && (
          <>
            {/* el espacio va FUERA del span: dentro, el cálculo del nombre accesible lo pierde («Instagram(se abre…») */}{" "}
            <span className="sr-only">{t("layout.footer.newTab")}</span>
          </>
        )}
      </a>
    </li>
  );
}

/**
 * Pie del diseño (PDF de Inicio): fondo marrón, el símbolo de la marca arriba a la izquierda, cuatro columnas con el
 * título en serif subrayado (Índice del sitio · Síguenos · Contáctanos · Legal) y, bajo una línea, el copyright y los
 * enlaces legales en serif atenuado. Sin boletín ni cupón del 10 % (decisión del dueño: el bloque del diseño no se
 * incluye) y sin el crédito «Developed by VNS» (es de la agencia del diseño, no de esta tienda). Contacto y redes salen
 * de los ajustes públicos y solo se muestran si existen. Los textos atenuados de abajo son más claros que en el PDF
 * para cumplir el contraste AA.
 */
export function Footer() {
  const { data: tree } = useCategoryTree();
  const { data: settings } = useStoreSettings();
  const { email, phone, whatsapp, socials } = contactLinks(settings);
  const shopTarget = tree?.[0] ? storeRoutes.category(tree[0].slug) : null;
  const hasContact = Boolean(email ?? phone ?? whatsapp);

  return (
    <footer className="theme-inverse pb-[env(safe-area-inset-bottom)]">
      <div className={cn(sideClass, "pb-12 pt-12 lg:pb-7 lg:pr-[8.1vw] lg:pt-[4.3rem]")}>
        <BrandMark className="h-28 w-[5.6rem] text-foreground lg:ml-[1.5vw] lg:h-[8.7rem] lg:w-[7rem]" />

        <div
          data-testid="footer-columns"
          className={cn(
            "mt-16 grid gap-x-4 gap-y-10 sm:grid-cols-2 lg:mt-[20.5rem]",
            // 4 columnas como el diseño; si no hay redes configuradas, la columna «Síguenos» no se pinta vacía.
            socials.length > 0
              ? "lg:grid-cols-[1fr_1fr_1fr_0.62fr]"
              : "lg:grid-cols-[1fr_1fr_0.62fr]",
          )}
        >
          <Column title={t("layout.footer.index")}>
            {shopTarget && <Item to={shopTarget}>{t("layout.footer.shopNow")}</Item>}
            <Item to={storeRoutes.home}>{t("nav.home")}</Item>
            <Item to={storeRoutes.about}>{t("layout.header.about")}</Item>
            <Item to={storeRoutes.contact}>{t("layout.footer.contactUs")}</Item>
          </Column>

          {socials.length > 0 && (
            <Column title={t("layout.footer.follow")}>
              {socials.map((social) => (
                <OutsideItem key={social.key} link={social} newTab />
              ))}
            </Column>
          )}

          <Column title={t("layout.footer.contact")}>
            {email && <OutsideItem link={email} />}
            {phone && <OutsideItem link={phone} />}
            {whatsapp && (
              <OutsideItem link={{ ...whatsapp, label: t("layout.footer.whatsapp") }} newTab />
            )}
            {!hasContact && <Item to={storeRoutes.contact}>{t("layout.footer.contactUs")}</Item>}
          </Column>

          <Column title={t("layout.footer.legal")}>
            <Item to={storeRoutes.privacy}>{t("layout.footer.privacy")}</Item>
            <Item to={storeRoutes.refunds}>{t("layout.footer.refunds")}</Item>
            <Item to={storeRoutes.shipping}>{t("layout.footer.shipping")}</Item>
            <Item to={storeRoutes.terms}>{t("layout.footer.terms")}</Item>
          </Column>
        </div>
      </div>

      <div className="border-t border-foreground">
        <div
          className={cn(
            sideClass,
            "flex flex-wrap items-center justify-center gap-x-10 gap-y-2 py-8 font-display text-base text-muted-foreground lg:gap-x-28 lg:pb-[4.5rem] lg:pt-4",
          )}
        >
          <p>{t("layout.footer.copyright", { year: new Date().getFullYear() })}</p>
          <Link to={storeRoutes.privacy} className="hover:underline">
            {t("layout.footer.privacyPolicies")}
          </Link>
          <Link to={storeRoutes.terms} className="hover:underline">
            {t("layout.footer.termsAndConditions")}
          </Link>
        </div>
      </div>
    </footer>
  );
}

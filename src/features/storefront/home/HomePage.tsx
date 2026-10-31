import { useMemo } from "react";
import { contactLinks } from "@/components/layout/contactLinks";
import { ErrorState } from "@/components/store/ErrorState";
import { useHome, useStoreSettings } from "@/features/catalog/hooks";
import { homeMediaUrl } from "@/features/catalog/mediaUrl";
import type { HomeSection } from "@/features/catalog/types";
import { absoluteUrl } from "@/features/storefront/seo/canonical";
import { organizationJsonLd, websiteJsonLd } from "@/features/storefront/seo/jsonld";
import { siteUrl } from "@/features/storefront/seo/siteUrl";
import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { t } from "@/i18n";
import { cleanText, findHero, sortSections } from "./homeSections";
import { HomeSkeleton } from "./HomeSkeleton";
import { AboutSection } from "./sections/AboutSection";
import { BannerSection } from "./sections/BannerSection";
import { CategoryTilesSection } from "./sections/CategoryTilesSection";
import { CollectionFeatureSection } from "./sections/CollectionFeatureSection";
import { HeroSection } from "./sections/HeroSection";
import { ProductRowSection } from "./sections/ProductRowSection";
import { TaglineSection } from "./sections/TaglineSection";

function renderSection(section: HomeSection, firstHeroId: string | undefined) {
  switch (section.kind) {
    case "hero":
      return (
        <HeroSection
          key={section.id}
          section={section}
          as={section.id === firstHeroId ? "h1" : "h2"}
        />
      );
    case "product_row":
      return <ProductRowSection key={section.id} section={section} />;
    case "collection_feature":
      return <CollectionFeatureSection key={section.id} section={section} />;
    case "about":
      return <AboutSection key={section.id} section={section} />;
    case "banner":
      return <BannerSection key={section.id} section={section} />;
    case "tagline":
      return <TaglineSection key={section.id} section={section} />;
    case "category_tiles":
      return <CategoryTilesSection key={section.id} section={section} />;
  }
}

/** Sin contenido en la base: el hero provisional de la marca (el de antes de existir el editor de portada). */
function FallbackHero() {
  return (
    <section className="theme-inverse flex min-h-[min(100svh,57rem)] flex-col items-center justify-center gap-4 px-[var(--gutter)] pb-16 pt-header text-center">
      <p className="eyebrow text-muted-foreground">{t("home.eyebrow")}</p>
      <h1 className="font-display text-display-xl">{t("home.title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("home.subtitle")}</p>
    </section>
  );
}

/** Error al cargar: con la cabecera blanca encima, el fondo es el de la marca (no se pierde el menú). */
function HomeError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="theme-inverse min-h-[min(100svh,57rem)] pt-header">
      <h1 className="sr-only">{t("app.name")}</h1>
      <ErrorState title={t("shop.home.errorTitle")} onRetry={onRetry} />
    </div>
  );
}

/**
 * Portada de la tienda (PDF de Inicio): las secciones que el admin configuró, en su orden. Tiene SIEMPRE un único
 * <h1>: el título del hero, o «Made In Chola» (oculto a la vista) si no hay hero con título. Mientras carga muestra un
 * esqueleto con la altura del hero; si falla, un error con reintento; sin secciones, el hero provisional.
 */
export function HomePage() {
  const home = useHome();
  const settings = useStoreSettings();
  const sections = useMemo(() => sortSections(home.data ?? []), [home.data]);
  const hero = findHero(sections);
  const heroTitle = cleanText(hero?.title);

  const base = siteUrl();
  const heroImage = hero?.media.kind === "image" ? homeMediaUrl("image", hero.media.path) : null;
  const sameAs = contactLinks(settings.data).socials.map((social) => social.href);
  usePageMeta({
    title: t("shop.seo.homeTitle"),
    bare: true,
    description: t("shop.seo.siteDescription"),
    canonical: absoluteUrl(base, "/"),
    image: heroImage,
    jsonLd: [
      organizationJsonLd({ name: t("app.name"), url: base, sameAs }),
      websiteJsonLd({
        name: t("app.name"),
        url: base,
        searchUrlTemplate: `${base}/buscar?q={search_term_string}`,
      }),
    ],
  });

  if (home.isPending) return <HomeSkeleton />;
  if (home.isError) return <HomeError onRetry={() => void home.refetch()} />;
  if (sections.length === 0) return <FallbackHero />;

  return (
    <>
      {!heroTitle && <h1 className="sr-only">{t("app.name")}</h1>}
      {sections.map((section) => renderSection(section, hero?.id))}
    </>
  );
}

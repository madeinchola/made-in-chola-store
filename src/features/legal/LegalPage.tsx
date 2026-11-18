import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { useStoreSettings } from "@/features/catalog/hooks";
import { canonicalUrl } from "@/features/storefront/seo/canonical";
import { siteUrl } from "@/features/storefront/seo/siteUrl";
import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { useLegalDocument } from "./hooks";
import { businessVariables } from "./businessVariables";
import { renderLegal } from "./renderLegal";
import { LEGAL_KINDS, LEGAL_PATHS, type LegalKind } from "./types";

const P = "legal.page" as const;

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));

/** Un texto legal: su versión y fecha de vigencia, el texto tal como se publicó y los demás documentos. */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const doc = useLegalDocument(kind);
  const settings = useStoreSettings();
  const title = doc.data?.title ?? t(`legal.titles.${kind}`);
  usePageMeta({
    title,
    description: doc.data?.body ? doc.data.body.replace(/[#*[\]()-]/g, "").slice(0, 160) : title,
    canonical: canonicalUrl(siteUrl(), LEGAL_PATHS[kind]),
    robots: doc.data?.version ? "index,follow" : "noindex,follow",
  });

  return (
    <section className="container max-w-3xl py-10">
      <h1 className="font-display text-3xl font-semibold">{title}</h1>
      {doc.isPending ? (
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          …
        </p>
      ) : doc.isError ? (
        <p role="alert" className="mt-6 text-destructive">
          {t(`${P}.loadError`)}
        </p>
      ) : !doc.data?.body || doc.data.version === null ? (
        <div className="mt-6 rounded-lg border border-dashed p-6 text-sm">
          <p className="font-medium">{t(`${P}.notPublished`)}</p>
          <p className="mt-1 text-muted-foreground">{t(`${P}.notPublishedHelp`)}</p>
        </div>
      ) : (
        <article className="mt-2 text-[15px]" data-testid="legal-body">
          <p className="text-sm text-muted-foreground">
            {t(`${P}.version`, {
              version: doc.data.version,
              date: doc.data.effectiveAt ? formatDate(doc.data.effectiveAt) : "",
            })}
          </p>
          <div className="mt-4">
            {renderLegal(doc.data.body, businessVariables(settings.data), t(`${P}.missingData`))}
          </div>
        </article>
      )}
      <nav aria-label={t(`${P}.otherDocs`)} className="mt-12 border-t pt-6">
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {LEGAL_KINDS.filter((k) => k !== kind).map((k) => (
            <li key={k}>
              <Link to={LEGAL_PATHS[k]} className="underline underline-offset-2 hover:no-underline">
                {t(`legal.titles.${k}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}

export const TermsPage = () => <LegalPage kind="terms" />;
export const PrivacyPage = () => <LegalPage kind="privacy" />;
export const CookiesPage = () => <LegalPage kind="cookies" />;
export const ShippingPage = () => <LegalPage kind="shipping" />;
export const ReturnsPage = () => <LegalPage kind="returns" />;

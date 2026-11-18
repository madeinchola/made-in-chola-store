import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { LEGAL_PATHS, type RequiredLegal } from "./types";

interface LegalConsentProps {
  required: RequiredLegal;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Mensaje de error a mostrar (se asocia a la casilla). */
  error?: string | null;
  id?: string;
}

const fragment = (key: "terms" | "privacy") => (
  <Link
    key={key}
    to={LEGAL_PATHS[key]}
    target="_blank"
    rel="noopener noreferrer"
    className="font-medium underline underline-offset-2"
  >
    {t(key === "terms" ? "legal.consent.termsLink" : "legal.consent.privacyLink")}
    <span className="sr-only"> {t("legal.consent.opensNew")}</span>
  </Link>
);

/**
 * La casilla «Leí y acepto…» con enlaces a los textos (se abren en otra pestaña para no perder lo escrito). Solo aparece cuando hay
 * textos publicados que exigen aceptación; si nada se exige, no se muestra y no se bloquea nada.
 */
export function LegalConsent({
  required,
  checked,
  onChange,
  error,
  id = "legal-consent",
}: LegalConsentProps) {
  const hasTerms = required.terms !== undefined;
  const hasPrivacy = required.privacy !== undefined;
  if (!hasTerms && !hasPrivacy) return null;
  const parts =
    hasTerms && hasPrivacy
      ? ["legal.consent.label", { terms: "terms", privacy: "privacy" }]
      : hasTerms
        ? ["legal.consent.labelTerms", { terms: "terms" }]
        : ["legal.consent.labelPrivacy", { privacy: "privacy" }];
  const [key, tokens] = parts as [
    "legal.consent.label" | "legal.consent.labelTerms" | "legal.consent.labelPrivacy",
    Record<string, "terms" | "privacy">,
  ];
  // El texto lleva marcas {terms} y {privacy}: se parte y se intercalan los enlaces.
  const template = t(key, {});
  const pieces = template.split(/(\{terms\}|\{privacy\})/g).map((piece, i) => {
    const token = /^\{(terms|privacy)\}$/.exec(piece)?.[1] as "terms" | "privacy" | undefined;
    return token && tokens[token] ? (
      <span key={i}>{fragment(token)}</span>
    ) : (
      <span key={i}>{piece}</span>
    );
  });
  return (
    <div>
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(value) => onChange(value === true)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5"
        />
        <label htmlFor={id} className="text-sm leading-snug">
          {pieces}
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

import { Link } from "react-router-dom";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { accountRoutes } from "@/features/account/accountRoutes";
import type { TaxProfile } from "@/features/account/tax/types";
import { t } from "@/i18n";

/** Datos fiscales (BR-ACC-06): opcionales, se piden aquí. Sin ellos el pedido va sin factura. */
export function TaxSection({
  profiles,
  loading,
  wantsInvoice,
  selectedId,
  error,
  onWants,
  onSelect,
}: {
  profiles: readonly TaxProfile[] | undefined;
  loading: boolean;
  wantsInvoice: boolean;
  selectedId: string | undefined;
  error: string | undefined;
  onWants: (wants: boolean) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-labelledby="checkout-tax" className="space-y-3">
      <h2 id="checkout-tax" tabIndex={-1} className="font-display text-display-sm">
        {t("checkout.tax.title")}
      </h2>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={wantsInvoice}
          onChange={(event) => onWants(event.target.checked)}
          className="h-4 w-4 shrink-0 accent-primary"
        />
        {t("checkout.tax.want")}
      </label>
      {wantsInvoice && error && (!profiles || profiles.length === 0) && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {wantsInvoice &&
        (loading ? (
          <p className="text-sm text-muted-foreground">{t("checkout.loading")}</p>
        ) : !profiles || profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("checkout.tax.empty")}{" "}
            <Link className="underline underline-offset-4" to={accountRoutes.tax}>
              {t("checkout.tax.add")}
            </Link>
          </p>
        ) : (
          <>
            <Field label={t("checkout.tax.selectLabel")} error={error}>
              <Select value={selectedId ?? ""} onChange={(event) => onSelect(event.target.value)}>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {t("checkout.tax.option", {
                      name: profile.legalName,
                      type: profile.docType.toUpperCase(),
                      number: profile.docNumber,
                    })}
                  </option>
                ))}
              </Select>
            </Field>
            <Link className="text-sm underline underline-offset-4" to={accountRoutes.tax}>
              {t("checkout.tax.manage")}
            </Link>
          </>
        ))}
    </section>
  );
}

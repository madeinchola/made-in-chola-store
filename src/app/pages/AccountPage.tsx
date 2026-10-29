import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";

/** Vista mínima: la cuenta completa (direcciones, pedidos, etc.) llega en el Sprint 6. */
export function AccountPage() {
  const { profile } = useAuth();
  return (
    <section className="container max-w-md py-12">
      <h1 className="font-display text-2xl font-bold">{t("account.title")}</h1>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("account.name")}</dt>
          <dd data-testid="account-name">{profile?.full_name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("account.email")}</dt>
          <dd>{profile?.email ?? t("account.none")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("account.phone")}</dt>
          <dd>{profile?.phone_e164 ?? t("account.none")}</dd>
        </div>
      </dl>
    </section>
  );
}

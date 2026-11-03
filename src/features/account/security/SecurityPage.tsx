import { t } from "@/i18n";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { DeactivateAccountSection } from "./DeactivateAccountSection";

/** `/cuenta/seguridad`: cambiar la contraseña y desactivar la cuenta. PROVISIONAL en estilo (no hay diseño de cuenta). */
export function SecurityPage() {
  return (
    <div className="space-y-12">
      <header className="space-y-1">
        <h2 className="font-display text-display-md">{t("acct.security.title")}</h2>
        <p className="text-muted-foreground">{t("acct.security.intro")}</p>
      </header>
      <ChangePasswordForm />
      <DeactivateAccountSection />
    </div>
  );
}

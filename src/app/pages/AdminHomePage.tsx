import { t } from "@/i18n";

export function AdminHomePage() {
  return (
    <section className="container py-12">
      <h1 className="font-display text-2xl font-bold">{t("admin.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("admin.body")}</p>
    </section>
  );
}

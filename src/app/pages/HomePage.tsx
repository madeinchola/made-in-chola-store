import { t } from "@/i18n";

export function HomePage() {
  return (
    <section className="container flex min-h-[60vh] flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-accent-foreground/70">
        {t("home.eyebrow")}
      </p>
      <h1 className="font-display text-4xl font-bold text-primary sm:text-6xl">
        {t("home.title")}
      </h1>
      <p className="max-w-md text-muted-foreground">{t("home.subtitle")}</p>
    </section>
  );
}

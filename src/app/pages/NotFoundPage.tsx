import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function NotFoundPage() {
  return (
    <section className="container flex min-h-[60vh] flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="font-display text-6xl font-bold text-primary">404</p>
      <h1 className="text-xl font-semibold">{t("notFound.title")}</h1>
      <p className="text-muted-foreground">{t("notFound.body")}</p>
      <Button asChild>
        <Link to="/">{t("notFound.back")}</Link>
      </Button>
    </section>
  );
}

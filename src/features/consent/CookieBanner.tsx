import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { useAnalyticsConfig } from "@/features/analytics/config";
import { acceptAll, rejectOptional, saveConsent } from "./consentStore";
import { useConsent } from "./useConsent";

/** El pie lanza este evento para reabrir las preferencias (el aviso y el diálogo viven aquí, no en el pie). */
export const OPEN_PREFERENCES_EVENT = "mic:cookie-preferences";

/**
 * Aviso de cookies: aparece SOLO si la tienda tiene alguna herramienta opcional conectada y la persona todavía no decidió. No bloquea
 * nada (no es un modal, no mueve el foco) y no desplaza el contenido: va fijo abajo. «Solo las necesarias» pesa igual que «Aceptar
 * todas»: rechazar es tan fácil como aceptar. Las preferencias se pueden reabrir desde el pie de página.
 */
export function CookieBanner() {
  const config = useAnalyticsConfig();
  const consent = useConsent();
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    const open = () => setPreferencesOpen(true);
    window.addEventListener(OPEN_PREFERENCES_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, open);
  }, []);

  const showBanner = config.ready && config.hasOptional && consent === null;

  return (
    <>
      {showBanner && (
        <section
          aria-label={t("cookies.banner.label")}
          data-testid="cookie-banner"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background p-4 shadow-lg"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-4 md:flex-row md:items-center">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{t("cookies.banner.title")}</p>
              <p className="mt-1 text-muted-foreground">
                {t("cookies.banner.body")}{" "}
                <Link to={storeRoutes.cookies} className="underline underline-offset-2">
                  {t("cookies.banner.policy")}
                </Link>
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setPreferencesOpen(true)}
              >
                {t("cookies.banner.customize")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => rejectOptional()}
              >
                {t("cookies.banner.rejectOptional")}
              </Button>
              <Button type="button" className="min-h-11" onClick={() => acceptAll()}>
                {t("cookies.banner.acceptAll")}
              </Button>
            </div>
          </div>
        </section>
      )}
      {preferencesOpen && (
        <PreferencesDialog
          initial={{
            analytics: consent?.analytics ?? false,
            marketing: consent?.marketing ?? false,
          }}
          onClose={() => setPreferencesOpen(false)}
        />
      )}
    </>
  );
}

function PreferencesDialog({
  initial,
  onClose,
}: {
  initial: { analytics: boolean; marketing: boolean };
  onClose: () => void;
}) {
  const [analytics, setAnalytics] = useState(initial.analytics);
  const [marketing, setMarketing] = useState(initial.marketing);
  const done = (choice: { analytics: boolean; marketing: boolean }) => {
    saveConsent(choice);
    toast.success(t("cookies.preferences.saved"));
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cookies.preferences.title")}</DialogTitle>
          <DialogDescription>{t("cookies.preferences.description")}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-4 text-sm">
          <Category
            id="cookies-necessary"
            label={t("cookies.preferences.necessary.label")}
            help={t("cookies.preferences.necessary.help")}
            checked
            disabled
          />
          <Category
            id="cookies-analytics"
            label={t("cookies.preferences.analytics.label")}
            help={t("cookies.preferences.analytics.help")}
            checked={analytics}
            onChange={setAnalytics}
          />
          <Category
            id="cookies-marketing"
            label={t("cookies.preferences.marketing.label")}
            help={t("cookies.preferences.marketing.help")}
            checked={marketing}
            onChange={setMarketing}
          />
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => done({ analytics: false, marketing: false })}
          >
            {t("cookies.preferences.rejectOptional")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => done({ analytics: true, marketing: true })}
          >
            {t("cookies.preferences.acceptAll")}
          </Button>
          <Button type="button" onClick={() => done({ analytics, marketing })}>
            {t("cookies.preferences.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Category({
  id,
  label,
  help,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <li className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onCheckedChange={(value) => onChange?.(value === true)}
        className="mt-0.5"
      />
      <div>
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <p id={`${id}-help`} className="text-muted-foreground">
          {help}
        </p>
      </div>
    </li>
  );
}

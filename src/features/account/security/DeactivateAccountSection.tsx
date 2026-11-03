import { useId, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
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
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { FormAlert } from "./FormAlert";
import { commonFailureMessage } from "./functionErrors";
import { useDeactivateAccount } from "./hooks";
import { useSingleFlight } from "./useSingleFlight";

/**
 * Desactivar la cuenta (BR-ACC-07: nada se borra; los pedidos se conservan). Explica qué se conserva y qué se
 * anonimiza, pide la contraseña y SIEMPRE una confirmación final: ninguna acción destructiva sale de un solo clic.
 * Tras el éxito se limpia la caché de la cuenta, se va a la portada y se cierra la sesión.
 */
export function DeactivateAccountSection() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useDeactivateAccount();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [anonymize, setAnonymize] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const refocusPassword = useRef(false);
  const singleFlight = useSingleFlight();
  const id = useId();

  const pending = mutation.isPending;

  const askConfirmation = (event: FormEvent) => {
    event.preventDefault();
    if (password === "") {
      setPasswordError(t("acct.security.errors.required"));
      passwordRef.current?.focus();
      return;
    }
    setPasswordError(null);
    setDialogError(null);
    setConfirmOpen(true);
  };

  // `singleFlight`: doble clic en «Sí, desactivar» → una sola petición.
  const confirm = () =>
    singleFlight(async () => {
      setDialogError(null);
      const result = await mutation.mutateAsync({ password, anonymize });
      if (result.ok) {
        setPassword("");
        queryClient.removeQueries({ queryKey: ["account"] }); // ningún dato de la cuenta queda en memoria
        // Primero la portada y luego el cierre de sesión: así el guard de /cuenta no redirige a /login a mitad de camino.
        navigate("/", { replace: true });
        toast.success(t("acct.security.deactivate.done"));
        try {
          await signOut();
        } catch {
          /* la cuenta ya está desactivada: aunque el cierre falle, el servidor no dará más datos */
        }
        return;
      }
      if (result.code === "invalid_credentials") {
        // El error es de la contraseña, no de la confirmación: se vuelve al campo para escribirla de nuevo.
        setPassword("");
        setPasswordError(t("acct.security.errors.invalid_credentials"));
        refocusPassword.current = true;
        setConfirmOpen(false);
        return;
      }
      setDialogError(
        result.code === "last_admin"
          ? t("acct.security.errors.last_admin")
          : commonFailureMessage(result),
      );
    });

  const changeOpen = (open: boolean) => {
    if (!open && pending) return; // no se puede cerrar con la petición en vuelo: no se sabría si se desactivó
    setConfirmOpen(open); // el aviso anterior se borra al volver a abrir (`askConfirmation`) y al reintentar (`confirm`)
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-card border border-destructive/40 p-5 sm:p-6"
    >
      <div className="space-y-1">
        <h3 id={`${id}-title`} className="font-display text-display-sm">
          {t("acct.security.deactivate.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("acct.security.deactivate.intro")}</p>
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="eyebrow">{t("acct.security.deactivate.keepsTitle")}</dt>
          <dd className="text-muted-foreground">{t("acct.security.deactivate.keeps")}</dd>
        </div>
        <div className="space-y-1">
          <dt className="eyebrow">{t("acct.security.deactivate.changesTitle")}</dt>
          <dd className="text-muted-foreground">{t("acct.security.deactivate.changes")}</dd>
        </div>
      </dl>
      <form onSubmit={askConfirmation} noValidate className="max-w-md space-y-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${id}-anonymize`}
            checked={anonymize}
            onCheckedChange={(checked) => setAnonymize(checked === true)}
            aria-describedby={`${id}-anonymize-hint`}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <label htmlFor={`${id}-anonymize`} className="text-sm font-medium">
              {t("acct.security.deactivate.anonymize")}
            </label>
            <p id={`${id}-anonymize-hint`} className="text-xs text-muted-foreground">
              {t("acct.security.deactivate.anonymizeHint")}
            </p>
          </div>
        </div>
        <Field
          label={t("acct.security.deactivate.password")}
          hint={t("acct.security.deactivate.passwordHint")}
          error={passwordError ?? undefined}
        >
          <PasswordInput
            ref={passwordRef}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (passwordError) setPasswordError(null);
            }}
          />
        </Field>
        <Button type="submit" variant="destructive">
          {t("acct.security.deactivate.submit")}
        </Button>
      </form>

      <Dialog open={confirmOpen} onOpenChange={changeOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (refocusPassword.current) {
              refocusPassword.current = false;
              event.preventDefault();
              passwordRef.current?.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("acct.security.deactivate.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {anonymize
                ? t("acct.security.deactivate.confirmAnonymize")
                : t("acct.security.deactivate.confirmKeep")}
            </DialogDescription>
          </DialogHeader>
          {dialogError && <FormAlert>{dialogError}</FormAlert>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-disabled={pending || undefined}
              onClick={() => changeOpen(false)}
            >
              {t("acct.security.deactivate.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={pending}
              onClick={() => void confirm()}
            >
              {t("acct.security.deactivate.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

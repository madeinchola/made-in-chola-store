import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { legalKeys, useLegalIndex, usePendingLegal } from "./hooks";
import { acceptLegalAgain } from "./legalApi";
import { LEGAL_PATHS, type LegalKind } from "./types";

const KINDS: readonly ("terms" | "privacy")[] = ["terms", "privacy"];

/**
 * Cuando el administrador publica una versión nueva de los términos o de la privacidad, quien ya tiene cuenta lo ve aquí: qué
 * cambió (la nota de cambios de cada texto), con enlace para leerlo, y acepta o lo deja para después. «Ahora no» solo lo cierra
 * mientras dure esta visita: el pago vuelve a pedir la aceptación, así que nadie compra sin haber aceptado lo vigente. En el propio
 * pago NO aparece (ahí ya está la casilla y el aviso taparía el formulario). También sirve a quien tenía cuenta antes de que
 * existieran los textos: para ella es la primera vez, no un cambio.
 */
export function ReacceptGate() {
  const { status, session } = useAuth();
  const userId = status === "authenticated" ? session?.user.id : undefined;
  const pending = usePendingLegal(userId);
  const queryClient = useQueryClient();
  const onCheckout = useLocation().pathname.startsWith(storeRoutes.checkout);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const required = pending.data ?? {};
  const kinds = KINDS.filter((kind) => required[kind] !== undefined);
  const open = userId !== undefined && dismissedFor !== userId && kinds.length > 0 && !onCheckout;
  // El índice (con las notas de cambios) solo se pide cuando hay algo que mostrar: nadie más lo descarga.
  const index = useLegalIndex(open);
  const docs = new Map((index.data ?? []).map((doc) => [doc.kind, doc]));

  const accept = async () => {
    const token = session?.access_token;
    if (!token || saving) return;
    setSaving(true);
    setError(null);
    const result = await acceptLegalAgain(required, token);
    setSaving(false);
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: legalKeys.pending(userId) });
      return;
    }
    // Si el texto volvió a cambiar mientras se leía, se vuelve a consultar lo vigente para que acepte lo que ve.
    if (result.code === "legal_outdated") {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: legalKeys.pending(userId) }),
        queryClient.invalidateQueries({ queryKey: legalKeys.index() }),
      ]);
      setError(t("legal.consent.outdated"));
      return;
    }
    setError(t("legal.reaccept.error"));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !saving && userId) setDismissedFor(userId);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("legal.reaccept.title")}</DialogTitle>
          <DialogDescription>{t("legal.reaccept.body")}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-3 text-sm">
          {kinds.map((kind) => {
            const doc = docs.get(kind as LegalKind);
            const title = doc?.title ?? t(`legal.titles.${kind}`);
            const note = doc?.changeNote?.trim();
            return (
              <li key={kind}>
                <p className="font-medium">
                  {note
                    ? t("legal.reaccept.change", { title, version: required[kind]!, note })
                    : t("legal.reaccept.changeNoNote", { title, version: required[kind]! })}
                </p>
                <Link
                  to={LEGAL_PATHS[kind]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {t("legal.reaccept.read", { title })}
                  <span className="sr-only"> {t("legal.consent.opensNew")}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => userId && setDismissedFor(userId)}
          >
            {t("legal.reaccept.later")}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void accept()}>
            {saving ? t("legal.reaccept.saving") : t("legal.reaccept.accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

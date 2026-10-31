import { useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";
import { t } from "@/i18n";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Avisa antes de perder cambios sin guardar: al navegar a otra pantalla de la app (diálogo de confirmación) y al cerrar o
 * recargar la pestaña (aviso del navegador). Solo actúa mientras `dirty` es true. Requiere un router de datos.
 */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const proceeded = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        // Cerrar con "Seguir editando" (o Esc) cancela la navegación; tras "Salir" no hay nada que cancelar.
        if (!open && blocker.state === "blocked" && !proceeded.current) blocker.reset();
        if (!open) proceeded.current = false;
      }}
      title={t("admin.unsaved.title")}
      description={t("admin.unsaved.body")}
      confirmLabel={t("admin.unsaved.leave")}
      cancelLabel={t("admin.unsaved.stay")}
      destructive
      onConfirm={() => {
        proceeded.current = true;
        if (blocker.state === "blocked") blocker.proceed();
      }}
    />
  );
}

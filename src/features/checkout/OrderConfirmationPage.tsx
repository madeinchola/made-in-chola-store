import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { accountRoutes } from "@/features/account/accountRoutes";
import { CancelOrderDialog } from "@/features/account/orders/CancelOrderDialog";
import { useOrderByNumber } from "@/features/account/orders/hooks";
import { OrderDetailView } from "@/features/account/orders/OrderDetailPage";
import { toDetail } from "@/features/account/orders/ordersMapping";
import { useAuth } from "@/features/auth/useAuth";
import { useStoreSettings } from "@/features/catalog/hooks";
import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { t, type MessageKey } from "@/i18n";
import type { OrderSnapshot, PaymentInstruction } from "./types";
import { buildWhatsAppUrl, whatsappOrderFromRow } from "./whatsappMessage";

interface ConfirmationState {
  instruction?: PaymentInstruction | null;
  paymentError?: string | null;
  /** El pedido tal como lo devolvió el servidor: permite armar el enlace de WhatsApp SIN esperar otra consulta. */
  order?: OrderSnapshot;
  justCreated?: boolean;
}

const OPENED_KEY = (number: string) => `mic.wa.opened.${number}`;

/**
 * `/pedido/:numero`: confirmación del pedido recién creado y, más tarde, su seguimiento. El pedido ya está GUARDADO en el
 * servidor cuando se llega aquí: si el navegador bloquea la ventana de WhatsApp (o la persona cierra todo), el botón de esta
 * pantalla y «Mis pedidos» lo recuperan. WhatsApp se intenta abrir UNA vez; reenviar es siempre un clic de la persona.
 */
export function OrderConfirmationPage() {
  usePageMeta({ title: t("checkout.confirmation.createdTitle"), robots: "noindex,nofollow" });
  const { numero } = useParams<{ numero: string }>();
  const location = useLocation();
  const nav = (location.state ?? null) as ConfirmationState | null;
  const { profile } = useAuth();
  const query = useOrderByNumber(profile?.id, numero);
  const settings = useStoreSettings();
  const [cancelling, setCancelling] = useState(false);
  const attempted = useRef(false);
  const heading = useRef<HTMLDivElement>(null);

  const row = query.data;
  const detail = useMemo(() => (row ? toDetail(row) : null), [row]);
  // El pedido que llegó por el estado de la navegación solo vale para ESTE número (un enlace pegado no lo trae).
  const created = nav?.order && nav.order.number === numero ? nav.order : null;
  const paymentMethod = row?.payment_method ?? created?.payment_method;
  const isWhatsApp = paymentMethod === "whatsapp";
  const storePhone = settings.data?.whatsapp_orders;
  const phone =
    nav?.instruction?.kind === "whatsapp"
      ? (nav.instruction as { phone_e164: string | null }).phone_e164
      : typeof storePhone === "string"
        ? storePhone
        : null;
  const whatsappUrl = useMemo(() => {
    if (!isWhatsApp) return null;
    if (created) return buildWhatsAppUrl(phone, created);
    return row ? buildWhatsAppUrl(phone, whatsappOrderFromRow(row)) : null;
  }, [row, created, isWhatsApp, phone]);

  // Intento ÚNICO de abrir WhatsApp al llegar recién creado. Puede bloquearlo el navegador: el botón siempre está.
  useEffect(() => {
    if (!nav?.justCreated || !whatsappUrl || attempted.current || !numero) return;
    attempted.current = true;
    try {
      if (window.sessionStorage.getItem(OPENED_KEY(numero))) return;
      window.sessionStorage.setItem(OPENED_KEY(numero), "1");
    } catch {
      /* sin almacenamiento: se intenta igual esta vez */
    }
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  }, [nav?.justCreated, whatsappUrl, numero]);

  useEffect(() => {
    if (detail) heading.current?.focus();
  }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isPending) {
    return (
      <div className="container min-h-[100svh] space-y-4 py-8 lg:py-12" aria-busy="true">
        <p role="status" className="sr-only">
          {t("checkout.loading")}
        </p>
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="container min-h-[100svh] py-8 lg:py-12">
        <ErrorState
          title={t("checkout.confirmation.loadError.title")}
          description={t("checkout.confirmation.loadError.description")}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  if (!row || !detail) {
    return (
      <div className="container min-h-[100svh] py-8 lg:py-12">
        <EmptyState
          title={t("checkout.confirmation.notFound.title")}
          description={t("checkout.confirmation.notFound.description")}
          action={
            <Link
              to={accountRoutes.orders}
              className={buttonVariants({ variant: "outline", caps: true })}
            >
              {t("checkout.confirmation.notFound.action")}
            </Link>
          }
        />
      </div>
    );
  }

  const pending = row.status === "pending_payment";
  // Recién creado: «¡Recibimos tu pedido!». Al volver más tarde (enlace guardado, «Mis pedidos») dice cómo va HOY.
  const justCreated = nav?.justCreated === true;
  const title = justCreated
    ? t("checkout.confirmation.createdTitle")
    : t(`checkout.confirmation.titleByStatus.${row.status}` as MessageKey);
  const body =
    justCreated || pending
      ? isWhatsApp
        ? t("checkout.confirmation.createdBody", { number: row.number })
        : t("checkout.confirmation.codBody", { number: row.number })
      : t(`checkout.confirmation.bodyByStatus.${row.status}` as MessageKey, {
          number: row.number,
        });
  return (
    <div className="container min-h-[100svh] max-w-3xl space-y-8 py-8 lg:py-12">
      <div ref={heading} tabIndex={-1} className="space-y-3 outline-none">
        <h1 className="font-display text-display-lg">{title}</h1>
        <p role="status" className="text-muted-foreground">
          {body}
        </p>
      </div>

      {nav?.paymentError && (
        <p role="alert" className="rounded-card border border-destructive p-4 text-sm">
          {t("checkout.confirmation.providerError", { number: row.number })}
        </p>
      )}

      {isWhatsApp && pending && (
        <div className="space-y-3 rounded-card border border-border bg-card p-5">
          {whatsappUrl ? (
            <>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({
                  size: "lg",
                  caps: true,
                  className: "min-h-12 w-full sm:w-auto",
                })}
              >
                {nav?.justCreated
                  ? t("checkout.confirmation.sendWhatsApp")
                  : t("checkout.confirmation.resendWhatsApp")}
              </a>
              <p className="text-sm text-muted-foreground">
                {t("checkout.confirmation.whatsappHelp")}
              </p>
            </>
          ) : (
            <p role="alert" className="text-sm">
              {t("checkout.confirmation.whatsappMissing", { number: row.number })}
            </p>
          )}
        </div>
      )}

      <OrderDetailView order={detail} onCancel={() => setCancelling(true)} />

      <div className="flex flex-wrap gap-3">
        <Link
          to={accountRoutes.orders}
          className={buttonVariants({ variant: "outline", caps: true })}
        >
          {t("checkout.confirmation.viewOrders")}
        </Link>
        <Link to={storeRoutes.shop} className={buttonVariants({ variant: "outline", caps: true })}>
          {t("checkout.confirmation.keepShopping")}
        </Link>
      </div>

      <CancelOrderDialog order={detail} open={cancelling} onOpenChange={setCancelling} />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AddressFormSheet,
  type AddressFormTarget,
} from "@/features/account/addresses/AddressFormSheet";
import { useActiveAddresses, useDeliveryCountries } from "@/features/account/addresses/hooks";
import type { Address } from "@/features/account/addresses/types";
import { useTaxProfiles } from "@/features/account/tax/hooks";
import { useAuth } from "@/features/auth/useAuth";
import { useCart } from "@/features/cart/cart-context";
import { formatCartMoney } from "@/features/cart/format";
import type { ScheduleChoice } from "@/features/shipping/destination";
import { track } from "@/features/storefront/analytics/track";
import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { t } from "@/i18n";
import { formatPhoneDisplay } from "@/features/account/addresses/phone";
import { createOrder } from "./checkoutApi";
import {
  canSubmit,
  choicesKey,
  defaultPaymentMethod,
  firstInvalidField,
  submitLabelKey,
  toErrorLines,
  validateContact,
  type ContactErrors,
  type ContactField,
  type ContactForm,
  type ErrorLine,
  type ErrorSection,
} from "./checkoutForm";
import { useCheckoutPreview, useShippingMethods } from "./checkoutHooks";
import { ContactSection, type ContactRefs } from "./ContactSection";
import { OrderSummary } from "./OrderSummary";
import { PaymentSection } from "./PaymentSection";
import { RevalidationDialog } from "./RevalidationDialog";
import type { Revalidation } from "./revalidation";
import { ShippingSection } from "./ShippingSection";
import { TaxSection } from "./TaxSection";
import type { CheckoutChoices, CheckoutPreview } from "./types";

/**
 * Llave de idempotencia de ESTA compra: un doble clic o el reintento tras un corte de red devuelve el mismo pedido.
 * Está ligada a LO QUE SE ENVÍA: si la persona cambia algo (dirección, pago, contacto…) antes de reintentar, es otra compra y
 * lleva otra llave; si no, el servidor devolvería el pedido viejo (o un conflicto) en lugar de crear el nuevo.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(12, "0");
}

/** Resume la bolsa (líneas, cantidades, cupón y total): si cambia, la vista previa se vuelve a pedir al servidor. */
function cartKeyOf(snapshot: ReturnType<typeof useCart>["state"]["snapshot"]): string {
  if (!snapshot) return "none";
  const lines = snapshot.lines
    .map((l) => `${l.variant_id}:${l.qty}:${l.status}:${l.unit_price}`)
    .join(",");
  return `${snapshot.totals.total}|${snapshot.discounts?.coupon?.code ?? ""}|${lines}`;
}

function Loading() {
  return (
    <div aria-busy="true" className="space-y-4">
      <p role="status" className="sr-only">
        {t("checkout.loading")}
      </p>
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/**
 * `/checkout` (S10): UN solo formulario, sin pasos (BR-CHK-01): contacto, entrega, datos fiscales opcionales y pago, con el
 * resumen al lado. Todo importe, descuento y envío sale de la VISTA PREVIA del servidor (`preview`): aquí nada se calcula.
 *
 *  · Antes de crear el pedido se revalida (BR-CHK-04): el cliente manda el total que VIO; si ya no es ese, no se crea y se
 *    muestra la diferencia para confirmarla.
 *  · Anti doble envío: el botón se bloquea mientras se envía y la llave de idempotencia hace que un reintento devuelva el
 *    mismo pedido (no duplica pedido ni stock).
 */
export function CheckoutPage() {
  usePageMeta({ title: t("checkout.title"), robots: "noindex,nofollow" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const cart = useCart();
  const methodsQuery = useShippingMethods();
  const addressesQuery = useActiveAddresses(profile?.id);
  const taxQuery = useTaxProfiles();
  const countries = useDeliveryCountries();

  const [contact, setContact] = useState<ContactForm>({ name: "", email: "", phone: "" });
  const [contactErrors, setContactErrors] = useState<ContactErrors>({});
  const [method, setMethod] = useState<string | undefined>();
  const [addressId, setAddressId] = useState<string | undefined>();
  const [schedule, setSchedule] = useState<ScheduleChoice | null>(null);
  const [wantsInvoice, setWantsInvoice] = useState(false);
  const [taxId, setTaxId] = useState<string | undefined>();
  const [payment, setPayment] = useState<string | undefined>();
  const [serverErrors, setServerErrors] = useState<ErrorLine[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [revalidation, setRevalidation] = useState<Revalidation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [addressTarget, setAddressTarget] = useState<AddressFormTarget | null>(null);

  const submittingRef = useRef(false);
  const keyRef = useRef({ signature: "", key: newIdempotencyKey() });
  const prefilled = useRef(false);
  const formShown = useRef(false);
  const trackedBegin = useRef(false);
  const refs: ContactRefs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
  };
  const summaryRef = useRef<HTMLDivElement>(null);

  // Contacto precargado del perfil (una sola vez: lo que la persona escriba después no se pisa).
  useEffect(() => {
    if (!profile || prefilled.current) return;
    prefilled.current = true;
    setContact({
      name: profile.full_name ?? "",
      email: profile.email ?? "",
      phone: profile.phone_e164 ? formatPhoneDisplay(profile.phone_e164) : "",
    });
  }, [profile]);

  const methods = methodsQuery.data;
  const addresses = addressesQuery.data?.filter((a) => a.forShipping);
  const current = methods?.find((m) => m.code === method);
  const isDelivery = current?.kind === "delivery";

  // Valores por omisión: la primera forma de entrega (domicilio primero) y la dirección predeterminada con pin.
  useEffect(() => {
    if (method || !methods || methods.length === 0) return;
    setMethod((methods.find((m) => m.kind === "delivery") ?? methods[0])?.code);
  }, [method, methods]);
  useEffect(() => {
    if (!isDelivery || !addresses || addresses.length === 0) return;
    if (addressId && addresses.some((a) => a.id === addressId)) return;
    const pick =
      addresses.find((a) => a.isDefault && a.lat !== null) ??
      addresses.find((a) => a.lat !== null) ??
      addresses[0];
    setAddressId(pick?.id);
  }, [isDelivery, addresses, addressId]);
  useEffect(() => {
    if (!wantsInvoice || taxId) return;
    const profiles = taxQuery.data;
    if (profiles && profiles.length > 0)
      setTaxId((profiles.find((p) => p.isDefault) ?? profiles[0])?.id);
  }, [wantsInvoice, taxId, taxQuery.data]);

  // La vista previa NO depende del método de pago (no cambia ningún importe): elegirlo no vuelve a pedir nada. Tampoco se pide
  // hasta tener los valores por omisión (forma de entrega y dirección): una primera respuesta sin dirección no serviría.
  const defaultsReady =
    Boolean(method) &&
    (!isDelivery ||
      (!addressesQuery.isPending &&
        (addressesQuery.isError || (addresses?.length ?? 0) === 0 || addressId !== undefined)));
  const choices: CheckoutChoices | null = useMemo(
    () =>
      method && defaultsReady
        ? {
            shippingMethod: method,
            ...(isDelivery && addressId ? { addressId } : {}),
            ...(wantsInvoice && taxId ? { taxProfileId: taxId } : {}),
            ...(isDelivery && schedule
              ? { slotId: schedule.slotId, deliveryDate: schedule.date }
              : {}),
          }
        : null,
    [method, defaultsReady, isDelivery, addressId, wantsInvoice, taxId, schedule],
  );
  const previewQuery = useCheckoutPreview(
    cart.state.loaded && cart.lines.length > 0 ? choices : null,
    cartKeyOf(cart.state.snapshot),
  );
  const preview: CheckoutPreview | undefined = previewQuery.data ?? undefined;
  // Mientras llega la vista previa de lo que se acaba de elegir se sigue mostrando la anterior (sin saltos), pero NO sirve para
  // enviar: sus números y sus errores son de otra elección.
  const stale = previewQuery.isPlaceholderData;

  // El método de pago por omisión sale del servidor (los que están disponibles para ESTE pedido).
  useEffect(() => {
    if (!preview) return;
    const next = defaultPaymentMethod(preview.payment.methods, payment);
    if (next !== payment) setPayment(next);
  }, [preview, payment]);

  // begin_checkout: una vez, cuando ya hay números del servidor (sin datos personales).
  useEffect(() => {
    if (!preview || trackedBegin.current) return;
    trackedBegin.current = true;
    track({
      name: "begin_checkout",
      items: preview.lines.length,
      value: preview.totals.subtotal,
      currency: preview.currency,
    });
  }, [preview]);

  const refreshPreview = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["checkout", "preview"] }),
    [queryClient],
  );

  function showServerErrors(lines: ErrorLine[]) {
    setServerErrors(lines);
    // El resumen de errores recibe el foco: lector de pantalla y teclado empiezan por lo que hay que corregir.
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  }

  function onChangeContact(field: ContactField, value: string) {
    setContact((c) => ({ ...c, [field]: value }));
    if (contactErrors[field]) setContactErrors((e) => ({ ...e, [field]: undefined }));
  }

  /** La llave de este contenido: la misma mientras no cambie nada, otra en cuanto cambie. */
  function keyFor(signature: string): string {
    if (keyRef.current.signature !== signature)
      keyRef.current = { signature, key: newIdempotencyKey() };
    return keyRef.current.key;
  }

  async function submit(expectedOverride?: number) {
    if (submittingRef.current || stale) return;
    setSubmitError(null);
    setServerErrors([]);
    const check = validateContact(contact);
    if (!check.ok) {
      setContactErrors(check.errors);
      const field = firstInvalidField(check.errors);
      if (field) refs[field].current?.focus();
      return;
    }
    setContactErrors({});
    // «Necesito factura» sin datos fiscales elegidos: el pedido saldría sin factura sin que la persona lo sepa.
    if (wantsInvoice && !taxId) {
      showServerErrors(toErrorLines([{ code: "tax_profile_required" }]));
      return;
    }
    if (!choices || !payment || !preview) {
      showServerErrors(
        toErrorLines([{ code: payment ? "cart_empty" : "payment_method_required" }]),
      );
      return;
    }
    const expected = expectedOverride ?? preview.totals.total;
    if (
      expected === null ||
      expected === undefined ||
      (expectedOverride === undefined && !canSubmit(preview))
    ) {
      showServerErrors(
        toErrorLines(preview.errors.length > 0 ? preview.errors : [{ code: "address_required" }]),
      );
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await createOrder(
        { ...choices, paymentMethod: payment },
        check.value,
        expected,
        keyFor(
          JSON.stringify([
            choicesKey({ ...choices, paymentMethod: payment }),
            check.value.name,
            check.value.email,
            check.value.phone,
          ]),
        ),
      );
      if (!result.ok) {
        setSubmitError(
          result.status === 401
            ? t("checkout.errors.login")
            : result.status === 429
              ? t("checkout.errors.rateLimited")
              : result.code === "network"
                ? t("checkout.errors.network")
                : t("checkout.errors.generic"),
        );
        return;
      }
      const data = result.data;
      if (data.outcome === "created" || data.outcome === "existing") {
        track({
          name: "purchase",
          transactionId: data.order.number,
          value: data.order.total,
          currency: data.order.currency,
          items: data.order.items.length,
          shipping: data.order.shipping_cost - data.order.shipping_discount,
          discount: data.order.discount_total,
        });
        void cart.store.refetch();
        void queryClient.invalidateQueries({ queryKey: ["account", "orders"] });
        navigate(storeRoutes.order(data.order.number), {
          replace: true,
          state: {
            instruction: data.payment_instruction,
            paymentError: data.payment_error,
            // El pedido recién creado: la confirmación arma el enlace de WhatsApp sin esperar otra consulta.
            order: data.order,
            justCreated: true,
          },
        });
      } else if (data.outcome === "changed" || data.outcome === "unavailable") {
        setRevalidation(data);
        void refreshPreview();
        void cart.store.refetch();
      } else {
        // Mismo identificador con otro contenido: esa llave ya no sirve; la próxima compra lleva una nueva.
        if (data.errors.some((e) => e.code === "idempotency_conflict"))
          keyRef.current = { signature: "", key: newIdempotencyKey() };
        showServerErrors(toErrorLines(data.errors));
        void refreshPreview();
        if (data.errors.some((e) => e.code === "cart_empty")) void cart.store.refetch();
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  const sectionMessages = (...sections: ErrorSection[]) =>
    serverErrors.filter((e) => sections.includes(e.section)).map((e) => e.message);

  // Errores de la VISTA PREVIA que conviene mostrar junto a la sección (sin esperar al envío).
  const previewDelivery = useMemo(
    () =>
      toErrorLines(preview?.errors ?? [])
        .filter((e) => e.section === "delivery" && e.code !== "address_required")
        .map((e) => e.message),
    [preview],
  );
  const previewSchedule = useMemo(
    () =>
      toErrorLines(preview?.errors ?? [])
        .filter((e) => e.section === "schedule")
        .map((e) => e.message),
    [preview],
  );
  const unique = (list: string[]) => [...new Set(list)];

  // El formulario aparece DE UNA VEZ cuando ya hay formas de entrega, direcciones y la primera vista previa: si cada sección
  // llegara por su cuenta, empujarían lo que está debajo (CLS). Hasta entonces, un esqueleto con la misma altura mínima.
  // La primera vista previa no trae método de pago: elegir el de por omisión pide una segunda. Mientras el formulario no se ha
  // mostrado esa segunda se espera también aquí (así el botón no parpadea «Calculando…» justo al abrir).
  const needsPayment =
    preview !== undefined &&
    payment === undefined &&
    preview.payment.methods.some((m) => m.available);
  // Sin forma de entrega no habrá nunca una vista previa: no se espera para siempre, se muestra el formulario con su aviso.
  const noPreviewPossible = methodsQuery.isError || (methods !== undefined && methods.length === 0);
  const initializing =
    methodsQuery.isPending ||
    addressesQuery.isPending ||
    (!formShown.current &&
      !noPreviewPossible &&
      !previewQuery.isError &&
      (preview === undefined || needsPayment || stale));

  useEffect(() => {
    if (!initializing && cart.lines.length > 0) formShown.current = true;
  });

  // ── Pantallas que no son el formulario ──
  if (!cart.state.loaded && cart.state.snapshot === null) {
    return (
      <div className="container min-h-[100svh] py-8 lg:py-12">
        <Loading />
      </div>
    );
  }
  if (
    cart.lines.length > 0 &&
    initializing &&
    previewQuery.data !== null &&
    !previewQuery.isError
  ) {
    return (
      <div className="container min-h-[100svh] py-8 lg:py-12">
        <h1 className="mb-6 font-display text-display-lg lg:mb-10">{t("checkout.title")}</h1>
        <Loading />
      </div>
    );
  }
  if (cart.lines.length === 0 || previewQuery.data === null) {
    return (
      <div className="container min-h-[100svh] py-8 lg:py-12">
        <EmptyState
          title={t("checkout.empty.title")}
          description={t("checkout.empty.description")}
          action={
            <Link
              to={storeRoutes.shop}
              className={buttonVariants({ variant: "outline", caps: true })}
            >
              {t("checkout.empty.action")}
            </Link>
          }
        />
      </div>
    );
  }
  if (previewQuery.isError && !preview) {
    return (
      <div className="container min-h-[100svh] py-8 lg:py-12">
        <ErrorState
          title={t("checkout.loadError.title")}
          description={t("checkout.loadError.description")}
          onRetry={() => void previewQuery.refetch()}
        />
      </div>
    );
  }

  const total = preview?.totals.total ?? null;
  const currency = preview?.currency ?? "BOB";
  const provider = preview?.payment.methods.find((m) => m.code === payment)?.provider;
  const summaryErrors = [
    ...Object.values(contactErrors).filter(Boolean),
    ...serverErrors.map((e) => e.message),
  ];

  return (
    <div className="container min-h-[100svh] py-8 lg:py-12">
      <h1 className="mb-6 font-display text-display-lg lg:mb-10">{t("checkout.title")}</h1>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-12">
        <form
          noValidate
          aria-label={t("checkout.stepsLabel")}
          onSubmit={onSubmit}
          className="min-w-0 space-y-10"
        >
          <div
            ref={summaryRef}
            tabIndex={-1}
            role={summaryErrors.length > 0 ? "alert" : undefined}
            className="outline-none"
          >
            {summaryErrors.length > 0 && (
              <div className="space-y-2 rounded-card border border-destructive p-4 text-sm">
                <p className="font-medium">{t("checkout.errorSummary.title")}</p>
                <p>{t("checkout.errorSummary.intro")}</p>
                <ul className="list-disc space-y-1 pl-5">
                  {unique(summaryErrors as string[]).map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <ContactSection
            values={contact}
            errors={contactErrors}
            refs={refs}
            onChange={onChangeContact}
          />

          <ShippingSection
            methods={methods}
            methodsLoading={methodsQuery.isPending}
            methodsError={methodsQuery.isError}
            method={method}
            onMethod={(code) => {
              setMethod(code);
              setSchedule(null);
              setServerErrors([]);
            }}
            addresses={addresses}
            addressesLoading={addressesQuery.isPending}
            addressesError={addressesQuery.isError}
            addressId={addressId}
            onAddress={(id) => {
              setAddressId(id);
              setSchedule(null);
              setServerErrors([]);
            }}
            onAddAddress={() => setAddressTarget({ kind: "create" })}
            onLocateAddress={(address: Address) => setAddressTarget({ kind: "edit", address })}
            preview={preview}
            schedule={schedule}
            onSchedule={(choice) => {
              setSchedule(choice);
              setServerErrors([]);
            }}
            deliveryErrors={unique([...previewDelivery, ...sectionMessages("delivery")])}
            scheduleErrors={unique([...previewSchedule, ...sectionMessages("schedule")])}
          />

          <TaxSection
            profiles={taxQuery.data}
            loading={taxQuery.isPending}
            wantsInvoice={wantsInvoice}
            selectedId={taxId}
            error={sectionMessages("tax")[0]}
            onWants={(wants) => {
              setWantsInvoice(wants);
              if (!wants) setTaxId(undefined);
            }}
            onSelect={setTaxId}
          />

          <PaymentSection
            methods={preview?.payment.methods}
            loading={previewQuery.isPending}
            selected={payment}
            currency={currency}
            error={sectionMessages("payment")[0]}
            onSelect={(code) => {
              setPayment(code);
              setServerErrors([]);
              track({ name: "add_payment_info", paymentMethod: code, value: total, currency });
            }}
          />

          <div className="space-y-3 border-t border-border pt-6">
            <p className="flex items-baseline justify-between text-base font-medium">
              <span>{t("checkout.summary.total")}</span>
              <span className="tabular-nums">
                {total === null
                  ? t("checkout.summary.totalPending")
                  : formatCartMoney(total, currency)}
              </span>
            </p>
            {submitError && (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="min-h-12 w-full"
              disabled={submitting || stale}
            >
              {submitting
                ? t("checkout.submit.sending")
                : stale
                  ? t("checkout.submit.calculating")
                  : t(submitLabelKey(provider))}
            </Button>
            <p className="text-xs text-muted-foreground">{t("checkout.submit.help")}</p>
          </div>
        </form>

        <aside className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:overflow-y-auto">
          <OrderSummary preview={preview} refreshing={previewQuery.isFetching} />
        </aside>
      </div>

      <RevalidationDialog
        result={revalidation}
        currency={currency}
        pending={submitting}
        waiting={stale}
        onClose={() => setRevalidation(null)}
        onConfirm={(newTotal) => {
          setRevalidation(null);
          void submit(newTotal);
        }}
      />

      <AddressFormSheet
        target={addressTarget}
        onOpenChange={(open) => {
          if (!open) setAddressTarget(null);
        }}
        countries={countries.countries}
        activeCount={addressesQuery.data?.length ?? 0}
        onSaved={(message, address) => {
          toast.success(message);
          setAddressId(address.id);
          setSchedule(null);
          setAddressTarget(null);
          void refreshPreview();
        }}
      />
    </div>
  );
}

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import type { Destination, ScheduleChoice } from "./destination";
import {
  GUEST_OWNER,
  rememberDestination,
  rememberSchedule,
  useRemembered,
} from "./destinationMemory";
import {
  buildQuoteParams,
  freshestSlots,
  quoteTotal,
  quoteView,
  scheduleView,
  type QuoteView,
  type ScheduleView,
} from "./estimate";
import { quoteShipping } from "./quote";
import { shippingQuoteKeys } from "./queryKeys";
import type { QuoteParams, QuoteSlot } from "./types";

const NO_PARAMS = {};

/**
 * Una consulta a `quote_shipping`, identificada por sus parámetros (`shippingQuoteKeys.quote`). Sin parámetros no pregunta.
 * Cada combinación de destino, subtotal, moneda y franja es UNA consulta distinta: al cambiar cualquiera, `data` vuelve a
 * ser `undefined` hasta que llegue la respuesta de la nueva (no se usa `placeholderData`), así que una cotización vieja no
 * puede mostrarse con datos nuevos.
 */
export function useShippingQuote(params: QuoteParams | null) {
  return useQuery({
    queryKey: shippingQuoteKeys.quote(params ?? NO_PARAMS),
    queryFn: () => quoteShipping(params as QuoteParams),
    enabled: params !== null,
  });
}

export interface ShippingEstimateInput {
  /** Subtotal que informa el servidor para la bolsa (`totals.subtotal`): es el «monto del pedido» de las reglas de tarifa. */
  subtotal: number;
  /**
   * Total que informa el servidor para la bolsa SIN envío (`totals.total`: subtotal menos el descuento de S9, cuando exista).
   * El «Total estimado» es este total + el costo del envío; por omisión, el subtotal (sin descuento).
   */
  baseTotal?: number;
  currency: string;
  /** ¿Hay algo que cobrar? (ver `canQuote`). */
  quotable: boolean;
  /**
   * El servidor dice que el envío es gratis (`discounts.free_shipping`, S9): el costo cotizado se muestra como «Envío gratis»
   * y NO se suma al «Total estimado». Por omisión, no.
   */
  freeShipping?: boolean;
}

export interface ShippingEstimate {
  /** `false` mientras la sesión se está resolviendo: aún no se sabe si es invitada o quién es. */
  ready: boolean;
  /** Id del usuario con sesión (el de su libreta de direcciones); `null` si es invitada. */
  userId: string | null;
  currency: string;
  destination: Destination | null;
  schedule: ScheduleChoice | null;
  quote: QuoteView;
  scheduleCheck: ScheduleView;
  /** Franjas a ofrecer (las más recientes que se conocen). Vacías si la cotización no es válida. */
  slots: QuoteSlot[];
  /** El envío es gratis por un descuento (S9): la cotización es válida pero no cuesta nada a la clienta. */
  freeShipping: boolean;
  /** Total del servidor (sin envío) + envío del servidor (o solo el total, con envío gratis); `null` si no hay un costo válido. */
  total: number | null;
  setDestination(destination: Destination | null): void;
  setSchedule(schedule: ScheduleChoice | null): void;
  /** Vuelve a preguntar lo que falló. */
  retry(): void;
}

/**
 * El estimador de envío de la bolsa: junta quién es la clienta, a dónde envía (recordado en memoria), las dos consultas
 * (costo y franja elegida) y lo que se debe mostrar de cada una. No toca el carrito.
 *
 * Dos consultas, no una: si la franja elegida se llenó, el servidor contesta `ok: false` y SIN costo; con una sola consulta
 * el envío «desaparecería» por un problema de la fecha. La del costo no lleva fecha; la de la franja se hace solo con el
 * costo ya válido.
 */
export function useShippingEstimate({
  subtotal,
  baseTotal = subtotal,
  currency,
  quotable,
  freeShipping = false,
}: ShippingEstimateInput): ShippingEstimate {
  const { status, session } = useAuth();
  const ready = status !== "loading";
  const userId = ready ? (session?.user.id ?? null) : null;
  const owner = ready ? (userId ?? GUEST_OWNER) : null;
  const remembered = useRemembered(owner);
  const destination = remembered.destination;
  const schedule = remembered.schedule;

  const asked = quotable && destination !== null;
  const baseParams = asked ? buildQuoteParams(destination, subtotal, currency) : null;
  const base = useShippingQuote(baseParams);
  const quote = quoteView({ asked, currency, data: base.data, failed: base.isError });

  const checking = asked && quote.kind === "ok" && schedule !== null;
  const checkParams = checking ? buildQuoteParams(destination, subtotal, currency, schedule) : null;
  const check = useShippingQuote(checkParams);
  const scheduleCheck = scheduleView({
    choice: schedule,
    asked: checking,
    data: check.data,
    failed: check.isError,
  });

  const slots = quote.kind === "ok" ? freshestSlots(quote.slots, check.data) : [];
  const total = quoteTotal(quote, baseTotal, currency, freeShipping);

  const setDestination = useCallback(
    (next: Destination | null) => {
      if (owner !== null) rememberDestination(owner, next);
    },
    [owner],
  );
  const setSchedule = useCallback(
    (next: ScheduleChoice | null) => {
      if (owner !== null) rememberSchedule(owner, next);
    },
    [owner],
  );
  const { refetch: refetchBase } = base;
  const { refetch: refetchCheck } = check;
  // `refetch` ignora `enabled`: solo se vuelve a preguntar lo que de verdad se estaba preguntando y no resultó.
  const retry = useCallback(() => {
    if (quote.kind === "failed" || quote.kind === "rejected") void refetchBase();
    if (scheduleCheck.kind === "failed") void refetchCheck();
  }, [quote.kind, scheduleCheck.kind, refetchBase, refetchCheck]);

  return {
    ready,
    userId,
    currency,
    destination,
    schedule,
    quote,
    scheduleCheck,
    slots,
    freeShipping,
    total,
    setDestination,
    setSchedule,
    retry,
  };
}

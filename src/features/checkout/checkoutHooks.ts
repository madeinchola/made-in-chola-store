import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";
import { choicesKey } from "./checkoutForm";
import { previewCheckout } from "./checkoutApi";
import type { CheckoutChoices, CheckoutPreview } from "./types";

/** Un error de la función `checkout` con lo que la pantalla necesita para explicarlo (HTTP, código y espera). */
export class CheckoutHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(code);
    this.name = "CheckoutHttpError";
  }
}

/** Una forma de entrega que la tienda ofrece (vista `public_shipping_methods`: nunca expone coordenadas). */
export interface ShippingMethodOption {
  code: string;
  name: string;
  kind: "delivery" | "pickup";
  description: string | null;
  etaMin: number | null;
  etaMax: number | null;
  pickupName: string | null;
  pickupAddress: string | null;
  pickupCity: string | null;
  pickupHours: string | null;
}

export const checkoutKeys = {
  methods: ["checkout", "shipping-methods"] as const,
  preview: (choices: CheckoutChoices, cartKey: string) =>
    ["checkout", "preview", choicesKey(choices), cartKey] as const,
};

export const useShippingMethods = () =>
  useQuery({
    queryKey: checkoutKeys.methods,
    queryFn: async (): Promise<ShippingMethodOption[]> => {
      const { data, error } = await getSupabase()
        .from("public_shipping_methods")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).flatMap((row) =>
        row.code && row.name && (row.kind === "delivery" || row.kind === "pickup")
          ? [
              {
                code: row.code,
                name: row.name,
                kind: row.kind,
                description: row.description ?? null,
                etaMin: row.eta_min_days ?? null,
                etaMax: row.eta_max_days ?? null,
                pickupName: row.pickup_name ?? null,
                pickupAddress: row.pickup_address ?? null,
                pickupCity: row.pickup_city ?? null,
                pickupHours: row.pickup_hours ?? null,
              },
            ]
          : [],
      );
    },
    staleTime: 5 * 60_000,
  });

/**
 * La vista previa del servidor para lo que la persona eligió. `cartKey` resume el estado de la bolsa (líneas, cantidades,
 * cupón y total): cualquier cambio en ella vuelve a pedir los números, así lo que se ve es siempre lo que el servidor
 * calcula. Mientras llega la nueva respuesta se conserva la anterior (sin saltos de diseño).
 */
export function useCheckoutPreview(choices: CheckoutChoices | null, cartKey: string) {
  const query = useQuery({
    queryKey: choices ? checkoutKeys.preview(choices, cartKey) : ["checkout", "preview", "idle"],
    queryFn: async (): Promise<CheckoutPreview | null> => {
      const result = await previewCheckout(choices as CheckoutChoices);
      if (!result.ok) throw new CheckoutHttpError(result.status, result.code, result.retryAfter);
      return result.data.outcome === "preview" ? result.data.checkout : null;
    },
    enabled: choices !== null,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: (count, error) =>
      count < 2 &&
      !(error instanceof CheckoutHttpError && error.status >= 400 && error.status < 500),
  });
  return query;
}

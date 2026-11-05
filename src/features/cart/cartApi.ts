import { callFunction } from "@/lib/functions";
import { getSupabase } from "@/lib/supabase";
import type { CartApi } from "./cartStore";
import type { CartRequestBody, CartResponse } from "./types";

/** Habla con la función `cart` con la sesión actual (si la hay); sin sesión es un invitado y va solo el token. */
export function createCartApi(): CartApi {
  return {
    async request(body: CartRequestBody) {
      let token: string | undefined;
      try {
        const { data } = await getSupabase().auth.getSession();
        token = data.session?.access_token ?? undefined;
      } catch {
        token = undefined;
      }
      return callFunction<CartResponse>("cart", body, token ? { token } : {});
    },
  };
}

/** Avisa a las demás pestañas del mismo navegador (mismo origen) que el carrito cambió. */
export function createCartChannel(): {
  post(): void;
  subscribe(onMessage: () => void): () => void;
} | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel("mic-cart");
  return {
    post: () => channel.postMessage("changed"),
    subscribe(onMessage) {
      const handler = () => onMessage();
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
  };
}

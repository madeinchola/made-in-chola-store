import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/features/auth/useAuth";
import { registerPostSignInHook } from "@/features/auth/postSignIn";
import { track } from "@/features/storefront/analytics/track";
import { CartContext, type CartContextValue } from "./cart-context";
import { createCartApi, createCartChannel } from "./cartApi";
import { type CartApi, CartStore } from "./cartStore";
import { blockingLines, canCheckout, displayCount, displayLines } from "./selectors";
import { browserCartStorage, type CartStorage } from "./storage";

interface CartProviderProps {
  children: ReactNode;
  /** Solo para pruebas: una API o un almacenamiento de mentira. */
  api?: CartApi;
  storage?: CartStorage;
}

/**
 * Monta el almacén del carrito y lo ata a la sesión: invitado ↔ usuario, fusión al iniciar sesión (gancho de S6),
 * reintento al volver la red y relectura al volver a la pestaña. Debe ir DENTRO de `AuthProvider`.
 */
export function CartProvider({ children, api, storage }: CartProviderProps) {
  const { status, session } = useAuth();
  const [store] = useState(
    () =>
      new CartStore({
        api: api ?? createCartApi(),
        storage: storage ?? browserCartStorage(),
        channel: createCartChannel(),
        onEvent: (event) => {
          if (event.type === "removed") {
            track({
              name: "remove_from_cart",
              quantity: event.quantity,
              item: {
                id: event.line.product_id,
                name: event.line.name,
                price: event.line.unit_price,
                // La moneda de la bolsa (la del servidor), no una fija: el precio y la moneda deben decir lo mismo.
                currency: event.currency,
              },
            });
          }
        },
      }),
  );
  const [open, setOpen] = useState(false);

  const userId = session?.user.id ?? null;
  const accessToken = session?.access_token ?? null;
  useEffect(() => {
    if (status === "loading") return;
    if (userId) {
      store.setIdentity({ kind: "user", userId });
      // Por si quedó un carrito de invitado sin fusionar (otra pestaña, falta de red al iniciar sesión): idempotente.
      void store.mergeGuest(userId);
    } else {
      store.setIdentity({ kind: "guest" });
    }
  }, [store, status, userId]);

  // Si lo pendiente se quedó esperando por una sesión vencida (401), al renovarse el token se reintenta solo.
  useEffect(() => {
    if (accessToken) store.sessionRefreshed();
  }, [store, accessToken]);

  // El inicio de sesión espera (hasta 3 s) a que el carrito de invitado se pase al del usuario.
  useEffect(
    () =>
      registerPostSignInHook(async ({ userId: id }) => {
        store.setIdentity({ kind: "user", userId: id });
        await store.mergeGuest(id);
      }),
    [store],
  );

  useEffect(() => {
    const online = () => store.retryNow();
    const visible = () => {
      if (document.visibilityState === "visible") store.refetchIfStale();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [store]);

  // Se engancha al montar y se suelta al desmontar, de forma REVERSIBLE: React en desarrollo (StrictMode) monta, desmonta y
  // vuelve a montar, y un fin definitivo dejaba a quien tiene sesión sin cargar su bolsa.
  useEffect(() => {
    store.connect();
    return () => store.disconnect();
  }, [store]);

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const value = useMemo<CartContextValue>(
    () => ({
      store,
      state,
      lines: displayLines(state),
      count: displayCount(state),
      blocking: blockingLines(state),
      canCheckout: canCheckout(state),
      open,
      setOpen,
    }),
    [store, state, open],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

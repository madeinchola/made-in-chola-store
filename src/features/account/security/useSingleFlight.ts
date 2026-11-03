import { useCallback, useRef } from "react";

/**
 * Deja pasar UNA operación asíncrona a la vez: mientras una está en vuelo, las demás llamadas se ignoran y devuelven
 * `undefined`. Usa una referencia y no estado: dos eventos disparados en el mismo instante (antes de que React vuelva a
 * pintar) ven el mismo valor, cosa que un `isPending` del último render no garantiza. El doble clic y «Intro + clic»
 * son los casos típicos; el botón con `loading` es la ayuda visual, esto es el seguro.
 */
export function useSingleFlight() {
  const flying = useRef(false);
  return useCallback(async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
    if (flying.current) return undefined;
    flying.current = true;
    try {
      return await operation();
    } finally {
      flying.current = false;
    }
  }, []);
}

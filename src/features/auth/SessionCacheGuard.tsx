import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

/**
 * Vacía la caché de datos cuando se CIERRA la sesión o cambia el usuario en la misma pestaña: las direcciones, los
 * datos fiscales, los pedidos o el panel de la persona anterior no pueden quedar en memoria (ni mostrarse un instante)
 * para quien entre después en un equipo compartido. Iniciar sesión por primera vez no vacía nada (solo hay datos públicos).
 * Debe montarse dentro de `QueryClientProvider` y de `AuthProvider`.
 */
export function SessionCacheGuard() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const previous = useRef<string | null>(null);
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (previous.current !== null && previous.current !== userId) void queryClient.resetQueries();
    previous.current = userId;
  }, [userId, queryClient]);
  return null;
}

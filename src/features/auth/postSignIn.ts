import { logger } from "@/lib/logger";

/**
 * Ganchos que se ejecutan UNA vez tras un inicio de sesión o registro EXITOSO (no al restaurar una sesión guardada ni al
 * refrescar el token). Existen para que otras áreas reaccionen al login sin que `AuthProvider` las conozca: el primero
 * es la fusión del carrito de invitado con el del cliente (`mergeGuestCart`, S7).
 *
 * Contrato:
 *  · un gancho recibe `{ userId }` y puede ser asíncrono;
 *  · es de MEJOR ESFUERZO: si falla, se registra (sin datos personales) y el inicio de sesión sigue; jamás lo bloquea;
 *  · el login espera a los ganchos como máximo `MAX_WAIT_MS` (para que la pantalla siguiente ya vea, p. ej., el carrito
 *    fusionado) y continúa aunque tarden: ellos siguen en segundo plano;
 *  · deben ser idempotentes (un reintento o un doble clic no duplica nada).
 */
export interface PostSignInContext {
  userId: string;
}
export type PostSignInHook = (context: PostSignInContext) => void | Promise<void>;

export const MAX_WAIT_MS = 3000;

const hooks = new Set<PostSignInHook>();

/** Registra un gancho. Devuelve la función para quitarlo. */
export function registerPostSignInHook(hook: PostSignInHook): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

/** Ejecuta todos los ganchos (en paralelo). Nunca lanza. */
export async function runPostSignInHooks(
  context: PostSignInContext,
  maxWaitMs: number = MAX_WAIT_MS,
): Promise<void> {
  if (hooks.size === 0) return;
  const running = [...hooks].map(async (hook) => {
    try {
      await hook(context);
    } catch (error) {
      logger.warn("Un gancho posterior al inicio de sesión falló", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxWaitMs);
  });
  try {
    await Promise.race([Promise.all(running).then(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

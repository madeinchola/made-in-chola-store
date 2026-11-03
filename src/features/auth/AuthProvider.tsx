import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { callFunction } from "@/lib/functions";
import { logger } from "@/lib/logger";
import { getSupabase } from "@/lib/supabase";
import { runPostSignInHooks } from "./postSignIn";
import {
  AuthContext,
  type AuthContextValue,
  type AuthResult,
  type AuthStatus,
  type Profile,
  type RegisterInput,
} from "./auth-context";

interface LoginResponse {
  session: { access_token: string; refresh_token: string };
}

/** Cada cuánto se reevalúa el perfil/rol de una sesión abierta (el servidor ya aplica el rol real en cada consulta). */
const PROFILE_REVALIDATE_MS = 60_000;

/** Resultado de leer el perfil: distingue «no hay perfil visible» (cuenta desactivada) de «no pude leerlo» (red, 5xx). */
type ProfileResult = { kind: "ok"; profile: Profile } | { kind: "missing" } | { kind: "error" };

/** Reintentos de la PRIMERA carga del perfil si falla la red (después manda la revalidación periódica). */
const PROFILE_RETRY_MS = [2_000, 5_000, 15_000] as const;

/**
 * Perfil del usuario actual. IMPORTANTE: se filtra por id. Para un admin la RLS (profiles_select_admin)
 * devuelve TODOS los perfiles, y un `maybeSingle()` sin filtro fallaría con "varias filas".
 */
async function fetchProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, full_name, email, phone_e164, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    logger.warn("No se pudo leer el perfil", { code: error.code });
    return { kind: "error" };
  }
  return data ? { kind: "ok", profile: data as Profile } : { kind: "missing" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const userId = session?.user.id ?? null;
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  // 1) Sesión de Supabase (persistida, refrescada y sincronizada entre pestañas por supabase-js).
  useEffect(() => {
    const supabase = getSupabase();
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) setStatus("anonymous");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      // El usuario CAMBIÓ sin pasar por «anónimo» (otra pestaña inició sesión con otra cuenta): el perfil y el rol del
      // anterior no pueden seguir valiendo ni un instante mientras llega el del nuevo.
      const switched =
        next !== null && sessionRef.current !== null && sessionRef.current.user.id !== next.user.id;
      // No se llama a supabase dentro del callback (puede bloquear): solo se guarda la sesión.
      setSession(next);
      if (!next || switched) {
        // Un reintento pendiente era de la sesión anterior: se cancela y el contador vuelve a empezar.
        window.clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
        attempts.current = 0;
        hasProfile.current = false;
      }
      if (!next) {
        setProfile(null);
        setStatus("anonymous");
      } else if (switched) {
        setProfile(null);
        setStatus("loading");
      } else {
        // Hay sesión pero aún no perfil: "loading" (nunca "anonymous"), para que los guards esperen
        // en vez de rebotar a /login. Un refresco de token con perfil ya cargado no cambia nada.
        setStatus((prev) => (prev === "authenticated" ? prev : "loading"));
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const retryTimer = useRef<number | undefined>(undefined);
  const attempts = useRef(0);
  /** ¿Ya se cargó el perfil de ESTA sesión? Solo mientras no, un fallo de red se reintenta enseguida. */
  const hasProfile = useRef(false);

  const loadProfile = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    const result = await fetchProfile(current.user.id);
    if (sessionRef.current?.user.id !== current.user.id) return; // la sesión cambió mientras se consultaba
    if (result.kind === "error") {
      // Un fallo de red o un 5xx NO es «cuenta desactivada»: no se cierra la sesión (un móvil que despierta sin
      // conexión sacaba a la clienta en pleno formulario). Se conserva lo que ya había; si aún no había perfil, se
      // reintenta unas veces y después manda la revalidación periódica.
      const delay = hasProfile.current ? undefined : PROFILE_RETRY_MS[attempts.current];
      if (delay !== undefined && retryTimer.current === undefined) {
        attempts.current += 1;
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = undefined;
          void loadProfile();
        }, delay);
      }
      return;
    }
    if (result.kind === "missing") {
      // Hay sesión pero RLS no entrega perfil: cuenta desactivada. Se cierra la sesión local.
      logger.warn("Sesión sin perfil visible: se cierra");
      await getSupabase().auth.signOut({ scope: "local" });
      return;
    }
    hasProfile.current = true;
    setProfile(result.profile);
    setStatus("authenticated");
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(retryTimer.current);
    },
    [],
  );

  // 2) Perfil del usuario actual (y revalidación periódica / al volver a la pestaña).
  useEffect(() => {
    if (!userId) return;
    void loadProfile();
    const interval = window.setInterval(() => void loadProfile(), PROFILE_REVALIDATE_MS);
    const onVisible = () => document.visibilityState === "visible" && void loadProfile();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, loadProfile]);

  const signIn = useCallback(async (identifier: string, password: string): Promise<AuthResult> => {
    const res = await callFunction<LoginResponse>("login", { identifier, password });
    if (!res.ok) return { ok: false, code: res.code, retryAfter: res.retryAfter };
    const { data, error } = await getSupabase().auth.setSession({
      access_token: res.data.session.access_token,
      refresh_token: res.data.session.refresh_token,
    });
    if (error) return { ok: false, code: "unknown" };
    // Ganchos de «acabo de iniciar sesión» (p. ej. fusionar el carrito de invitado, S7): mejor esfuerzo, no bloquean.
    const userId = data?.session?.user.id;
    if (userId) await runPostSignInHooks({ userId });
    return { ok: true };
  }, []);

  const signUp = useCallback(
    async (input: RegisterInput): Promise<AuthResult> => {
      const res = await callFunction("register", {
        full_name: input.fullName,
        email: input.email || undefined,
        phone: input.phone || undefined,
        phone_country: input.phoneCountry,
        password: input.password,
      });
      if (!res.ok)
        return { ok: false, code: res.code, retryAfter: res.retryAfter, failures: res.failures };
      return signIn(input.email || input.phone || "", input.password);
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut({ scope: "global" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      profile,
      isAdmin: profile?.role === "admin",
      signIn,
      signUp,
      signOut,
      refreshProfile: loadProfile,
    }),
    [status, session, profile, signIn, signUp, signOut, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

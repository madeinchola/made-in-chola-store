import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { callFunction } from "@/lib/functions";
import { logger } from "@/lib/logger";
import { getSupabase } from "@/lib/supabase";
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

/**
 * Perfil del usuario actual. IMPORTANTE: se filtra por id. Para un admin la RLS (profiles_select_admin)
 * devuelve TODOS los perfiles, y un `maybeSingle()` sin filtro fallaría con "varias filas".
 */
async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, full_name, email, phone_e164, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    logger.warn("No se pudo leer el perfil", { code: error.code });
    return null;
  }
  return (data as Profile | null) ?? null;
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
      // No se llama a supabase dentro del callback (puede bloquear): solo se guarda la sesión.
      setSession(next);
      if (!next) {
        setProfile(null);
        setStatus("anonymous");
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

  const loadProfile = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    const next = await fetchProfile(current.user.id);
    if (sessionRef.current?.user.id !== current.user.id) return; // la sesión cambió mientras se consultaba
    if (!next) {
      // Hay sesión pero RLS no entrega perfil: cuenta desactivada. Se cierra la sesión local.
      logger.warn("Sesión sin perfil visible: se cierra");
      await getSupabase().auth.signOut({ scope: "local" });
      return;
    }
    setProfile(next);
    setStatus("authenticated");
  }, []);

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
    const { error } = await getSupabase().auth.setSession({
      access_token: res.data.session.access_token,
      refresh_token: res.data.session.refresh_token,
    });
    return error ? { ok: false, code: "unknown" } : { ok: true };
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

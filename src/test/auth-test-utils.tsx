/* Utilidades SOLO de tests (exportan datos y funciones junto al proveedor falso): el aviso de fast refresh no aplica. */
/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { AuthContext, type AuthContextValue, type Profile } from "@/features/auth/auth-context";

export const customerProfile: Profile = {
  id: "11111111-1111-1111-1111-111111111111",
  full_name: "Ana Cliente",
  email: "ana@test.com",
  phone_e164: null,
  role: "customer",
};
export const adminProfile: Profile = {
  ...customerProfile,
  id: "22222222-2222-2222-2222-222222222222",
  full_name: "Admin Uno",
  role: "admin",
};

/** Contexto de auth falso y controlable para probar UI y guards sin red. */
export function fakeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "anonymous",
    session: null,
    profile: null,
    isAdmin: false,
    signIn: async () => ({ ok: true }),
    signUp: async () => ({ ok: true }),
    signOut: async () => {},
    refreshProfile: async () => {},
    ...overrides,
  };
}

export const asCustomer = (o: Partial<AuthContextValue> = {}) =>
  fakeAuth({ status: "authenticated", profile: customerProfile, isAdmin: false, ...o });
export const asAdmin = (o: Partial<AuthContextValue> = {}) =>
  fakeAuth({ status: "authenticated", profile: adminProfile, isAdmin: true, ...o });

export function WithAuth({ value, children }: { value: AuthContextValue; children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

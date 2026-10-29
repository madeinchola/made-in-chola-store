import { createContext } from "react";
import type { Session } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
  role: "customer" | "admin";
}

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthFailure {
  code: string;
  retryAfter?: number;
  failures?: string[];
}

export type AuthResult = { ok: true } | ({ ok: false } & AuthFailure);

export interface RegisterInput {
  fullName: string;
  email?: string;
  phone?: string;
  phoneCountry?: string;
  password: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  signIn(identifier: string, password: string): Promise<AuthResult>;
  signUp(input: RegisterInput): Promise<AuthResult>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

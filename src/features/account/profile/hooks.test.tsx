import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { AppError } from "@/lib/errors";
import { asCustomer, customerProfile, fakeAuth, WithAuth } from "@/test/auth-test-utils";

const api = vi.hoisted(() => ({
  getProfilePreferences: vi.fn(),
  updateProfile: vi.fn(),
  listPublicCurrencies: vi.fn(),
  changeContact: vi.fn(),
}));
vi.mock("./api", () => api);

import {
  useChangeContact,
  useProfilePreferences,
  usePublicCurrencies,
  useUpdateProfile,
} from "./hooks";
import { profileKeys } from "./queryKeys";

const PREFS = { fullName: "Ana Cliente", locale: "es", currency: null };

function setup(auth: AuthContextValue = asCustomer()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WithAuth value={auth}>{children}</WithAuth>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getProfilePreferences.mockResolvedValue(PREFS);
  api.updateProfile.mockResolvedValue({ ...PREFS, fullName: "Ana M." });
  api.listPublicCurrencies.mockResolvedValue([
    { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2 },
  ]);
  api.changeContact.mockResolvedValue({ ok: true, data: { ok: true, changed: true } });
});

describe("useProfilePreferences", () => {
  it("lee las preferencias de la persona en sesión y las guarda bajo su clave", async () => {
    const { wrapper, queryClient } = setup();
    const { result } = renderHook(() => useProfilePreferences(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getProfilePreferences).toHaveBeenCalledWith(customerProfile.id);
    expect(result.current.data).toEqual(PREFS);
    expect(queryClient.getQueryData(profileKeys.preferences(customerProfile.id))).toEqual(PREFS);
  });

  it("sin sesión no consulta nada", () => {
    const { wrapper } = setup(fakeAuth());
    const { result } = renderHook(() => useProfilePreferences(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(api.getProfilePreferences).not.toHaveBeenCalled();
  });

  it("la clave incluye a la persona: otra sesión no reutiliza la caché de esta", () => {
    expect(profileKeys.preferences("a")).not.toEqual(profileKeys.preferences("b"));
    expect(profileKeys.preferences("a")[0]).toBe("account");
  });
});

describe("usePublicCurrencies", () => {
  it("carga las monedas habilitadas", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => usePublicCurrencies(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2 },
    ]);
  });
});

describe("useUpdateProfile", () => {
  it("guarda con el id de la sesión, deja el resultado en caché y refresca el perfil de la sesión", async () => {
    const refreshProfile = vi.fn(async () => {});
    const { wrapper, queryClient } = setup(asCustomer({ refreshProfile }));
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await result.current.mutateAsync({ fullName: "Ana M." });
    expect(api.updateProfile).toHaveBeenCalledWith(customerProfile.id, { fullName: "Ana M." });
    expect(queryClient.getQueryData(profileKeys.preferences(customerProfile.id))).toEqual({
      ...PREFS,
      fullName: "Ana M.",
    });
    expect(refreshProfile).toHaveBeenCalledTimes(1);
  });

  it("si falla: no toca la caché ni refresca el perfil, y el error llega a quien llamó", async () => {
    const refreshProfile = vi.fn(async () => {});
    api.updateProfile.mockRejectedValue(
      new AppError("validation", "La moneda preferida no está habilitada"),
    );
    const { wrapper, queryClient } = setup(asCustomer({ refreshProfile }));
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await expect(result.current.mutateAsync({ currency: "JPY" })).rejects.toThrow(
      "La moneda preferida no está habilitada",
    );
    expect(refreshProfile).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(profileKeys.preferences(customerProfile.id))).toBeUndefined();
  });

  it("sin sesión rechaza sin llamar a la API", async () => {
    const { wrapper } = setup(fakeAuth());
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await expect(result.current.mutateAsync({ fullName: "X" })).rejects.toMatchObject({
      code: "unauthorized",
      message: "Tu sesión venció. Inicia sesión de nuevo para continuar.",
    });
    expect(api.updateProfile).not.toHaveBeenCalled();
  });
});

describe("useChangeContact", () => {
  const session = { access_token: "tok-77" } as Session;

  it("envía el cambio con el token de la sesión y, si se aplicó, refresca el perfil", async () => {
    const refreshProfile = vi.fn(async () => {});
    const { wrapper } = setup(asCustomer({ session, refreshProfile }));
    const { result } = renderHook(() => useChangeContact(), { wrapper });
    const outcome = await result.current.mutateAsync({ password: "clave", email: "n@x.co" });
    expect(api.changeContact).toHaveBeenCalledWith(
      { password: "clave", email: "n@x.co" },
      "tok-77",
    );
    expect(outcome).toEqual({ ok: true, data: { ok: true, changed: true } });
    expect(refreshProfile).toHaveBeenCalledTimes(1);
  });

  it("un fallo NO rechaza (devuelve el resultado) y NO refresca el perfil", async () => {
    const refreshProfile = vi.fn(async () => {});
    const failure = { ok: false, status: 401, code: "invalid_credentials", message: "x" };
    api.changeContact.mockResolvedValue(failure);
    const { wrapper } = setup(asCustomer({ session, refreshProfile }));
    const { result } = renderHook(() => useChangeContact(), { wrapper });
    await expect(result.current.mutateAsync({ password: "mala", email: "n@x.co" })).resolves.toBe(
      failure,
    );
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it("sin sesión envía sin token (el servidor responde 401)", async () => {
    const { wrapper } = setup(asCustomer({ session: null }));
    const { result } = renderHook(() => useChangeContact(), { wrapper });
    await result.current.mutateAsync({ password: "p", phone: null });
    expect(api.changeContact).toHaveBeenCalledWith({ password: "p", phone: null }, undefined);
  });
});

import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asCustomer, WithAuth } from "@/test/auth-test-utils";

const api = vi.hoisted(() => ({ changePassword: vi.fn(), deactivateAccount: vi.fn() }));
vi.mock("./api", () => api);

import { useChangePassword, useDeactivateAccount } from "./hooks";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
  >
    <WithAuth value={asCustomer({ session: { access_token: "tok-5" } as Session })}>
      {children}
    </WithAuth>
  </QueryClientProvider>
);

beforeEach(() => vi.clearAllMocks());

describe("useChangePassword", () => {
  it("usa el token de la sesión y devuelve el resultado (fallos incluidos) sin rechazar", async () => {
    const failure = { ok: false, status: 401, code: "invalid_credentials", message: "x" };
    api.changePassword.mockResolvedValue(failure);
    const { result } = renderHook(() => useChangePassword(), { wrapper });
    const outcome = await act(() =>
      result.current.mutateAsync({ currentPassword: "a", newPassword: "b" }),
    );
    expect(outcome).toBe(failure);
    expect(api.changePassword).toHaveBeenCalledWith(
      { currentPassword: "a", newPassword: "b" },
      "tok-5",
    );
  });
});

describe("useDeactivateAccount", () => {
  it("usa el token de la sesión y pasa la contraseña y la opción de anonimizar", async () => {
    api.deactivateAccount.mockResolvedValue({ ok: true, data: { ok: true } });
    const { result } = renderHook(() => useDeactivateAccount(), { wrapper });
    await act(() => result.current.mutateAsync({ password: "clave", anonymize: true }));
    expect(api.deactivateAccount).toHaveBeenCalledWith(
      { password: "clave", anonymize: true },
      "tok-5",
    );
  });
});

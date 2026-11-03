import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { AppError } from "@/lib/errors";
import { asCustomer, customerProfile, fakeAuth, WithAuth } from "@/test/auth-test-utils";

const api = vi.hoisted(() => ({
  listTaxProfiles: vi.fn(),
  createTaxProfile: vi.fn(),
  updateTaxProfile: vi.fn(),
  archiveTaxProfile: vi.fn(),
  restoreTaxProfile: vi.fn(),
  setDefaultTaxProfile: vi.fn(),
}));
vi.mock("./api", () => api);

import {
  useArchiveTaxProfile,
  useCreateTaxProfile,
  useRestoreTaxProfile,
  useSetDefaultTaxProfile,
  useTaxProfiles,
  useUpdateTaxProfile,
} from "./hooks";
import { taxKeys } from "./queryKeys";

const INPUT = { docType: "ci" as const, docNumber: "1234567", legalName: "Ana" };

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
  api.listTaxProfiles.mockResolvedValue([]);
  api.createTaxProfile.mockResolvedValue({});
  api.updateTaxProfile.mockResolvedValue({});
  api.archiveTaxProfile.mockResolvedValue({});
  api.restoreTaxProfile.mockResolvedValue({});
  api.setDefaultTaxProfile.mockResolvedValue({});
});

describe("useTaxProfiles", () => {
  it("lista los de la persona en sesión (filtrados por su id) bajo su clave", async () => {
    api.listTaxProfiles.mockResolvedValue([{ id: "t-1" }]);
    const { wrapper, queryClient } = setup();
    const { result } = renderHook(() => useTaxProfiles(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listTaxProfiles).toHaveBeenCalledWith(customerProfile.id);
    expect(queryClient.getQueryData(taxKeys.list(customerProfile.id))).toEqual([{ id: "t-1" }]);
  });

  it("sin sesión no consulta", () => {
    const { wrapper } = setup(fakeAuth());
    const { result } = renderHook(() => useTaxProfiles(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(api.listTaxProfiles).not.toHaveBeenCalled();
  });

  it("siempre fresco: al volver a montar relee la lista", async () => {
    const { wrapper } = setup();
    const first = renderHook(() => useTaxProfiles(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    const second = renderHook(() => useTaxProfiles(), { wrapper });
    await waitFor(() => expect(api.listTaxProfiles).toHaveBeenCalledTimes(2));
    second.unmount();
  });
});

describe("mutaciones", () => {
  it("crear: usa el id de la sesión como dueño", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateTaxProfile(), { wrapper });
    await act(() => result.current.mutateAsync(INPUT));
    expect(api.createTaxProfile).toHaveBeenCalledWith(customerProfile.id, INPUT);
  });

  it("crear sin sesión rechaza sin llamar a la API", async () => {
    const { wrapper } = setup(fakeAuth());
    const { result } = renderHook(() => useCreateTaxProfile(), { wrapper });
    await expect(result.current.mutateAsync(INPUT)).rejects.toMatchObject({ code: "unauthorized" });
    expect(api.createTaxProfile).not.toHaveBeenCalled();
  });

  it.each([
    [
      "editar",
      () => useUpdateTaxProfile(),
      (m: ReturnType<typeof useUpdateTaxProfile>) => m.mutateAsync({ id: "t-1", input: INPUT }),
      "updateTaxProfile",
      ["t-1", INPUT],
    ],
    [
      "archivar",
      () => useArchiveTaxProfile(),
      (m: ReturnType<typeof useArchiveTaxProfile>) => m.mutateAsync("t-2"),
      "archiveTaxProfile",
      ["t-2"],
    ],
    [
      "restaurar",
      () => useRestoreTaxProfile(),
      (m: ReturnType<typeof useRestoreTaxProfile>) => m.mutateAsync("t-3"),
      "restoreTaxProfile",
      ["t-3"],
    ],
    [
      "predeterminado",
      () => useSetDefaultTaxProfile(),
      (m: ReturnType<typeof useSetDefaultTaxProfile>) => m.mutateAsync("t-4"),
      "setDefaultTaxProfile",
      ["t-4"],
    ],
  ] as const)(
    "%s llama a la API con los argumentos correctos",
    async (_name, useHook, run, fn, args) => {
      const { wrapper } = setup();
      const { result } = renderHook(() => useHook(), { wrapper });
      await act(() => run(result.current as never));
      expect(api[fn]).toHaveBeenCalledWith(...args);
    },
  );

  it("tras guardar vuelve a leer la lista (y también si FALLA: otro dispositivo pudo cambiarla)", async () => {
    const { wrapper } = setup();
    const list = renderHook(() => useTaxProfiles(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(api.listTaxProfiles).toHaveBeenCalledTimes(1);

    const archive = renderHook(() => useArchiveTaxProfile(), { wrapper });
    await act(() => archive.result.current.mutateAsync("t-1"));
    await waitFor(() => expect(api.listTaxProfiles).toHaveBeenCalledTimes(2));

    api.archiveTaxProfile.mockRejectedValue(new AppError("validation", "no"));
    await act(async () => {
      await archive.result.current.mutateAsync("t-1").catch(() => {});
    });
    await waitFor(() => expect(api.listTaxProfiles).toHaveBeenCalledTimes(3));
  });
});

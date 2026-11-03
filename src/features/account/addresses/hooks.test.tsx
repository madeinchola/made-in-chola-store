import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import {
  FALLBACK_COUNTRIES,
  useActiveAddresses,
  useArchiveAddress,
  useArchivedAddresses,
  useCreateAddress,
  useDeliveryCountries,
  useRestoreAddress,
  useSetDefaultAddress,
  useUpdateAddress,
} from "./hooks";
import { addressKeys } from "./queryKeys";
import type { Address, AddressInput } from "./types";

const api = vi.hoisted(() => ({
  listActiveAddresses: vi.fn(),
  listArchivedAddresses: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  archiveAddress: vi.fn(),
  restoreAddress: vi.fn(),
  setDefaultAddress: vi.fn(),
  listDeliveryCountries: vi.fn(),
}));
vi.mock("./api", () => api);

const PROFILE = "11111111-1111-1111-1111-111111111111";

const address = (id: string, over: Partial<Address> = {}): Address => ({
  id,
  profileId: PROFILE,
  label: `Dirección ${id}`,
  recipient: "Ana",
  phone: "+59171234567",
  line1: "Calle 1",
  line2: null,
  city: "La Paz",
  department: "La Paz",
  country: "BO",
  referenceText: null,
  lat: null,
  lng: null,
  isDefault: false,
  forShipping: true,
  forBilling: false,
  archivedAt: null,
  createdAt: "2026-11-01T10:00:00+00:00",
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});

const input: AddressInput = {
  label: "Casa",
  recipient: "Ana",
  phoneE164: "+59171234567",
  line1: "Calle 1",
  line2: null,
  city: "La Paz",
  department: "La Paz",
  country: "BO",
  referenceText: null,
  lat: null,
  lng: null,
  forShipping: true,
  forBilling: false,
  isDefault: false,
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.listActiveAddresses.mockResolvedValue([address("a")]);
  api.listArchivedAddresses.mockResolvedValue([
    address("z", { archivedAt: "2026-11-02T10:00:00Z" }),
  ]);
  api.createAddress.mockResolvedValue(address("nueva"));
  api.updateAddress.mockResolvedValue(address("a"));
  api.archiveAddress.mockResolvedValue(address("a"));
  api.restoreAddress.mockResolvedValue(address("z"));
  api.setDefaultAddress.mockResolvedValue(address("a"));
  api.listDeliveryCountries.mockResolvedValue([
    { code: "BO", name: "Bolivia" },
    { code: "AR", name: "Argentina" },
  ]);
});

describe("consultas", () => {
  it("las activas se piden con el id del cliente", async () => {
    const { result } = renderHook(() => useActiveAddresses(PROFILE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listActiveAddresses).toHaveBeenCalledWith(PROFILE);
    expect(result.current.data?.[0]?.id).toBe("a");
  });

  it("las archivadas, igual", async () => {
    const { result } = renderHook(() => useArchivedAddresses(PROFILE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listArchivedAddresses).toHaveBeenCalledWith(PROFILE);
    expect(result.current.data?.[0]?.id).toBe("z");
  });

  it("sin id de cliente (sesión sin cargar) NO consultan", async () => {
    const active = renderHook(() => useActiveAddresses(undefined), { wrapper });
    const archived = renderHook(() => useArchivedAddresses(undefined), { wrapper });
    await act(async () => {});
    expect(api.listActiveAddresses).not.toHaveBeenCalled();
    expect(api.listArchivedAddresses).not.toHaveBeenCalled();
    expect(active.result.current.fetchStatus).toBe("idle");
    expect(archived.result.current.fetchStatus).toBe("idle");
  });

  it("clientes distintos no comparten caché", async () => {
    api.listActiveAddresses.mockImplementation(async (id: string) => [address(`de-${id}`)]);
    const first = renderHook(() => useActiveAddresses("c1"), { wrapper });
    const second = renderHook(() => useActiveAddresses("c2"), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(first.result.current.data?.[0]?.id).toBe("de-c1");
    expect(second.result.current.data?.[0]?.id).toBe("de-c2");
  });

  it("un error de la API llega al estado de la consulta", async () => {
    api.listActiveAddresses.mockRejectedValue(new AppError("network", "sin conexión"));
    const { result } = renderHook(() => useActiveAddresses(PROFILE), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("sin conexión");
  });
});

/** Las dos listas observadas + la mutación: así se ve qué se recarga. */
function withLists<T>(useMutationHook: () => T) {
  return renderHook(
    () => ({
      active: useActiveAddresses(PROFILE),
      archived: useArchivedAddresses(PROFILE),
      mutation: useMutationHook(),
    }),
    { wrapper },
  );
}

describe("mutaciones", () => {
  it("crear: llama a la API con el cliente y los datos, y recarga AMBAS listas", async () => {
    const { result } = withLists(() => useCreateAddress(PROFILE));
    await waitFor(() => expect(result.current.archived.isSuccess).toBe(true));
    expect(api.listActiveAddresses).toHaveBeenCalledTimes(1);
    expect(api.listArchivedAddresses).toHaveBeenCalledTimes(1);
    let created: Address | undefined;
    await act(async () => {
      created = await result.current.mutation.mutateAsync(input);
    });
    expect(api.createAddress).toHaveBeenCalledWith(PROFILE, input);
    expect(created?.id).toBe("nueva");
    expect(api.listActiveAddresses).toHaveBeenCalledTimes(2);
    expect(api.listArchivedAddresses).toHaveBeenCalledTimes(2);
  });

  it("editar: pasa cliente, id y datos", async () => {
    const { result } = withLists(() => useUpdateAddress(PROFILE));
    await waitFor(() => expect(result.current.active.isSuccess).toBe(true));
    await act(async () => {
      await result.current.mutation.mutateAsync({ id: "a", input });
    });
    expect(api.updateAddress).toHaveBeenCalledWith(PROFILE, "a", input);
    expect(api.listActiveAddresses).toHaveBeenCalledTimes(2);
    expect(api.listArchivedAddresses).toHaveBeenCalledTimes(2);
  });

  it("archivar: pasa cliente e id y recarga las dos listas", async () => {
    const { result } = withLists(() => useArchiveAddress(PROFILE));
    await waitFor(() => expect(result.current.archived.isSuccess).toBe(true));
    await act(async () => {
      await result.current.mutation.mutateAsync("a");
    });
    expect(api.archiveAddress).toHaveBeenCalledWith(PROFILE, "a");
    expect(api.listActiveAddresses).toHaveBeenCalledTimes(2);
    expect(api.listArchivedAddresses).toHaveBeenCalledTimes(2);
  });

  it("restaurar: pasa cliente e id y recarga las dos listas", async () => {
    const { result } = withLists(() => useRestoreAddress(PROFILE));
    await waitFor(() => expect(result.current.archived.isSuccess).toBe(true));
    await act(async () => {
      await result.current.mutation.mutateAsync("z");
    });
    expect(api.restoreAddress).toHaveBeenCalledWith(PROFILE, "z");
    expect(api.listActiveAddresses).toHaveBeenCalledTimes(2);
    expect(api.listArchivedAddresses).toHaveBeenCalledTimes(2);
  });

  it("marcar predeterminada: pasa cliente e id y recarga (otra fila cambió en la base)", async () => {
    const { result } = withLists(() => useSetDefaultAddress(PROFILE));
    await waitFor(() => expect(result.current.archived.isSuccess).toBe(true));
    await act(async () => {
      await result.current.mutation.mutateAsync("a");
    });
    expect(api.setDefaultAddress).toHaveBeenCalledWith(PROFILE, "a");
    expect(api.listActiveAddresses).toHaveBeenCalledTimes(2);
    expect(api.listArchivedAddresses).toHaveBeenCalledTimes(2);
  });

  it("la mutación no termina hasta tener las listas al día (quien la espera ya ve los datos nuevos)", async () => {
    api.listActiveAddresses
      .mockResolvedValueOnce([address("a")])
      .mockResolvedValue([address("a"), address("nueva")]);
    const { result } = withLists(() => useCreateAddress(PROFILE));
    await waitFor(() => expect(result.current.active.isSuccess).toBe(true));
    let cacheWhenResolved: Address[] | undefined;
    await act(async () => {
      await result.current.mutation.mutateAsync(input);
      // En el instante en que `mutateAsync` se resuelve, la caché YA tiene la lista nueva.
      cacheWhenResolved = client.getQueryData<Address[]>(addressKeys.active(PROFILE));
    });
    expect(cacheWhenResolved?.map((a) => a.id)).toEqual(["a", "nueva"]);
  });

  it("la mutación sigue «en curso» mientras las listas se recargan y solo termina cuando llegan", async () => {
    let releaseRefetch: (list: Address[]) => void = () => {};
    api.listActiveAddresses
      .mockResolvedValueOnce([address("a")])
      .mockImplementationOnce(
        () => new Promise<Address[]>((resolve) => (releaseRefetch = resolve)),
      );
    const { result } = withLists(() => useCreateAddress(PROFILE));
    await waitFor(() => expect(result.current.archived.isSuccess).toBe(true));
    let finished = false;
    let mutation: Promise<unknown> = Promise.resolve();
    act(() => {
      mutation = result.current.mutation.mutateAsync(input).then(() => {
        finished = true;
      });
    });
    // La API ya respondió (createAddress), pero la lista nueva todavía no llegó: la mutación NO ha terminado.
    await waitFor(() => expect(api.listActiveAddresses).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(finished).toBe(false);
    await act(async () => {
      releaseRefetch([address("a"), address("nueva")]);
      await mutation;
    });
    expect(finished).toBe(true);
  });

  it("si la API falla, el error llega a quien espera y las listas se recargan igualmente", async () => {
    api.archiveAddress.mockRejectedValue(new AppError("conflict", "otra pestaña ya la archivó"));
    const { result } = withLists(() => useArchiveAddress(PROFILE));
    await waitFor(() => expect(result.current.archived.isSuccess).toBe(true));
    let failure: unknown;
    await act(async () => {
      failure = await result.current.mutation.mutateAsync("a").catch((e: unknown) => e);
    });
    expect(failure).toMatchObject({ message: "otra pestaña ya la archivó" });
    expect(api.listActiveAddresses).toHaveBeenCalledTimes(2);
    expect(api.listArchivedAddresses).toHaveBeenCalledTimes(2);
  });

  it("sin sesión (sin id de cliente) ninguna mutación llega a la API", async () => {
    const create = renderHook(() => useCreateAddress(undefined), { wrapper });
    const update = renderHook(() => useUpdateAddress(undefined), { wrapper });
    const archive = renderHook(() => useArchiveAddress(undefined), { wrapper });
    const restore = renderHook(() => useRestoreAddress(undefined), { wrapper });
    const makeDefault = renderHook(() => useSetDefaultAddress(undefined), { wrapper });
    await act(async () => {
      await create.result.current.mutateAsync(input).catch(() => {});
      await update.result.current.mutateAsync({ id: "a", input }).catch(() => {});
      await archive.result.current.mutateAsync("a").catch(() => {});
      await restore.result.current.mutateAsync("a").catch(() => {});
      await makeDefault.result.current.mutateAsync("a").catch(() => {});
    });
    expect(api.createAddress).not.toHaveBeenCalled();
    expect(api.updateAddress).not.toHaveBeenCalled();
    expect(api.archiveAddress).not.toHaveBeenCalled();
    expect(api.restoreAddress).not.toHaveBeenCalled();
    expect(api.setDefaultAddress).not.toHaveBeenCalled();
    await waitFor(() => expect(create.result.current.isError).toBe(true));
  });
});

describe("useDeliveryCountries", () => {
  it("entrega los países habilitados que devuelve la vista", async () => {
    const { result } = renderHook(() => useDeliveryCountries(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.countries).toEqual([
      { code: "BO", name: "Bolivia" },
      { code: "AR", name: "Argentina" },
    ]);
    expect(result.current.isError).toBe(false);
  });

  it("mientras carga (o si falla) usa Bolivia: el formulario nunca se queda sin país", async () => {
    api.listDeliveryCountries.mockRejectedValue(new AppError("network", "x"));
    const { result } = renderHook(() => useDeliveryCountries(), { wrapper });
    expect(result.current.countries).toEqual([{ code: "BO", name: "Bolivia" }]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.countries).toEqual([{ code: "BO", name: "Bolivia" }]);
    expect(FALLBACK_COUNTRIES).toEqual([{ code: "BO", name: "Bolivia" }]);
  });

  it("una lista vacía también cae en Bolivia", async () => {
    api.listDeliveryCountries.mockResolvedValue([]);
    const { result } = renderHook(() => useDeliveryCountries(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.countries).toEqual([{ code: "BO", name: "Bolivia" }]);
  });
});

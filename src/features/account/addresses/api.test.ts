import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import {
  archiveAddress,
  createAddress,
  listActiveAddresses,
  listArchivedAddresses,
  listDeliveryCountries,
  restoreAddress,
  setDefaultAddress,
  updateAddress,
} from "./api";
import type { AddressRow } from "./mapping";
import type { AddressInput } from "./types";

type Call = [method: string, args: unknown[]];
const calls: Call[] = [];
let outcome: { data: unknown; error: unknown } = { data: null, error: null };
const from = vi.fn();

/** Constructor de consultas falso: registra cada llamada encadenada y, al esperarlo, entrega `outcome`. */
function makeBuilder() {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
            Promise.resolve(outcome).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push([String(property), args]);
          return builder;
        };
      },
    },
  );
  return builder;
}

vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from }) }));

const COLUMNS =
  "id,profile_id,label,recipient,phone_e164,line1,line2,city,department,country,reference_text,lat,lng,is_default,for_shipping,for_billing,archived_at,created_at,updated_at";
const PROFILE = "11111111-1111-1111-1111-111111111111";
const ADDRESS_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const row = (over: Partial<AddressRow> = {}): AddressRow => ({
  id: ADDRESS_ID,
  profile_id: PROFILE,
  label: "Casa",
  recipient: "Ana Cliente",
  phone_e164: "+59171234567",
  line1: "Calle 21 #123",
  line2: null,
  city: "La Paz",
  department: "La Paz",
  country: "BO",
  reference_text: null,
  lat: null,
  lng: null,
  is_default: false,
  for_shipping: true,
  for_billing: false,
  archived_at: null,
  created_at: "2026-11-01T10:00:00+00:00",
  updated_at: "2026-11-01T10:00:00+00:00",
  ...over,
});

const input: AddressInput = {
  label: "Casa",
  recipient: "Ana Cliente",
  phoneE164: "+59171234567",
  line1: "Calle 21 #123",
  line2: null,
  city: "La Paz",
  department: "La Paz",
  country: "BO",
  referenceText: null,
  lat: -16.5,
  lng: -68.15,
  forShipping: true,
  forBilling: false,
  isDefault: false,
};

const callsOf = (method: string) =>
  calls.filter(([name]) => name === method).map(([, args]) => args);

beforeEach(() => {
  calls.length = 0;
  outcome = { data: null, error: null };
  from.mockReset();
  from.mockImplementation(() => makeBuilder());
});

describe("listActiveAddresses", () => {
  it("consulta la tabla `addresses` filtrando por el cliente y solo las no archivadas, de la más reciente a la más antigua", async () => {
    outcome = { data: [], error: null };
    await listActiveAddresses(PROFILE);
    expect(from).toHaveBeenCalledWith("addresses");
    expect(calls).toEqual([
      ["select", [COLUMNS]],
      ["eq", ["profile_id", PROFILE]],
      ["is", ["archived_at", null]],
      ["order", ["created_at", { ascending: false }]],
      ["order", ["id", { ascending: false }]],
    ]);
  });

  it("el filtro por cliente protege al admin (la RLS le deja leer las de todos)", async () => {
    outcome = { data: [], error: null };
    await listActiveAddresses("otro-cliente");
    expect(callsOf("eq")).toEqual([["profile_id", "otro-cliente"]]);
  });

  it("devuelve la predeterminada primero y conserva el orden del servidor en el resto", async () => {
    outcome = {
      data: [
        row({ id: "nueva", label: "Nueva", created_at: "2026-11-03T10:00:00+00:00" }),
        row({ id: "def", label: "Predeterminada", is_default: true }),
        row({ id: "vieja", label: "Vieja", created_at: "2026-10-01T10:00:00+00:00" }),
      ],
      error: null,
    };
    const list = await listActiveAddresses(PROFILE);
    expect(list.map((a) => a.id)).toEqual(["def", "nueva", "vieja"]);
  });

  it("mapea las filas a la forma de la aplicación", async () => {
    outcome = { data: [row({ lat: -16.5, lng: -68.15 })], error: null };
    const [first] = await listActiveAddresses(PROFILE);
    expect(first).toMatchObject({
      id: ADDRESS_ID,
      profileId: PROFILE,
      phone: "+59171234567",
      lat: -16.5,
    });
  });

  it("sin datos (null) devuelve una lista vacía", async () => {
    outcome = { data: null, error: null };
    expect(await listActiveAddresses(PROFILE)).toEqual([]);
  });

  it("un error de la base se lanza ya traducido (AppError en español)", async () => {
    outcome = { data: null, error: { code: "PGRST301", message: "JWT expired" } };
    const failure = await listActiveAddresses(PROFILE).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({
      code: "unauthorized",
      message: "Tu sesión venció. Inicia sesión de nuevo.",
    });
  });
});

describe("listArchivedAddresses", () => {
  it("solo las archivadas del cliente, la archivada más recientemente primero y como máximo 100", async () => {
    outcome = { data: [], error: null };
    await listArchivedAddresses(PROFILE);
    expect(calls).toEqual([
      ["select", [COLUMNS]],
      ["eq", ["profile_id", PROFILE]],
      ["not", ["archived_at", "is", null]],
      ["order", ["archived_at", { ascending: false }]],
      ["limit", [100]],
    ]);
  });

  it("traduce errores y mapea filas", async () => {
    outcome = { data: [row({ archived_at: "2026-11-02T10:00:00+00:00" })], error: null };
    expect((await listArchivedAddresses(PROFILE))[0]?.archivedAt).toBe("2026-11-02T10:00:00+00:00");
    outcome = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(listArchivedAddresses(PROFILE)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("createAddress", () => {
  it("inserta con el dueño y las columnas, y devuelve la fila creada", async () => {
    outcome = { data: row({ is_default: true, lat: -16.5, lng: -68.15 }), error: null };
    const created = await createAddress(PROFILE, input);
    expect(from).toHaveBeenCalledWith("addresses");
    expect(calls).toEqual([
      [
        "insert",
        [
          {
            profile_id: PROFILE,
            label: "Casa",
            recipient: "Ana Cliente",
            phone_e164: "+59171234567",
            line1: "Calle 21 #123",
            line2: null,
            city: "La Paz",
            department: "La Paz",
            country: "BO",
            reference_text: null,
            lat: -16.5,
            lng: -68.15,
            for_shipping: true,
            for_billing: false,
            is_default: false,
          },
        ],
      ],
      ["select", [COLUMNS]],
      ["single", []],
    ]);
    expect(created).toMatchObject({ id: ADDRESS_ID, isDefault: true });
  });

  it("el tope de 20 llega como mensaje propio en español", async () => {
    outcome = {
      data: null,
      error: {
        code: "23514",
        message: "Alcanzaste el máximo de 20 registros activos; archiva alguno para agregar otro",
      },
    };
    await expect(createAddress(PROFILE, input)).rejects.toMatchObject({
      code: "validation",
      message:
        "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar o restaurar otra.",
    });
  });

  it("teléfono, coordenadas y sesión se traducen", async () => {
    outcome = {
      data: null,
      error: {
        code: "23514",
        message:
          'new row for relation "addresses" violates check constraint "addresses_coords_pair"',
      },
    };
    await expect(createAddress(PROFILE, input)).rejects.toMatchObject({
      message:
        "La ubicación del mapa no es válida: revisa la latitud y la longitud, o quita el pin.",
    });
    outcome = {
      data: null,
      error: { code: "42501", message: "new row violates row-level security policy" },
    };
    await expect(createAddress(PROFILE, input)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("updateAddress", () => {
  it("actualiza solo las columnas editables, de ESA dirección y de ESE cliente", async () => {
    outcome = { data: row({ label: "Casa nueva" }), error: null };
    const updated = await updateAddress(PROFILE, ADDRESS_ID, { ...input, label: "Casa nueva" });
    expect(calls.map(([name]) => name)).toEqual(["update", "eq", "eq", "select", "maybeSingle"]);
    const [patch] = callsOf("update")[0] as [Record<string, unknown>];
    expect(Object.keys(patch).sort()).toEqual([
      "city",
      "country",
      "department",
      "for_billing",
      "for_shipping",
      "label",
      "lat",
      "line1",
      "line2",
      "lng",
      "phone_e164",
      "recipient",
      "reference_text",
    ]);
    expect(patch.label).toBe("Casa nueva");
    expect(callsOf("eq")).toEqual([
      ["id", ADDRESS_ID],
      ["profile_id", PROFILE],
    ]);
    expect(callsOf("select")).toEqual([[COLUMNS]]);
    expect(updated.label).toBe("Casa nueva");
  });

  it("marcar predeterminada desde el formulario envía is_default: true", async () => {
    outcome = { data: row({ is_default: true }), error: null };
    await updateAddress(PROFILE, ADDRESS_ID, { ...input, isDefault: true });
    const [patch] = callsOf("update")[0] as [Record<string, unknown>];
    expect(patch.is_default).toBe(true);
  });

  it("sin fila devuelta (la RLS no la deja ver o ya no existe) lanza not_found, no «éxito» silencioso", async () => {
    outcome = { data: null, error: null };
    await expect(updateAddress(PROFILE, ADDRESS_ID, input)).rejects.toMatchObject({
      code: "not_found",
      message: "No encontramos esa dirección. Recarga la lista e inténtalo otra vez.",
    });
  });

  it("traduce los errores de la base", async () => {
    outcome = {
      data: null,
      error: { code: "23514", message: 'violates check constraint "addresses_phone_required"' },
    };
    await expect(updateAddress(PROFILE, ADDRESS_ID, input)).rejects.toMatchObject({
      message: "La dirección necesita un teléfono de contacto válido.",
    });
  });
});

describe("archivar, restaurar y marcar predeterminada", () => {
  it("archivar fija archived_at a la hora indicada (UTC ISO) y nada más", async () => {
    outcome = { data: row({ archived_at: "2026-11-02T15:30:00.000Z" }), error: null };
    const archived = await archiveAddress(
      PROFILE,
      ADDRESS_ID,
      new Date("2026-11-02T15:30:00.000Z"),
    );
    expect(callsOf("update")).toEqual([[{ archived_at: "2026-11-02T15:30:00.000Z" }]]);
    expect(callsOf("eq")).toEqual([
      ["id", ADDRESS_ID],
      ["profile_id", PROFILE],
    ]);
    expect(archived.archivedAt).toBe("2026-11-02T15:30:00.000Z");
  });

  it("archivar sin hora explícita usa la actual", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-25T08:00:00.000Z"));
    try {
      outcome = { data: row(), error: null };
      await archiveAddress(PROFILE, ADDRESS_ID);
      expect(callsOf("update")).toEqual([[{ archived_at: "2026-12-25T08:00:00.000Z" }]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restaurar pone archived_at en null", async () => {
    outcome = { data: row(), error: null };
    await restoreAddress(PROFILE, ADDRESS_ID);
    expect(callsOf("update")).toEqual([[{ archived_at: null }]]);
    expect(callsOf("eq")).toEqual([
      ["id", ADDRESS_ID],
      ["profile_id", PROFILE],
    ]);
  });

  it("restaurar con 20 activas: el tope llega traducido", async () => {
    outcome = {
      data: null,
      error: {
        code: "23514",
        message: "Alcanzaste el máximo de 20 registros activos; archiva alguno para agregar otro",
      },
    };
    await expect(restoreAddress(PROFILE, ADDRESS_ID)).rejects.toMatchObject({
      message:
        "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar o restaurar otra.",
    });
  });

  it("marcar predeterminada solo envía is_default: true", async () => {
    outcome = { data: row({ is_default: true }), error: null };
    const result = await setDefaultAddress(PROFILE, ADDRESS_ID);
    expect(callsOf("update")).toEqual([[{ is_default: true }]]);
    expect(result.isDefault).toBe(true);
  });

  it.each([
    ["archiveAddress", () => archiveAddress(PROFILE, ADDRESS_ID)],
    ["restoreAddress", () => restoreAddress(PROFILE, ADDRESS_ID)],
    ["setDefaultAddress", () => setDefaultAddress(PROFILE, ADDRESS_ID)],
  ])("%s: sin fila devuelta → not_found", async (_name, run) => {
    outcome = { data: null, error: null };
    await expect(run()).rejects.toMatchObject({ code: "not_found" });
  });

  it.each([
    ["archiveAddress", () => archiveAddress(PROFILE, ADDRESS_ID)],
    ["restoreAddress", () => restoreAddress(PROFILE, ADDRESS_ID)],
    ["setDefaultAddress", () => setDefaultAddress(PROFILE, ADDRESS_ID)],
  ])("%s: un error de la base se traduce", async (_name, run) => {
    outcome = { data: null, error: { code: "PGRST301", message: "JWT expired" } };
    await expect(run()).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("NADA se borra: ninguna operación usa delete", async () => {
    outcome = { data: row(), error: null };
    await createAddress(PROFILE, input);
    await updateAddress(PROFILE, ADDRESS_ID, input);
    await archiveAddress(PROFILE, ADDRESS_ID);
    await restoreAddress(PROFILE, ADDRESS_ID);
    await setDefaultAddress(PROFILE, ADDRESS_ID);
    outcome = { data: [], error: null };
    await listActiveAddresses(PROFILE);
    await listArchivedAddresses(PROFILE);
    expect(calls.some(([name]) => name === "delete" || name === "upsert")).toBe(false);
  });
});

describe("listDeliveryCountries", () => {
  it("lee la vista pública de países habilitados, por nombre", async () => {
    outcome = { data: [{ code: "BO", name: "Bolivia" }], error: null };
    expect(await listDeliveryCountries()).toEqual([{ code: "BO", name: "Bolivia" }]);
    expect(from).toHaveBeenCalledWith("public_countries");
    expect(calls).toEqual([
      ["select", ["code,name"]],
      ["order", ["name"]],
    ]);
  });

  it("descarta filas sin código o sin nombre (las columnas de una vista son anulables)", async () => {
    outcome = {
      data: [
        { code: null, name: "Sin código" },
        { code: "AR", name: null },
        { code: "", name: "Vacío" },
        { code: "PE", name: "Perú" },
      ],
      error: null,
    };
    expect(await listDeliveryCountries()).toEqual([{ code: "PE", name: "Perú" }]);
  });

  it("sin datos → lista vacía; con error → AppError traducido", async () => {
    outcome = { data: null, error: null };
    expect(await listDeliveryCountries()).toEqual([]);
    outcome = { data: null, error: { code: "XX000", message: "boom interno" } };
    await expect(listDeliveryCountries()).rejects.toMatchObject({
      code: "unknown",
      message: "No se pudo completar la operación. Inténtalo de nuevo.",
    });
  });
});

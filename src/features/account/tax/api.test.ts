import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  argsOf,
  createRecorder,
  opNames,
  type RecordedCall,
  type Reply,
} from "../profile/testRecorder";

const state = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.client }));

import {
  archiveTaxProfile,
  createTaxProfile,
  listTaxProfiles,
  restoreTaxProfile,
  setDefaultTaxProfile,
  updateTaxProfile,
} from "./api";

let calls: RecordedCall[];
let reply: Reply;
beforeEach(() => {
  reply = { data: null, error: null };
  const recorder = createRecorder(() => reply);
  state.client = recorder.client;
  calls = recorder.calls;
});
afterEach(() => vi.useRealTimers());

const COLUMNS = "id,doc_type,doc_number,legal_name,is_default,archived_at,created_at,updated_at";
const row = (over: Record<string, unknown> = {}) => ({
  id: "t-1",
  doc_type: "ci",
  doc_number: "1234567-1A",
  legal_name: "Ana Cliente",
  is_default: true,
  archived_at: null,
  created_at: "2026-11-01T10:00:00+00:00",
  updated_at: "2026-11-01T11:00:00+00:00",
  ...over,
});

describe("listTaxProfiles", () => {
  it("filtra por DUEÑO (un admin ve todos por RLS), del más reciente al más antiguo", async () => {
    reply = { data: [row()], error: null };
    await listTaxProfiles("u-1");
    expect(calls[0]?.table).toBe("tax_profiles");
    expect(argsOf(calls[0], "select")).toEqual([COLUMNS]);
    expect(argsOf(calls[0], "eq")).toEqual(["profile_id", "u-1"]);
    expect(calls[0]?.ops.filter(([name]) => name === "order").map(([, args]) => args)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("mapea las columnas y deriva `archived` de archived_at", async () => {
    reply = {
      data: [
        row(),
        row({
          id: "t-2",
          doc_type: "nit",
          doc_number: "1020304021",
          is_default: false,
          archived_at: "2026-11-02T09:00:00+00:00",
        }),
      ],
      error: null,
    };
    await expect(listTaxProfiles("u-1")).resolves.toEqual([
      {
        id: "t-1",
        docType: "ci",
        docNumber: "1234567-1A",
        legalName: "Ana Cliente",
        isDefault: true,
        archived: false,
        createdAt: "2026-11-01T10:00:00+00:00",
        updatedAt: "2026-11-01T11:00:00+00:00",
      },
      {
        id: "t-2",
        docType: "nit",
        docNumber: "1020304021",
        legalName: "Ana Cliente",
        isDefault: false,
        archived: true,
        createdAt: "2026-11-01T10:00:00+00:00",
        updatedAt: "2026-11-01T11:00:00+00:00",
      },
    ]);
  });

  it("un tipo de documento inesperado no rompe la pantalla (cae en «otro»)", async () => {
    reply = { data: [row({ doc_type: "licencia" })], error: null };
    expect((await listTaxProfiles("u-1"))[0]?.docType).toBe("otro");
  });

  it("sin datos → lista vacía; con error → AppError traducido", async () => {
    reply = { data: null, error: null };
    await expect(listTaxProfiles("u-1")).resolves.toEqual([]);
    reply = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(listTaxProfiles("u-1")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("createTaxProfile", () => {
  it("inserta EXACTAMENTE las 4 columnas permitidas (sin is_default: la base marca al primero) y devuelve la fila", async () => {
    reply = { data: row(), error: null };
    const created = await createTaxProfile("u-1", {
      docType: "ci",
      docNumber: "1234567-1A",
      legalName: "Ana Cliente",
    });
    expect(calls[0]?.table).toBe("tax_profiles");
    expect(argsOf(calls[0], "insert")).toEqual([
      { profile_id: "u-1", doc_type: "ci", doc_number: "1234567-1A", legal_name: "Ana Cliente" },
    ]);
    expect(argsOf(calls[0], "select")).toEqual([COLUMNS]);
    expect(opNames(calls[0])).toContain("single");
    expect(created.id).toBe("t-1");
  });

  it("tope de 10 (23514) → mensaje de la regla, con el motivo para el formulario", async () => {
    reply = {
      data: null,
      error: {
        code: "23514",
        message: "Alcanzaste el máximo de 10 registros activos; archiva alguno para agregar otro",
      },
    };
    await expect(
      createTaxProfile("u-1", { docType: "ci", docNumber: "1234567", legalName: "X" }),
    ).rejects.toMatchObject({
      reason: "cap",
      message: "Llegaste al máximo de 10 datos fiscales activos. Archiva alguno para agregar otro.",
    });
  });

  it("documento repetido entre los activos (23505, índice tax_profiles_no_dup_idx)", async () => {
    reply = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "tax_profiles_no_dup_idx"',
      },
    };
    await expect(
      createTaxProfile("u-1", { docType: "ci", docNumber: "1234567", legalName: "X" }),
    ).rejects.toMatchObject({
      reason: "duplicate",
      message: "Ya tienes datos fiscales activos con ese documento.",
    });
  });
});

describe("actualizaciones", () => {
  it("updateTaxProfile: solo tipo, documento y razón social, filtrando por id", async () => {
    reply = { data: [row({ legal_name: "Nueva SRL" })], error: null };
    const updated = await updateTaxProfile("t-1", {
      docType: "nit",
      docNumber: "1020304021",
      legalName: "Nueva SRL",
    });
    expect(argsOf(calls[0], "update")).toEqual([
      { doc_type: "nit", doc_number: "1020304021", legal_name: "Nueva SRL" },
    ]);
    expect(argsOf(calls[0], "eq")).toEqual(["id", "t-1"]);
    expect(argsOf(calls[0], "select")).toEqual([COLUMNS]);
    expect(updated.legalName).toBe("Nueva SRL");
  });

  it("archiveTaxProfile: archived_at = ahora (UTC); nunca borra", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T15:30:00.000Z"));
    reply = { data: [row({ archived_at: "2026-11-02T15:30:00+00:00" })], error: null };
    const archived = await archiveTaxProfile("t-1");
    expect(argsOf(calls[0], "update")).toEqual([{ archived_at: "2026-11-02T15:30:00.000Z" }]);
    expect(argsOf(calls[0], "eq")).toEqual(["id", "t-1"]);
    expect(opNames(calls[0])).not.toContain("delete");
    expect(archived.archived).toBe(true);
  });

  it("restoreTaxProfile: archived_at = null", async () => {
    reply = { data: [row()], error: null };
    await restoreTaxProfile("t-1");
    expect(argsOf(calls[0], "update")).toEqual([{ archived_at: null }]);
    expect(argsOf(calls[0], "eq")).toEqual(["id", "t-1"]);
  });

  it("setDefaultTaxProfile: is_default = true", async () => {
    reply = { data: [row()], error: null };
    await setDefaultTaxProfile("t-1");
    expect(argsOf(calls[0], "update")).toEqual([{ is_default: true }]);
    expect(argsOf(calls[0], "eq")).toEqual(["id", "t-1"]);
  });

  it.each([
    [
      "updateTaxProfile",
      () => updateTaxProfile("t-1", { docType: "ci", docNumber: "1234", legalName: "X" }),
    ],
    ["archiveTaxProfile", () => archiveTaxProfile("t-1")],
    ["restoreTaxProfile", () => restoreTaxProfile("t-1")],
    ["setDefaultTaxProfile", () => setDefaultTaxProfile("t-1")],
  ])("%s: 0 filas (ya no existe o no es suya) → not_found", async (_name, call) => {
    reply = { data: [], error: null };
    await expect(call()).rejects.toMatchObject({
      reason: "not_found",
      message: "Esos datos fiscales ya no existen. Actualiza la página.",
    });
  });

  it("restaurar con 10 activos (23514) y editar a un documento repetido (23505) llegan traducidos", async () => {
    reply = {
      data: null,
      error: {
        code: "23514",
        message: "Alcanzaste el máximo de 10 registros activos; archiva alguno para agregar otro",
      },
    };
    await expect(restoreTaxProfile("t-1")).rejects.toMatchObject({ reason: "cap" });
    reply = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "tax_profiles_no_dup_idx"',
      },
    };
    await expect(
      updateTaxProfile("t-1", { docType: "ci", docNumber: "1234", legalName: "X" }),
    ).rejects.toMatchObject({ reason: "duplicate" });
  });
});

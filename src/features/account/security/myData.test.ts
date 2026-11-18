import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { downloadMyData, fetchMyData, myDataFileName, serializeMyData } from "./myData";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

beforeEach(() => rpc.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("myDataFileName", () => {
  it("lleva la fecha de HOY en La Paz (a las 23:30 de La Paz en UTC ya es el día siguiente)", () => {
    expect(myDataFileName(new Date("2026-11-17T15:00:00Z"))).toBe(
      "mis-datos-made-in-chola-2026-11-17.json",
    );
    expect(myDataFileName(new Date("2026-11-18T03:30:00Z"))).toBe(
      "mis-datos-made-in-chola-2026-11-17.json",
    );
  });
});

describe("serializeMyData", () => {
  it("JSON con sangría, con los acentos tal cual y un salto de línea final", () => {
    const text = serializeMyData({ nombre: "Ana Pérez", pedidos: [] });
    expect(text).toBe('{\n  "nombre": "Ana Pérez",\n  "pedidos": []\n}\n');
    expect(JSON.parse(text)).toEqual({ nombre: "Ana Pérez", pedidos: [] });
  });
});

describe("fetchMyData", () => {
  it("llama a my_data_export sin argumentos y devuelve el objeto", async () => {
    rpc.mockResolvedValue({ data: { format_version: 1 }, error: null });
    await expect(fetchMyData()).resolves.toEqual({ format_version: 1 });
    expect(rpc).toHaveBeenCalledWith("my_data_export", {});
  });
  it("traduce el error de la base y rechaza una respuesta que no es un objeto", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "login_required" } });
    await expect(fetchMyData()).rejects.toBeInstanceOf(AppError);
    rpc.mockResolvedValue({ data: [1, 2], error: null });
    await expect(fetchMyData()).rejects.toThrow("respuesta inesperada");
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchMyData()).rejects.toThrow();
  });
});

describe("downloadMyData", () => {
  it("guarda un archivo .json con los datos, sin dejar nada pegado a la página", async () => {
    rpc.mockResolvedValue({
      data: { format_version: 1, profile: { full_name: "Ana" } },
      error: null,
    });
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return "blob:fake";
    });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.useFakeTimers();
    await downloadMyData();
    expect(click).toHaveBeenCalledTimes(1);
    expect(blob).not.toBeNull();
    expect((blob as unknown as Blob).type).toBe("application/json;charset=utf-8");
    expect(JSON.parse(await (blob as unknown as Blob).text())).toMatchObject({
      profile: { full_name: "Ana" },
    });
    expect(document.querySelector("a[download]")).toBeNull();
    vi.advanceTimersByTime(1100);
    expect(revoke).toHaveBeenCalledWith("blob:fake");
    vi.useRealTimers();
  });

  it("si la base falla no crea ningún archivo", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    const create = vi.fn();
    Object.assign(URL, { createObjectURL: create });
    await expect(downloadMyData()).rejects.toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });
});

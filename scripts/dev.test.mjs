import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { isEntrypoint, planDev } from "./dev.mjs";

describe("planDev", () => {
  it("sin Docker: solo frontend y avisa", () => {
    const p = planDev({ hasDocker: false, dockerRunning: false, supabaseRunning: false });
    expect(p.startSupabase).toBe(false);
    expect(p.warning).toMatch(/no está instalado/);
  });
  it("Docker instalado pero apagado: solo frontend y avisa", () => {
    const p = planDev({ hasDocker: true, dockerRunning: false, supabaseRunning: false });
    expect(p.startSupabase).toBe(false);
    expect(p.warning).toMatch(/no está corriendo/);
  });
  it("Docker listo y Supabase apagado: lo inicia", () => {
    expect(planDev({ hasDocker: true, dockerRunning: true, supabaseRunning: false })).toEqual({
      startSupabase: true,
      warning: null,
    });
  });
  it("Supabase ya corriendo: no lo reinicia", () => {
    expect(
      planDev({ hasDocker: true, dockerRunning: true, supabaseRunning: true }).startSupabase,
    ).toBe(false);
  });
});

describe("isEntrypoint (regresión: la ruta del proyecto tiene espacios)", () => {
  it("reconoce el script aunque la ruta tenga espacios", () => {
    const path = "/Users/ana/Made In Chola/scripts/dev.mjs";
    expect(isEntrypoint(pathToFileURL(path).href, path)).toBe(true);
    expect(`file://${path}` === pathToFileURL(path).href).toBe(false); // la comparación ingenua original falla
  });
  it("no se dispara al ser importado desde otro módulo", () => {
    expect(isEntrypoint("file:///a/dev.mjs", "/b/otro.mjs")).toBe(false);
    expect(isEntrypoint("file:///a/dev.mjs", undefined)).toBe(false);
  });
});

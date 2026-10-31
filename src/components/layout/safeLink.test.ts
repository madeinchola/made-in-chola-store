import { describe, expect, it } from "vitest";
import { safeLink } from "./safeLink";

describe("safeLink", () => {
  it("acepta rutas internas y recorta espacios de los extremos", () => {
    expect(safeLink("/coleccion/verano")).toEqual({ kind: "internal", to: "/coleccion/verano" });
    expect(safeLink("  /x?y=1#z ")).toEqual({ kind: "internal", to: "/x?y=1#z" });
    expect(safeLink("/")).toEqual({ kind: "internal", to: "/" });
  });

  it("acepta http y https con dominio (la URL se normaliza)", () => {
    expect(safeLink("https://example.com/a?b=1")).toEqual({
      kind: "external",
      href: "https://example.com/a?b=1",
    });
    expect(safeLink("http://example.com")).toEqual({
      kind: "external",
      href: "http://example.com/",
    });
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["  javascript:alert(1)"],
    ["java\tscript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
    ["ftp://example.com/archivo"],
    ["mailto:a@b.co"],
    ["tel:+59171234567"],
  ])("rechaza esquemas peligrosos o no web: %s", (value) => {
    expect(safeLink(value)).toBeNull();
  });

  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/ruta con espacio"],
    ["/\u0000x"],
    ["https://exa mple.com"],
  ])(
    "rechaza rutas que el navegador leería como otro sitio o con caracteres de control: %j",
    (value) => {
      expect(safeLink(value)).toBeNull();
    },
  );

  it("rechaza credenciales incrustadas y direcciones sin dominio", () => {
    expect(safeLink("https://usuario:clave@example.com")).toBeNull();
    expect(safeLink("https://usuario@example.com")).toBeNull();
    expect(safeLink("https:///")).toBeNull();
  });

  it("vacío, espacios y valores que no son texto → null", () => {
    expect(safeLink("")).toBeNull();
    expect(safeLink("   ")).toBeNull();
    expect(safeLink(null)).toBeNull();
    expect(safeLink(undefined)).toBeNull();
    expect(safeLink(5 as unknown as string)).toBeNull();
  });

  it("httpsOnly: solo https; ni http ni rutas internas", () => {
    const o = { httpsOnly: true };
    expect(safeLink("https://www.instagram.com/madeinchola/", o)).toEqual({
      kind: "external",
      href: "https://www.instagram.com/madeinchola/",
    });
    expect(safeLink("http://www.instagram.com/x", o)).toBeNull();
    expect(safeLink("/categoria/x", o)).toBeNull();
  });
});

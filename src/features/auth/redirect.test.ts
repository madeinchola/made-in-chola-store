import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath (anti open-redirect)", () => {
  it.each(["/", "/cuenta", "/admin/productos?x=1#a", "/producto/vestido-rojo"])(
    "acepta ruta interna %s",
    (p) => {
      expect(safeRedirectPath(p)).toBe(p);
    },
  );
  it.each([
    "//evil.com",
    "//evil.com/x",
    "https://evil.com",
    "http://evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
    "\\\\evil.com",
    "/ok\nmal",
    "evil.com",
    "",
    "   ",
  ])("rechaza %j", (p) => {
    expect(safeRedirectPath(p)).toBe("/");
  });
  it("las rutas con codificación rara siguen siendo del MISMO origen (no hay forma de escapar vía %2F, %5C o puntos)", () => {
    for (const p of [
      "/%2F%2Fevil.com",
      "/%5Cevil.com",
      "/../../evil.com",
      "/./\\.evil.com".replace("\\", ""),
    ]) {
      const out = safeRedirectPath(p);
      expect(new URL(out, "https://tienda.test").origin, p).toBe("https://tienda.test");
    }
  });
  it("rechaza tipos que no son string", () => {
    for (const v of [null, undefined, 42, {}, ["/ok"]]) expect(safeRedirectPath(v)).toBe("/");
  });
  it("respeta un fallback propio", () => {
    expect(safeRedirectPath("//evil.com", "/cuenta")).toBe("/cuenta");
  });
});

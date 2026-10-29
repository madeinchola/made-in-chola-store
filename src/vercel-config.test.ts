import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Valida el vercel.json REAL del repo: es lo que se despliega.
const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
  rewrites: { source: string; destination: string }[];
};

const globalHeaders = Object.fromEntries(
  config.headers.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key, h.value]),
);
const csp = Object.fromEntries(
  globalHeaders["Content-Security-Policy"]!.split(";").map((d) => {
    const [name, ...values] = d.trim().split(/\s+/);
    return [name, values];
  }),
) as Record<string, string[]>;

describe("vercel.json", () => {
  it("rewrite SPA: cualquier ruta profunda sirve index.html", () => {
    expect(config.rewrites).toContainEqual({ source: "/(.*)", destination: "/index.html" });
  });
  it("headers de seguridad obligatorios presentes", () => {
    expect(globalHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(globalHeaders["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(globalHeaders["Referrer-Policy"]).toBeTruthy();
    expect(globalHeaders["Permissions-Policy"]).toBeTruthy();
    expect(globalHeaders["X-Frame-Options"]).toBe("DENY");
  });
  it("CSP: sin 'unsafe-eval' ni 'unsafe-inline' en scripts, sin comodín total", () => {
    const script = csp["script-src"]!;
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
    for (const [name, values] of Object.entries(csp)) {
      expect(values, name).not.toContain("*");
    }
  });
  it("CSP: frame-ancestors 'none', object-src 'none', base-uri y default-src restrictivos", () => {
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
  });
  it("CSP: permite lo legítimo (Supabase API y realtime, imágenes de Storage)", () => {
    expect(csp["connect-src"]).toEqual(
      expect.arrayContaining(["https://*.supabase.co", "wss://*.supabase.co"]),
    );
    expect(csp["img-src"]).toContain("https:");
  });
  it("assets con hash se cachean como inmutables", () => {
    const rule = config.headers.find((h) => h.source === "/assets/(.*)");
    expect(rule?.headers[0]?.value).toMatch(/immutable/);
  });
});

import { describe, expect, it } from "vitest";
import { localEnv, rpc } from "../../test-support/api";

// Integración REAL contra Supabase local (`npm run test:integration`). No se salta en silencio.
describe("Supabase local: API", () => {
  it("healthcheck responde con ok, UTC y hora del servidor cercana a la local", async () => {
    const res = await rpc("healthcheck", {}, localEnv().anon);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.timezone).toBe("UTC");
    expect(Math.abs(Date.parse(res.body.server_time_utc) - Date.now())).toBeLessThan(60_000);
  });
  it("una petición sin apikey se trata como anon (el gateway no la rechaza: la barrera es RLS/GRANT)", async () => {
    const res = await fetch(`${localEnv().url}/rest/v1/rpc/healthcheck`, {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
  });
  it("un JWT falsificado se rechaza con 401", async () => {
    const res = await rpc(
      "healthcheck",
      {},
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firma-falsa",
    );
    expect(res.status).toBe(401);
  });
  it("una función inexistente da 404", async () => {
    expect((await rpc("no_existe", {})).status).toBe(404);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const setSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ auth: { setSession } }) }));

import { adoptSession } from "./adoptSession";

beforeEach(() => setSession.mockReset());

describe("adoptSession", () => {
  it("entrega los dos tokens a Supabase y devuelve true", async () => {
    setSession.mockResolvedValue({ error: null });
    await expect(adoptSession({ access_token: "a", refresh_token: "r" })).resolves.toBe(true);
    expect(setSession).toHaveBeenCalledWith({ access_token: "a", refresh_token: "r" });
  });

  it("si Supabase la rechaza devuelve false", async () => {
    setSession.mockResolvedValue({ error: { message: "mal" } });
    await expect(adoptSession({ access_token: "a", refresh_token: "r" })).resolves.toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["sin access_token", { access_token: "", refresh_token: "r" }],
    ["sin refresh_token", { access_token: "a", refresh_token: "" }],
  ])("%s → false y NO llama a Supabase", async (_name, session) => {
    await expect(adoptSession(session as never)).resolves.toBe(false);
    expect(setSession).not.toHaveBeenCalled();
  });
});

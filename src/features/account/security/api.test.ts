import { beforeEach, describe, expect, it, vi } from "vitest";

const callFunction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/functions", () => ({ callFunction }));
const adoptSession = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/adoptSession", () => ({ adoptSession }));
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ auth: { signOut } }) }));

import { changePassword, deactivateAccount } from "./api";

const SESSION = { access_token: "acc-nuevo", refresh_token: "ref-nuevo" };

beforeEach(() => {
  callFunction.mockReset();
  adoptSession.mockReset();
  signOut.mockClear();
});

describe("changePassword", () => {
  it("llama a `change-password` con current_password y new_password y el token de la sesión", async () => {
    adoptSession.mockResolvedValue(true);
    callFunction.mockResolvedValue({ ok: true, data: { ok: true, session: SESSION } });
    const result = await changePassword(
      { currentPassword: "vieja-1", newPassword: "Nueva-2026" },
      "tok-1",
    );
    expect(callFunction).toHaveBeenCalledTimes(1);
    expect(callFunction).toHaveBeenCalledWith(
      "change-password",
      { current_password: "vieja-1", new_password: "Nueva-2026" },
      { token: "tok-1" },
    );
    expect(result).toEqual({ ok: true, data: { ok: true, relogin: false } });
  });

  it("ADOPTA la sesión nueva que entrega el servidor (la anterior ya no sirve) y no cierra la local", async () => {
    adoptSession.mockResolvedValue(true);
    callFunction.mockResolvedValue({ ok: true, data: { ok: true, session: SESSION } });
    await changePassword({ currentPassword: "a", newPassword: "b" }, "t");
    expect(adoptSession).toHaveBeenCalledWith(SESSION);
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["el servidor no entregó sesión", { ok: true, data: { ok: true, session: null } }, false],
    ["no vino el campo session", { ok: true, data: { ok: true } }, false],
    ["Supabase no aceptó la sesión", { ok: true, data: { ok: true, session: SESSION } }, false],
  ])(
    "%s → cierra la sesión LOCAL (la vieja ya no sirve) y avisa con relogin",
    async (_name, response, adopted) => {
      adoptSession.mockResolvedValue(adopted);
      callFunction.mockResolvedValue(response);
      const result = await changePassword({ currentPassword: "a", newPassword: "b" }, "t");
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(result).toEqual({ ok: true, data: { ok: true, relogin: true } });
    },
  );

  it("un fallo no toca la sesión: no se adopta nada ni se cierra nada", async () => {
    callFunction.mockResolvedValue({
      ok: false,
      status: 401,
      code: "invalid_credentials",
      message: "x",
    });
    await changePassword({ currentPassword: "a", newPassword: "b" }, "t");
    expect(adoptSession).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("devuelve los fallos tal cual, con sus reglas incumplidas (no lanza)", async () => {
    const failure = {
      ok: false,
      status: 400,
      code: "weak_password",
      message: "x",
      failures: ["too_short"],
    };
    callFunction.mockResolvedValue(failure);
    await expect(
      changePassword({ currentPassword: "a", newPassword: "b" }, undefined),
    ).resolves.toBe(failure);
    expect(callFunction.mock.calls[0]?.[2]).toEqual({ token: undefined });
  });
});

describe("deactivateAccount", () => {
  it.each([true, false])("llama a `deactivate-account` con anonymize=%s", async (anonymize) => {
    callFunction.mockResolvedValue({ ok: true, data: { ok: true } });
    await deactivateAccount({ password: "clave-1", anonymize }, "tok-2");
    expect(callFunction).toHaveBeenCalledWith(
      "deactivate-account",
      { password: "clave-1", anonymize },
      { token: "tok-2" },
    );
  });

  it("devuelve el fallo last_admin sin lanzar", async () => {
    const failure = { ok: false, status: 409, code: "last_admin", message: "x" };
    callFunction.mockResolvedValue(failure);
    await expect(deactivateAccount({ password: "p", anonymize: false }, "t")).resolves.toBe(
      failure,
    );
  });
});

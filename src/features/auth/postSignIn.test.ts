import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WAIT_MS, registerPostSignInHook, runPostSignInHooks } from "./postSignIn";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const offs: (() => void)[] = [];
const register = (hook: Parameters<typeof registerPostSignInHook>[0]) => {
  const off = registerPostSignInHook(hook);
  offs.push(off);
  return off;
};

beforeEach(() => warn.mockClear());
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  vi.useRealTimers();
});

describe("ganchos posteriores al inicio de sesión", () => {
  it("sin ganchos no hace nada ni espera", async () => {
    await expect(runPostSignInHooks({ userId: "u1" })).resolves.toBeUndefined();
  });

  it("cada gancho recibe el id del usuario, una vez", async () => {
    const a = vi.fn();
    const b = vi.fn(async () => {});
    register(a);
    register(b);
    await runPostSignInHooks({ userId: "u1" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ userId: "u1" });
    expect(b).toHaveBeenCalledWith({ userId: "u1" });
  });

  it("un gancho que falla se registra SIN datos personales y no impide a los demás ni lanza", async () => {
    const ok = vi.fn();
    register(() => {
      throw new TypeError("correo ana@test.com inválido");
    });
    register(async () => {
      throw new Error("otro fallo");
    });
    register(ok);
    await expect(runPostSignInHooks({ userId: "u1" })).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
    // solo el NOMBRE del error, nunca su mensaje (podría llevar datos personales)
    expect(warn.mock.calls.map((call) => call[1])).toEqual([
      { error: "TypeError" },
      { error: "Error" },
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("ana@test.com");
  });

  it("espera a los ganchos lentos como máximo MAX_WAIT_MS y sigue (ellos terminan después)", async () => {
    vi.useFakeTimers();
    let finished = false;
    register(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            finished = true;
            resolve();
          }, MAX_WAIT_MS * 3);
        }),
    );
    let resolved = false;
    const run = runPostSignInHooks({ userId: "u1" }).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS - 1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(resolved).toBe(true);
    expect(finished).toBe(false); // el gancho sigue en segundo plano
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS * 3);
    expect(finished).toBe(true);
  });

  it("un gancho rápido no espera el plazo completo", async () => {
    vi.useFakeTimers();
    register(async () => {});
    let resolved = false;
    void runPostSignInHooks({ userId: "u1" }).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("el plazo se puede ajustar", async () => {
    vi.useFakeTimers();
    register(() => new Promise<void>(() => {}));
    let resolved = false;
    void runPostSignInHooks({ userId: "u1" }, 50).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("quitar un gancho lo deja de ejecutar", async () => {
    const hook = vi.fn();
    const off = register(hook);
    off();
    await runPostSignInHooks({ userId: "u1" });
    expect(hook).not.toHaveBeenCalled();
  });
});

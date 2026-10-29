import { describe, expect, it, vi } from "vitest";
import { checkPasswordPwned, sha1Hex } from "@shared/pwned";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 (valor de referencia público)
const PASSWORD_SHA1 = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";

const respond = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe("sha1Hex", () => {
  it("coincide con el valor de referencia conocido", async () => {
    expect(await sha1Hex("password")).toBe(PASSWORD_SHA1);
  });
});

describe("checkPasswordPwned", () => {
  it("k-anonymity: solo se envían los primeros 5 caracteres del hash, nunca la contraseña", async () => {
    const fetchImpl = respond("");
    await checkPasswordPwned("password", fetchImpl);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    // El host se llama "pwnedpasswords": se inspecciona solo la RUTA y la query, que es lo que podría filtrar la clave.
    const { pathname, search } = new URL(String(url));
    expect(pathname + search).toBe("/range/5BAA6");
    expect((init as RequestInit).headers).toMatchObject({ "Add-Padding": "true" });
  });

  it("encuentra el sufijo y devuelve el conteo", async () => {
    const body = `0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n${PASSWORD_SHA1.slice(5)}:10437277\r\nFFFF:1`;
    expect(await checkPasswordPwned("password", respond(body))).toEqual({
      pwned: true,
      count: 10437277,
      unavailable: false,
    });
  });

  it("el relleno de HIBP (count 0) NO cuenta como filtrada", async () => {
    const body = `${PASSWORD_SHA1.slice(5)}:0`;
    expect(await checkPasswordPwned("password", respond(body))).toEqual({
      pwned: false,
      count: 0,
      unavailable: false,
    });
  });

  it("sufijo ausente → no filtrada", async () => {
    expect(await checkPasswordPwned("password", respond("AAAA:5\nBBBB:7"))).toEqual({
      pwned: false,
      count: 0,
      unavailable: false,
    });
  });

  it("HTTP de error → unavailable (NO bloquea el registro)", async () => {
    expect(await checkPasswordPwned("password", respond("x", 503))).toEqual({
      pwned: false,
      count: 0,
      unavailable: true,
    });
  });

  it("red caída → unavailable", async () => {
    const boom = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await checkPasswordPwned("password", boom)).toEqual({
      pwned: false,
      count: 0,
      unavailable: true,
    });
  });

  it("timeout: aborta la petición y devuelve unavailable", async () => {
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) =>
          init?.signal?.addEventListener("abort", () =>
            rej(new DOMException("abort", "AbortError")),
          ),
        ),
    ) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await checkPasswordPwned("password", hang, 50)).toEqual({
      pwned: false,
      count: 0,
      unavailable: true,
    });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("contraseña vacía no consulta nada", async () => {
    const fetchImpl = respond("");
    expect(await checkPasswordPwned("", fetchImpl)).toEqual({
      pwned: false,
      count: 0,
      unavailable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

import { assertEquals } from "jsr:@std/assert@1";
import {
  bearerToken,
  isRecentRecoverySession,
  jwtClaims,
  RECOVERY_MAX_AGE_SECONDS,
} from "./auth.ts";

const withAuth = (value?: string) =>
  new Request("http://x/fn", { headers: value === undefined ? {} : { Authorization: value } });

Deno.test(
  "bearerToken: extrae el JWT de «Bearer …» (sin distinguir mayúsculas en la palabra)",
  () => {
    assertEquals(bearerToken(withAuth("Bearer abc.def.ghi")), "abc.def.ghi");
    assertEquals(bearerToken(withAuth("bearer abc.def.ghi")), "abc.def.ghi");
    assertEquals(bearerToken(withAuth("BEARER   abc.def.ghi")), "abc.def.ghi");
  },
);

Deno.test("bearerToken: sin cabecera, vacío, otro esquema o con espacios dentro → null", () => {
  assertEquals(bearerToken(withAuth()), null);
  assertEquals(bearerToken(withAuth("")), null);
  assertEquals(bearerToken(withAuth("Bearer")), null);
  assertEquals(bearerToken(withAuth("Bearer ")), null);
  assertEquals(bearerToken(withAuth("Basic abc")), null);
  assertEquals(bearerToken(withAuth("abc.def.ghi")), null);
  assertEquals(bearerToken(withAuth("Bearer abc def")), null);
});

const jwtOf = (payload: unknown) => {
  // base64url de UTF-8 (btoa solo admite Latin1: hay que pasar por los bytes)
  const b64 = (value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256" })}.${b64(payload)}.firma`;
};

Deno.test(
  "jwtClaims: decodifica el payload (base64url, con acentos) y rechaza lo que no es JWT",
  () => {
    assertEquals(jwtClaims(jwtOf({ sub: "u1", name: "Ñandú ✓" })), { sub: "u1", name: "Ñandú ✓" });
    assertEquals(jwtClaims("sin-puntos"), null);
    assertEquals(jwtClaims("a.%%%.c"), null);
    assertEquals(jwtClaims(jwtOf("texto")), null); // el payload no es un objeto
    assertEquals(jwtClaims(jwtOf(null)), null);
  },
);

const NOW = 1_800_000_000;
const withAmr = (...amr: unknown[]) => ({ amr });

Deno.test(
  "jwtClaims: entiende los caracteres «-» y «_» de base64url (no solo los de base64 normal)",
  () => {
    // «???>>>» en base64 normal da «Pz8/Pj4+» (lleva «/» y «+»): en base64url pasan a «_» y «-»
    const token = jwtOf({ x: "???>>>" });
    assertEquals(token.split(".")[1]!.includes("_") || token.split(".")[1]!.includes("-"), true);
    assertEquals(jwtClaims(token), { x: "???>>>" });
  },
);

Deno.test("sesión de recuperación: método otp o recovery y reciente → sí", () => {
  assertEquals(isRecentRecoverySession(withAmr({ method: "otp", timestamp: NOW - 5 }), NOW), true);
  assertEquals(
    isRecentRecoverySession(withAmr({ method: "recovery", timestamp: NOW - 5 }), NOW),
    true,
  );
});

Deno.test(
  "sesión de recuperación: una sesión con CONTRASEÑA (o cualquier otro método) no lo es",
  () => {
    assertEquals(
      isRecentRecoverySession(withAmr({ method: "password", timestamp: NOW }), NOW),
      false,
    );
    assertEquals(isRecentRecoverySession(withAmr({ method: "oauth", timestamp: NOW }), NOW), false);
    assertEquals(isRecentRecoverySession(withAmr({ method: "totp", timestamp: NOW }), NOW), false);
  },
);

Deno.test(
  "sesión de recuperación: vigencia exacta de 15 minutos (900 s sí, 901 s no) y tolera 60 s de reloj adelantado",
  () => {
    assertEquals(RECOVERY_MAX_AGE_SECONDS, 900);
    assertEquals(
      isRecentRecoverySession(withAmr({ method: "otp", timestamp: NOW - 900 }), NOW),
      true,
    );
    assertEquals(
      isRecentRecoverySession(withAmr({ method: "otp", timestamp: NOW - 901 }), NOW),
      false,
    );
    assertEquals(
      isRecentRecoverySession(withAmr({ method: "otp", timestamp: NOW + 60 }), NOW),
      true,
    );
    assertEquals(
      isRecentRecoverySession(withAmr({ method: "otp", timestamp: NOW + 61 }), NOW),
      false,
    );
    assertEquals(
      isRecentRecoverySession(withAmr({ method: "otp", timestamp: NOW - 20 }), NOW, 10),
      false,
    ); // plazo ajustable
  },
);

Deno.test(
  "sesión de recuperación: basta una entrada válida entre varias; lo mal formado no cuenta ni lanza",
  () => {
    assertEquals(
      isRecentRecoverySession(
        withAmr({ method: "password", timestamp: NOW }, { method: "otp", timestamp: NOW - 1 }),
        NOW,
      ),
      true,
    );
    for (const bad of [
      null,
      {},
      { amr: "otp" },
      { amr: [] },
      { amr: [null] },
      { amr: ["otp"] },
      { amr: [{ method: "otp" }] },
      { amr: [{ method: "otp", timestamp: "ahora" }] },
      { amr: [{ method: "otp", timestamp: NaN }] },
      { amr: [{ method: "otp", timestamp: null }] },
    ]) {
      assertEquals(
        isRecentRecoverySession(bad as Record<string, unknown> | null, NOW),
        false,
        JSON.stringify(bad),
      );
    }
  },
);

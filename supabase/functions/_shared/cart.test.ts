import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  type CartIdentity,
  cartRequestSchema,
  generateCartToken,
  hashCartToken,
  isCartToken,
  isWrite,
  planRpc,
} from "./cart.ts";
import { HttpError } from "./errors.ts";
import { clientIp, networkFingerprint, normalizeIp } from "./rate-limit.ts";
import { parseBodyLimited, readLimitedText } from "./validate.ts";

const VARIANT = "662d00cc-07e3-4eca-ac0a-ab8b2b0cc18e";
const USER = "11111111-1111-4111-8111-111111111111";

Deno.test("el token tiene la forma «ct_» + 43 caracteres base64url y no se repite", () => {
  const a = generateCartToken();
  const b = generateCartToken();
  assertEquals(a.length, 46); // «ct_» (3) + 32 bytes en base64url sin relleno (43)
  assert(isCartToken(a));
  assertNotEquals(a, b);
});

Deno.test("isCartToken rechaza lo que no es un token", () => {
  const ok = "ct_" + "A".repeat(43);
  assert(isCartToken(ok));
  for (const bad of [
    "",
    "ct_" + "A".repeat(42),
    "ct_" + "A".repeat(44),
    "xx_" + "A".repeat(43),
    "ct_" + "A".repeat(42) + "+", // «+» no es base64url
    "ct_" + "A".repeat(42) + "=",
    ` ${ok}`,
    null,
    undefined,
    42,
  ]) {
    assertEquals(isCartToken(bad), false, `debería rechazar ${JSON.stringify(bad)}`);
  }
});

Deno.test("hashCartToken es sha256 hexadecimal (vector conocido de «abc»)", async () => {
  assertEquals(
    await hashCartToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assertEquals((await hashCartToken(generateCartToken())).length, 64);
});

Deno.test("el esquema acepta cada acción bien formada", () => {
  const token = "ct_" + "A".repeat(43);
  for (const body of [
    { action: "get" },
    { action: "get", cart_token: token },
    { action: "set_item", variant_id: VARIANT, qty: 0 },
    { action: "set_item", variant_id: VARIANT, qty: 1000, cart_token: token },
    { action: "remove_item", variant_id: VARIANT },
    { action: "clear" },
    { action: "refresh", cart_token: token },
    { action: "accept_prices" },
    { action: "accept_prices", variant_id: VARIANT },
    { action: "merge", cart_token: token },
  ]) {
    assert(cartRequestSchema.safeParse(body).success, `debería aceptar ${JSON.stringify(body)}`);
  }
});

Deno.test(
  "el esquema rechaza cantidades raras, ids que no son uuid, campos de más y acciones desconocidas",
  () => {
    const token = "ct_" + "A".repeat(43);
    for (const body of [
      { action: "set_item", variant_id: VARIANT, qty: -1 },
      { action: "set_item", variant_id: VARIANT, qty: 1001 },
      { action: "set_item", variant_id: VARIANT, qty: 1.5 },
      { action: "set_item", variant_id: VARIANT, qty: "2" },
      { action: "set_item", variant_id: VARIANT, qty: null },
      { action: "set_item", variant_id: VARIANT },
      { action: "set_item", variant_id: "no-es-uuid", qty: 1 },
      { action: "set_item", variant_id: [VARIANT], qty: 1 }, // una lista no es un id
      { action: "get", extra: 1 }, // .strict(): nada de campos de más
      { action: "set_item", variant_id: VARIANT, qty: 1, price: 1 }, // el cliente no manda precios
      { action: "merge" }, // merge exige token
      { action: "hack", cart_token: token },
      { cart_token: token },
      [],
      "get",
      null,
    ]) {
      assertEquals(
        cartRequestSchema.safeParse(body).success,
        false,
        `debería rechazar ${JSON.stringify(body)}`,
      );
    }
  },
);

const guest: CartIdentity = {
  userId: null,
  tokenHash: "a".repeat(64),
  mayCreate: false,
  ipHash: "9".repeat(64),
};
const user: CartIdentity = { userId: USER, tokenHash: null, mayCreate: false, ipHash: null };

Deno.test("planRpc: el usuario manda sobre el token; el invitado va por su hash", () => {
  const get = { action: "get" } as const;
  assertEquals(planRpc(get, user), {
    fn: "cart_get",
    args: { p_profile_id: USER, p_token_hash: null },
  });
  // Aunque un usuario autenticado traiga también un token, el carrito es el suyo: el hash no se usa.
  assertEquals(planRpc(get, { ...user, tokenHash: "b".repeat(64) }).args, {
    p_profile_id: USER,
    p_token_hash: null,
  });
  assertEquals(planRpc(get, guest), {
    fn: "cart_get",
    args: { p_profile_id: null, p_token_hash: "a".repeat(64) },
  });
});

Deno.test(
  "planRpc: un invitado solo estrena carrito si el servidor acaba de emitir el token",
  () => {
    const set = { action: "set_item", variant_id: VARIANT, qty: 2 } as const;
    assertEquals(planRpc(set, guest).args.p_may_create, false);
    assertEquals(planRpc(set, { ...guest, mayCreate: true }).args.p_may_create, true);
    assertEquals(planRpc(set, user).args.p_may_create, true);
    assertEquals(planRpc(set, guest), {
      fn: "cart_set_item",
      args: {
        p_profile_id: null,
        p_token_hash: "a".repeat(64),
        p_variant_id: VARIANT,
        p_qty: 2,
        p_may_create: false,
        p_ip_hash: "9".repeat(64),
      },
    });
  },
);

Deno.test("planRpc: cada acción llama a su función y merge lleva usuario Y token", () => {
  const merged = planRpc(
    { action: "merge", cart_token: "ct_" + "A".repeat(43) },
    { userId: USER, tokenHash: "c".repeat(64), mayCreate: false, ipHash: null },
  );
  assertEquals(merged, {
    fn: "merge_guest_cart",
    args: { p_profile_id: USER, p_token_hash: "c".repeat(64) },
  });
  assertEquals(
    planRpc({ action: "remove_item", variant_id: VARIANT }, user).fn,
    "cart_remove_item",
  );
  assertEquals(planRpc({ action: "clear" }, user).fn, "cart_clear");
  assertEquals(planRpc({ action: "refresh" }, user).fn, "cart_refresh");
  assertEquals(planRpc({ action: "accept_prices" }, user).args.p_variant_id, null);
  assertEquals(
    planRpc({ action: "accept_prices", variant_id: VARIANT }, user).args.p_variant_id,
    VARIANT,
  );
});

Deno.test("solo «get» no es escritura", () => {
  assertEquals(isWrite({ action: "get" }), false);
  for (const action of ["clear", "refresh", "accept_prices"] as const) {
    assertEquals(isWrite({ action }), true, action);
  }
  assertEquals(isWrite({ action: "remove_item", variant_id: VARIANT }), true);
});

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

Deno.test(
  "readLimitedText: un cuerpo justo en el tope pasa y uno de un byte más se corta con 413",
  async () => {
    const exactly = "x".repeat(2048);
    const req = new Request("http://x", { method: "POST", body: exactly });
    assertEquals((await readLimitedText(req, 2048)).length, 2048);

    const over = new Request("http://x", { method: "POST", body: "x".repeat(2049) });
    const error = await assertRejects(() => readLimitedText(over, 2048), HttpError);
    assertEquals(error.status, 413);
  },
);

Deno.test(
  "readLimitedText: por trozos y SIN Content-Length corta en cuanto se pasa y no sigue leyendo",
  async () => {
    let pulled = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(encoder.encode("y".repeat(1000)));
        if (pulled > 10_000) controller.close(); // si no se cortara, leería 10 MB
      },
    });
    const req = new Request("http://x", { method: "POST", body, duplex: "half" } as RequestInit);
    const error = await assertRejects(() => readLimitedText(req, 2048), HttpError);
    assertEquals(error.status, 413);
    assert(pulled <= 5, `leyó ${pulled} trozos de 1000 bytes: debía cortar a los 3`);
  },
);

Deno.test(
  "readLimitedText: un Content-Length declarado de más se rechaza sin leer el cuerpo",
  async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-length": "999999" },
      body: streamOf("{}"),
      duplex: "half",
    } as RequestInit);
    const error = await assertRejects(() => readLimitedText(req, 2048), HttpError);
    assertEquals(error.status, 413);
  },
);

Deno.test(
  "parseBodyLimited: JSON inválido → 400, esquema inválido → 400, válido → datos",
  async () => {
    const send = (body: string) => new Request("http://x", { method: "POST", body });
    const bad = await assertRejects(
      () => parseBodyLimited(send("{no es json"), cartRequestSchema, 2048),
      HttpError,
    );
    assertEquals(bad.code, "invalid_json");
    const invalid = await assertRejects(
      () => parseBodyLimited(send('{"action":"set_item","qty":1}'), cartRequestSchema, 2048),
      HttpError,
    );
    assertEquals(invalid.status, 400);
    const parsed = await parseBodyLimited(send('{"action":"clear"}'), cartRequestSchema, 2048);
    assertEquals(parsed, { action: "clear" });
  },
);

Deno.test(
  "un cuerpo gigante nunca llega al esquema (aviso de zod): 413 antes de parsear",
  async () => {
    // 1 MB de lista dentro de un campo: el tope lo corta antes de JSON.parse y de zod.
    const huge = JSON.stringify({ action: "get", cart_token: "t".repeat(1_000_000) });
    const req = new Request("http://x", { method: "POST", body: huge });
    const error = await assertRejects(
      () => parseBodyLimited(req, cartRequestSchema, 2048),
      HttpError,
    );
    assertEquals(error.status, 413);
    assertThrows(() => {
      throw error;
    }, HttpError);
  },
);

Deno.test("clientIp: la cabecera del proxy gana a la que puede escribir el cliente", () => {
  const req = (headers: Record<string, string>) => new Request("http://x", { headers });
  // Un atacante que manda su propia x-forwarded-for no cambia la IP que ve el límite.
  assertEquals(
    clientIp(req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7" })),
    "203.0.113.7",
  );
  assertEquals(clientIp(req({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" })), "198.51.100.9");
  assertEquals(clientIp(req({})), "unknown");
  assertEquals(clientIp(req({ "cf-connecting-ip": "  " })), "unknown");
});

Deno.test(
  "planRpc: la huella de red solo viaja para invitados (un usuario no lleva ninguna)",
  () => {
    const set = { action: "set_item", variant_id: VARIANT, qty: 1 } as const;
    assertEquals(planRpc(set, guest).args.p_ip_hash, "9".repeat(64));
    assertEquals(planRpc(set, { ...user, ipHash: "9".repeat(64) }).args.p_ip_hash, null);
  },
);

Deno.test("planRpc: accept_prices manda el precio que la persona vio (o null)", () => {
  assertEquals(
    planRpc({ action: "accept_prices", variant_id: VARIANT, expected_price: 120.5 }, user).args,
    { p_profile_id: USER, p_token_hash: null, p_variant_id: VARIANT, p_expected_price: 120.5 },
  );
  assertEquals(planRpc({ action: "accept_prices" }, user).args.p_expected_price, null);
});

Deno.test(
  "el esquema acepta un precio esperado positivo y rechaza 0, negativos, texto y absurdos",
  () => {
    for (const expected_price of [0.01, 120.5, 1_000_000_000]) {
      assert(
        cartRequestSchema.safeParse({
          action: "accept_prices",
          variant_id: VARIANT,
          expected_price,
        }).success,
      );
    }
    for (const expected_price of [0, -1, "120", null, 1_000_000_001, Number.NaN]) {
      assertEquals(
        cartRequestSchema.safeParse({
          action: "accept_prices",
          variant_id: VARIANT,
          expected_price,
        }).success,
        false,
        `debería rechazar ${String(expected_price)}`,
      );
    }
  },
);

Deno.test(
  "normalizeIp: IPv4 tal cual; IPv6 se agrupa por su prefijo /64 (rotar de dirección no cambia la red)",
  () => {
    assertEquals(normalizeIp("203.0.113.7"), "203.0.113.7");
    // Mismos 64 primeros bits, distinta dirección → misma clave.
    const a = normalizeIp("2001:db8:abcd:12:1111:2222:3333:4444");
    const b = normalizeIp("2001:DB8:ABCD:12:ffff:eeee:dddd:cccc");
    assertEquals(a, "2001:0db8:abcd:0012::/64");
    assertEquals(a, b);
    // Otro /64 → otra clave.
    assertNotEquals(a, normalizeIp("2001:db8:abcd:13:1111:2222:3333:4444"));
    // Formas comprimidas.
    assertEquals(normalizeIp("2001:db8::1"), "2001:0db8:0000:0000::/64");
    assertEquals(normalizeIp("::1"), "0000:0000:0000:0000::/64");
    assertEquals(normalizeIp("fe80::1%eth0"), "fe80:0000:0000:0000::/64");
    // IPv4 dentro de IPv6 es la IPv4.
    assertEquals(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
    // Lo que no es una IP no se rompe.
    assertEquals(normalizeIp("unknown"), "unknown");
    assertEquals(normalizeIp("2001:db8::1::2"), "2001:db8::1::2");
    assertEquals(normalizeIp("gggg::1"), "gggg::1");
  },
);

Deno.test(
  "clientIp aplica la normalización: dos direcciones del mismo /64 son la misma red",
  () => {
    const req = (ip: string) => new Request("http://x", { headers: { "cf-connecting-ip": ip } });
    assertEquals(clientIp(req("2001:db8:1:2::a")), clientIp(req("2001:db8:1:2:ffff::b")));
    assertNotEquals(clientIp(req("2001:db8:1:2::a")), clientIp(req("2001:db8:1:3::a")));
  },
);

Deno.test(
  "networkFingerprint: estable, dependiente de la clave, hexadecimal y sin rastro de la IP",
  async () => {
    const f = await networkFingerprint("203.0.113.7", "clave-uno");
    assertEquals(f.length, 64);
    assert(/^[0-9a-f]{64}$/.test(f));
    assertEquals(f, await networkFingerprint("203.0.113.7", "clave-uno")); // estable
    assertNotEquals(f, await networkFingerprint("203.0.113.8", "clave-uno")); // otra red
    assertNotEquals(f, await networkFingerprint("203.0.113.7", "clave-dos")); // sin la clave no se reproduce
    assert(!f.includes("203"));
  },
);

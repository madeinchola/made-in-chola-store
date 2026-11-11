import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  checkProofFile,
  detectProofMime,
  extMatchesMime,
  LIMITS,
  MAX_BODY_BYTES,
  parseProofPath,
  paymentsRequestSchema,
  PROOF_MAX_BYTES,
  sha256Hex,
  userLimit,
} from "./payments-api.ts";

const USER = "a1000000-0000-4000-8000-000000000001";
const ORDER = "c1000000-0000-4000-8000-000000000001";
const FILE = "f0000000-0000-4000-8000-000000000001";
const PAYMENT = "b2000000-0000-4000-8000-000000000001";

const bytes = (...values: number[]) => new Uint8Array(values);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff, 0xe0];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const text = (value: string) => new TextEncoder().encode(value);

Deno.test("esquema: reintentar y subir comprobante son válidos", () => {
  assert(paymentsRequestSchema.safeParse({ action: "retry", order_id: ORDER }).success);
  assert(
    paymentsRequestSchema.safeParse({
      action: "proof_submit",
      payment_id: PAYMENT,
      path: `${USER}/${ORDER}/${FILE}.jpg`,
    }).success,
  );
});

Deno.test(
  "esquema: estricto — ningún campo de más (ni la identidad ni un monto) y ningún id inventado",
  () => {
    assertEquals(
      paymentsRequestSchema.safeParse({ action: "retry", order_id: ORDER, profile_id: USER })
        .success,
      false,
    );
    assertEquals(
      paymentsRequestSchema.safeParse({
        action: "proof_submit",
        payment_id: PAYMENT,
        path: "x",
        amount: 1,
      }).success,
      false,
    );
    assertEquals(
      paymentsRequestSchema.safeParse({ action: "retry", order_id: "no-es-uuid" }).success,
      false,
    );
    assertEquals(
      paymentsRequestSchema.safeParse({ action: "approve", order_id: ORDER }).success,
      false,
    );
    assertEquals(
      paymentsRequestSchema.safeParse({ action: "proof_submit", payment_id: PAYMENT }).success,
      false,
    );
    assertEquals(
      paymentsRequestSchema.safeParse({
        action: "proof_submit",
        payment_id: PAYMENT,
        path: "a".repeat(201),
      }).success,
      false,
    );
  },
);

Deno.test("el cuerpo admite 1 kB y los topes son estrictos", () => {
  assertEquals(MAX_BODY_BYTES, 1024);
  assertEquals(PROOF_MAX_BYTES, 5 * 1024 * 1024);
  assertEquals(userLimit("retry"), { name: "retry", ...LIMITS.retryPerUser });
  assertEquals(userLimit("proof_submit"), { name: "proof", ...LIMITS.proofPerUser });
  assert(LIMITS.retryPerUser.max < LIMITS.proofPerUser.max);
});

Deno.test("ruta del comprobante: solo la carpeta de quien pregunta, con la forma exacta", () => {
  assertEquals(parseProofPath(`${USER}/${ORDER}/${FILE}.jpg`, USER), {
    orderId: ORDER,
    ext: "jpg",
  });
  assertEquals(parseProofPath(`${USER}/${ORDER}/${FILE}.pdf`, USER)?.ext, "pdf");
  const other = "a1000000-0000-4000-8000-000000000002";
  assertEquals(parseProofPath(`${other}/${ORDER}/${FILE}.jpg`, USER), null); // la carpeta de otra clienta
  for (const bad of [
    `${USER}/${ORDER}/${FILE}.svg`,
    `${USER}/${ORDER}/${FILE}.JPG`,
    `${USER}/${ORDER}/../${FILE}.jpg`,
    `${USER}/${ORDER}/${FILE}.jpg/extra`,
    `${USER}/${ORDER}/${FILE}.jpg `,
    `/${USER}/${ORDER}/${FILE}.jpg`,
    `${USER}/${ORDER}.jpg`,
    "",
  ]) {
    assertEquals(parseProofPath(bad, USER), null, bad);
  }
});

Deno.test("tipo real por los bytes: jpeg, png, webp y pdf; nada más", () => {
  assertEquals(detectProofMime(bytes(...JPG)), "image/jpeg");
  assertEquals(detectProofMime(bytes(...PNG)), "image/png");
  assertEquals(detectProofMime(bytes(...WEBP)), "image/webp");
  assertEquals(detectProofMime(bytes(...PDF)), "application/pdf");
  // un svg con script, un html, un ejecutable y un script NO son comprobantes, se llamen como se llamen
  assertEquals(
    detectProofMime(
      text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ),
    null,
  );
  assertEquals(detectProofMime(text("<!doctype html><script>alert(1)</script>")), null);
  assertEquals(detectProofMime(bytes(0x4d, 0x5a, 0x90, 0x00)), null); // MZ (exe)
  assertEquals(detectProofMime(text("#!/bin/sh\nrm -rf /")), null);
  // casi: RIFF que no es WebP (WAVE), PNG truncado, vacío
  assertEquals(
    detectProofMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)),
    null,
  );
  assertEquals(detectProofMime(bytes(0x89, 0x50, 0x4e, 0x47)), null);
  assertEquals(detectProofMime(bytes()), null);
});

Deno.test("la extensión debe corresponder al tipo real", () => {
  assert(extMatchesMime("jpg", "image/jpeg"));
  assert(extMatchesMime("jpeg", "image/jpeg"));
  assert(extMatchesMime("png", "image/png"));
  assert(extMatchesMime("pdf", "application/pdf"));
  assertEquals(extMatchesMime("jpg", "image/png"), false);
  assertEquals(extMatchesMime("pdf", "image/jpeg"), false);
  assertEquals(extMatchesMime("webp", "application/pdf"), false);
});

Deno.test("sha256Hex da el vector conocido de «abc»", async () => {
  assertEquals(
    await sha256Hex(text("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assertEquals(
    await sha256Hex(bytes()),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

Deno.test(
  "comprobante: vacío, enorme, de tipo desconocido o con la extensión cambiada se rechazan",
  async () => {
    assertEquals(await checkProofFile(bytes(), "jpg"), { ok: false, reason: "empty" });
    const big = new Uint8Array(PROOF_MAX_BYTES + 1);
    big.set(JPG);
    assertEquals(await checkProofFile(big, "jpg"), { ok: false, reason: "too_large" });
    assertEquals(await checkProofFile(text("<svg><script/></svg>"), "jpg"), {
      ok: false,
      reason: "unknown_type",
    });
    assertEquals(await checkProofFile(bytes(...PNG, 1, 2, 3), "jpg"), {
      ok: false,
      reason: "extension_mismatch",
    });
    // justo en el tope entra
    const edge = new Uint8Array(PROOF_MAX_BYTES);
    edge.set(JPG);
    assertEquals((await checkProofFile(edge, "jpg")).ok, true);
  },
);

Deno.test(
  "comprobante válido: tipo, tamaño y una huella que cambia si cambia un solo byte",
  async () => {
    const a = bytes(...PNG, 1, 2, 3, 4);
    const b = bytes(...PNG, 1, 2, 3, 5);
    const ra = await checkProofFile(a, "png");
    const rb = await checkProofFile(b, "png");
    const ra2 = await checkProofFile(bytes(...PNG, 1, 2, 3, 4), "png");
    assert(ra.ok && rb.ok && ra2.ok);
    if (ra.ok && rb.ok && ra2.ok) {
      assertEquals(ra.mime, "image/png");
      assertEquals(ra.size, 12);
      assertEquals(ra.hash, ra2.hash); // el mismo archivo, la misma huella
      assert(ra.hash !== rb.hash); // otro byte, otra huella
      assert(/^[0-9a-f]{64}$/.test(ra.hash));
    }
  },
);

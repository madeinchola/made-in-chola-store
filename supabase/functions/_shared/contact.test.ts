import { assertEquals } from "jsr:@std/assert@1";
import { planContactChange, type CurrentContact } from "./contact.ts";

const emailOnly: CurrentContact = { email: "ana@test.com", phone: null, authEmail: "ana@test.com" };
const both: CurrentContact = {
  email: "ana@test.com",
  phone: "+59171111111",
  authEmail: "ana@test.com",
};
// Cuenta solo-teléfono: en Auth existe con el email sintético del teléfono y el perfil no tiene email.
const phoneOnly: CurrentContact = {
  email: null,
  phone: "+59172222222",
  authEmail: "59172222222@phone.madeinchola.invalid",
};

Deno.test("sin email ni teléfono en la petición: nada que cambiar", () => {
  assertEquals(planContactChange(both, {}), { ok: false, reason: "nothing_to_change" });
});

Deno.test("el mismo valor en otro formato no es un cambio (misma cuenta, mismo E.164)", () => {
  assertEquals(planContactChange(both, { phone: "7111 1111" }), { ok: true, changed: false });
  assertEquals(planContactChange(both, { phone: "+591 71111111" }), { ok: true, changed: false });
  assertEquals(planContactChange(both, { email: "  ANA@Test.COM " }), { ok: true, changed: false });
});

Deno.test("agregar un teléfono a una cuenta con email: Auth no se toca", () => {
  assertEquals(planContactChange(emailOnly, { phone: "7222 3333" }), {
    ok: true,
    changed: true,
    email: "ana@test.com",
    phone: "+59172223333",
    authEmail: "ana@test.com",
    authEmailChanged: false,
  });
});

Deno.test("cambiar el email: Auth cambia al nuevo, normalizado", () => {
  assertEquals(planContactChange(both, { email: " Nuevo@Test.com " }), {
    ok: true,
    changed: true,
    email: "nuevo@test.com",
    phone: "+59171111111",
    authEmail: "nuevo@test.com",
    authEmailChanged: true,
  });
});

Deno.test("solo-teléfono agrega un email real: Auth pasa del sintético al real", () => {
  assertEquals(planContactChange(phoneOnly, { email: "eli@test.com" }), {
    ok: true,
    changed: true,
    email: "eli@test.com",
    phone: "+59172222222",
    authEmail: "eli@test.com",
    authEmailChanged: true,
  });
});

Deno.test(
  "solo-teléfono cambia de teléfono: el email sintético se rehace con el número nuevo",
  () => {
    assertEquals(planContactChange(phoneOnly, { phone: "7333 4444" }), {
      ok: true,
      changed: true,
      email: null,
      phone: "+59173334444",
      authEmail: "59173334444@phone.madeinchola.invalid",
      authEmailChanged: true,
    });
  },
);

Deno.test("quitar el email de una cuenta con teléfono: Auth pasa al sintético del teléfono", () => {
  assertEquals(planContactChange(both, { email: null }), {
    ok: true,
    changed: true,
    email: null,
    phone: "+59171111111",
    authEmail: "59171111111@phone.madeinchola.invalid",
    authEmailChanged: true,
  });
  // texto en blanco = quitar
  assertEquals(planContactChange(both, { email: "   " }), planContactChange(both, { email: null }));
});

Deno.test("quitar el teléfono de una cuenta con email: Auth no se toca", () => {
  assertEquals(planContactChange(both, { phone: null }), {
    ok: true,
    changed: true,
    email: "ana@test.com",
    phone: null,
    authEmail: "ana@test.com",
    authEmailChanged: false,
  });
});

Deno.test("no se puede quedar sin ningún identificador", () => {
  assertEquals(planContactChange(phoneOnly, { phone: null }), {
    ok: false,
    reason: "identifier_required",
  });
  assertEquals(planContactChange(emailOnly, { email: "" }), {
    ok: false,
    reason: "identifier_required",
  });
  assertEquals(planContactChange(both, { email: null, phone: null }), {
    ok: false,
    reason: "identifier_required",
  });
});

Deno.test(
  "formatos inválidos: email sin dominio, correo sintético reclamado, teléfono corto o boliviano que no es celular",
  () => {
    assertEquals(planContactChange(both, { email: "sin-arroba" }), {
      ok: false,
      reason: "invalid_email",
    });
    assertEquals(planContactChange(both, { email: "yo@phone.madeinchola.invalid" }), {
      ok: false,
      reason: "invalid_email",
    });
    assertEquals(planContactChange(both, { phone: "123" }), { ok: false, reason: "invalid_phone" });
    assertEquals(planContactChange(both, { phone: "2123456" }), {
      ok: false,
      reason: "invalid_phone",
    }); // fijo de La Paz
    assertEquals(planContactChange(both, { phone: "abc" }), { ok: false, reason: "invalid_phone" });
  },
);

Deno.test(
  "el país del teléfono se respeta; uno no soportado es un teléfono inválido (no un error 500)",
  () => {
    const argentina = planContactChange(emailOnly, { phone: "011 4089 3614", phoneCountry: "AR" });
    assertEquals(argentina.ok && argentina.changed && argentina.phone, "+541140893614");
    assertEquals(planContactChange(emailOnly, { phone: "123456789", phoneCountry: "ZZ" }), {
      ok: false,
      reason: "invalid_phone",
    });
  },
);

Deno.test("cambiar email y teléfono a la vez", () => {
  assertEquals(planContactChange(emailOnly, { email: "otro@test.com", phone: "6999 8888" }), {
    ok: true,
    changed: true,
    email: "otro@test.com",
    phone: "+59169998888",
    authEmail: "otro@test.com",
    authEmailChanged: true,
  });
});

Deno.test(
  "el email de Auth se compara normalizado: una diferencia de mayúsculas o espacios no provoca una escritura innecesaria",
  () => {
    const plan = planContactChange(
      { email: "ana@test.com", phone: null, authEmail: " ANA@Test.com " },
      { phone: "7222 3333" },
    );
    assertEquals(plan.ok && plan.changed && plan.authEmailChanged, false);
  },
);

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  fn,
  testEnv,
  dbExec,
  dbSql,
  login,
  recoverySession,
  refreshSession,
  register,
  registerAndLogin,
  rest,
  svcRest,
  svcRpc,
  uniqueEmail,
  uniquePhone,
} from "../../../test-support/api";

// Integración REAL (HTTP): PostgREST + RLS + triggers + Edge Functions + GoTrue contra la base local.
// Cubre lo que el cliente NO puede probar solo: IDOR entre clientes, la regla «una sola predeterminada» bajo
// CONCURRENCIA real, el tope de registros, permisos por columna, y el cambio de contacto / contraseña / desactivación.

type User = Awaited<ReturnType<typeof registerAndLogin>>;

beforeEach(async () => {
  await clearRateLimits();
});

const address = (profileId: string, over: Record<string, unknown> = {}) => ({
  profile_id: profileId,
  label: "Casa",
  recipient: "Persona Prueba",
  phone_e164: "+59171234567",
  line1: "Calle Uno 123",
  city: "La Paz",
  ...over,
});
const tax = (profileId: string, over: Record<string, unknown> = {}) => ({
  profile_id: profileId,
  doc_type: "ci",
  doc_number: "1234567",
  legal_name: "Persona Prueba",
  ...over,
});
const mine = (user: User, path: string) => rest("GET", path, user.token);
const defaults = async (user: User, table: "addresses" | "tax_profiles") =>
  (
    (await mine(user, `${table}?select=id,is_default&is_default=eq.true&archived_at=is.null`))
      .body as unknown[]
  ).length;

describe("direcciones: permisos, aislamiento entre clientes y reglas (HTTP real)", () => {
  let ana: User;
  let beto: User;

  beforeAll(async () => {
    await clearRateLimits();
    ana = await registerAndLogin({ name: "Ana Pérez" });
    beto = await registerAndLogin({ name: "Beto Rojas" });
  });

  it("una clienta crea su dirección; la primera queda predeterminada y todo se guarda tal cual (emoji, tildes, texto raro)", async () => {
    const res = await rest(
      "POST",
      "addresses",
      ana.token,
      address(ana.id, {
        recipient: "Ana 🧵 Pérez <b>x</b>",
        reference_text: "Portón verde, frente a la «farmacia»",
        lat: -16.5,
        lng: -68.15,
      }),
    );
    expect(res.status).toBe(201);
    const row = (res.body as any[])[0];
    expect(row.is_default).toBe(true);
    expect(row.recipient).toBe("Ana 🧵 Pérez <b>x</b>"); // texto plano: nada se interpreta ni se altera
    expect(Number(row.lat)).toBe(-16.5);
    expect(Number(row.lng)).toBe(-68.15);
  });

  it("IDOR: otro cliente no la ve (lista, por id ni por filtro), no la edita, no la borra y no crea una a nombre ajeno", async () => {
    const created = await rest(
      "POST",
      "addresses",
      ana.token,
      address(ana.id, { label: "Privada" }),
    );
    const id = (created.body as any[])[0].id as string;

    expect(((await mine(beto, "addresses?select=id")).body as unknown[]).length).toBe(0);
    expect(((await mine(beto, `addresses?id=eq.${id}&select=id`)).body as unknown[]).length).toBe(
      0,
    );
    expect(
      ((await mine(beto, `addresses?profile_id=eq.${ana.id}&select=id`)).body as unknown[]).length,
    ).toBe(0);

    const patch = await rest("PATCH", `addresses?id=eq.${id}`, beto.token, { label: "Hackeada" });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual([]); // 0 filas afectadas
    expect(
      ((await svcRest("GET", `addresses?id=eq.${id}&select=label`)).body as any[])[0].label,
    ).toBe("Privada");

    expect((await rest("DELETE", `addresses?id=eq.${id}`, beto.token)).status).toBe(403);
    expect((await rest("DELETE", `addresses?id=eq.${id}`, ana.token)).status).toBe(403); // ni la dueña: se archiva
    expect(
      ((await svcRest("GET", `addresses?id=eq.${id}&select=id`)).body as unknown[]).length,
    ).toBe(1);

    const forged = await rest(
      "POST",
      "addresses",
      beto.token,
      address(ana.id, { label: "Intruso" }),
    );
    expect(forged.status).toBe(403);
  });

  it("la dueña no puede pasar su dirección a otro cliente ni tocar columnas internas", async () => {
    const created = await rest("POST", "addresses", ana.token, address(ana.id, { label: "Mía" }));
    const id = (created.body as any[])[0].id as string;
    expect(
      (await rest("PATCH", `addresses?id=eq.${id}`, ana.token, { profile_id: beto.id })).status,
    ).toBe(403);
    expect(
      (
        await rest("PATCH", `addresses?id=eq.${id}`, ana.token, {
          created_at: "2001-01-01T00:00:00Z",
        })
      ).status,
    ).toBe(403);
    expect(
      (await rest("PATCH", `addresses?id=eq.${id}`, ana.token, { id: crypto.randomUUID() })).status,
    ).toBe(403);
    expect(
      ((await svcRest("GET", `addresses?id=eq.${id}&select=profile_id`)).body as any[])[0]
        .profile_id,
    ).toBe(ana.id);
  });

  it("sin sesión (anon) no hay acceso", async () => {
    const env = testEnv();
    const res = await fetch(`${env.url}/rest/v1/addresses?select=id`, {
      headers: { apikey: env.anon },
    });
    expect([401, 403]).toContain(res.status);
  });

  it("el admin LEE las direcciones de los clientes pero no puede editarlas", async () => {
    const adminUser = await registerAndLogin({ name: "Admin Prueba" });
    await svcRpc("promote_admin", { p_email: adminUser.email });
    const seen = await mine(adminUser, `addresses?profile_id=eq.${ana.id}&select=id`);
    expect((seen.body as unknown[]).length).toBeGreaterThan(0);
    const patch = await rest("PATCH", `addresses?profile_id=eq.${ana.id}`, adminUser.token, {
      label: "Admin edita",
    });
    expect(patch.body).toEqual([]);
    expect(
      (
        (await svcRest("GET", `addresses?label=eq.${encodeURIComponent("Admin edita")}&select=id`))
          .body as unknown[]
      ).length,
    ).toBe(0);
    const forged = await rest(
      "POST",
      "addresses",
      adminUser.token,
      address(ana.id, { label: "Del admin" }),
    );
    expect(forged.status).toBe(403);
  });

  it("datos inválidos: pin a medias, coordenadas fuera de rango, teléfono sin +, sin propósito y país no habilitado → 400", async () => {
    for (const bad of [
      { lat: -16.5 },
      { lat: 91, lng: 0 },
      { lat: 0, lng: 181 },
      { phone_e164: "71234567" },
      { for_shipping: false, for_billing: false },
      { label: "   " },
      { country: "AR" },
    ]) {
      const res = await rest("POST", "addresses", ana.token, address(ana.id, bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("CONCURRENCIA: 8 «marcar como predeterminada» simultáneos terminan con EXACTAMENTE una y sin errores", async () => {
    const user = await registerAndLogin({ name: "Concurrente Uno" });
    const created = await rest(
      "POST",
      "addresses",
      user.token,
      Array.from({ length: 8 }, (_, i) => address(user.id, { label: `Dir ${i + 1}` })),
    );
    expect(created.status).toBe(201);
    const ids = (created.body as any[]).map((r) => r.id as string);
    expect(await defaults(user, "addresses")).toBe(1); // la primera, sola

    const results = await Promise.all(
      ids.map((id) => rest("PATCH", `addresses?id=eq.${id}`, user.token, { is_default: true })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(await defaults(user, "addresses")).toBe(1);
  });

  it("CONCURRENCIA: 8 altas simultáneas, todas «predeterminada», terminan con exactamente una y todas creadas", async () => {
    const user = await registerAndLogin({ name: "Concurrente Dos" });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        rest(
          "POST",
          "addresses",
          user.token,
          address(user.id, { label: `Alta ${i + 1}`, is_default: true }),
        ),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(((await mine(user, "addresses?select=id")).body as unknown[]).length).toBe(8);
    expect(await defaults(user, "addresses")).toBe(1);
  });

  it("CONCURRENCIA: archivar la predeterminada mientras se marca otra (12 rondas) nunca da error ni deja dos o ninguna", async () => {
    // Antes de usar un candado por SENTENCIA esto producía un interbloqueo (500) en casi todas las rondas.
    const user = await registerAndLogin({ name: "Concurrente Tres" });
    for (let round = 1; round <= 12; round++) {
      const created = await rest("POST", "addresses", user.token, [
        address(user.id, { label: `R${round}A` }),
        address(user.id, { label: `R${round}B` }),
      ]); // 2 por ronda y 1 archivada: 12 rondas = 12 activas, bajo el tope de 20
      expect(created.status, `ronda ${round}: alta`).toBe(201);
      const rows = created.body as { id: string; is_default: boolean }[];
      // se archiva la predeterminada (la de este lote o la de uno anterior) y a la vez se marca otra
      const current = (
        (await mine(user, "addresses?select=id&is_default=eq.true&archived_at=is.null")).body as {
          id: string;
        }[]
      )[0]!;
      const target = rows.find((r) => r.id !== current.id)!;
      const results = await Promise.all([
        rest("PATCH", `addresses?id=eq.${current.id}`, user.token, {
          archived_at: new Date().toISOString(),
        }),
        rest("PATCH", `addresses?id=eq.${target.id}`, user.token, { is_default: true }),
      ]);
      expect(
        results.map((r) => r.status),
        `ronda ${round}`,
      ).toEqual([200, 200]);
      expect(await defaults(user, "addresses"), `ronda ${round}: predeterminadas`).toBe(1);
    }
  });

  it("CONCURRENCIA: crear y archivar a la vez en un cliente con direcciones no da error ni deja dos predeterminadas", async () => {
    const user = await registerAndLogin({ name: "Concurrente Cuatro" });
    await rest("POST", "addresses", user.token, [
      address(user.id, { label: "Base 1" }),
      address(user.id, { label: "Base 2" }),
    ]);
    const ids = ((await mine(user, "addresses?select=id")).body as { id: string }[]).map(
      (r) => r.id,
    );
    const results = await Promise.all([
      rest("POST", "addresses", user.token, address(user.id, { label: "Nueva", is_default: true })),
      rest("PATCH", `addresses?id=eq.${ids[0]}`, user.token, {
        archived_at: new Date().toISOString(),
      }),
      rest("PATCH", `addresses?id=eq.${ids[1]}`, user.token, { is_default: true }),
      rest(
        "POST",
        "addresses",
        user.token,
        address(user.id, { label: "Nueva 2", is_default: true }),
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 200, 200, 201]);
    expect(await defaults(user, "addresses")).toBe(1);
  });

  it("tope de 20 activas: 20 de una vez entran, la 21.ª se rechaza (400) y archivar libera un lugar; 21 de una vez no entra NINGUNA", async () => {
    const user = await registerAndLogin({ name: "Tope" });
    const twenty = Array.from({ length: 20 }, (_, i) => address(user.id, { label: `T${i + 1}` }));
    expect((await rest("POST", "addresses", user.token, twenty)).status).toBe(201);
    const over = await rest("POST", "addresses", user.token, address(user.id, { label: "T21" }));
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.body)).toContain("máximo de 20");
    const first = (
      (await mine(user, "addresses?select=id&order=created_at.asc&limit=1")).body as any[]
    )[0].id;
    expect(
      (
        await rest("PATCH", `addresses?id=eq.${first}`, user.token, {
          archived_at: new Date().toISOString(),
        })
      ).status,
    ).toBe(200);
    expect(
      (await rest("POST", "addresses", user.token, address(user.id, { label: "Cabe" }))).status,
    ).toBe(201);

    const other = await registerAndLogin({ name: "Tope Dos" });
    const twentyOne = Array.from({ length: 21 }, (_, i) =>
      address(other.id, { label: `U${i + 1}` }),
    );
    expect((await rest("POST", "addresses", other.token, twentyOne)).status).toBe(400);
    expect(((await mine(other, "addresses?select=id")).body as unknown[]).length).toBe(0); // todo o nada
  });

  it("archivar la predeterminada promueve a otra activa; restaurar con una predeterminada vigente no le quita la marca", async () => {
    const user = await registerAndLogin({ name: "Archiva" });
    const created = await rest("POST", "addresses", user.token, [
      address(user.id, { label: "Uno" }),
      address(user.id, { label: "Dos" }),
    ]);
    const rows = created.body as any[];
    const def = rows.find((r) => r.is_default)!;
    const other = rows.find((r) => !r.is_default)!;
    await rest("PATCH", `addresses?id=eq.${def.id}`, user.token, {
      archived_at: new Date().toISOString(),
    });
    const after = (await mine(user, "addresses?select=id,is_default,archived_at")).body as any[];
    expect(after.find((r) => r.id === def.id).is_default).toBe(false);
    expect(after.find((r) => r.id === other.id).is_default).toBe(true);
    await rest("PATCH", `addresses?id=eq.${def.id}`, user.token, { archived_at: null });
    const restored = (await mine(user, "addresses?select=id,is_default")).body as any[];
    expect(restored.find((r) => r.id === other.id).is_default).toBe(true);
    expect(restored.find((r) => r.id === def.id).is_default).toBe(false);
  });
});

describe("datos fiscales y preferencias del perfil (HTTP real)", () => {
  let ana: User;
  let beto: User;
  beforeAll(async () => {
    await clearRateLimits();
    ana = await registerAndLogin({ name: "Ana Fiscal" });
    beto = await registerAndLogin({ name: "Beto Fiscal" });
  });

  it("crea un CI (queda predeterminado), el documento pasa a mayúsculas y un duplicado activo da 409", async () => {
    const created = await rest(
      "POST",
      "tax_profiles",
      ana.token,
      tax(ana.id, { doc_type: "pas", doc_number: "ab12345" }),
    );
    expect(created.status).toBe(201);
    const row = (created.body as any[])[0];
    expect(row.doc_number).toBe("AB12345");
    expect(row.is_default).toBe(true);
    const dup = await rest(
      "POST",
      "tax_profiles",
      ana.token,
      tax(ana.id, { doc_type: "pas", doc_number: "AB12345" }),
    );
    expect(dup.status).toBe(409);
  });

  it("el mismo documento en OTRO cliente sí se permite; IDOR: no se ven, no se editan y no se crean a nombre ajeno", async () => {
    const mineCi = await rest(
      "POST",
      "tax_profiles",
      ana.token,
      tax(ana.id, { doc_number: "7654321" }),
    );
    expect(mineCi.status).toBe(201);
    expect(
      (await rest("POST", "tax_profiles", beto.token, tax(beto.id, { doc_number: "7654321" })))
        .status,
    ).toBe(201);
    expect(
      ((await mine(beto, `tax_profiles?profile_id=eq.${ana.id}&select=id`)).body as unknown[])
        .length,
    ).toBe(0);
    const id = (mineCi.body as any[])[0].id;
    const patch = await rest("PATCH", `tax_profiles?id=eq.${id}`, beto.token, {
      legal_name: "Hackeado",
    });
    expect(patch.body).toEqual([]);
    expect(
      (await rest("POST", "tax_profiles", beto.token, tax(ana.id, { doc_number: "1111111" })))
        .status,
    ).toBe(403);
    expect((await rest("DELETE", `tax_profiles?id=eq.${id}`, ana.token)).status).toBe(403);
  });

  it("CONCURRENCIA: 6 «predeterminado» simultáneos dejan exactamente uno", async () => {
    const user = await registerAndLogin({ name: "Fiscal Concurrente" });
    const created = await rest(
      "POST",
      "tax_profiles",
      user.token,
      Array.from({ length: 6 }, (_, i) =>
        tax(user.id, { doc_type: "otro", doc_number: `DOC${i + 1}` }),
      ),
    );
    const ids = (created.body as any[]).map((r) => r.id as string);
    const results = await Promise.all(
      ids.map((id) => rest("PATCH", `tax_profiles?id=eq.${id}`, user.token, { is_default: true })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(await defaults(user, "tax_profiles")).toBe(1);
  });

  it("tope de 10 activos y documento con símbolos rechazado", async () => {
    const user = await registerAndLogin({ name: "Fiscal Tope" });
    const ten = Array.from({ length: 10 }, (_, i) =>
      tax(user.id, { doc_type: "otro", doc_number: `D${i + 1}00` }),
    );
    expect((await rest("POST", "tax_profiles", user.token, ten)).status).toBe(201);
    const over = await rest(
      "POST",
      "tax_profiles",
      user.token,
      tax(user.id, { doc_type: "otro", doc_number: "D1100" }),
    );
    expect(over.status).toBe(400);
    expect(
      (await rest("POST", "tax_profiles", ana.token, tax(ana.id, { doc_number: "<script>" })))
        .status,
    ).toBe(400);
  });

  it("preferencias: una moneda deshabilitada se rechaza, la habilitada y volver a NULL se aceptan; el rol sigue intocable", async () => {
    const bad = await rest("PATCH", `profiles?id=eq.${ana.id}`, ana.token, {
      preferred_currency: "USD",
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await rest("PATCH", `profiles?id=eq.${ana.id}`, ana.token, {
          preferred_currency: "BOB",
          preferred_locale: "es",
        })
      ).status,
    ).toBe(200);
    expect(
      (await rest("PATCH", `profiles?id=eq.${ana.id}`, ana.token, { preferred_currency: null }))
        .status,
    ).toBe(200);
    expect(
      (await rest("PATCH", `profiles?id=eq.${ana.id}`, ana.token, { role: "admin" })).status,
    ).toBe(403);
    expect(
      (await rest("PATCH", `profiles?id=eq.${ana.id}`, ana.token, { email: "otro@x.com" })).status,
    ).toBe(403);
  });

  it("los países y monedas habilitados se leen por las vistas públicas (sin sesión) y solo lo habilitado", async () => {
    const env = testEnv();
    const countries = await (
      await fetch(`${env.url}/rest/v1/public_countries?select=code`, {
        headers: { apikey: env.anon },
      })
    ).json();
    expect(countries).toEqual([{ code: "BO" }]);
    const currencies = await (
      await fetch(`${env.url}/rest/v1/public_currencies?select=code`, {
        headers: { apikey: env.anon },
      })
    ).json();
    expect(currencies).toEqual([{ code: "BOB" }]);
    const settings = await (
      await fetch(
        `${env.url}/rest/v1/public_store_settings?key=eq.tax_id_validation&select=value`,
        { headers: { apikey: env.anon } },
      )
    ).json();
    expect(settings).toEqual([{ value: "strict" }]);
  });
});

describe("update-contact: cambiar email y teléfono con la contraseña (Edge Function + GoTrue real)", () => {
  const body = (user: User, extra: Record<string, unknown>) => ({
    password: user.password,
    ...extra,
  });
  const profile = async (user: User) =>
    (
      (await rest("GET", `profiles?id=eq.${user.id}&select=email,phone_e164`, user.token))
        .body as any[]
    )[0];

  it("sin sesión → 401; con contraseña incorrecta → 401 invalid_credentials y NADA cambia", async () => {
    const user = await registerAndLogin();
    expect(
      (await fn("update-contact", { password: user.password, phone: uniquePhone() })).status,
    ).toBe(401);
    const wrong = await fn(
      "update-contact",
      { password: "Otra-Clave-2026!", phone: uniquePhone() },
      { token: user.token },
    );
    expect(wrong.status).toBe(401);
    expect((wrong.body as any).error.code).toBe("invalid_credentials");
    expect((await profile(user)).phone_e164).toBeNull();
  });

  it("agrega un teléfono: queda normalizado en el perfil, se puede iniciar sesión con él y el cambio se audita a nombre del cliente", async () => {
    const user = await registerAndLogin();
    const phone = uniquePhone();
    const res = await fn("update-contact", body(user, { phone }), { token: user.token });
    expect(res.status).toBe(200);
    expect((res.body as any).changed).toBe(true);
    expect((await profile(user)).phone_e164).toBe(`+591${phone}`);
    expect((await login(phone, user.password)).status).toBe(200);
    expect((await login(user.email!, user.password)).status).toBe(200); // el email sigue funcionando

    const audit = await svcRest(
      "GET",
      `audit_log?table_name=eq.profiles&actor_id=eq.${user.id}&select=diff,actor_role`,
    );
    const rows = (audit.body as any[]).filter((r) => r.diff?.phone_e164);
    expect(rows.length).toBe(1);
    expect(rows[0].diff.phone_e164).toEqual({ changed: true }); // sin el número en claro
  });

  it("el mismo número en otro formato no es un cambio", async () => {
    const user = await registerAndLogin();
    const phone = uniquePhone();
    await fn("update-contact", body(user, { phone }), { token: user.token });
    const again = await fn("update-contact", body(user, { phone: `591 ${phone}` }), {
      token: user.token,
    });
    expect(again.status).toBe(200);
    expect((again.body as any).changed).toBe(false);
  });

  it("un teléfono o email que ya son de otra cuenta → 409 con el MISMO mensaje (no revela cuál existe) y nada cambia", async () => {
    const owner = await registerAndLogin({ phone: uniquePhone() });
    const ownerEmailUser = await registerAndLogin();
    const user = await registerAndLogin();
    const dupPhone = await fn("update-contact", body(user, { phone: owner.phone }), {
      token: user.token,
    });
    const dupEmail = await fn("update-contact", body(user, { email: ownerEmailUser.email }), {
      token: user.token,
    });
    expect(dupPhone.status).toBe(409);
    expect(dupEmail.status).toBe(409);
    expect((dupPhone.body as any).error.code).toBe("contact_update_failed");
    expect((dupPhone.body as any).error.message).toBe((dupEmail.body as any).error.message);
    const p = await profile(user);
    expect(p.phone_e164).toBeNull();
    expect(p.email).toBe(user.email);
    expect((await login(user.email!, user.password)).status).toBe(200); // Auth no se tocó
  });

  it("cambia el email: se entra con el nuevo y el viejo deja de servir", async () => {
    const user = await registerAndLogin();
    const next = uniqueEmail("nuevo");
    const res = await fn("update-contact", body(user, { email: `  ${next.toUpperCase()} ` }), {
      token: user.token,
    });
    expect(res.status).toBe(200);
    expect((await profile(user)).email).toBe(next);
    expect((await login(next, user.password)).status).toBe(200);
    expect((await login(user.email!, user.password)).status).toBe(401);
  });

  it("cuenta solo-teléfono: agrega un email real, cambia de teléfono y no puede quedarse sin identificador", async () => {
    const phone = uniquePhone();
    const user = await registerAndLogin({ phone });
    const email = uniqueEmail("solo");
    expect((await fn("update-contact", body(user, { email }), { token: user.token })).status).toBe(
      200,
    );
    expect((await login(email, user.password)).status).toBe(200);
    expect((await login(phone, user.password)).status).toBe(200);

    const phone2 = uniquePhone();
    const user2 = await registerAndLogin({ phone: uniquePhone() });
    expect(
      (await fn("update-contact", body(user2, { phone: phone2 }), { token: user2.token })).status,
    ).toBe(200);
    expect((await login(phone2, user2.password)).status).toBe(200);
    expect((await login(user2.phone!, user2.password)).status).toBe(401);

    const user3 = await registerAndLogin({ phone: uniquePhone() });
    const solo = await fn("update-contact", body(user3, { phone: null }), { token: user3.token });
    expect(solo.status).toBe(400);
    expect((solo.body as any).error.code).toBe("identifier_required");
  });

  it("quitar el email de una cuenta con teléfono: sigue entrando con el teléfono", async () => {
    const user = await registerAndLogin();
    const phone = uniquePhone();
    await fn("update-contact", body(user, { phone }), { token: user.token });
    const res = await fn("update-contact", body(user, { email: null }), { token: user.token });
    expect(res.status).toBe(200);
    expect((await profile(user)).email).toBeNull();
    expect((await login(phone, user.password)).status).toBe(200);
  });

  it("formatos inválidos y cuerpo vacío → 400", async () => {
    const user = await registerAndLogin();
    const send = (extra: Record<string, unknown>) =>
      fn("update-contact", body(user, extra), { token: user.token });
    expect(((await send({ email: "sin-arroba" })).body as any).error.code).toBe("invalid_email");
    expect(((await send({ email: "yo@phone.madeinchola.invalid" })).body as any).error.code).toBe(
      "invalid_email",
    );
    expect(((await send({ phone: "123" })).body as any).error.code).toBe("invalid_phone");
    expect(((await send({})).body as any).error.code).toBe("nothing_to_change");
  });

  it("límite de intentos: la 6.ª contraseña incorrecta seguida recibe 429", async () => {
    const user = await registerAndLogin();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await fn(
            "update-contact",
            { password: "Mala-Clave-000!", phone: uniquePhone() },
            { token: user.token },
          )
        ).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });
});

describe("change-password y desactivar cuenta (Edge Functions + GoTrue real)", () => {
  const NEW_PASSWORD = "Montaña-Azul-2027!";

  it("cambia la contraseña con la actual: la nueva entra y la vieja ya no", async () => {
    const user = await registerAndLogin();
    const res = await fn(
      "change-password",
      { current_password: user.password, new_password: NEW_PASSWORD },
      { token: user.token },
    );
    expect(res.status).toBe(200);
    expect((await login(user.email!, NEW_PASSWORD)).status).toBe(200);
    expect((await login(user.email!, user.password)).status).toBe(401);
  });

  it("exige sesión y contraseña actual correcta; rechaza la débil (con motivos), la igual a la actual y la que contiene el email", async () => {
    const user = await registerAndLogin();
    expect(
      (await fn("change-password", { current_password: user.password, new_password: NEW_PASSWORD }))
        .status,
    ).toBe(401);
    const wrong = await fn(
      "change-password",
      { current_password: "Mala-Clave-000!", new_password: NEW_PASSWORD },
      { token: user.token },
    );
    expect(wrong.status).toBe(401);
    expect((wrong.body as any).error.code).toBe("invalid_credentials");

    const weak = await fn(
      "change-password",
      { current_password: user.password, new_password: "abc" },
      { token: user.token },
    );
    expect(weak.status).toBe(400);
    expect((weak.body as any).error.code).toBe("weak_password");
    expect(((weak.body as any).error.failures as string[]).length).toBeGreaterThan(0);

    const same = await fn(
      "change-password",
      { current_password: user.password, new_password: user.password },
      { token: user.token },
    );
    expect((same.body as any).error.code).toBe("same_password");

    const withEmail = await fn(
      "change-password",
      { current_password: user.password, new_password: `${user.email!.split("@")[0]}-2027-Zz` },
      { token: user.token },
    );
    expect(withEmail.status).toBe(400);
    expect((await login(user.email!, user.password)).status).toBe(200); // nada cambió
  });

  it("límite de intentos: la 6.ª contraseña actual incorrecta seguida recibe 429", async () => {
    const user = await registerAndLogin();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await fn(
            "change-password",
            { current_password: "Mala-Clave-000!", new_password: NEW_PASSWORD },
            { token: user.token },
          )
        ).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("desactivar SIN anonimizar conserva direcciones y datos fiscales (invisibles para la cuenta); no se puede volver a entrar", async () => {
    const user = await registerAndLogin({ name: "Se Va" });
    await rest("POST", "addresses", user.token, address(user.id, { recipient: "Se Va" }));
    await rest("POST", "tax_profiles", user.token, tax(user.id, { legal_name: "Se Va" }));
    const res = await fn(
      "deactivate-account",
      { password: user.password, anonymize: false },
      { token: user.token },
    );
    expect(res.status).toBe(200);
    expect((await login(user.email!, user.password)).status).toBe(401);
    const kept = await svcRest(
      "GET",
      `addresses?profile_id=eq.${user.id}&select=recipient,line1,archived_at`,
    );
    expect((kept.body as any[])[0]).toMatchObject({
      recipient: "Se Va",
      line1: "Calle Uno 123",
      archived_at: null,
    });
    expect(
      (
        (await svcRest("GET", `tax_profiles?profile_id=eq.${user.id}&select=legal_name`))
          .body as any[]
      )[0].legal_name,
    ).toBe("Se Va");
  });

  it("desactivar CON anonimización borra todo dato personal (direcciones, pin y fiscales) pero conserva los registros archivados", async () => {
    const user = await registerAndLogin({ name: "Se Anonimiza" });
    // (PostgREST exige que todos los objetos de un alta masiva lleven las mismas claves)
    const created = await rest("POST", "addresses", user.token, [
      address(user.id, {
        recipient: "Se Anonimiza",
        lat: -16.5,
        lng: -68.15,
        reference_text: "casa azul",
      }),
      address(user.id, {
        label: "Otra",
        recipient: "Se Anonimiza",
        lat: null,
        lng: null,
        reference_text: null,
      }),
    ]);
    expect(created.status).toBe(201);
    await rest(
      "POST",
      "tax_profiles",
      user.token,
      tax(user.id, { legal_name: "Se Anonimiza SRL", doc_number: "9876543" }),
    );
    const res = await fn(
      "deactivate-account",
      { password: user.password, anonymize: true },
      { token: user.token },
    );
    expect(res.status).toBe(200);
    const addr = (
      await svcRest(
        "GET",
        `addresses?profile_id=eq.${user.id}&select=recipient,phone_e164,line1,lat,lng,reference_text,is_default,archived_at`,
      )
    ).body as any[];
    expect(addr.length).toBe(2); // nada se borró
    for (const row of addr) {
      expect(row).toMatchObject({
        recipient: "Anonimizado",
        phone_e164: null,
        line1: "—",
        lat: null,
        lng: null,
        reference_text: null,
        is_default: false,
      });
      expect(row.archived_at).not.toBeNull();
    }
    const fiscal = (
      await svcRest(
        "GET",
        `tax_profiles?profile_id=eq.${user.id}&select=legal_name,doc_number,archived_at`,
      )
    ).body as any[];
    expect(fiscal).toHaveLength(1);
    expect(fiscal[0]).toMatchObject({ legal_name: "Anonimizado", doc_number: "000" });
    expect(fiscal[0].archived_at).not.toBeNull();
    const prof = (
      await svcRest("GET", `profiles?id=eq.${user.id}&select=full_name,email,phone_e164,is_active`)
    ).body as any[];
    expect(prof[0]).toMatchObject({
      full_name: "Cliente anonimizado",
      email: null,
      phone_e164: null,
      is_active: false,
    });
  });

  it("política de reactivación (hoy): una cuenta desactivada SIN anonimizar sigue ocupando su email (registrarse de nuevo da el 409 uniforme); anonimizada lo libera", async () => {
    const kept = await registerAndLogin();
    expect(
      (
        await fn(
          "deactivate-account",
          { password: kept.password, anonymize: false },
          { token: kept.token },
        )
      ).status,
    ).toBe(200);
    const again = await register({
      full_name: "Otra vez",
      email: kept.email,
      password: kept.password,
    });
    expect(again.status).toBe(409);
    expect((again.body as any).error.code).toBe("register_failed");

    const freed = await registerAndLogin();
    expect(
      (
        await fn(
          "deactivate-account",
          { password: freed.password, anonymize: true },
          { token: freed.token },
        )
      ).status,
    ).toBe(200);
    const reborn = await register({
      full_name: "Nueva persona",
      email: freed.email,
      password: freed.password,
    });
    expect(reborn.status).toBe(201);
    expect((await login(freed.email!, freed.password)).status).toBe(200);
  });

  it("la contraseña es obligatoria para desactivar", async () => {
    const user = await registerAndLogin();
    const wrong = await fn(
      "deactivate-account",
      { password: "Mala-Clave-000!", anonymize: true },
      { token: user.token },
    );
    expect(wrong.status).toBe(401);
    expect(
      ((await svcRest("GET", `profiles?id=eq.${user.id}&select=is_active`)).body as any[])[0]
        .is_active,
    ).toBe(true);
  });
});

describe("ajuste tax_id_validation (HTTP real)", () => {
  it("el admin lo cambia entre strict y lenient; otro valor se rechaza; un cliente no puede editarlo", async () => {
    const adminUser = await registerAndLogin({ name: "Admin Ajustes" });
    await svcRpc("promote_admin", { p_email: adminUser.email });
    const customer = await registerAndLogin();
    try {
      expect(
        (
          await rest("PATCH", "store_settings?key=eq.tax_id_validation", adminUser.token, {
            value: "lenient",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await rest("PATCH", "store_settings?key=eq.tax_id_validation", adminUser.token, {
            value: "raro",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await rest("PATCH", "store_settings?key=eq.tax_id_validation", customer.token, {
            value: "strict",
          })
        ).body,
      ).toEqual([]);
      expect(
        (
          (await svcRest("GET", "store_settings?key=eq.tax_id_validation&select=value"))
            .body as any[]
        )[0].value,
      ).toBe("lenient");
    } finally {
      await svcRest("PATCH", "store_settings?key=eq.tax_id_validation", { value: "strict" });
    }
  });
});

describe("arreglos de la revisión independiente (Edge Functions + GoTrue real)", () => {
  const NEW_PASSWORD = "Montaña-Azul-2027!";

  it("set-password SOLO acepta la sesión del enlace de recuperación: con un token de inicio de sesión normal → 403 y la contraseña no cambia", async () => {
    const user = await registerAndLogin();
    const res = await fn("set-password", { password: NEW_PASSWORD }, { token: user.token });
    expect(res.status).toBe(403);
    expect((res.body as any).error.code).toBe("recovery_required");
    expect((await login(user.email!, user.password)).status).toBe(200); // sigue la de antes
    expect((await login(user.email!, NEW_PASSWORD)).status).toBe(401);
  });

  it("set-password con el enlace de recuperación SÍ funciona: cierra TODAS las sesiones (incluida la del enlace) y entrega una nueva", async () => {
    const user = await registerAndLogin();
    const other = (await login(user.email!, user.password)).body.session; // otra sesión (otro equipo)
    const recovery = await recoverySession(user.email!);
    const res = await fn("set-password", { password: NEW_PASSWORD }, { token: recovery.access });
    expect(res.status).toBe(200);
    expect((await refreshSession(other.refresh_token)).status).toBeGreaterThanOrEqual(400); // revocada
    expect((await refreshSession(user.refresh)).status).toBeGreaterThanOrEqual(400); // la de registerAndLogin también
    expect((await refreshSession(recovery.refresh)).status).toBeGreaterThanOrEqual(400); // y la del enlace
    // la ÚNICA viva es la que entrega el servidor
    const issued = (res.body as any).session;
    expect(issued.access_token).toBeTruthy();
    expect((await refreshSession(issued.refresh_token)).status).toBe(200);
    expect(Number(dbSql(`select count(*) from auth.sessions where user_id = '${user.id}'`))).toBe(
      1,
    );
    expect((await login(user.email!, NEW_PASSWORD)).status).toBe(200);
  });

  it("change-password cierra TODAS las sesiones (una robada o abierta en otro equipo) y entrega una nueva a quien cambió la contraseña", async () => {
    const user = await registerAndLogin();
    const stolen = (await login(user.email!, user.password)).body.session;
    const res = await fn(
      "change-password",
      { current_password: user.password, new_password: NEW_PASSWORD },
      { token: user.token },
    );
    expect(res.status).toBe(200);
    expect((await refreshSession(stolen.refresh_token)).status).toBeGreaterThanOrEqual(400);
    expect((await refreshSession(user.refresh)).status).toBeGreaterThanOrEqual(400); // incluso la desde la que se cambió
    const issued = (res.body as any).session;
    expect(issued.access_token).toBeTruthy();
    expect((await refreshSession(issued.refresh_token)).status).toBe(200); // la nueva sí sirve
    expect(Number(dbSql(`select count(*) from auth.sessions where user_id = '${user.id}'`))).toBe(
      1,
    );
  });

  it("confirmar con la contraseña NO deja sesiones fantasma: tras update-contact y un intento fallido la cuenta sigue con UNA sola sesión; tras change-password, con la nueva", async () => {
    const user = await registerAndLogin();
    const sessions = () =>
      Number(dbSql(`select count(*) from auth.sessions where user_id = '${user.id}'`));
    expect(sessions()).toBe(1); // la del inicio de sesión
    await fn(
      "update-contact",
      { password: user.password, phone: uniquePhone() },
      { token: user.token },
    );
    expect(sessions()).toBe(1);
    await fn(
      "update-contact",
      { password: "Mala-Clave-000!", phone: uniquePhone() },
      { token: user.token },
    );
    expect(sessions()).toBe(1);
    await fn(
      "change-password",
      { current_password: user.password, new_password: NEW_PASSWORD },
      { token: user.token },
    );
    expect(sessions()).toBe(1); // se cerraron todas y se abrió la nueva
  });

  it("anonimizar borra también lo que GoTrue guarda: nombre y teléfono de raw_user_meta_data y los eventos con el email y el nombre reales", async () => {
    const user = await registerAndLogin({ name: "Persona Con Nombre" });
    await fn(
      "update-contact",
      { password: user.password, phone: uniquePhone() },
      { token: user.token },
    );
    expect(
      dbSql(`select raw_user_meta_data ? 'full_name' from auth.users where id = '${user.id}'`),
    ).toBe("t");
    // En la nube GoTrue NO guarda sus eventos en `auth.audit_log_entries` (la tabla queda vacía), así que se inserta uno
    // sintético con la forma del que escribe GoTrue (`actor_id`, email y nombre reales), para comprobar que se limpia.
    dbExec(
      `insert into auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
               json_build_object('action', 'login', 'actor_id', '${user.id}', 'actor_username', '${user.email}', 'actor_name', 'Persona Con Nombre', 'log_type', 'account'), now(), '')`,
    );
    expect(
      Number(
        dbSql(
          `select count(*) from auth.audit_log_entries where payload::text like '%${user.email}%'`,
        ),
      ),
    ).toBeGreaterThan(0);

    const res = await fn(
      "deactivate-account",
      { password: user.password, anonymize: true },
      { token: user.token },
    );
    expect(res.status).toBe(200);
    expect(
      dbSql(
        `select raw_user_meta_data ?| array['full_name','phone_e164','name'] from auth.users where id = '${user.id}'`,
      ),
    ).toBe("f");
    // Ni el email real ni el nombre quedan en ningún evento. (El propio evento de la anonimización solo trae el correo
    // genérico «deleted-…» y el id: no es un dato personal.)
    expect(
      Number(
        dbSql(
          `select count(*) from auth.audit_log_entries where payload::text like '%${user.email}%' or payload::text like '%Persona Con Nombre%'`,
        ),
      ),
    ).toBe(0);
    expect(
      Number(
        dbSql(
          `select count(*) from auth.audit_log_entries where payload::text like '%actor_name%' and payload::text like '%${user.id}%'`,
        ),
      ),
    ).toBe(0);
    expect(dbSql(`select email from auth.users where id = '${user.id}'`)).toMatch(
      /^deleted-.*@deleted\.madeinchola\.invalid$/,
    );
    expect(
      dbSql(`select identity_data::text from auth.identities where user_id = '${user.id}'`),
    ).not.toContain(user.email!);
  });

  it("update-contact: el límite NO se reinicia con los éxitos (5 cambios seguidos y el 6.º → 429), para que sondear emails ajenos no tenga ritmo libre", async () => {
    const user = await registerAndLogin();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await fn(
            "update-contact",
            { password: user.password, phone: uniquePhone() },
            { token: user.token },
          )
        ).status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("update-contact: dos cambios SIMULTÁNEOS del mismo cliente (email y teléfono) nunca dan error 500 ni dejan el perfil y Auth desalineados", async () => {
    for (let round = 0; round < 4; round++) {
      const user = await registerAndLogin();
      const nextEmail = uniqueEmail("carrera");
      const nextPhone = uniquePhone();
      const [a, b] = await Promise.all([
        fn("update-contact", { password: user.password, email: nextEmail }, { token: user.token }),
        fn("update-contact", { password: user.password, phone: nextPhone }, { token: user.token }),
      ]);
      expect(
        [a.status, b.status].every((status) => status === 200 || status === 409),
        `ronda ${round}: ${a.status}/${b.status}`,
      ).toBe(true);
      for (const response of [a, b]) {
        if (response.status === 409)
          expect((response.body as any).error.code).toBe("contact_update_conflict");
      }
      const profile = (
        (await svcRest("GET", `profiles?id=eq.${user.id}&select=email,phone_e164`)).body as any[]
      )[0];
      // Lo que quedó en el perfil es lo que sirve para entrar: Auth y perfil coinciden
      expect(
        (await login(profile.email, user.password)).status,
        `ronda ${round}: entrar con el email del perfil`,
      ).toBe(200);
      if (profile.phone_e164)
        expect((await login(profile.phone_e164, user.password)).status).toBe(200);
      await clearRateLimits();
    }
  });
});

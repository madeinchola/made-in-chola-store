import { beforeEach, describe, expect, it } from "vitest";
import { checkPasswordPwned } from "../../supabase/functions/_shared/pwned";
import {
  authApi,
  clearRateLimits,
  fn,
  jwtSub,
  localEnv,
  login,
  mailpitMessageText,
  mailpitMessagesTo,
  register,
  registerAndLogin,
  rest,
  rpc,
  STRONG_PASSWORD,
  svcRest,
  svcRpc,
  uniqueEmail,
  uniquePhone,
} from "../../test-support/api";

// Integración REAL: Edge Functions + GoTrue + Postgres locales. Cada test parte con los contadores limpios.
beforeEach(async () => {
  await clearRateLimits();
});

const stripCorrelation = (body: any) =>
  JSON.stringify({ ...body, error: { ...body.error, correlationId: "-" } });

describe("registro e inicio de sesión", () => {
  it("registra con email e inicia sesión con mayúsculas y espacios; el perfil queda como customer", async () => {
    const email = uniqueEmail("ana");
    const reg = await register({
      full_name: "Ana Pérez",
      email: `  ${email.toUpperCase()}  `,
      password: STRONG_PASSWORD,
    });
    expect(reg.status).toBe(201);
    const res = await login(` ${email} `, STRONG_PASSWORD);
    expect(res.status).toBe(200);
    const token = res.body.session.access_token as string;
    const profiles = await rest("GET", "profiles?select=full_name,email,role,is_active", token);
    expect(profiles.body).toEqual([
      { full_name: "Ana Pérez", email, role: "customer", is_active: true },
    ]);
  });

  it("registra SOLO con teléfono y el mismo número en formatos distintos entra a la MISMA cuenta", async () => {
    const phone = uniquePhone();
    const first = await registerAndLogin({ phone });
    const formats = [
      phone,
      `0${phone}`,
      `+591 ${phone.slice(0, 4)}-${phone.slice(4)}`,
      `591${phone}`,
      `(591) ${phone}`,
      `00591${phone}`,
    ];
    for (const f of formats) {
      const res = await login(f, STRONG_PASSWORD);
      expect(res.status, `formato "${f}"`).toBe(200);
      expect(jwtSub(res.body.session.access_token)).toBe(first.id);
    }
    const profile = await rest("GET", "profiles?select=email,phone_e164", first.token);
    expect(profile.body).toEqual([{ email: null, phone_e164: `+591${phone}` }]);
  });

  it("cuenta con email Y teléfono: ambos identificadores entran al mismo usuario", async () => {
    const email = uniqueEmail("doble");
    const phone = uniquePhone();
    const a = await registerAndLogin({ email, phone });
    const byPhone = await login(phone, STRONG_PASSWORD);
    expect(jwtSub(byPhone.body.session.access_token)).toBe(a.id);
  });

  it("la sesión devuelta es utilizable y refrescable", async () => {
    const u = await registerAndLogin();
    const refreshed = await authApi("POST", "token?grant_type=refresh_token", {
      body: { refresh_token: u.refresh },
    });
    expect(refreshed.status).toBe(200);
    expect(jwtSub(refreshed.body.access_token)).toBe(u.id);
  });
});

describe("registro: validaciones", () => {
  it.each([
    [
      "sin identificador",
      { full_name: "X", password: STRONG_PASSWORD },
      400,
      "identifier_required",
    ],
    [
      "email inválido",
      { full_name: "X", email: "no-es-email", password: STRONG_PASSWORD },
      400,
      "invalid_email",
    ],
    [
      "email con dominio reservado .invalid",
      { full_name: "X", email: "a@phone.madeinchola.invalid", password: STRONG_PASSWORD },
      400,
      "invalid_email",
    ],
    [
      "teléfono inválido",
      { full_name: "X", phone: "123", password: STRONG_PASSWORD },
      400,
      "invalid_phone",
    ],
    [
      "teléfono boliviano que no es celular",
      { full_name: "X", phone: "22123456", password: STRONG_PASSWORD },
      400,
      "invalid_phone",
    ],
    [
      "nombre vacío",
      { full_name: "   ", email: "ok@prueba.test", password: STRONG_PASSWORD },
      400,
      "validation",
    ],
    [
      "nombre larguísimo",
      { full_name: "x".repeat(500), email: "ok@prueba.test", password: STRONG_PASSWORD },
      400,
      "validation",
    ],
  ])("%s → %i %s", async (_n, body, status, code) => {
    const res = await register(body as Record<string, unknown>);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });

  it("rechaza JSON roto (400) y métodos distintos de POST (405)", async () => {
    const env = localEnv();
    const broken = await fetch(`${env.url}/functions/v1/register`, {
      method: "POST",
      headers: { apikey: env.anon, "Content-Type": "application/json" },
      body: "{no",
    });
    expect(broken.status).toBe(400);
    const get = await fetch(`${env.url}/functions/v1/register`, {
      method: "GET",
      headers: { apikey: env.anon },
    });
    expect(get.status).toBe(405);
  });

  it.each([
    ["muy corta", "Ab1!", "too_short"],
    ["común", "password123", "common"],
    ["común con mayúscula y símbolo", "Contraseña2024!", "common"],
    ["secuencial", "12345678", "sequential"],
    ["repetitiva", "aaaaaaaaaa", "repetitive"],
  ])("contraseña %s → weak_password con '%s' en failures", async (_n, password, failure) => {
    const res = await register({ full_name: "X", email: uniqueEmail(), password });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("weak_password");
    expect(res.body.error.failures).toContain(failure);
  });

  it("contraseña que contiene el usuario del email → rechazada", async () => {
    const res = await register({
      full_name: "X",
      email: "marcelo.quispe@prueba.test",
      password: "MarceloQuispe-77",
    });
    expect(res.body.error.failures).toContain("contains_identifier");
  });

  it("contraseña filtrada públicamente (HIBP real) → pwned_password", async () => {
    // Si HIBP no responde, ESTE test falla a propósito: no podemos afirmar nada sobre el chequeo.
    const candidate = "Qazwsx123456";
    const probe = await checkPasswordPwned(candidate);
    expect(
      probe.unavailable,
      "HIBP inaccesible: no se puede verificar el chequeo de filtraciones",
    ).toBe(false);
    expect(probe.pwned, "el candidato debería figurar en HIBP").toBe(true);
    const res = await register({ full_name: "X", email: uniqueEmail(), password: candidate });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("pwned_password");
  });

  it("identificador duplicado (email con otro case / teléfono con otro formato) → mismo 409 uniforme", async () => {
    const email = uniqueEmail("dup");
    const phone = uniquePhone();
    await register({ full_name: "Original", email, phone, password: STRONG_PASSWORD });
    const dupEmail = await register({
      full_name: "Otro",
      email: email.toUpperCase(),
      password: STRONG_PASSWORD,
    });
    const dupPhone = await register({
      full_name: "Otro",
      phone: `+591 ${phone}`,
      password: STRONG_PASSWORD,
    });
    expect([dupEmail.status, dupPhone.status]).toEqual([409, 409]);
    expect(stripCorrelation(dupEmail.body)).toBe(stripCorrelation(dupPhone.body));
    expect(dupEmail.body.error.code).toBe("register_failed");
    const count = await svcRest(
      "GET",
      `profiles?select=id&or=(email.eq.${email},phone_e164.eq.%2B591${phone})`,
    );
    expect(count.body).toHaveLength(1);
  });

  it("registro simultáneo con el mismo identificador (carrera) → exactamente UNA cuenta", async () => {
    const email = uniqueEmail("carrera");
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        register({ full_name: "Carrera", email, password: STRONG_PASSWORD }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const rows = await svcRest("GET", `profiles?select=id&email=eq.${email}`);
    expect(rows.body).toHaveLength(1);
  });

  it("rate limit de registro por IP: el 6.º intento en la ventana → 429 con Retry-After", async () => {
    const codes: number[] = [];
    let last: Awaited<ReturnType<typeof register>> | undefined;
    for (let i = 0; i < 6; i++) {
      last = await register({ full_name: "X", email: "no-valido", password: STRONG_PASSWORD }); // falla validación pero cuenta
      codes.push(last.status);
    }
    expect(codes).toEqual([400, 400, 400, 400, 400, 429]);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(last!.body.error.code).toBe("rate_limited");
  });
});

describe("login: mensajes uniformes y rate limit", () => {
  it("usuario inexistente, contraseña incorrecta, teléfono inexistente e identificador mal formado → RESPUESTA IDÉNTICA", async () => {
    const u = await registerAndLogin();
    const responses = await Promise.all([
      login(u.identifier, "otra-clave-incorrecta"),
      login(uniqueEmail("fantasma"), STRONG_PASSWORD),
      login(uniquePhone(), STRONG_PASSWORD),
      login("%%% no es nada %%%", STRONG_PASSWORD),
    ]);
    for (const r of responses) expect(r.status).toBe(401);
    const bodies = new Set(responses.map((r) => stripCorrelation(r.body)));
    expect(bodies.size).toBe(1);
    expect(JSON.parse([...bodies][0]!).error.code).toBe("invalid_credentials");
  });

  it("timing: un usuario inexistente NO responde mucho más rápido que una contraseña incorrecta", async () => {
    const u = await registerAndLogin();
    const time = async (identifier: () => string) => {
      const samples: number[] = [];
      for (let i = 0; i < 10; i++) {
        await clearRateLimits();
        const t0 = performance.now();
        await login(identifier(), "clave-incorrecta-123");
        samples.push(performance.now() - t0);
      }
      return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
    };
    await login("warm@up.test", "x"); // calienta la función
    const wrong = await time(() => u.identifier);
    const ghost = await time(() => uniqueEmail("ghost"));
    // Fuga clara = un camino hace bcrypt (~50-100 ms) y el otro no. Tolerancia amplia contra ruido de CI.
    expect(
      ghost / wrong,
      `inexistente ${ghost.toFixed(0)} ms vs incorrecta ${wrong.toFixed(0)} ms`,
    ).toBeGreaterThan(0.6);
    expect(ghost / wrong).toBeLessThan(1.7);
  });

  it("el intento N+1 en la ventana se rechaza (429), aun con la contraseña correcta", async () => {
    const u = await registerAndLogin();
    await clearRateLimits();
    for (let i = 0; i < 5; i++)
      expect((await login(u.identifier, `mala-${i}-xxxx`)).status).toBe(401);
    const blocked = await login(u.identifier, u.password);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.body.session).toBeUndefined();
  });

  it("el bloqueo es idéntico para identificadores que NO existen (no revela existencia)", async () => {
    const ghost = uniqueEmail("ghost");
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await login(ghost, `mala-${i}-xxxx`)).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("el bloqueo es por identificador: otra cuenta sigue entrando", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    await clearRateLimits();
    for (let i = 0; i < 6; i++) await login(a.identifier, `mala-${i}-xxxx`);
    expect((await login(a.identifier, a.password)).status).toBe(429);
    expect((await login(b.identifier, b.password)).status).toBe(200);
  });

  it("un login exitoso reinicia el contador del identificador", async () => {
    const u = await registerAndLogin();
    await clearRateLimits();
    for (let i = 0; i < 3; i++) await login(u.identifier, `mala-${i}-xxxx`);
    expect((await login(u.identifier, u.password)).status).toBe(200);
    for (let i = 0; i < 5; i++)
      expect((await login(u.identifier, `mala-${i}-xxxx`)).status).toBe(401);
  });

  it("la respuesta de login nunca expone el email de Auth de un teléfono", async () => {
    const phone = uniquePhone();
    await registerAndLogin({ phone });
    const ok = await login(phone, STRONG_PASSWORD);
    const bad = await login(phone, "mala-clave-xxxx");
    for (const r of [ok, bad])
      expect(JSON.stringify(r.body)).not.toMatch(/phone\.madeinchola\.invalid|@/);
  });
});

describe("seguridad de la API de Auth y de los permisos", () => {
  it("el registro directo en GoTrue está CERRADO (solo se crea cuenta vía `register`)", async () => {
    const res = await authApi("POST", "signup", {
      body: { email: uniqueEmail("bypass"), password: STRONG_PASSWORD },
    });
    expect(res.status).toBe(422);
    expect(res.body.error_code).toBe("signup_disabled");
  });

  it("la API admin de Auth no acepta la anon key ni el JWT de un cliente", async () => {
    const u = await registerAndLogin();
    expect([401, 403]).toContain(
      (await authApi("GET", "admin/users", { token: localEnv().anon })).status,
    );
    expect([401, 403]).toContain((await authApi("GET", "admin/users", { token: u.token })).status);
  });

  it("ESCALADA: un cliente no puede hacerse admin (PATCH directo, user_metadata ni RPCs)", async () => {
    const u = await registerAndLogin();
    const patch = await rest("PATCH", `profiles?id=eq.${u.id}`, u.token, { role: "admin" });
    expect([401, 403]).toContain(patch.status);
    // user_metadata es editable por el propio usuario: NO debe tener efecto sobre el rol.
    await authApi("PUT", "user", { token: u.token, body: { data: { role: "admin" } } });
    expect((await rpc("is_admin", {}, u.token)).body).toBe(false);
    expect((await rest("GET", "profiles?select=role", u.token)).body).toEqual([
      { role: "customer" },
    ]);
    for (const name of ["promote_admin", "set_user_role"]) {
      const res = await rpc(name, { p_email: "x@x.com", p_id: u.id, p_role: "admin" }, u.token);
      expect([401, 403, 404]).toContain(res.status);
    }
    expect((await rpc("promote_admin", { p_email: "x@x.com" })).status).toBeGreaterThanOrEqual(401); // anon
  });

  it("un cliente no ve perfiles ajenos ni audit_log; anon no ve nada", async () => {
    const a = await registerAndLogin();
    await registerAndLogin();
    const mine = await rest("GET", "profiles?select=id", a.token);
    expect(mine.body).toEqual([{ id: a.id }]);
    expect((await rest("GET", "audit_log?select=id", a.token)).body).toEqual([]);
    expect((await rest("GET", "profiles?select=id")).status).toBe(401);
    expect([401, 403]).toContain(
      (await rest("GET", "audit_log?select=id", localEnv().anon)).status,
    );
  });

  it("un cliente edita su nombre pero no su email/teléfono directamente", async () => {
    const u = await registerAndLogin({ name: "Nombre Viejo" });
    const ok = await rest("PATCH", `profiles?id=eq.${u.id}`, u.token, {
      full_name: "Nombre Nuevo",
    });
    expect(ok.status).toBe(200);
    expect(ok.body[0].full_name).toBe("Nombre Nuevo");
    expect([401, 403]).toContain(
      (await rest("PATCH", `profiles?id=eq.${u.id}`, u.token, { email: "otro@x.com" })).status,
    );
  });

  it("promover admin (solo servicio) da acceso a todos los perfiles y al audit_log; degradar lo revoca YA", async () => {
    const admin = await registerAndLogin();
    const other = await registerAndLogin();
    expect((await svcRpc("promote_admin", { p_email: admin.email })).status).toBe(200);
    expect((await rpc("is_admin", {}, admin.token)).body).toBe(true);
    const all = await rest("GET", "profiles?select=id", admin.token);
    expect((all.body as unknown[]).length).toBeGreaterThanOrEqual(2);
    const audit = await rest(
      "GET",
      `audit_log?select=action,diff&table_name=eq.profiles&record_id=eq.${admin.id}&action=eq.UPDATE`,
      admin.token,
    );
    expect(audit.body[0].diff.role).toEqual({ old: "customer", new: "admin" });
    // con otro admin presente, se puede degradar al primero; el MISMO token pierde permisos al instante
    expect((await svcRpc("promote_admin", { p_email: other.email })).status).toBe(200);
    expect(
      (await svcRpc("set_user_role", { p_id: admin.id, p_role: "customer" })).status,
    ).toBeLessThan(300);
    expect((await rpc("is_admin", {}, admin.token)).body).toBe(false);
    expect((await rest("GET", "profiles?select=id", admin.token)).body).toEqual([{ id: admin.id }]);
    // y limpieza: dejar a `other` como customer para no contaminar otros tests (tiene que quedar otro admin: no se puede degradar al último)
  });
});

describe("cambio de email por la API de Auth", () => {
  it("no se puede tomar el email de OTRA cuenta (ni siquiera siendo solo-teléfono)", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const solo = await registerAndLogin({ phone: uniquePhone() });
    for (const user of [b, solo]) {
      const res = await authApi("PUT", "user", { token: user.token, body: { email: a.email } });
      expect(res.status).toBe(422);
      expect(res.body.error_code).toBe("email_exists");
    }
    const profile = await svcRest("GET", `profiles?select=email&id=eq.${b.id}`);
    expect(profile.body).toEqual([{ email: b.email }]);
  });

  it("un cambio de email queda PENDIENTE de confirmación: ni el login ni el perfil cambian antes", async () => {
    const u = await registerAndLogin();
    const nuevo = uniqueEmail("nuevo");
    expect((await authApi("PUT", "user", { token: u.token, body: { email: nuevo } })).status).toBe(
      200,
    );
    await clearRateLimits();
    expect((await login(nuevo, u.password)).status).toBe(401);
    expect((await login(u.email!, u.password)).status).toBe(200);
    expect((await svcRest("GET", `profiles?select=email&id=eq.${u.id}`)).body).toEqual([
      { email: u.email },
    ]);
  });
});

describe("desactivación de cuenta (BR-ACC-07)", () => {
  it("exige la contraseña, desactiva, invalida la sesión y bloquea el login con el mismo mensaje uniforme", async () => {
    const u = await registerAndLogin();
    const wrong = await fn(
      "deactivate-account",
      { password: "incorrecta-xxx" },
      { token: u.token },
    );
    expect(wrong.status).toBe(401);
    expect((await rest("GET", "profiles?select=is_active", u.token)).body).toEqual([
      { is_active: true },
    ]);

    const ok = await fn("deactivate-account", { password: u.password }, { token: u.token });
    expect(ok.status).toBe(200);

    expect((await rest("GET", "profiles?select=id", u.token)).body).toEqual([]); // el JWT vigente ya no lee nada
    const refresh = await authApi("POST", "token?grant_type=refresh_token", {
      body: { refresh_token: u.refresh },
    });
    expect(refresh.status).toBeGreaterThanOrEqual(400); // el baneo impide renovar la sesión
    const again = await login(u.identifier, u.password);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("invalid_credentials");
    const row = await svcRest("GET", `profiles?select=is_active,email&id=eq.${u.id}`);
    expect(row.body).toEqual([{ is_active: false, email: u.email }]); // se conserva la fila
  });

  it("anonimizar elimina la PII, conserva la fila y libera el email para un registro nuevo", async () => {
    const u = await registerAndLogin({ name: "Persona Real" });
    expect(
      (
        await fn(
          "deactivate-account",
          { password: u.password, anonymize: true },
          { token: u.token },
        )
      ).status,
    ).toBe(200);
    const row = await svcRest(
      "GET",
      `profiles?select=full_name,email,phone_e164,is_active,anonymized_at&id=eq.${u.id}`,
    );
    expect(row.body[0]).toMatchObject({
      full_name: "Cliente anonimizado",
      email: null,
      phone_e164: null,
      is_active: false,
    });
    expect(row.body[0].anonymized_at).not.toBeNull();
    const log = await svcRest(
      "GET",
      `audit_log?select=diff&table_name=eq.profiles&record_id=eq.${u.id}`,
    );
    expect(JSON.stringify(log.body)).not.toContain("Persona Real");
    expect(JSON.stringify(log.body)).not.toContain(u.email!);
    expect(
      (await register({ full_name: "Nueva Persona", email: u.email, password: STRONG_PASSWORD }))
        .status,
    ).toBe(201);
  });

  it("sin sesión → 401; el último admin no puede desactivarse", async () => {
    expect((await fn("deactivate-account", { password: "x" })).status).toBe(401);
    // dejar un único admin activo: todos los demás pasan a customer
    const admins = (await svcRest("GET", "profiles?select=id&role=eq.admin")).body as {
      id: string;
    }[];
    const solo = await registerAndLogin();
    await svcRpc("promote_admin", { p_email: solo.email });
    for (const a of admins) await svcRpc("set_user_role", { p_id: a.id, p_role: "customer" });
    const res = await fn("deactivate-account", { password: solo.password }, { token: solo.token });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("last_admin");
    expect((await rpc("is_admin", {}, solo.token)).body).toBe(true);
    // restaurar
    const keep = await registerAndLogin();
    await svcRpc("promote_admin", { p_email: keep.email });
    await svcRpc("set_user_role", { p_id: solo.id, p_role: "customer" });
  });
});

describe("recuperación de contraseña de punta a punta", () => {
  it("respuesta uniforme para cuentas existentes e inexistentes; el correo llega solo al existente", async () => {
    const u = await registerAndLogin();
    const ghost = uniqueEmail("sinCuenta");
    const a = await authApi("POST", "recover", { body: { email: u.email } });
    const b = await authApi("POST", "recover", { body: { email: ghost } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
    await new Promise((r) => setTimeout(r, 1500));
    expect(await mailpitMessagesTo(u.email!)).toHaveLength(1);
    expect(await mailpitMessagesTo(ghost)).toHaveLength(0);
  });

  it("enlace del correo → sesión temporal → set-password (con política) → entra con la nueva y la vieja deja de servir", async () => {
    const u = await registerAndLogin();
    const REDIRECT = "http://localhost:5173/restablecer";
    await authApi("POST", `recover?redirect_to=${encodeURIComponent(REDIRECT)}`, {
      body: { email: u.email },
    });
    let msgs: { ID: string }[] = [];
    for (let i = 0; i < 10 && msgs.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
      msgs = await mailpitMessagesTo(u.email!);
    }
    expect(msgs.length).toBe(1);
    const text = await mailpitMessageText(msgs[0]!.ID);
    const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/
      .exec(text)?.[0]
      ?.replace(/&amp;/g, "&");
    expect(link, "el correo debe traer un enlace de verificación").toBeTruthy();
    const verify = await fetch(link!.replace(/^https?:\/\/[^/]+/, localEnv().url), {
      redirect: "manual",
    });
    const location = verify.headers.get("location") ?? "";
    expect(location).toContain("/restablecer");
    const recoveryToken = new URLSearchParams(location.split("#")[1]).get("access_token");
    expect(recoveryToken).toBeTruthy();

    const weak = await fn("set-password", { password: "12345678" }, { token: recoveryToken! });
    expect(weak.status).toBe(400);
    expect(weak.body.error.failures).toContain("sequential");

    const newPassword = "Nuevo-Cielo-Andino-77";
    expect(
      (await fn("set-password", { password: newPassword }, { token: recoveryToken! })).status,
    ).toBe(200);
    await clearRateLimits();
    expect((await login(u.identifier, newPassword)).status).toBe(200);
    expect((await login(u.identifier, u.password)).status).toBe(401);
  });

  it("un redirect_to hacia un dominio ajeno NO se respeta (anti open-redirect / robo del token)", async () => {
    const u = await registerAndLogin();
    await authApi(
      "POST",
      `recover?redirect_to=${encodeURIComponent("https://evil.example/robar")}`,
      { body: { email: u.email } },
    );
    let msgs: { ID: string }[] = [];
    for (let i = 0; i < 10 && msgs.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
      msgs = await mailpitMessagesTo(u.email!);
    }
    const text = await mailpitMessageText(msgs[0]!.ID);
    const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/
      .exec(text)![0]
      .replace(/&amp;/g, "&");
    const location =
      (
        await fetch(link.replace(/^https?:\/\/[^/]+/, localEnv().url), { redirect: "manual" })
      ).headers.get("location") ?? "";
    expect(location).not.toContain("evil.example");
    expect(location).toMatch(/^http:\/\/localhost:5173/);
  });

  it("set-password sin sesión → 401", async () => {
    expect((await fn("set-password", { password: "Nuevo-Cielo-Andino-77" })).status).toBe(401);
  });
});

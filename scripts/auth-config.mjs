#!/usr/bin/env node
// Compara la configuración de Auth del proyecto de Supabase con la LÍNEA BASE de seguridad de Made In Chola (Sprint 16,
// docs/seguridad.md). Solo LEE (una petición GET a la API de gestión) y nunca imprime secretos: muestra únicamente las claves
// de seguridad de la línea base. Necesita SUPABASE_ACCESS_TOKEN en .env.e2e (el mismo que usa el despliegue de funciones).
//   npm run security:auth-config               informe; sale con 1 si algo de la línea base falla
//   npm run security:auth-config -- --launch   además exige lo que solo corresponde al lanzamiento (dominio propio, sin localhost)
import { pathToFileURL } from "node:url";
import { buildCloudEnv } from "./cloud-env.mjs";

const SEVERITY_ORDER = { bloqueante: 0, alto: 1, medio: 2 };

/**
 * Cada regla: la clave de Auth, lo que se espera y por qué importa. `launch: true` = solo cuenta al lanzar (con dominio propio).
 * `test(valor, config)` devuelve true si cumple.
 */
export const BASELINE = [
  {
    key: "disable_signup",
    severity: "bloqueante",
    expected: "true",
    test: (v) => v === true,
    why: "Nadie crea cuentas llamando a Auth directamente: las cuentas nacen solo por la función register (con sus límites y su política de contraseñas).",
  },
  {
    key: "external_anonymous_users_enabled",
    severity: "bloqueante",
    expected: "false",
    test: (v) => v === false,
    why: "Sin sesiones anónimas de Auth: cada sesión pertenece a una persona registrada.",
  },
  {
    key: "mailer_autoconfirm",
    severity: "bloqueante",
    expected: "false",
    test: (v) => v === false,
    why: "Un correo se confirma de verdad antes de dar la cuenta por suya.",
  },
  {
    key: "password_min_length",
    severity: "alto",
    expected: ">= 8",
    test: (v) => typeof v === "number" && v >= 8,
    why: "Piso de longitud también para quien llama a Auth directo (la política completa de la tienda vive en las funciones).",
  },
  {
    key: "refresh_token_rotation_enabled",
    severity: "alto",
    expected: "true",
    test: (v) => v === true,
    why: "Un token de renovación robado deja de servir al usarse el siguiente.",
  },
  {
    key: "jwt_exp",
    severity: "medio",
    expected: "<= 3600 (1 hora)",
    test: (v) => typeof v === "number" && v > 0 && v <= 3600,
    why: "Una sesión robada caduca pronto.",
  },
  {
    key: "security_update_password_require_reauthentication",
    severity: "alto",
    expected: "true",
    test: (v) => v === true,
    why: "Cambiar la contraseña por Auth directo exige haber iniciado sesión hace poco o confirmar de nuevo: con solo un token robado no se toma la cuenta.",
  },
  {
    key: "security_captcha_enabled",
    severity: "alto",
    expected: "true",
    test: (v) => v === true,
    why: "Sin captcha, quien llama a Auth directo puede adivinar contraseñas sin el bloqueo por intentos de la función login (que Auth no tiene).",
  },
  {
    key: "smtp_host",
    severity: "bloqueante",
    expected: "un servidor SMTP propio",
    test: (v) => typeof v === "string" && v.trim() !== "",
    why: "Sin SMTP propio Auth usa el correo de pruebas de Supabase (2 envíos por hora en todo el proyecto): la recuperación de contraseña dejaría de funcionar.",
  },
  {
    key: "rate_limit_email_sent",
    severity: "bloqueante",
    expected: ">= 30 por hora (con SMTP propio)",
    test: (v) => typeof v === "number" && v >= 30,
    why: "El tope de correos de Auth por hora debe alcanzar para las recuperaciones y confirmaciones de un día normal.",
  },
  {
    key: "password_hibp_enabled",
    severity: "medio",
    expected: "true (plan Pro)",
    test: (v) => v === true,
    why: "Auth rechaza contraseñas filtradas también al llamarlo directo (las funciones de la tienda ya lo hacen con Have I Been Pwned).",
  },
  {
    key: "site_url",
    severity: "bloqueante",
    expected: "https y el dominio propio de la tienda (no *.vercel.app)",
    launch: true,
    test: (v) => typeof v === "string" && /^https:\/\//.test(v) && !/\.vercel\.app(\/|$)/.test(v),
    why: "Los enlaces de los correos de Auth apuntan a esta dirección.",
  },
  {
    key: "uri_allow_list",
    severity: "alto",
    expected: "solo https, sin localhost",
    launch: true,
    test: (v) =>
      typeof v === "string" &&
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((u) => /^https:\/\//.test(u) && !/localhost|127\.0\.0\.1/.test(u)),
    why: "Auth solo redirige a direcciones de esta lista: con localhost o http, un enlace de recuperación podría terminar fuera de la tienda.",
  },
];

/** Evalúa una configuración contra la línea base. `launch` activa las reglas que solo cuentan al lanzar. */
export function evaluate(config, { launch = false } = {}) {
  return BASELINE.map((rule) => {
    const actual = config[rule.key];
    const ok = rule.test(actual, config);
    const status = ok ? "ok" : rule.launch && !launch ? "pendiente" : "falla";
    return { ...rule, actual, status };
  });
}

const show = (v) =>
  v === undefined ? "(no existe)" : v === null || v === "" ? "(vacío)" : JSON.stringify(v);

/** Informe en texto; ningún valor fuera de la línea base se imprime. */
export function formatReport(results) {
  const lines = [];
  const mark = { ok: "✔", falla: "✘", pendiente: "·" };
  for (const r of [...results].sort(
    (a, b) =>
      (a.status === "ok") - (b.status === "ok") ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )) {
    lines.push(
      `${mark[r.status]} [${r.severity}] ${r.key} = ${show(r.actual)}  (esperado: ${r.expected})${
        r.status === "ok"
          ? ""
          : `\n    ${r.why}${r.status === "pendiente" ? " — corresponde al lanzamiento (use --launch para exigirlo)" : ""}`
      }`,
    );
  }
  const fails = results.filter((r) => r.status === "falla").length;
  const pending = results.filter((r) => r.status === "pendiente").length;
  lines.push(
    `\n${results.length - fails - pending} de ${results.length} reglas cumplidas, ${fails} fallan, ${pending} pendientes para el lanzamiento.`,
  );
  return lines.join("\n");
}

export async function fetchAuthConfig(env, fetchImpl = fetch) {
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(env.VITE_SUPABASE_URL ?? "")?.[1];
  if (!ref) throw new Error("VITE_SUPABASE_URL no tiene la forma https://<proyecto>.supabase.co");
  if (!env.SUPABASE_ACCESS_TOKEN)
    throw new Error("Falta SUPABASE_ACCESS_TOKEN (archivo .env.e2e).");
  const res = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  });
  if (!res.ok)
    throw new Error(`La API de gestión respondió ${res.status} (¿token vencido o revocado?)`);
  return await res.json();
}

async function main() {
  const launch = process.argv.includes("--launch");
  const config = await fetchAuthConfig(buildCloudEnv());
  const results = evaluate(config, { launch });
  console.log(formatReport(results));
  if (results.some((r) => r.status === "falla")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}

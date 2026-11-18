// Auditoría ESTÁTICA de las funciones de Edge (Sprint 16, docs/seguridad.md): lo que cada función promete en seguridad queda
// escrito aquí como contrato. Si alguien añade una función, cambia su `verify_jwt` o le quita su defensa, este archivo falla
// y obliga a decidirlo a propósito (y a ampliar la tabla de abajo con el motivo).
//
// Qué se comprueba, función por función:
//   · está declarada en supabase/config.toml con el `verify_jwt` esperado (las que no exigen sesión del gateway SE
//     AUTENTICAN SOLAS: con la sesión dentro del código, con un secreto, con la firma del proveedor o por ser públicas con límite);
//   · las públicas tienen límite de frecuencia y leen su cuerpo con tope de tamaño;
//   · las internas (administrador, secreto, firma) llevan la marca de su autenticación ANTES de hacer nada;
//   · todas contestan los errores por `errorResponse` (nunca un error crudo) y nadie escribe `Access-Control-Allow-Origin` a mano.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS = join(root, "supabase", "functions");
const read = (...parts) => readFileSync(join(...parts), "utf8");

/**
 * kind:
 *  - "session": el gateway valida el JWT (verify_jwt = true) y el código vuelve a leer al usuario con getUser();
 *  - "public":  sin sesión obligatoria (visitante o clienta): límite de frecuencia + cuerpo con tope;
 *  - "admin":   el código exige is_admin() con el JWT de quien llama;
 *  - "secret":  solo la clave de servicio (cron/worker), comparada en tiempo constante;
 *  - "signature": firma del proveedor de pagos con un secreto por proveedor.
 */
export const EXPECTED = {
  login: { jwt: false, kind: "public" },
  register: { jwt: false, kind: "public" },
  cart: { jwt: false, kind: "public" },
  checkout: { jwt: false, kind: "public" },
  payments: { jwt: false, kind: "public" },
  complaint: { jwt: false, kind: "public" },
  "legal-accept": { jwt: false, kind: "public" },
  "meta-capi": { jwt: false, kind: "public" },
  "deactivate-account": { jwt: true, kind: "session" },
  "set-password": { jwt: true, kind: "session" },
  "update-contact": { jwt: true, kind: "session" },
  "change-password": { jwt: true, kind: "session" },
  "payment-webhook": { jwt: false, kind: "signature" },
  "payment-reconcile": { jwt: false, kind: "admin" },
  "notify-admin": { jwt: false, kind: "admin" },
  "notify-worker": { jwt: false, kind: "secret" },
};

/** Funciones declaradas en config.toml: { nombre → verify_jwt }. */
export function parseConfig(toml) {
  const found = {};
  for (const m of toml.matchAll(
    /\[functions\.([a-z0-9-]+)\]\s*\n\s*verify_jwt\s*=\s*(true|false)/g,
  )) {
    found[m[1]] = m[2] === "true";
  }
  return found;
}

const dirs = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_shared")
  .map((d) => d.name)
  .sort();
/** La llamada que pregunta a la base si quien llama es administrador (el nombre exacto de la función, no un parecido). */
const IS_ADMIN_CALL = /rpc\(\s*["']is_admin["']/;
const source = (name) => read(FUNCTIONS, name, "index.ts");
/** Usa el límite de frecuencia: aparece la importación Y al menos un uso (llamado o entregado como dependencia). */
export const usesRateLimit = (code) => (code.match(/enforceRateLimit\b/g) ?? []).length >= 2;
const config = parseConfig(read(root, "supabase", "config.toml"));

/** Archivos .ts de producción (sin pruebas) de supabase/functions, con su texto. */
function productionFiles(dir = FUNCTIONS) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      out.push([path, read(path)]);
  }
  return out;
}

describe("parseConfig", () => {
  it("lee el verify_jwt de cada función y no confunde otras secciones", () => {
    const toml = `[api]\nport = 1\n\n[functions.login]\nverify_jwt = false\n\n[functions.set-password]\n# comentario\nverify_jwt = true\n\n[auth]\nverify_jwt = false\n`;
    expect(parseConfig(toml)).toEqual({ login: false });
  });

  it("acepta un comentario entre la sección y la clave solo si no hay otra sección en medio (comportamiento actual)", () => {
    expect(parseConfig("[functions.x]\nverify_jwt = true\n")).toEqual({ x: true });
  });
});

describe("usesRateLimit", () => {
  it("exige la importación y un uso: solo importar no cuenta; llamarlo o pasarlo como dependencia sí", () => {
    const imported = 'import { enforceRateLimit } from "../_shared/rate-limit.ts";';
    expect(usesRateLimit("")).toBe(false);
    expect(usesRateLimit(imported)).toBe(false);
    expect(usesRateLimit(`${imported}\nawait enforceRateLimit(a, b);`)).toBe(true);
    expect(usesRateLimit(`${imported}\nrun({ limit: enforceRateLimit });`)).toBe(true);
  });
});

describe("las funciones de Edge del repositorio", () => {
  it("las carpetas de supabase/functions son exactamente las de la tabla (una función nueva se declara aquí a propósito)", () => {
    expect(dirs).toEqual(Object.keys(EXPECTED).sort());
  });

  it("config.toml declara cada función con el verify_jwt esperado, y ninguna de más", () => {
    expect(config).toEqual(
      Object.fromEntries(Object.entries(EXPECTED).map(([name, e]) => [name, e.jwt])),
    );
  });

  it("solo una lista cerrada de funciones puede llamarse SIN sesión del gateway (verify_jwt = false)", () => {
    expect(
      Object.entries(config)
        .filter(([, jwt]) => !jwt)
        .map(([name]) => name)
        .sort(),
    ).toEqual(
      [
        "cart",
        "checkout",
        "complaint",
        "legal-accept",
        "login",
        "meta-capi",
        "notify-admin",
        "notify-worker",
        "payment-reconcile",
        "payment-webhook",
        "payments",
        "register",
      ].sort(),
    );
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    describe(name, () => {
      const code = () => source(name);

      it("contesta los errores con errorResponse y no escribe CORS a mano", () => {
        expect(code()).toContain("errorResponse(");
        expect(code()).not.toMatch(/Access-Control-Allow-Origin/i);
      });

      if (expected.kind === "session") {
        it("vuelve a leer al usuario con getUser() (no se fía solo del gateway)", () => {
          expect(code()).toMatch(/auth\.getUser\(/);
        });
      }

      if (expected.kind === "public" || expected.kind === "session") {
        it("lleva límite de frecuencia", () => {
          expect(usesRateLimit(code())).toBe(true);
        });
        it("lee el cuerpo con tope de tamaño (parseBody tiene 16 KiB por omisión; parseBodyLimited, el suyo) y nunca con req.json()", () => {
          expect(code()).toMatch(/parseBody(Limited)?\(/);
          expect(code()).not.toMatch(/req\.json\(/);
        });
      }

      if (expected.kind === "admin") {
        it("exige is_admin() con el JWT de quien llama y tiene límite de frecuencia", () => {
          expect(code()).toMatch(IS_ADMIN_CALL);
          expect(usesRateLimit(code())).toBe(true);
          // la autenticación va ANTES de leer el cuerpo
          const auth = code().search(IS_ADMIN_CALL);
          const body = code().search(/req\.json\(|parseBody/);
          if (body !== -1) expect(auth).toBeLessThan(body);
        });
      }

      if (expected.kind === "secret") {
        it("compara la clave de servicio en tiempo constante ANTES de leer el cuerpo", () => {
          expect(code()).toMatch(/timingSafeEqual\(/);
          expect(code().search(/timingSafeEqual\(token/)).toBeLessThan(
            code().search(/req\.json\(/),
          );
          expect(code()).toMatch(/403/);
        });
      }

      if (expected.kind === "signature") {
        it("verifica la firma con un secreto por proveedor (PAYMENT_WEBHOOK_SECRET_*) y tiene límite", () => {
          expect(code()).toMatch(/PAYMENT_WEBHOOK_SECRET_/);
          expect(usesRateLimit(code())).toBe(true);
        });
      }
    });
  }

  it("la clave de servicio solo se lee en el cliente de servicio, en el cron autenticado y como llave de huellas", () => {
    const readers = productionFiles()
      .filter(([, text]) =>
        /Deno\.env\.get\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']|required\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']/.test(
          text,
        ),
      )
      .map(([path]) => path.slice(FUNCTIONS.length + 1))
      .sort();
    expect(readers).toEqual(
      [
        "_shared/legal.ts",
        "_shared/supabase.ts",
        "cart/index.ts",
        "complaint/index.ts",
        "notify-worker/index.ts",
      ].sort(),
    );
  });

  it("nadie escribe Access-Control-Allow-Origin fuera de cors.ts, y ahí nunca es «*»", () => {
    for (const [path, text] of productionFiles()) {
      if (path.endsWith(join("_shared", "cors.ts"))) continue;
      expect(text, path).not.toMatch(/Access-Control-Allow-Origin/i);
    }
    const cors = read(FUNCTIONS, "_shared", "cors.ts");
    expect(cors).not.toMatch(/Allow-Origin["']\s*:\s*["']\*/);
    expect(cors).toMatch(/allowedOrigins\.includes\(origin\)/);
  });

  it("ninguna función escribe en consola a mano (todo pasa por el registro que redacta datos personales)", () => {
    for (const [path, text] of productionFiles()) {
      if (path.endsWith(join("_shared", "logger.ts"))) continue; // el propio registro es quien escribe
      expect(text, path).not.toMatch(/console\.(log|error|warn|info|debug)\(/);
    }
  });

  it("ninguna función arma SQL con texto del usuario (todo es .rpc() o .from() con parámetros)", () => {
    for (const [path, text] of productionFiles()) {
      expect(text, path).not.toMatch(/\.query\(\s*[`"'][^`"']*\$\{/);
      expect(text, path).not.toMatch(/sql\s*`|\bpg\.|postgres\(/);
    }
  });
});

#!/usr/bin/env node
// Diccionario de datos (Sprint 16): genera docs/diccionario-datos.md a partir del CATÁLOGO real de la nube (tablas, columnas, claves
// foráneas, quién puede leer y escribir, vistas y funciones). Así nunca se desactualiza: se vuelve a generar y se compara.
//   npm run docs:data-dictionary            escribe docs/diccionario-datos.md
//   npm run docs:data-dictionary -- --check  sale con 1 si el archivo escrito ya no coincide con la base (sin escribir nada)
// Necesita SUPABASE_DB_PASSWORD (.env.e2e) y `psql` (brew install libpq). Solo LEE la base.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCloudEnv } from "./cloud-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "diccionario-datos.md");
const PSQL = process.env.PSQL_BIN ?? "/opt/homebrew/opt/libpq/bin/psql";

/** Una consulta que devuelve UNA fila con un JSON con todo el catálogo de `public` que interesa. */
export const CATALOG_SQL = `
select jsonb_build_object(
  'tables', (select coalesce(jsonb_agg(t order by t.name), '[]') from (
    select c.relname as name, obj_description(c.oid, 'pg_class') as comment, c.relrowsecurity as rls,
      (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
      has_table_privilege('anon', c.oid, 'select') or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('anon', c.oid, a.attnum, 'select')) as anon_read,
      has_table_privilege('authenticated', c.oid, 'select') or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', c.oid, a.attnum, 'select')) as auth_read,
      has_table_privilege('authenticated', c.oid, 'insert') or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', c.oid, a.attnum, 'insert')) as auth_insert,
      has_table_privilege('authenticated', c.oid, 'update') or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', c.oid, a.attnum, 'update')) as auth_update,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull,
          'default', pg_get_expr(d.adbin, d.adrelid),
          'comment', col_description(c.oid, a.attnum),
          'fk', (select cf.relname || '.' || af.attname from pg_constraint k join pg_class cf on cf.oid = k.confrelid
                   join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
                  where k.conrelid = c.oid and k.contype = 'f' and k.conkey = array[a.attnum]::smallint[] limit 1),
          'pk', exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p' and a.attnum = any (k.conkey)),
          'auth_read', has_column_privilege('authenticated', c.oid, a.attnum, 'select')
        ) order by a.attnum), '[]')
         from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  ) t),
  'views', (select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'anon', has_table_privilege('anon', c.oid, 'select'),
      'auth', has_table_privilege('authenticated', c.oid, 'select'), 'invoker', coalesce(c.reloptions, '{}') && array['security_invoker=true']) order by c.relname), '[]')
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')),
  'functions', (select coalesce(jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
      'returns', pg_get_function_result(p.oid), 'secdef', p.prosecdef,
      'who', case when has_function_privilege('anon', p.oid, 'execute') then 'visitante'
                  when has_function_privilege('authenticated', p.oid, 'execute') then 'sesión'
                  when has_function_privilege('service_role', p.oid, 'execute') then 'servicio' else 'interna' end) order by p.proname, p.oid), '[]')
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype and p.prorettype <> 'event_trigger'::regtype)
)::text`;

const esc = (s) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
const short = (s, n = 60) =>
  String(s ?? "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? "");

/** Quién toca la tabla desde el navegador, en una frase. */
export function access(t) {
  const parts = [];
  if (t.anon_read) parts.push("la lee un visitante");
  if (t.auth_read) parts.push("la lee una sesión (filtrada por RLS)");
  if (t.auth_insert) parts.push("una sesión inserta");
  if (t.auth_update) parts.push("una sesión actualiza");
  return parts.length ? parts.join(" · ") : "cerrada al navegador (solo funciones del servidor)";
}

/** Markdown completo a partir del modelo del catálogo. Determinista: mismo modelo, mismo texto. */
export function render(model) {
  const out = [
    "# Diccionario de datos",
    "",
    "> **Generado** por `npm run docs:data-dictionary` desde el catálogo real de la base (no se edita a mano: vuelve a generarlo). `npm run docs:data-dictionary -- --check` falla si este archivo ya no coincide con la base.",
    "",
    `**${model.tables.length} tablas**, ${model.views.length} vistas y ${model.functions.length} funciones en el esquema \`public\`. «Sesión» = una persona con la cuenta iniciada (clienta o administradora; la RLS decide qué filas ve). Nada se borra: el catálogo se archiva y los pedidos y el historial son inmutables.`,
    "",
    "## Tablas",
    "",
    "| Tabla | Columnas | Quién la toca desde el navegador |",
    "| --- | ---: | --- |",
    ...model.tables.map(
      (t) => `| [\`${t.name}\`](#${t.name}) | ${t.columns.length} | ${access(t)} |`,
    ),
    "",
  ];
  for (const t of model.tables) {
    out.push(`### ${t.name}`, "");
    if (t.comment) out.push(t.comment, "");
    out.push(
      `RLS ${t.rls ? "activa" : "**APAGADA**"} · ${t.policies} políticas · ${access(t)}.`,
      "",
      "| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |",
      "| --- | --- | :-: | --- | --- | :-: |",
      ...t.columns.map(
        (c) =>
          `| ${c.pk ? `**${esc(c.name)}**` : esc(c.name)} | ${esc(c.type)} | ${c.notnull ? "no" : "sí"} | ${esc(short(c.default))} | ${esc(c.fk ?? "")} | ${c.auth_read ? "sí" : "no"} |`,
      ),
      "",
    );
  }
  out.push(
    "## Vistas",
    "",
    "| Vista | Visitante | Sesión | Respeta la RLS de quien consulta |",
    "| --- | :-: | :-: | :-: |",
    ...model.views.map(
      (v) =>
        `| \`${v.name}\` | ${v.anon ? "sí" : "no"} | ${v.auth ? "sí" : "no"} | ${v.invoker ? "sí" : "no (filtra por dentro)"} |`,
    ),
    "",
    "## Funciones",
    "",
    "Quién puede llamarlas: **visitante** (sin sesión), **sesión** (clienta o administradora; cada una se autoriza por dentro), **servicio** (solo las funciones de Edge y el cron) o **interna** (solo otras funciones).",
    "",
    "| Función | Argumentos | Devuelve | Permisos del dueño | Quién |",
    "| --- | --- | --- | :-: | --- |",
    ...model.functions.map(
      (f) =>
        `| \`${f.name}\` | ${esc(short(f.args, 90))} | ${esc(short(f.returns, 40))} | ${f.secdef ? "sí" : "no"} | ${f.who} |`,
    ),
    "",
  );
  return out.join("\n");
}

function fetchModel(env) {
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(env.VITE_SUPABASE_URL ?? "")?.[1];
  if (!ref || !env.SUPABASE_DB_PASSWORD)
    throw new Error("Faltan VITE_SUPABASE_URL (.env.local) y SUPABASE_DB_PASSWORD (.env.e2e).");
  const r = spawnSync(PSQL, ["-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", CATALOG_SQL], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: "aws-0-us-east-2.pooler.supabase.com",
      PGPORT: "5432",
      PGUSER: `postgres.${ref}`,
      PGPASSWORD: env.SUPABASE_DB_PASSWORD,
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "30",
    },
  });
  if (r.status !== 0)
    throw new Error(`psql falló: ${(r.stderr || String(r.error)).trim().slice(0, 300)}`);
  return JSON.parse(r.stdout.trim());
}

function main() {
  const check = process.argv.includes("--check");
  const text = render(fetchModel(buildCloudEnv()));
  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (current !== text) {
      console.error(
        "docs/diccionario-datos.md ya no coincide con la base: corre `npm run docs:data-dictionary` y súbelo.",
      );
      process.exitCode = 1;
    } else console.log("El diccionario de datos coincide con la base.");
    return;
  }
  writeFileSync(OUT, text);
  console.log(`Escrito ${OUT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

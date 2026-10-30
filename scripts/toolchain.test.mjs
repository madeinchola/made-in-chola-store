// Guarda contra la mezcla de versiones del CLI de Supabase (causó 500 `42P10` en todas las subidas
// a Storage: el CLI global y el del repo fijan imágenes distintas y `db reset` deja el esquema de
// Storage más nuevo que el servidor que corre). Ver README → "Backend local".
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const pkg = JSON.parse(read("package.json"));

const SUBCOMMANDS = "start|stop|status|functions|db|test|link|gen|secrets|login|projects";

/** Comandos `supabase <sub>` escritos sin `npx`: ejecutarían el CLI GLOBAL (otra versión). */
function bareSupabaseCommands(text) {
  return [
    ...text.matchAll(new RegExp(`(?<!npx )(?<![\\w/@.-])supabase (?:${SUBCOMMANDS})\\b`, "g")),
  ].map((m) => m[0]);
}

/** Versión pedida a `supabase/setup-cli` en un workflow ("latest" si no declara ninguna). */
function setupCliVersions(yml) {
  const lines = yml.split("\n");
  const found = [];
  lines.forEach((line, i) => {
    if (!line.includes("supabase/setup-cli")) return;
    const m = /version:\s*['"]?([\w.^~-]+)/.exec(lines.slice(i + 1, i + 4).join("\n"));
    found.push(m ? m[1] : "latest");
  });
  return found;
}

describe("comprobadores (con textos sintéticos)", () => {
  it("bareSupabaseCommands detecta el CLI sin npx y deja pasar npx, rutas y paquetes", () => {
    expect(
      bareSupabaseCommands("corre `supabase start -x vector` y luego supabase db reset"),
    ).toEqual(["supabase start", "supabase db"]);
    expect(bareSupabaseCommands("npx supabase start")).toEqual([]);
    expect(bareSupabaseCommands("SUPABASE_ACCESS_TOKEN=x npx supabase functions deploy")).toEqual(
      [],
    );
    expect(bareSupabaseCommands("ver supabase/functions/login y @supabase/supabase-js")).toEqual(
      [],
    );
    expect(bareSupabaseCommands("Supabase local (Docker)")).toEqual([]);
  });

  it("setupCliVersions lee la versión, o 'latest' si falta, o nada si no se usa", () => {
    const con = "- uses: supabase/setup-cli@v1\n  with: { version: 2.117.0 }\n- run: x";
    const sin = "- uses: supabase/setup-cli@v1\n- run: supabase start";
    expect(setupCliVersions(con)).toEqual(["2.117.0"]);
    expect(setupCliVersions(sin)).toEqual(["latest"]);
    expect(setupCliVersions("- run: npm ci")).toEqual([]);
  });
});

describe("CLI de Supabase: una sola versión en todo el repo", () => {
  const pinned = pkg.devDependencies.supabase;

  it("package.json lo fija a una versión EXACTA (sin ^, ~ ni rangos)", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("el instalado en node_modules es el fijado", () => {
    const installed = JSON.parse(read("node_modules/supabase/package.json")).version;
    expect(installed).toBe(pinned);
  });

  it("el README no manda a escribir `supabase <comando>` a secas (usa npx o npm run)", () => {
    expect(bareSupabaseCommands(read("README.md"))).toEqual([]);
  });

  it("ningún workflow usa un CLI de otra versión (ni 'latest')", () => {
    const dir = join(root, ".github/workflows");
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      for (const v of setupCliVersions(readFileSync(join(dir, file), "utf8"))) {
        expect(v, `${file} usa supabase/setup-cli ${v}, pero el repo fija ${pinned}`).toBe(pinned);
      }
    }
  });

  it("`npm run dev` arranca Supabase con el script db:start (una sola definición, con sus exclusiones)", () => {
    const dev = read("scripts/dev.mjs");
    expect(dev).toMatch(/\[\s*"run"\s*,\s*"--silent"\s*,\s*"db:start"\s*\]/);
    expect(dev).not.toMatch(/\[\s*"supabase"\s*,\s*"start"\s*\]/);
    expect(pkg.scripts["db:start"]).toContain("-x logflare,vector");
  });

  it("los scripts de npm para el stack local existen (el README los usa en vez del CLI global)", () => {
    for (const s of ["db:start", "db:stop", "db:reset", "db:test", "functions:serve"]) {
      expect(pkg.scripts[s], s).toMatch(/^supabase /);
    }
  });
});

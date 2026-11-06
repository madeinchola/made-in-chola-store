import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { dbExec, dbRunFile } from "../../test-support/api";
import { tapFailures, tapSummary } from "../../test-support/db";

// pgTAP contra la base de la NUBE (sin Docker): cada archivo de `supabase/tests` corre con `psql`. Todos son
// `begin; … rollback;`, así que no dejan datos. Necesitan la extensión `pgtap` (se crea aquí, una vez; se quita en la entrega)
// y SUPABASE_DB_PASSWORD en `.env.e2e`. Ojo: varias aserciones suponen una base vacía o conocida; la nube tiene datos de
// ejemplo y de prueba, así que un fallo puede ser del dato y no del código: se revisa uno por uno.
const DIR = join(process.cwd(), "supabase/tests");
const FILES = readdirSync(DIR)
  .filter((f) => /\.test\.sql$/.test(f))
  .sort();

beforeAll(() => {
  dbExec("create extension if not exists pgtap with schema extensions");
});

describe("pgTAP en la nube", () => {
  it("hay archivos de prueba", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  for (const file of FILES) {
    it(
      file,
      async () => {
        const r = await dbRunFile(join(DIR, file));
        const summary = tapSummary(r.stdout);
        expect(tapFailures(r.stdout), `${file}\n${r.stdout}\n${r.stderr}`).toEqual([]);
        expect(r.status, `${file} terminó con error:\n${r.stderr}`).toBe(0);
        expect(summary.planned, `${file} no declaró un plan (1..N)`).not.toBeNull();
        expect(summary.ok, `${file}: pasaron ${summary.ok} de ${summary.planned}`).toBe(
          summary.planned,
        );
      },
      180_000,
    );
  }
});

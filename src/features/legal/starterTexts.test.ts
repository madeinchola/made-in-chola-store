import { describe, expect, it } from "vitest";
import { parseBlocks, missingVariables } from "./renderLegal";
import { COMPLETE_MARKER, DRAFT_MARKER, STARTER_TEXTS, pendingMarkers } from "./starterTexts";
import { LEGAL_KINDS } from "./types";

const BUSINESS = { razon_social: "x", nit: "x", direccion: "x", correo: "x", telefono: "x" };

describe("textos de partida", () => {
  it.each(LEGAL_KINDS)(
    "«%s» cumple las reglas que la base exige al guardar (20–60 000 caracteres, sin HTML)",
    (kind) => {
      const body = STARTER_TEXTS[kind];
      expect(body.trim().length).toBeGreaterThanOrEqual(20);
      expect(body.length).toBeLessThanOrEqual(60_000);
      // la misma expresión que `admin_legal_save_draft`: una «<» seguida de letra, «/» o «!» se rechaza
      expect(body).not.toMatch(/<[a-zA-Z/!]/);
    },
  );

  it.each(LEGAL_KINDS)(
    "«%s» solo usa variables que existen (ninguna con error de escritura)",
    (kind) => {
      expect(missingVariables(STARTER_TEXTS[kind], BUSINESS)).toEqual([]);
    },
  );

  it.each(LEGAL_KINDS)(
    "«%s» lleva la marca de borrador y no se puede publicar tal cual",
    (kind) => {
      expect(STARTER_TEXTS[kind]).toContain(DRAFT_MARKER);
      expect(pendingMarkers(STARTER_TEXTS[kind])).toContain(DRAFT_MARKER);
    },
  );

  it("los que tienen datos por decidir lo marcan con [COMPLETAR…]", () => {
    for (const kind of ["shipping", "returns"] as const) {
      expect(STARTER_TEXTS[kind]).toContain(COMPLETE_MARKER);
    }
  });

  it.each(LEGAL_KINDS)(
    "«%s» tiene secciones (# → <h2>) y no repite el título de la página",
    (kind) => {
      const blocks = parseBlocks(STARTER_TEXTS[kind]);
      const headings = blocks.filter((b) => b.type === "h");
      expect(headings.length).toBeGreaterThan(3);
      // el <h1> es el título de la página: el texto empieza con la marca de borrador, no con otro título
      expect(blocks[0]).toMatchObject({ type: "p" });
      expect(headings.every((h) => h.level === 1)).toBe(true);
    },
  );

  it("un texto sin marcas no tiene nada pendiente", () => {
    expect(pendingMarkers("Texto final, sin marcas.")).toEqual([]);
  });
});

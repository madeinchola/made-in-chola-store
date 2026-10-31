import { describe, expect, it } from "vitest";
import { changeSummary, diffEntries, entityLabel, formatDiffValue } from "./diff";
import { AUDIT_TABLES, isAuditAction, isAuditTable } from "./tables";
import { es } from "@/i18n/es";

describe("diffEntries: UPDATE", () => {
  it("cada columna cambiada trae {old, new}; orden alfabético", () => {
    expect(
      diffEntries("UPDATE", {
        slug: { old: "a", new: "b" },
        name: { old: "Camisa", new: "Camisa Chola" },
      }),
    ).toEqual([
      { key: "name", kind: "changed", old: "Camisa", new: "Camisa Chola" },
      { key: "slug", kind: "changed", old: "a", new: "b" },
    ]);
  });
  it("una columna con datos personales llega como {changed: true}: no se inventa ningún valor", () => {
    expect(diffEntries("UPDATE", { email: { changed: true } })).toEqual([
      { key: "email", kind: "redacted" },
    ]);
  });
  it("conserva valores nulos y falsos legítimos (old: null, new: false)", () => {
    expect(diffEntries("UPDATE", { is_new: { old: null, new: false } })).toEqual([
      { key: "is_new", kind: "changed", old: null, new: false },
    ]);
  });
  it("una forma inesperada se muestra como valor, sin romper", () => {
    expect(diffEntries("UPDATE", { x: 5, y: { raro: 1 } })).toEqual([
      { key: "x", kind: "value", value: 5 },
      { key: "y", kind: "value", value: { raro: 1 } },
    ]);
  });
});

describe("diffEntries: INSERT y DELETE", () => {
  it("muestran cada columna con su valor", () => {
    expect(diffEntries("INSERT", { name: "Camisa", price: 120 })).toEqual([
      { key: "name", kind: "value", value: "Camisa" },
      { key: "price", kind: "value", value: 120 },
    ]);
    expect(diffEntries("DELETE", { code: "A-1" })).toEqual([
      { key: "code", kind: "value", value: "A-1" },
    ]);
  });
  it('"[redacted]" marca un dato personal', () => {
    expect(diffEntries("INSERT", { full_name: "[redacted]", role: "customer" })).toEqual([
      { key: "full_name", kind: "redacted" },
      { key: "role", kind: "value", value: "customer" },
    ]);
  });
  it("un objeto con la clave 'old' en un INSERT es un valor jsonb normal, no un cambio", () => {
    expect(diffEntries("INSERT", { payload: { old: 1, new: 2 } })).toEqual([
      { key: "payload", kind: "value", value: { old: 1, new: 2 } },
    ]);
  });
});

describe("diffEntries: diff mal formado", () => {
  it.each([null, undefined, "texto", 5, [], [1, 2], true])(
    "%j → sin entradas, sin lanzar",
    (bad) => {
      expect(diffEntries("UPDATE", bad)).toEqual([]);
      expect(diffEntries("INSERT", bad)).toEqual([]);
    },
  );
});

describe("formatDiffValue", () => {
  it("nulo, vacío, booleanos, números y texto", () => {
    expect(formatDiffValue(null)).toBe("—");
    expect(formatDiffValue(undefined)).toBe("—");
    expect(formatDiffValue("")).toBe("(vacío)");
    expect(formatDiffValue(true)).toBe("Sí");
    expect(formatDiffValue(false)).toBe("No");
    expect(formatDiffValue(0)).toBe("0");
    expect(formatDiffValue(12.5)).toBe("12.5");
    expect(formatDiffValue("hola")).toBe("hola");
  });
  it("objetos y arreglos como JSON compacto", () => {
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
    expect(formatDiffValue(["x", 2])).toBe('["x",2]');
  });
  it("corta a 200 caracteres con puntos suspensivos; 200 exactos no se cortan", () => {
    expect(formatDiffValue("a".repeat(200))).toBe("a".repeat(200));
    expect(formatDiffValue("a".repeat(201))).toBe(`${"a".repeat(200)}…`);
    expect(formatDiffValue("😀".repeat(201))).toBe(`${"😀".repeat(200)}…`);
  });
});

describe("entityLabel", () => {
  it("toma el primer dato reconocible, por prioridad", () => {
    expect(entityLabel({ code: "A-1", name: "Camisa" })).toBe("Camisa");
    expect(entityLabel({ code: "A-1", slug: "a" })).toBe("A-1");
    expect(entityLabel({ message: "Envío gratis" })).toBe("Envío gratis");
  });
  it("ignora vacíos y datos personales; null si no hay nada", () => {
    expect(entityLabel({ name: "  ", code: "B" })).toBe("B");
    expect(entityLabel({ name: "[redacted]" })).toBeNull();
    expect(entityLabel({ id: "x", price: 5 })).toBeNull();
    expect(entityLabel(null)).toBeNull();
  });
});

describe("changeSummary", () => {
  it("UPDATE lista hasta 3 columnas y cuenta el resto", () => {
    expect(changeSummary("UPDATE", { name: { old: "a", new: "b" } })).toBe("Cambió: name");
    expect(
      changeSummary("UPDATE", {
        a: { old: 1, new: 2 },
        b: { old: 1, new: 2 },
        c: { old: 1, new: 2 },
        d: { old: 1, new: 2 },
        e: { old: 1, new: 2 },
      }),
    ).toBe("Cambió: a, b, c +2");
  });
  it("en la frontera: 3 columnas no llevan «+», 4 columnas llevan «+1»", () => {
    const col = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i + 1}`, { old: 1, new: 2 }]));
    expect(changeSummary("UPDATE", col(3))).toBe("Cambió: c1, c2, c3");
    expect(changeSummary("UPDATE", col(4))).toBe("Cambió: c1, c2, c3 +1");
  });
  it("UPDATE sin detalle", () => {
    expect(changeSummary("UPDATE", {})).toBe("Modificado");
    expect(changeSummary("UPDATE", null)).toBe("Modificado");
  });
  it("INSERT y DELETE usan el nombre de la fila si lo hay", () => {
    expect(changeSummary("INSERT", { name: "Camisa Chola" })).toBe("Creado: «Camisa Chola»");
    expect(changeSummary("INSERT", { id: "x" })).toBe("Creado");
    expect(changeSummary("DELETE", { code: "A-1" })).toBe("Eliminado: «A-1»");
    expect(changeSummary("DELETE", {})).toBe("Eliminado");
  });
});

describe("tablas y acciones auditadas", () => {
  it("cada tabla auditada tiene nombre amigable y no hay repetidas", () => {
    expect(new Set(AUDIT_TABLES).size).toBe(AUDIT_TABLES.length);
    for (const name of AUDIT_TABLES) {
      expect(es.admin.audit.tables[name], name).toBeTruthy();
    }
    expect(Object.keys(es.admin.audit.tables).sort()).toEqual([...AUDIT_TABLES].sort());
  });
  it("guardas de tipo", () => {
    expect(isAuditTable("products")).toBe(true);
    expect(isAuditTable("audit_log")).toBe(false);
    expect(isAuditTable(null)).toBe(false);
    expect(isAuditAction("UPDATE")).toBe(true);
    expect(isAuditAction("update")).toBe(false);
  });
});

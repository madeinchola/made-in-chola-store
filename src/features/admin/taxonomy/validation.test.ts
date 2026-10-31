import { describe, expect, it } from "vitest";
import {
  categoryFormSchema,
  collectionFormSchema,
  parseWindow,
  toCategoryInput,
  toCollectionInput,
  type CategoryFormValues,
  type CollectionFormValues,
} from "./validation";

const cat: CategoryFormValues = { name: "Ropa", slug: "ropa", description: "", parentId: "" };
const col: CollectionFormValues = {
  name: "Verano",
  slug: "verano",
  description: "",
  startsAt: "",
  endsAt: "",
};

const catIssues = (p: Partial<CategoryFormValues>) => {
  const r = categoryFormSchema.safeParse({ ...cat, ...p });
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};
const colIssues = (p: Partial<CollectionFormValues>) => {
  const r = collectionFormSchema.safeParse({ ...col, ...p });
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("categoryFormSchema", () => {
  it("datos mínimos válidos", () => {
    expect(catIssues({})).toEqual([]);
  });
  it("nombre: obligatorio (aun con espacios), hasta 80 caracteres", () => {
    expect(catIssues({ name: "   " })).toEqual(["name: Escribe el nombre."]);
    expect(catIssues({ name: "a".repeat(80) })).toEqual([]);
    expect(catIssues({ name: "a".repeat(81) })).toEqual([
      "name: El nombre admite hasta 80 caracteres.",
    ]);
  });
  it.each([
    "Ropa",
    "ropa chola",
    "ropa_chola",
    "-ropa",
    "ropa-",
    "ropa--chola",
    "ñandú",
    "a".repeat(81),
  ])("slug «%s» inválido", (slug) => {
    expect(catIssues({ slug }).length).toBeGreaterThan(0);
  });
  it.each(["ropa", "ropa-chola-2027", "a1", "a".repeat(80)])("slug «%s» válido", (slug) => {
    expect(catIssues({ slug })).toEqual([]);
  });
  it("descripción: hasta 1000 caracteres", () => {
    expect(catIssues({ description: "d".repeat(1000) })).toEqual([]);
    expect(catIssues({ description: "d".repeat(1001) })).toEqual([
      "description: La descripción admite hasta 1000 caracteres.",
    ]);
  });
});

describe("toCategoryInput", () => {
  it("recorta, descripción vacía → null y padre vacío → null", () => {
    expect(
      toCategoryInput({ name: "  Ropa ", slug: " ropa ", description: "  ", parentId: "" }),
    ).toEqual({
      name: "Ropa",
      slug: "ropa",
      description: null,
      parentId: null,
    });
  });
  it("conserva descripción y padre", () => {
    expect(toCategoryInput({ ...cat, description: " texto ", parentId: "p1" })).toMatchObject({
      description: "texto",
      parentId: "p1",
    });
  });
});

describe("parseWindow (hora de La Paz → UTC)", () => {
  it("sin fechas: ventana abierta", () => {
    expect(parseWindow("", "")).toEqual({ ok: true, startsAt: null, endsAt: null });
  });
  it("convierte sumando 4 horas", () => {
    expect(parseWindow("2026-10-29T08:00", "2026-10-30T20:30")).toEqual({
      ok: true,
      startsAt: "2026-10-29T12:00:00.000Z",
      endsAt: "2026-10-31T00:30:00.000Z",
    });
  });
  it("solo inicio o solo fin son válidos", () => {
    expect(parseWindow("2026-10-29T08:00", "")).toMatchObject({ ok: true, endsAt: null });
    expect(parseWindow("", "2026-10-29T08:00")).toMatchObject({ ok: true, startsAt: null });
  });
  it("el fin debe ser POSTERIOR al inicio: igual o anterior se rechaza en el campo de fin", () => {
    expect(parseWindow("2026-10-29T08:00", "2026-10-29T08:00")).toEqual({
      ok: false,
      field: "endsAt",
      problem: "order",
    });
    expect(parseWindow("2026-10-29T08:00", "2026-10-29T07:59")).toEqual({
      ok: false,
      field: "endsAt",
      problem: "order",
    });
    expect(parseWindow("2026-10-29T08:00", "2026-10-29T08:01").ok).toBe(true);
  });
  it("una fecha mal formada señala el campo correcto", () => {
    expect(parseWindow("mañana", "")).toEqual({ ok: false, field: "startsAt", problem: "invalid" });
    expect(parseWindow("", "2026-13-45T10:00")).toEqual({
      ok: false,
      field: "endsAt",
      problem: "invalid",
    });
  });
});

describe("collectionFormSchema", () => {
  it("válido sin fechas y con fechas ordenadas", () => {
    expect(colIssues({})).toEqual([]);
    expect(colIssues({ startsAt: "2026-10-01T00:00", endsAt: "2026-11-01T00:00" })).toEqual([]);
  });
  it("fin anterior al inicio: error en endsAt", () => {
    expect(colIssues({ startsAt: "2026-11-01T00:00", endsAt: "2026-10-01T00:00" })).toEqual([
      "endsAt: El fin de la vigencia debe ser posterior al inicio.",
    ]);
  });
  it("fecha inválida: error en su campo", () => {
    expect(colIssues({ startsAt: "xx" })).toEqual(["startsAt: La fecha no es válida."]);
  });
  it("descripción: hasta 2000 caracteres", () => {
    expect(colIssues({ description: "d".repeat(2000) })).toEqual([]);
    expect(colIssues({ description: "d".repeat(2001) })).toHaveLength(1);
  });
  it("las reglas de nombre y slug son las mismas que en categorías", () => {
    expect(colIssues({ name: "" })).toEqual(["name: Escribe el nombre."]);
    expect(colIssues({ slug: "Con Espacios" }).length).toBeGreaterThan(0);
  });
});

describe("toCollectionInput", () => {
  it("convierte las fechas a UTC y limpia texto", () => {
    expect(
      toCollectionInput({
        name: " Verano ",
        slug: "verano",
        description: " ",
        startsAt: "2026-10-29T08:00",
        endsAt: "",
      }),
    ).toEqual({
      name: "Verano",
      slug: "verano",
      description: null,
      startsAt: "2026-10-29T12:00:00.000Z",
      endsAt: null,
    });
  });
});

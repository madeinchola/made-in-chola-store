import { describe, expect, it } from "vitest";
import {
  emptyMethodValues,
  etaLabel,
  isBaseDeliveryMethod,
  methodStatus,
  methodToValues,
  pickupOptions,
  pickupProblem,
  validateMethodCreate,
  validateMethodUpdate,
  type MethodFormValues,
} from "./storeMethodLogic";
import type { ShippingMethod, StoreLocation } from "./types";

const values = (over: Partial<MethodFormValues> = {}): MethodFormValues => ({
  code: "express",
  name: "Entrega express",
  kind: "delivery",
  description: "En el día",
  etaMinDays: "1",
  etaMaxDays: "3",
  pickupLocationId: "",
  sortOrder: "5",
  isActive: true,
  ...over,
});

const location = (over: Partial<StoreLocation> = {}): StoreLocation => ({
  id: "l1",
  name: "Casa central",
  addressText: "Calle 1",
  city: "La Paz",
  lat: -16.5,
  lng: -68.15,
  pickupHours: null,
  isPrimary: false,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});

const method = (over: Partial<ShippingMethod> = {}): ShippingMethod => ({
  id: "m1",
  code: "recojo",
  name: "Recojo en tienda",
  kind: "pickup",
  description: null,
  etaMinDays: null,
  etaMaxDays: null,
  pickupLocationId: "l1",
  isActive: true,
  sortOrder: 0,
  archived: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});

const createErrors = (v: MethodFormValues, existing: string[] = []) => {
  const r = validateMethodCreate(v, existing);
  if (r.ok) throw new Error("se esperaba un error de validación");
  return r.errors;
};
const updateErrors = (v: MethodFormValues) => {
  const r = validateMethodUpdate(v);
  if (r.ok) throw new Error("se esperaba un error de validación");
  return r.errors;
};

const CODE_FORMAT =
  "El código debe tener de 2 a 32 caracteres: minúsculas, dígitos o guion bajo (_), y empezar con una letra.";

describe("validateMethodCreate: lo que se envía", () => {
  it("un método de domicilio válido produce exactamente el MethodCreateInput", () => {
    expect(validateMethodCreate(values(), [])).toEqual({
      ok: true,
      input: {
        code: "express",
        name: "Entrega express",
        kind: "delivery",
        description: "En el día",
        etaMinDays: 1,
        etaMaxDays: 3,
        pickupLocationId: null,
        isActive: true,
        sortOrder: 5,
      },
    });
  });

  it("un método de recojo lleva su ubicación", () => {
    expect(
      validateMethodCreate(
        values({ code: "recojo_sopo", kind: "pickup", pickupLocationId: "loc-9" }),
        [],
      ),
    ).toEqual({
      ok: true,
      input: {
        code: "recojo_sopo",
        name: "Entrega express",
        kind: "pickup",
        description: "En el día",
        etaMinDays: 1,
        etaMaxDays: 3,
        pickupLocationId: "loc-9",
        isActive: true,
        sortOrder: 5,
      },
    });
  });

  it("un método de domicilio NO lleva ubicación aunque quedara una elegida (la base lo exige)", () => {
    const r = validateMethodCreate(values({ kind: "delivery", pickupLocationId: "loc-9" }), []);
    expect(r.ok && r.input.pickupLocationId).toBeNull();
  });

  it("recorta los textos; descripción vacía y plazos vacíos se envían como null", () => {
    const r = validateMethodCreate(
      values({
        code: "  express  ",
        name: "  Express ",
        description: "   ",
        etaMinDays: " ",
        etaMaxDays: "",
      }),
      [],
    );
    expect(r).toEqual({
      ok: true,
      input: {
        code: "express",
        name: "Express",
        kind: "delivery",
        description: null,
        etaMinDays: null,
        etaMaxDays: null,
        pickupLocationId: null,
        isActive: true,
        sortOrder: 5,
      },
    });
  });
});

describe("validateMethodCreate: el código (^[a-z][a-z0-9_]{1,31}$)", () => {
  it("acepta códigos válidos, incluido el de 2 y el de 32 caracteres", () => {
    for (const code of ["ab", "a1", "recojo_tienda", "a_", "x9_y", `a${"b".repeat(31)}`]) {
      expect(validateMethodCreate(values({ code }), []).ok, code).toBe(true);
    }
  });

  it("rechaza lo que la regla de la base rechazaría", () => {
    const bad = [
      "a", // 1 carácter
      `a${"b".repeat(32)}`, // 33
      "1abc", // empieza con dígito
      "_abc", // empieza con guion bajo
      "Abc", // mayúscula
      "abC",
      "ab-c", // guion medio
      "ab c", // espacio
      "ab.c",
      "áb", // acento
      "recojo!",
    ];
    for (const code of bad) {
      expect(createErrors(values({ code })).code, code).toBe(CODE_FORMAT);
    }
  });

  it("vacío o solo espacios: pide el código", () => {
    expect(createErrors(values({ code: "" })).code).toBe("Escribe el código del método.");
    expect(createErrors(values({ code: "   " })).code).toBe("Escribe el código del método.");
  });

  it("no puede repetirse un código existente (también de un método archivado)", () => {
    expect(createErrors(values({ code: "delivery" }), ["delivery", "recojo"]).code).toBe(
      "Ya existe un método con ese código (puede estar archivado).",
    );
    expect(validateMethodCreate(values({ code: "delivery2" }), ["delivery"]).ok).toBe(true);
  });

  it("el código repetido se detecta aunque venga con espacios alrededor", () => {
    expect(createErrors(values({ code: " delivery " }), ["delivery"]).code).toBe(
      "Ya existe un método con ese código (puede estar archivado).",
    );
  });
});

describe("validateMethodCreate / Update: nombre, descripción, plazos y orden", () => {
  it("el nombre es obligatorio y admite 80 caracteres, no 81", () => {
    expect(createErrors(values({ name: "  " })).name).toBe("Escribe el nombre del método.");
    expect(validateMethodCreate(values({ name: "a".repeat(80) }), []).ok).toBe(true);
    expect(createErrors(values({ name: "a".repeat(81) })).name).toBe(
      "El nombre admite hasta 80 caracteres.",
    );
    expect(updateErrors(values({ name: "a".repeat(81) })).name).toBe(
      "El nombre admite hasta 80 caracteres.",
    );
  });

  it("la descripción admite 300 caracteres, no 301", () => {
    expect(validateMethodCreate(values({ description: "a".repeat(300) }), []).ok).toBe(true);
    expect(createErrors(values({ description: "a".repeat(301) })).description).toBe(
      "La descripción admite hasta 300 caracteres.",
    );
  });

  it("los plazos son enteros de 0 a 90: 0 y 90 valen; 91, -1, decimales y texto no", () => {
    const eta = (min: string, max: string) =>
      validateMethodCreate(values({ etaMinDays: min, etaMaxDays: max }), []);
    const ok0 = eta("0", "90");
    expect(ok0.ok && [ok0.input.etaMinDays, ok0.input.etaMaxDays]).toEqual([0, 90]);
    const msg = "Escribe un número entero de días, de 0 a 90.";
    expect(createErrors(values({ etaMinDays: "91", etaMaxDays: "" })).etaMinDays).toBe(msg);
    expect(createErrors(values({ etaMinDays: "", etaMaxDays: "91" })).etaMaxDays).toBe(msg);
    for (const bad of ["-1", "2.5", "2,5", "abc", "1e1", "+3", "1000"]) {
      expect(createErrors(values({ etaMinDays: bad, etaMaxDays: "" })).etaMinDays, bad).toBe(msg);
    }
  });

  it("el mínimo no puede ser mayor que el máximo; igual vale (el error va en el máximo)", () => {
    expect(createErrors(values({ etaMinDays: "4", etaMaxDays: "3" }))).toEqual({
      etaMaxDays: "El plazo máximo no puede ser menor que el mínimo.",
    });
    const same = validateMethodCreate(values({ etaMinDays: "3", etaMaxDays: "3" }), []);
    expect(same.ok).toBe(true);
    // 10 > 9 numéricamente aunque "10" < "9" como texto
    expect(updateErrors(values({ etaMinDays: "10", etaMaxDays: "9" })).etaMaxDays).toBe(
      "El plazo máximo no puede ser menor que el mínimo.",
    );
  });

  it("solo uno de los dos plazos también se permite (la base lo permite)", () => {
    const onlyMax = validateMethodCreate(values({ etaMinDays: "", etaMaxDays: "5" }), []);
    expect(onlyMax.ok && [onlyMax.input.etaMinDays, onlyMax.input.etaMaxDays]).toEqual([null, 5]);
    const onlyMin = validateMethodCreate(values({ etaMinDays: "2", etaMaxDays: "" }), []);
    expect(onlyMin.ok && [onlyMin.input.etaMinDays, onlyMin.input.etaMaxDays]).toEqual([2, null]);
  });

  it("el orden es un entero obligatorio (negativo vale, -0 se vuelve 0, hasta 9 cifras)", () => {
    const order = (sortOrder: string) => validateMethodCreate(values({ sortOrder }), []);
    const neg = order("-5");
    expect(neg.ok && neg.input.sortOrder).toBe(-5);
    const zero = order("-0");
    expect(zero.ok && Object.is(zero.input.sortOrder, 0)).toBe(true);
    const big = order("999999999");
    expect(big.ok && big.input.sortOrder).toBe(999999999);
    const msg = "Escribe un número entero, por ejemplo 0.";
    for (const bad of ["", " ", "1.5", "abc", "1000000000", "--1", "+1"]) {
      expect(createErrors(values({ sortOrder: bad })).sortOrder, JSON.stringify(bad)).toBe(msg);
    }
  });

  it("un método «recojo» exige ubicación; vacía o de espacios no vale", () => {
    const msg = "Elige la ubicación donde se recoge el pedido.";
    expect(createErrors(values({ kind: "pickup", pickupLocationId: "" })).pickupLocationId).toBe(
      msg,
    );
    expect(createErrors(values({ kind: "pickup", pickupLocationId: "  " })).pickupLocationId).toBe(
      msg,
    );
    expect(updateErrors(values({ kind: "pickup", pickupLocationId: "" })).pickupLocationId).toBe(
      msg,
    );
  });

  it("un método «domicilio» sin ubicación NO da error de ubicación", () => {
    const r = validateMethodCreate(values({ kind: "delivery", pickupLocationId: "" }), []);
    expect(r.ok).toBe(true);
  });

  it("junta TODOS los errores a la vez", () => {
    expect(
      Object.keys(
        createErrors(
          values({
            code: "",
            name: "",
            kind: "pickup",
            pickupLocationId: "",
            etaMinDays: "x",
            etaMaxDays: "y",
            sortOrder: "",
          }),
        ),
      ).sort(),
    ).toEqual(["code", "etaMaxDays", "etaMinDays", "name", "pickupLocationId", "sortOrder"]);
  });
});

describe("validateMethodUpdate: el código y el tipo no se editan", () => {
  it("el MethodUpdateInput NO trae código ni tipo", () => {
    const r = validateMethodUpdate(values({ code: "otro", kind: "delivery" }));
    expect(r).toEqual({
      ok: true,
      input: {
        name: "Entrega express",
        description: "En el día",
        etaMinDays: 1,
        etaMaxDays: 3,
        pickupLocationId: null,
        isActive: true,
        sortOrder: 5,
      },
    });
    expect(r.ok && "code" in r.input).toBe(false);
    expect(r.ok && "kind" in r.input).toBe(false);
  });

  it("no valida el código (el existente puede ser cualquiera que la base aceptó antes)", () => {
    expect(validateMethodUpdate(values({ code: "" })).ok).toBe(true);
  });

  it("un recojo conserva su ubicación", () => {
    const r = validateMethodUpdate(values({ kind: "pickup", pickupLocationId: "l7" }));
    expect(r.ok && r.input.pickupLocationId).toBe("l7");
  });
});

describe("methodToValues / emptyMethodValues", () => {
  it("un método nuevo empieza como domicilio, activo, con orden 0 y sin plazo", () => {
    expect(emptyMethodValues()).toEqual({
      code: "",
      name: "",
      kind: "delivery",
      description: "",
      etaMinDays: "",
      etaMaxDays: "",
      pickupLocationId: "",
      sortOrder: "0",
      isActive: true,
    });
  });

  it("al editar trae todos los datos como texto (null = vacío; 0 NO es vacío)", () => {
    expect(
      methodToValues(
        method({
          etaMinDays: 0,
          etaMaxDays: 2,
          description: "Hola",
          sortOrder: 3,
          isActive: false,
        }),
      ),
    ).toEqual({
      code: "recojo",
      name: "Recojo en tienda",
      kind: "pickup",
      description: "Hola",
      etaMinDays: "0",
      etaMaxDays: "2",
      pickupLocationId: "l1",
      sortOrder: "3",
      isActive: false,
    });
  });

  it("abrir y guardar sin tocar nada conserva el dato (ida y vuelta)", () => {
    const m = method({ etaMinDays: 1, etaMaxDays: 1, sortOrder: -2 });
    expect(validateMethodUpdate(methodToValues(m))).toEqual({
      ok: true,
      input: {
        name: "Recojo en tienda",
        description: null,
        etaMinDays: 1,
        etaMaxDays: 1,
        pickupLocationId: "l1",
        isActive: true,
        sortOrder: -2,
      },
    });
  });
});

describe("etaLabel", () => {
  it("sin plazo", () => expect(etaLabel(null, null)).toBe("Sin plazo"));
  it("mismo mínimo y máximo: 0 = mismo día, 1 = «1 día», n = «n días»", () => {
    expect(etaLabel(0, 0)).toBe("El mismo día");
    expect(etaLabel(1, 1)).toBe("1 día");
    expect(etaLabel(3, 3)).toBe("3 días");
  });
  it("rango", () => {
    expect(etaLabel(2, 4)).toBe("2–4 días");
    expect(etaLabel(0, 1)).toBe("0–1 días");
  });
  it("solo mínimo / solo máximo (singular y plural)", () => {
    expect(etaLabel(1, null)).toBe("Desde 1 día");
    expect(etaLabel(5, null)).toBe("Desde 5 días");
    expect(etaLabel(0, null)).toBe("Desde 0 días");
    expect(etaLabel(null, 1)).toBe("Hasta 1 día");
    expect(etaLabel(null, 7)).toBe("Hasta 7 días");
  });
});

describe("estado y método base", () => {
  it("methodStatus: archivado gana sobre inactivo", () => {
    expect(methodStatus({ archived: true, isActive: false })).toBe("archived");
    expect(methodStatus({ archived: true, isActive: true })).toBe("archived");
    expect(methodStatus({ archived: false, isActive: false })).toBe("inactive");
    expect(methodStatus({ archived: false, isActive: true })).toBe("active");
  });
  it("isBaseDeliveryMethod: solo el código «delivery»", () => {
    expect(isBaseDeliveryMethod({ code: "delivery" })).toBe(true);
    expect(isBaseDeliveryMethod({ code: "delivery2" })).toBe(false);
    expect(isBaseDeliveryMethod({ code: "Delivery" })).toBe(false);
  });
});

describe("pickupOptions", () => {
  const locations = [
    location({ id: "a", name: "A" }),
    location({ id: "b", name: "B", isActive: false }),
    location({ id: "c", name: "C", archived: true }),
    location({ id: "d", name: "D" }),
  ];

  it("ofrece solo las activas y sin archivar", () => {
    expect(pickupOptions(locations, null)).toEqual([
      { id: "a", name: "A", note: null },
      { id: "d", name: "D", note: null },
    ]);
  });

  it("conserva la ubicación actual del método si dejó de estar disponible, marcada", () => {
    expect(pickupOptions(locations, "b").map((o) => [o.id, o.note])).toEqual([
      ["a", null],
      ["d", null],
      ["b", "inactive"],
    ]);
    expect(pickupOptions(locations, "c").map((o) => [o.id, o.note])).toEqual([
      ["a", null],
      ["d", null],
      ["c", "archived"],
    ]);
  });

  it("si la ubicación actual ya no existe, queda como opción «missing»", () => {
    expect(pickupOptions(locations, "zzz").at(-1)).toEqual({
      id: "zzz",
      name: "",
      note: "missing",
    });
  });

  it("la actual que sigue disponible no se repite", () => {
    expect(pickupOptions(locations, "a").map((o) => o.id)).toEqual(["a", "d"]);
  });
});

describe("pickupProblem", () => {
  const locations = [
    location({ id: "ok" }),
    location({ id: "off", isActive: false }),
    location({ id: "old", archived: true, isActive: false }),
  ];
  const m = (pickupLocationId: string | null, over: Partial<ShippingMethod> = {}) =>
    method({ pickupLocationId, ...over });

  it("ubicación disponible: sin problema", () =>
    expect(pickupProblem(m("ok"), locations)).toBeNull());
  it("inactiva / archivada (gana sobre inactiva) / inexistente", () => {
    expect(pickupProblem(m("off"), locations)).toBe("inactive");
    expect(pickupProblem(m("old"), locations)).toBe("archived");
    expect(pickupProblem(m("nada"), locations)).toBe("missing");
  });
  it("no aplica a domicilio, a archivados ni a un recojo sin ubicación", () => {
    expect(pickupProblem(m("off", { kind: "delivery" }), locations)).toBeNull();
    expect(pickupProblem(m("off", { archived: true }), locations)).toBeNull();
    expect(pickupProblem(m(null), locations)).toBeNull();
  });
});

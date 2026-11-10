import { describe, expect, it } from "vitest";
import {
  codeProblem,
  couponFormFrom,
  couponStatus,
  couponsCsv,
  emptyCouponForm,
  emptyGenerateForm,
  filterCoupons,
  formatLaPaz,
  laPazStamp,
  normalizeCode,
  sortCoupons,
  usesByCoupon,
  usesText,
  validateCouponForm,
  validateGenerateForm,
  validityText,
} from "./CouponsLogic";
import type { Coupon, Redemption } from "./types";

const BOM = "﻿";

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: "c1",
  discountId: "d1",
  code: "VERANO-10",
  codeNormalized: "VERAN010",
  isActive: true,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  archived: false,
  updatedAt: "2026-11-05T10:00:00.123456+00:00",
  ...over,
});

const redemption = (over: Partial<Redemption> = {}): Redemption => ({
  id: "r1",
  discountId: "d1",
  discountName: "Verano",
  couponId: "c1",
  couponCode: "VERANO-10",
  profileId: "p1",
  customerName: "Ana",
  customerEmail: "ana@correo.com",
  ownerType: "order",
  ownerId: "o1",
  amount: 10,
  currency: "BOB",
  status: "applied",
  createdAt: "2026-11-05T12:00:00+00:00",
  ...over,
});

describe("normalizeCode (réplica de _coupon_norm)", () => {
  it("quita espacios, guiones y guiones bajos, pasa a mayúsculas y unifica O→0, I→1, L→1", () => {
    // «VERANO10» → «VERAN010» (la O de VERANO pasa a cero).
    expect(normalizeCode("Verano-10")).toBe("VERAN010");
    expect(normalizeCode("VERANO10")).toBe("VERAN010");
    expect(normalizeCode("verano 10")).toBe("VERAN010");
    expect(normalizeCode("VERAN0 1O")).toBe("VERAN010");
    expect(normalizeCode("ver_ano--10")).toBe("VERAN010");
    // L→1, I→1: «LilaIl» → L I L A I L → 1 1 1 A 1 1.
    expect(normalizeCode("LilaIl")).toBe("111A11");
  });
  it("recorta lo de los extremos y un texto vacío o solo de separadores queda vacío", () => {
    expect(normalizeCode("  ab c  ")).toBe("ABC");
    expect(normalizeCode(" - _ ")).toBe("");
    expect(normalizeCode("")).toBe("");
  });
  it("no toca otras letras ni números", () => {
    expect(normalizeCode("abc123xyz")).toBe("ABC123XYZ");
  });
});

describe("codeProblem (réplica de la restricción de coupons.code)", () => {
  it.each([
    ["", "required"],
    ["   ", "required"],
    ["ab", "tooShort"],
    ["1", "tooShort"],
    ["abc", "tooShort"],
    ["A-B", "tooShort"],
    ["A--", "tooShort"],
    ["1-0", "tooShort"],
    ["ab-c", "tooShort"], // 4 caracteres, pero normaliza a «ABC» (3): la base lo rechaza (coupons_code_norm_len)
    ["1--0", "tooShort"],
    ["a".repeat(33), "tooLong"],
    ["a".repeat(40), "tooLong"],
    ["-abc", "start"],
    ["--a", "start"],
    ["ab c", "chars"],
    ["a b", "chars"],
    ["añb", "chars"],
    ["áb1", "chars"],
    ["ñ", "chars"],
    ["ab_c", "chars"],
    ["ab.c", "chars"],
    ["ab@c", "chars"],
    ["ab😀", "chars"],
  ] as const)("%j → %s", (input, expected) => {
    expect(codeProblem(input)).toBe(expected);
  });
  it.each([
    ["abcd"],
    ["AB-CD"],
    ["0ABC"],
    ["9-9-9-9"],
    ["ab-cd-"],
    ["a".repeat(32)],
    ["  VERANO-10  "],
  ])("%j es válido", (input) => {
    expect(codeProblem(input)).toBeNull();
  });
});

describe("couponStatus: lo que vería una clienta hoy", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const past = "2026-11-01T00:00:00.000Z";
  const future = "2026-12-01T00:00:00.000Z";

  it("un código normal está activo", () => {
    expect(couponStatus(coupon(), 0, now)).toBe("active");
  });
  it("archivado gana sobre todo lo demás", () => {
    expect(couponStatus(coupon({ archived: true, isActive: false, endsAt: past }), 5, now)).toBe(
      "archived",
    );
  });
  it("apagado gana sobre vencido, no empezado y agotado", () => {
    expect(couponStatus(coupon({ isActive: false, endsAt: past }), 0, now)).toBe("inactive");
    expect(couponStatus(coupon({ isActive: false, startsAt: future }), 0, now)).toBe("inactive");
    expect(couponStatus(coupon({ isActive: false, usageLimit: 1 }), 1, now)).toBe("inactive");
  });
  it("el fin es EXCLUSIVO: a la hora exacta ya está vencido; un milisegundo antes, no", () => {
    expect(couponStatus(coupon({ endsAt: "2026-11-05T12:00:00.000Z" }), 0, now)).toBe("expired");
    expect(couponStatus(coupon({ endsAt: "2026-11-05T12:00:00.001Z" }), 0, now)).toBe("active");
    expect(couponStatus(coupon({ endsAt: past }), 0, now)).toBe("expired");
  });
  it("el inicio es INCLUSIVO: a la hora exacta ya sirve; un milisegundo antes, aún no empieza", () => {
    expect(couponStatus(coupon({ startsAt: "2026-11-05T12:00:00.000Z" }), 0, now)).toBe("active");
    expect(couponStatus(coupon({ startsAt: "2026-11-05T12:00:00.001Z" }), 0, now)).toBe(
      "scheduled",
    );
    expect(couponStatus(coupon({ startsAt: future }), 0, now)).toBe("scheduled");
  });
  it("dentro de la ventana está activo", () => {
    expect(couponStatus(coupon({ startsAt: past, endsAt: future }), 0, now)).toBe("active");
  });
  it("agotado cuando los usos alcanzan el tope (≥), no antes", () => {
    expect(couponStatus(coupon({ usageLimit: 1 }), 0, now)).toBe("active");
    expect(couponStatus(coupon({ usageLimit: 1 }), 1, now)).toBe("exhausted");
    expect(couponStatus(coupon({ usageLimit: 5 }), 4, now)).toBe("active");
    expect(couponStatus(coupon({ usageLimit: 5 }), 5, now)).toBe("exhausted");
    expect(couponStatus(coupon({ usageLimit: 5 }), 6, now)).toBe("exhausted");
  });
  it("sin tope nunca se agota; sin saber los usos no se adivina", () => {
    expect(couponStatus(coupon({ usageLimit: null }), 999, now)).toBe("active");
    expect(couponStatus(coupon({ usageLimit: 1 }), null, now)).toBe("active");
  });
  it("vencido y no empezado ganan sobre agotado", () => {
    expect(couponStatus(coupon({ usageLimit: 1, endsAt: past }), 1, now)).toBe("expired");
    expect(couponStatus(coupon({ usageLimit: 1, startsAt: future }), 1, now)).toBe("scheduled");
  });
  it("una fecha ilegible no rompe ni vence el código", () => {
    expect(couponStatus(coupon({ endsAt: "no es fecha" }), 0, now)).toBe("active");
  });
});

describe("usesByCoupon", () => {
  it("cuenta reservados y aplicados por código; ignora devueltos y los usos sin código", () => {
    const uses = usesByCoupon([
      redemption({ id: "1", couponId: "c1", status: "reserved" }),
      redemption({ id: "2", couponId: "c1", status: "applied" }),
      redemption({ id: "3", couponId: "c1", status: "reverted" }),
      redemption({ id: "4", couponId: "c2", status: "applied" }),
      redemption({ id: "5", couponId: "c3", status: "reverted" }),
      redemption({ id: "6", couponId: null, couponCode: null, status: "applied" }),
    ]);
    expect(Object.fromEntries(uses)).toEqual({ c1: 2, c2: 1 });
  });
  it("sin usos, mapa vacío", () => {
    expect(usesByCoupon([]).size).toBe(0);
  });
});

describe("sortCoupons y filterCoupons", () => {
  it("los archivados van al final y el resto conserva su orden", () => {
    const list = [
      coupon({ id: "a", archived: true }),
      coupon({ id: "b" }),
      coupon({ id: "c", archived: true }),
      coupon({ id: "d" }),
    ];
    expect(sortCoupons(list).map((c) => c.id)).toEqual(["b", "d", "a", "c"]);
  });

  const list = [
    coupon({ id: "1", code: "VERANO-10", codeNormalized: "VERAN010" }),
    coupon({ id: "2", code: "invierno-5", codeNormalized: "1NV1ERN05" }),
    coupon({ id: "3", code: "PROMO", codeNormalized: "PR0M0" }),
  ];
  const ids = (q: string) => filterCoupons(list, q).map((c) => c.id);

  it("sin texto devuelve todos", () => {
    expect(ids("")).toEqual(["1", "2", "3"]);
    expect(ids("   ")).toEqual(["1", "2", "3"]);
  });
  it("busca sin importar mayúsculas, espacios, guiones ni 0/O", () => {
    expect(ids("verano")).toEqual(["1"]);
    expect(ids("VERANO 10")).toEqual(["1"]);
    expect(ids("verano-10")).toEqual(["1"]);
    expect(ids("VERAN0-10")).toEqual(["1"]);
    expect(ids("inv")).toEqual(["2"]);
    expect(ids("PR0M0")).toEqual(["3"]);
    expect(ids("promo")).toEqual(["3"]);
  });
  it("una búsqueda de solo separadores se compara tal cual (los códigos con guion)", () => {
    expect(ids("-")).toEqual(["1", "2"]);
  });
  it("sin coincidencias devuelve una lista vacía", () => {
    expect(ids("zzz")).toEqual([]);
  });
});

describe("textos de la tabla", () => {
  it("formatLaPaz: hora de La Paz (UTC−4), día de mes sin cero y mes abreviado", () => {
    expect(formatLaPaz("2026-11-05T12:00:00Z")).toBe("5 nov 2026, 08:00");
    // 03:00 UTC del 6 = 23:00 del 5 en La Paz.
    expect(formatLaPaz("2026-11-06T03:00:00Z")).toBe("5 nov 2026, 23:00");
    expect(formatLaPaz("2026-12-01T04:00:00Z")).toBe("1 dic 2026, 00:00");
  });
  it("formatLaPaz: un texto que no es fecha se devuelve tal cual", () => {
    expect(formatLaPaz("basura")).toBe("basura");
  });
  it("validityText: sin fechas, solo inicio, solo fin o ambos", () => {
    const s = "2026-11-05T12:00:00Z";
    const e = "2026-12-01T04:00:00Z";
    expect(validityText({ startsAt: null, endsAt: null })).toBe("Sin fechas propias");
    expect(validityText({ startsAt: s, endsAt: null })).toBe("Desde 5 nov 2026, 08:00");
    expect(validityText({ startsAt: null, endsAt: e })).toBe("Hasta 1 dic 2026, 00:00");
    expect(validityText({ startsAt: s, endsAt: e })).toBe(
      "Desde 5 nov 2026, 08:00 hasta 1 dic 2026, 00:00",
    );
  });
  it("usesText", () => {
    expect(usesText({ usageLimit: null }, null)).toBe("—");
    expect(usesText({ usageLimit: 5 }, null)).toBe("—");
    expect(usesText({ usageLimit: null }, 3)).toBe("3 (sin tope)");
    expect(usesText({ usageLimit: 1 }, 0)).toBe("0 de 1 (un solo uso)");
    expect(usesText({ usageLimit: 10 }, 3)).toBe("3 de 10");
  });
  it("laPazStamp: AAAA-MM-DD HH:mm en La Paz, vacío sin fecha o con una fecha ilegible", () => {
    expect(laPazStamp("2026-11-05T12:00:00Z")).toBe("2026-11-05 08:00");
    expect(laPazStamp("2026-12-01T04:00:00Z")).toBe("2026-12-01 00:00");
    expect(laPazStamp(null)).toBe("");
    expect(laPazStamp("xx")).toBe("");
  });
});

describe("validateCouponForm", () => {
  const form = (over = {}) => ({ ...emptyCouponForm(), code: "Verano-10", ...over });
  const create = (values: ReturnType<typeof form>, existing: Coupon[] = []) =>
    validateCouponForm(values, { mode: "create", existing });

  it("un formulario válido da el valor listo para enviar (hora de La Paz → UTC, código recortado)", () => {
    expect(
      create(
        form({
          code: "  Verano-10 ",
          startsAt: "2026-11-05T08:00",
          endsAt: "2026-12-01T00:00",
          usageLimit: "5",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        code: "Verano-10",
        isActive: true,
        startsAt: "2026-11-05T12:00:00.000Z",
        endsAt: "2026-12-01T04:00:00.000Z",
        usageLimit: 5,
      },
    });
  });
  it("sin fechas ni tope: nulls; respeta «encendido»", () => {
    expect(create(form({ isActive: false }))).toEqual({
      ok: true,
      value: {
        code: "Verano-10",
        isActive: false,
        startsAt: null,
        endsAt: null,
        usageLimit: null,
      },
    });
  });
  it("solo inicio o solo fin son válidos", () => {
    expect(create(form({ startsAt: "2026-11-05T08:00" }))).toMatchObject({
      ok: true,
      value: { startsAt: "2026-11-05T12:00:00.000Z", endsAt: null },
    });
    expect(create(form({ endsAt: "2026-12-01T00:00" }))).toMatchObject({
      ok: true,
      value: { startsAt: null, endsAt: "2026-12-01T04:00:00.000Z" },
    });
  });

  it("el formato del código se revisa al crear", () => {
    expect(create(form({ code: "" }))).toEqual({ ok: false, errors: { code: "required" } });
    expect(create(form({ code: "ab" }))).toEqual({ ok: false, errors: { code: "tooShort" } });
    expect(create(form({ code: "ab-c" }))).toEqual({ ok: false, errors: { code: "tooShort" } });
    expect(create(form({ code: "verano 10" }))).toEqual({ ok: false, errors: { code: "chars" } });
    expect(create(form({ code: "-verano" }))).toEqual({ ok: false, errors: { code: "start" } });
  });

  it("un código que choca (ya normalizado) con otro de este descuento se avisa y dice con cuál", () => {
    const existing = [coupon({ code: "VERANO10", codeNormalized: "VERAN010" })];
    expect(create(form({ code: "Verano-10" }), existing)).toEqual({
      ok: false,
      errors: { code: "duplicate" },
      duplicateOf: "VERANO10",
    });
    // Con ceros en vez de oes también choca.
    expect(create(form({ code: "VERAN0-1O" }), existing)).toMatchObject({
      ok: false,
      errors: { code: "duplicate" },
    });
  });
  it("los códigos ARCHIVADOS también reservan su nombre", () => {
    const existing = [coupon({ code: "VERANO10", codeNormalized: "VERAN010", archived: true })];
    expect(create(form({ code: "verano-10" }), existing)).toMatchObject({
      ok: false,
      errors: { code: "duplicate" },
    });
  });
  it("un código distinto no choca", () => {
    const existing = [coupon({ code: "VERANO10", codeNormalized: "VERAN010" })];
    expect(create(form({ code: "VERANO-11" }), existing)).toMatchObject({ ok: true });
  });
  it("el formato manda sobre el duplicado (no se compara un código mal escrito)", () => {
    const existing = [coupon({ code: "VERANO10", codeNormalized: "VERAN010" })];
    expect(create(form({ code: "verano 10" }), existing)).toEqual({
      ok: false,
      errors: { code: "chars" },
    });
  });

  it("el fin debe ser DESPUÉS del inicio (igual no vale)", () => {
    expect(create(form({ startsAt: "2026-12-01T00:00", endsAt: "2026-11-05T08:00" }))).toEqual({
      ok: false,
      errors: { endsAt: "beforeStart" },
    });
    expect(create(form({ startsAt: "2026-11-05T08:00", endsAt: "2026-11-05T08:00" }))).toEqual({
      ok: false,
      errors: { endsAt: "beforeStart" },
    });
    expect(
      create(form({ startsAt: "2026-11-05T08:00", endsAt: "2026-11-05T08:01" })),
    ).toMatchObject({ ok: true });
  });
  it("una fecha mal formada o imposible se marca en su campo", () => {
    expect(create(form({ startsAt: "garabato" }))).toEqual({
      ok: false,
      errors: { startsAt: "invalid" },
    });
    expect(create(form({ endsAt: "2026-13-45T99:99" }))).toEqual({
      ok: false,
      errors: { endsAt: "invalid" },
    });
  });

  it.each([
    ["", null],
    ["1", 1],
    [" 7 ", 7],
    ["007", 7],
    ["999999999", 999999999],
  ])("tope %j → %j", (text, expected) => {
    expect(create(form({ usageLimit: text }))).toMatchObject({
      ok: true,
      value: { usageLimit: expected },
    });
  });
  it.each([["0"], ["-1"], ["2.5"], ["2,5"], ["abc"], ["1000000000"], ["1e3"]])(
    "tope %j no es válido",
    (text) => {
      expect(create(form({ usageLimit: text }))).toEqual({
        ok: false,
        errors: { usageLimit: "invalid" },
      });
    },
  );

  it("junta todos los problemas a la vez", () => {
    expect(create(form({ code: "", startsAt: "x", endsAt: "y", usageLimit: "0" }))).toEqual({
      ok: false,
      errors: {
        code: "required",
        startsAt: "invalid",
        endsAt: "invalid",
        usageLimit: "invalid",
      },
    });
  });

  it("al editar el código no se revisa (ni su formato ni los duplicados)", () => {
    const existing = [coupon({ code: "VERANO10", codeNormalized: "VERAN010" })];
    expect(validateCouponForm(form({ code: "" }), { mode: "edit", existing })).toMatchObject({
      ok: true,
    });
    expect(
      validateCouponForm(form({ code: "VERANO10" }), { mode: "edit", existing }),
    ).toMatchObject({ ok: true });
  });
  it("al editar sigue revisando fechas y tope", () => {
    expect(
      validateCouponForm(
        form({ startsAt: "2026-12-01T00:00", endsAt: "2026-11-05T08:00", usageLimit: "x" }),
        { mode: "edit", existing: [] },
      ),
    ).toEqual({ ok: false, errors: { endsAt: "beforeStart", usageLimit: "invalid" } });
  });

  it("couponFormFrom trae las fechas en hora de La Paz y el tope como texto", () => {
    expect(
      couponFormFrom(
        coupon({
          startsAt: "2026-11-05T12:00:00+00:00",
          endsAt: "2026-12-01T04:00:00+00:00",
          usageLimit: 3,
          isActive: false,
        }),
      ),
    ).toEqual({
      code: "VERANO-10",
      isActive: false,
      startsAt: "2026-11-05T08:00",
      endsAt: "2026-12-01T00:00",
      usageLimit: "3",
    });
    expect(couponFormFrom(coupon())).toEqual({
      code: "VERANO-10",
      isActive: true,
      startsAt: "",
      endsAt: "",
      usageLimit: "",
    });
  });
});

describe("validateGenerateForm (reglas de admin_generate_coupon_codes)", () => {
  const form = (over = {}) => ({ ...emptyGenerateForm(), count: "50", ...over });

  it("parte con el largo 8, sin prefijo ni un solo uso, y pide la cantidad", () => {
    expect(emptyGenerateForm()).toEqual({ count: "", prefix: "", length: "8", singleUse: false });
    expect(validateGenerateForm(emptyGenerateForm())).toEqual({
      ok: false,
      errors: { count: "required" },
    });
  });
  it("los parámetros exactos: cantidad, prefijo, largo y tope 1 si es de un solo uso", () => {
    expect(validateGenerateForm(form({ prefix: "VERANO", length: "10", singleUse: true }))).toEqual(
      {
        ok: true,
        value: { count: 50, prefix: "VERANO", length: 10, usageLimit: 1 },
      },
    );
  });
  it("sin prefijo → null; sin «un solo uso» → sin tope; el prefijo se recorta", () => {
    expect(validateGenerateForm(form())).toEqual({
      ok: true,
      value: { count: 50, prefix: null, length: 8, usageLimit: null },
    });
    expect(validateGenerateForm(form({ prefix: "  ab1  " }))).toMatchObject({
      ok: true,
      value: { prefix: "ab1" },
    });
  });
  it.each([
    ["1", true],
    ["500", true],
    ["0", false],
    ["501", false],
    ["abc", false],
    ["5.5", false],
    ["-3", false],
    ["1000000000", false],
  ])("cantidad %j: %s", (count, ok) => {
    expect(validateGenerateForm(form({ count })).ok).toBe(ok);
  });
  it("cantidad vacía es «required» y una mala es «invalid»", () => {
    expect(validateGenerateForm(form({ count: "" }))).toEqual({
      ok: false,
      errors: { count: "required" },
    });
    expect(validateGenerateForm(form({ count: "501" }))).toEqual({
      ok: false,
      errors: { count: "invalid" },
    });
  });
  it.each([
    ["", true],
    ["A", true],
    ["12345678", true],
    ["ABCDEFGHI", false],
    ["AB-C", false],
    ["ÁB", false],
    ["AB C", false],
    ["AB_", false],
  ])("prefijo %j: %s", (prefix, ok) => {
    expect(validateGenerateForm(form({ prefix })).ok).toBe(ok);
  });
  it.each([
    ["5", false],
    ["6", true],
    ["20", true],
    ["21", false],
    ["", false],
    ["abc", false],
    ["8.5", false],
  ])("largo %j: %s", (length, ok) => {
    expect(validateGenerateForm(form({ length })).ok).toBe(ok);
  });
  it("junta los tres problemas a la vez", () => {
    expect(
      validateGenerateForm({ count: "0", prefix: "x-y", length: "99", singleUse: false }),
    ).toEqual({ ok: false, errors: { count: "invalid", prefix: "invalid", length: "invalid" } });
  });
});

describe("couponsCsv", () => {
  it("encabezado, código, tope y vigencia en hora de La Paz; vacío si no hay tope o fecha", () => {
    expect(
      couponsCsv([
        {
          code: "VERANO-10",
          usageLimit: 1,
          startsAt: "2026-11-05T12:00:00Z",
          endsAt: "2026-12-01T04:00:00Z",
        },
        { code: "ABC-123", usageLimit: null, startsAt: null, endsAt: null },
      ]),
    ).toBe(
      `${BOM}Código,Tope de usos,Empieza (hora de La Paz),Termina (hora de La Paz)\r\n` +
        "VERANO-10,1,2026-11-05 08:00,2026-12-01 00:00\r\n" +
        "ABC-123,,,\r\n",
    );
  });
  it("sin códigos, solo el encabezado", () => {
    expect(couponsCsv([])).toBe(
      `${BOM}Código,Tope de usos,Empieza (hora de La Paz),Termina (hora de La Paz)\r\n`,
    );
  });
  it("un código no puede colar una fórmula (aunque la base no lo permita, el CSV se defiende)", () => {
    expect(
      couponsCsv([{ code: "=1+1", usageLimit: null, startsAt: null, endsAt: null }]),
    ).toContain("\r\n'=1+1,,,\r\n");
  });
});

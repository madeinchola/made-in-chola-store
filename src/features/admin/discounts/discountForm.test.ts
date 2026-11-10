import { describe, expect, it } from "vitest";
import { t, type MessageKey } from "@/i18n";
import {
  allowedScopes,
  changeKind,
  couponMode,
  emptyTier,
  FIELD_PROBLEMS,
  flagsApply,
  initialValues,
  isPercentKind,
  parseAmount,
  parsePercent,
  previewDescribable,
  problemText,
  toUpdateInput,
  validateDiscount,
  valuesFromDiscount,
  type DiscountErrors,
  type DiscountFormValues,
} from "./discountForm";
import { DISCOUNT_KINDS, type Discount, type DiscountKind, type DiscountParams } from "./types";

/** Valores válidos de cada tipo; cada prueba cambia solo lo que le interesa. */
const v = (kind: DiscountKind, over: Partial<DiscountFormValues> = {}): DiscountFormValues => {
  const base: Partial<Record<DiscountKind, Partial<DiscountFormValues>>> = {
    percent: { percent: "10" },
    fixed: { amount: "20" },
    bogo: { take: "2", pay: "1", scope: "category", targets: [{ id: "c1", label: "Verano" }] },
    volume: { tiers: [{ minQty: "3", percent: "5" }] },
    group_price: { percent: "15", customerGroupId: "g1" },
    flash: { percent: "20", startsAt: "2026-12-01T06:00", endsAt: "2026-12-01T08:00" },
    first_purchase: { percent: "10" },
  };
  return { ...initialValues(kind, "BOB"), name: "Prueba", ...base[kind], ...over };
};
const errorsOf = (values: DiscountFormValues): DiscountErrors => {
  const result = validateDiscount(values);
  if (result.ok) throw new Error("se esperaba un error de validación");
  return result.errors;
};
const payloadOf = (values: DiscountFormValues) => {
  const result = validateDiscount(values);
  if (!result.ok) throw new Error(`se esperaba válido: ${JSON.stringify(result.errors)}`);
  return result.payload;
};

describe("reglas por tipo", () => {
  it("cuáles pides código: porcentaje y monto siempre; 2×1, volumen, grupo y flash nunca; envío y primera compra a elección", () => {
    expect(DISCOUNT_KINDS.map((k) => [k, couponMode(k)])).toEqual([
      ["percent", "always"],
      ["fixed", "always"],
      ["free_shipping", "choice"],
      ["bogo", "never"],
      ["volume", "never"],
      ["group_price", "never"],
      ["flash", "never"],
      ["first_purchase", "choice"],
    ]);
  });
  it("alcances: el envío gratis solo todo el pedido; el 2×1 nunca todo el pedido; el resto los cuatro", () => {
    expect(allowedScopes("free_shipping")).toEqual(["order"]);
    expect(allowedScopes("bogo")).toEqual(["product", "category", "collection"]);
    for (const kind of [
      "percent",
      "fixed",
      "volume",
      "group_price",
      "flash",
      "first_purchase",
    ] as const) {
      expect(allowedScopes(kind)).toEqual(["order", "product", "category", "collection"]);
    }
  });
  it("«se suma» y «no rebajados» solo en un cupón que descuenta producto", () => {
    expect(flagsApply("percent", true)).toBe(true);
    expect(flagsApply("first_purchase", true)).toBe(true);
    expect(flagsApply("first_purchase", false)).toBe(false);
    expect(flagsApply("free_shipping", true)).toBe(false);
    expect(flagsApply("bogo", false)).toBe(false);
  });
  it("tipos con porcentaje", () => {
    expect(DISCOUNT_KINDS.filter(isPercentKind)).toEqual([
      "percent",
      "group_price",
      "flash",
      "first_purchase",
    ]);
  });
});

describe("valores iniciales", () => {
  it("el porcentaje y el monto arrancan con código; el 2×1 arranca en 2×1 sobre productos; el resto automático sobre todo el pedido", () => {
    expect(initialValues("percent", "BOB")).toMatchObject({
      requiresCoupon: true,
      scope: "order",
      priority: "100",
      isActive: true,
      stackable: false,
      excludeSale: false,
    });
    expect(initialValues("fixed", "BOB").requiresCoupon).toBe(true);
    expect(initialValues("bogo", "BOB")).toMatchObject({
      requiresCoupon: false,
      scope: "product",
      take: "2",
      pay: "1",
    });
    expect(initialValues("free_shipping", "BOB")).toMatchObject({
      requiresCoupon: false,
      scope: "order",
      take: "",
      pay: "",
    });
    expect(initialValues("volume", "BOB").tiers).toEqual([emptyTier()]);
  });
  it("cambiar de tipo conserva el nombre y la moneda y reinicia lo demás", () => {
    const edited: DiscountFormValues = {
      ...initialValues("percent", "USD"),
      name: "Mi nombre",
      percent: "10",
      minOrder: "50",
    };
    const changed = changeKind(edited, "bogo");
    expect(changed).toMatchObject({
      kind: "bogo",
      name: "Mi nombre",
      currency: "USD",
      percent: "",
      minOrder: "",
      scope: "product",
    });
    // el mismo tipo no toca nada
    expect(changeKind(edited, "percent")).toBe(edited);
  });
});

describe("validateDiscount: UN descuento válido de cada uno de los 8 tipos (payload exacto)", () => {
  const common = {
    currency: "BOB",
    minOrderAmount: null,
    customerGroupId: null,
    stackableWithAutomatic: false,
    excludeSaleItems: false,
    usageLimitTotal: null,
    usageLimitPerCustomer: null,
    priority: 100,
    startsAt: null,
    endsAt: null,
    isActive: true,
  };
  it("porcentaje con código", () => {
    expect(payloadOf(v("percent"))).toEqual({
      ...common,
      name: "Prueba",
      kind: "percent",
      params: { kind: "percent", percent: 10, maxAmount: null },
      scope: "order",
      requiresCoupon: true,
    });
  });
  it("monto fijo con código", () => {
    expect(payloadOf(v("fixed", { amount: "12,5" }))).toEqual({
      ...common,
      name: "Prueba",
      kind: "fixed",
      params: { kind: "fixed", amount: 12.5 },
      scope: "order",
      requiresCoupon: true,
    });
  });
  it("envío gratis (automático y con código)", () => {
    expect(payloadOf(v("free_shipping", { minOrder: "200" }))).toEqual({
      ...common,
      name: "Prueba",
      kind: "free_shipping",
      params: { kind: "free_shipping" },
      scope: "order",
      requiresCoupon: false,
      minOrderAmount: 200,
    });
    expect(payloadOf(v("free_shipping", { requiresCoupon: true })).requiresCoupon).toBe(true);
  });
  it("2×1 por categoría", () => {
    expect(payloadOf(v("bogo"))).toEqual({
      ...common,
      name: "Prueba",
      kind: "bogo",
      params: { kind: "bogo", take: 2, pay: 1 },
      scope: "category",
      requiresCoupon: false,
    });
  });
  it("volumen", () => {
    expect(
      payloadOf(
        v("volume", {
          tiers: [
            { minQty: "3", percent: "5" },
            { minQty: "6", percent: "10" },
          ],
        }),
      ),
    ).toEqual({
      ...common,
      name: "Prueba",
      kind: "volume",
      params: {
        kind: "volume",
        tiers: [
          { minQty: 3, percent: 5 },
          { minQty: 6, percent: 10 },
        ],
      },
      scope: "order",
      requiresCoupon: false,
    });
  });
  it("precio por tipo de cliente", () => {
    expect(payloadOf(v("group_price"))).toEqual({
      ...common,
      name: "Prueba",
      kind: "group_price",
      params: { kind: "group_price", percent: 15, maxAmount: null },
      scope: "order",
      requiresCoupon: false,
      customerGroupId: "g1",
    });
  });
  it("oferta flash (06:00 y 08:00 de La Paz son las 10:00 y las 12:00 UTC)", () => {
    expect(payloadOf(v("flash"))).toEqual({
      ...common,
      name: "Prueba",
      kind: "flash",
      params: { kind: "flash", percent: 20, maxAmount: null },
      scope: "order",
      requiresCoupon: false,
      startsAt: "2026-12-01T10:00:00.000Z",
      endsAt: "2026-12-01T12:00:00.000Z",
    });
  });
  it("primera compra", () => {
    expect(payloadOf(v("first_purchase", { requiresCoupon: true }))).toEqual({
      ...common,
      name: "Prueba",
      kind: "first_purchase",
      params: { kind: "first_purchase", percent: 10, maxAmount: null },
      scope: "order",
      requiresCoupon: true,
      usageLimitPerCustomer: 1, // arranca en «una vez por clienta» (sin tope, dos pedidos simultáneos podrían usarlo)
    });
  });
  it("primera compra arranca con tope de 1 por clienta; los demás tipos, sin tope", () => {
    expect(initialValues("first_purchase", "BOB").usageLimitPerCustomer).toBe("1");
    for (const kind of [
      "percent",
      "fixed",
      "free_shipping",
      "bogo",
      "volume",
      "group_price",
      "flash",
    ] as const) {
      expect(initialValues(kind, "BOB").usageLimitPerCustomer).toBe("");
    }
  });
});

describe("nombre", () => {
  it("vacío o solo espacios: obligatorio", () => {
    expect(errorsOf(v("percent", { name: "" })).name).toBe("required");
    expect(errorsOf(v("percent", { name: "    " })).name).toBe("required");
  });
  it("se recorta lo que sobra antes de enviar", () => {
    expect(payloadOf(v("percent", { name: "   Verano 10   " })).name).toBe("Verano 10");
  });
  it("80 caracteres sí, 81 no", () => {
    expect(validateDiscount(v("percent", { name: "a".repeat(80) })).ok).toBe(true);
    expect(errorsOf(v("percent", { name: "a".repeat(81) })).name).toBe("too_long");
  });
  it("cuenta caracteres, no unidades UTF-16 (un emoji vale 1, como en la base)", () => {
    expect(validateDiscount(v("percent", { name: "😀".repeat(80) })).ok).toBe(true);
    expect(errorsOf(v("percent", { name: "😀".repeat(81) })).name).toBe("too_long");
  });
});

describe("porcentaje: mayor que 0, hasta 100, hasta 2 decimales", () => {
  const percentError = (text: string) => errorsOf(v("percent", { percent: text })).percent;
  it("vacío, no numérico y notación científica", () => {
    expect(percentError("")).toBe("required");
    expect(percentError("   ")).toBe("required");
    expect(percentError("diez")).toBe("number");
    expect(percentError("1e1")).toBe("number");
    expect(percentError("10 %")).toBe("number");
    expect(percentError("1,2,3")).toBe("number");
  });
  it("0 y negativos fuera de rango; el borde 0,01 sí", () => {
    expect(percentError("0")).toBe("range");
    expect(percentError("0,00")).toBe("range");
    expect(percentError("-5")).toBe("range");
    expect(parsePercent("0,01")).toEqual({ ok: true, value: 0.01 });
  });
  it("100 sí; 100,01 y 101 no", () => {
    expect(parsePercent("100")).toEqual({ ok: true, value: 100 });
    expect(percentError("100,01")).toBe("range");
    expect(percentError("101")).toBe("range");
  });
  it("coma o punto como decimal, con espacios alrededor", () => {
    expect(parsePercent(" 12,5 ")).toEqual({ ok: true, value: 12.5 });
    expect(parsePercent("12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parsePercent("33,33")).toEqual({ ok: true, value: 33.33 });
  });
  it("más de 2 decimales se RECHAZA (no se redondea en silencio)", () => {
    expect(percentError("10,505")).toBe("decimals");
    expect(percentError("0,001")).toBe("decimals");
    expect(percentError("33,333")).toBe("decimals");
  });
});

describe("tope y monto fijo: mayor que 0, menor que 1.000.000.000, hasta 2 decimales", () => {
  it("el tope es opcional: vacío = null", () => {
    expect(payloadOf(v("percent", { maxAmount: "" })).params).toEqual({
      kind: "percent",
      percent: 10,
      maxAmount: null,
    });
    expect(payloadOf(v("percent", { maxAmount: "  " })).params).toMatchObject({ maxAmount: null });
  });
  it("tope válido", () => {
    expect(payloadOf(v("percent", { maxAmount: "50" })).params).toMatchObject({ maxAmount: 50 });
    expect(payloadOf(v("flash", { maxAmount: "12,5" })).params).toMatchObject({ maxAmount: 12.5 });
    expect(parseAmount("999999999,99")).toEqual({ ok: true, value: 999_999_999.99 });
  });
  it("tope: 0, negativo y desde mil millones, fuera de rango; decimales y letras", () => {
    const cap = (text: string) => errorsOf(v("percent", { maxAmount: text })).maxAmount;
    expect(cap("0")).toBe("range");
    expect(cap("-1")).toBe("range");
    expect(cap("1000000000")).toBe("range");
    expect(cap("12,505")).toBe("decimals");
    expect(cap("mucho")).toBe("number");
  });
  it("monto fijo obligatorio, positivo y con hasta 2 decimales", () => {
    const amount = (text: string) => errorsOf(v("fixed", { amount: text })).amount;
    expect(amount("")).toBe("required");
    expect(amount("abc")).toBe("number");
    expect(amount("0")).toBe("range");
    expect(amount("-20")).toBe("range");
    expect(amount("1000000000")).toBe("range");
    expect(amount("19,999")).toBe("decimals");
  });
  it("«1.500» se rechaza: tiene 3 decimales escritos y valdría 1,5 en silencio (la clienta quiso decir mil quinientos)", () => {
    expect(errorsOf(v("fixed", { amount: "1.500" })).amount).toBe("decimals");
    expect(errorsOf(v("fixed", { amount: "1,500" })).amount).toBe("decimals");
    expect(payloadOf(v("fixed", { amount: "1500" })).params).toEqual({
      kind: "fixed",
      amount: 1500,
    });
  });
});

describe("2×1 (llévate N, paga M)", () => {
  const bogo = (take: string, pay: string) => errorsOf(v("bogo", { take, pay }));
  it("llévate 2–20", () => {
    expect(bogo("", "1").take).toBe("required");
    expect(bogo("abc", "1").take).toBe("number");
    expect(bogo("2,5", "1").take).toBe("integer");
    expect(bogo("1", "1").take).toBe("range");
    expect(bogo("21", "1").take).toBe("range");
    expect(payloadOf(v("bogo", { take: "2", pay: "1" })).params).toEqual({
      kind: "bogo",
      take: 2,
      pay: 1,
    });
    expect(payloadOf(v("bogo", { take: "20", pay: "19" })).params).toEqual({
      kind: "bogo",
      take: 20,
      pay: 19,
    });
  });
  it("paga de 1 a «llévate − 1»", () => {
    expect(bogo("3", "").pay).toBe("required");
    expect(bogo("3", "x").pay).toBe("number");
    expect(bogo("3", "1,5").pay).toBe("integer");
    expect(bogo("3", "0").pay).toBe("range");
    expect(bogo("3", "3").pay).toBe("not_below_take");
    expect(bogo("3", "4").pay).toBe("not_below_take");
    expect(payloadOf(v("bogo", { take: "3", pay: "2" })).params).toEqual({
      kind: "bogo",
      take: 3,
      pay: 2,
    });
  });
  it("si «llévate» está mal no se acusa a «paga» de pasarse (solo se revisa lo que sí se puede)", () => {
    const e = bogo("1", "5");
    expect(e.take).toBe("range");
    expect(e.pay).toBeUndefined();
  });
  it("exige alcance de productos, categorías o colecciones, con al menos un objetivo", () => {
    expect(errorsOf(v("bogo", { scope: "order" })).scope).toBe("bogo_order");
    expect(errorsOf(v("bogo", { targets: [] })).targets).toBe("category");
    expect(errorsOf(v("bogo", { scope: "product", targets: [] })).targets).toBe("product");
    expect(errorsOf(v("bogo", { scope: "collection", targets: [] })).targets).toBe("collection");
  });
});

describe("volumen", () => {
  const tiers = (...rows: [string, string][]) =>
    errorsOf(v("volume", { tiers: rows.map(([minQty, percent]) => ({ minQty, percent })) })).tiers;
  it("sin tramos: «none»; más de 10: «too_many»; 10 sí", () => {
    expect(tiers()?.list).toBe("none");
    const eleven = Array.from({ length: 11 }, (_, i) => [String(i + 2), "5"] as [string, string]);
    expect(tiers(...eleven)?.list).toBe("too_many");
    const ten = Array.from({ length: 10 }, (_, i) => ({ minQty: String(i + 2), percent: "5" }));
    expect(validateDiscount(v("volume", { tiers: ten })).ok).toBe(true);
  });
  it("cantidad mínima: entera, de 2 a 10.000", () => {
    expect(tiers(["", "5"])?.rows[0]).toEqual({ minQty: "required" });
    expect(tiers(["tres", "5"])?.rows[0]).toEqual({ minQty: "number" });
    expect(tiers(["2,5", "5"])?.rows[0]).toEqual({ minQty: "integer" });
    expect(tiers(["1", "5"])?.rows[0]).toEqual({ minQty: "range" });
    expect(tiers(["10001", "5"])?.rows[0]).toEqual({ minQty: "range" });
    expect(validateDiscount(v("volume", { tiers: [{ minQty: "2", percent: "5" }] })).ok).toBe(true);
    expect(validateDiscount(v("volume", { tiers: [{ minQty: "10000", percent: "5" }] })).ok).toBe(
      true,
    );
  });
  it("las cantidades crecen ESTRICTAMENTE: igual o menor que la anterior se rechaza", () => {
    const e = tiers(["3", "5"], ["3", "10"], ["2", "12"], ["6", "15"]);
    expect(e?.rows).toEqual([{}, { minQty: "order" }, { minQty: "order" }, {}]);
  });
  it("un tramo ya inválido no cuenta como «anterior»: el siguiente se compara con el último bueno", () => {
    // fila 2 inválida (letras): la 3 (4) se compara con la 1 (3), no con la 2
    const e = tiers(["3", "5"], ["x", "10"], ["4", "12"]);
    expect(e?.rows).toEqual([{}, { minQty: "number" }, {}]);
  });
  it("porcentaje de cada tramo: (0, 100], hasta 2 decimales", () => {
    expect(tiers(["3", ""])?.rows[0]).toEqual({ percent: "required" });
    expect(tiers(["3", "0"])?.rows[0]).toEqual({ percent: "range" });
    expect(tiers(["3", "101"])?.rows[0]).toEqual({ percent: "range" });
    expect(tiers(["3", "5,555"])?.rows[0]).toEqual({ percent: "decimals" });
    expect(tiers(["3", "x"])?.rows[0]).toEqual({ percent: "number" });
  });
  it("un error por fila, en el mismo orden", () => {
    const e = tiers(["3", "5"], ["", "0"]);
    expect(e?.rows).toEqual([{}, { minQty: "required", percent: "range" }]);
  });
  it("con alcance de volumen por categoría exige al menos un objetivo", () => {
    expect(errorsOf(v("volume", { scope: "category", targets: [] })).targets).toBe("category");
  });
});

describe("precio por tipo de cliente", () => {
  it("exige un grupo", () => {
    expect(errorsOf(v("group_price", { customerGroupId: "" })).group).toBe("required");
  });
  it("solo este tipo manda el grupo: en otros tipos se ignora aunque haya quedado escrito", () => {
    expect(payloadOf(v("percent", { customerGroupId: "g1" })).customerGroupId).toBeNull();
    expect(payloadOf(v("group_price")).customerGroupId).toBe("g1");
  });
});

describe("alcance y objetivos", () => {
  it("envío gratis solo con alcance «todo el pedido»", () => {
    expect(
      errorsOf(v("free_shipping", { scope: "category", targets: [{ id: "c", label: "C" }] })).scope,
    ).toBe("shipping_scope");
  });
  it("un alcance de productos, categorías o colecciones sin elegir nada falla, y dice qué falta", () => {
    expect(errorsOf(v("percent", { scope: "product" })).targets).toBe("product");
    expect(errorsOf(v("percent", { scope: "category" })).targets).toBe("category");
    expect(errorsOf(v("percent", { scope: "collection" })).targets).toBe("collection");
  });
  it("«todo el pedido» no lleva objetivos aunque queden elegidos de antes", () => {
    const result = validateDiscount(
      v("percent", { scope: "order", targets: [{ id: "x", label: "X" }] }),
    );
    expect(result).toMatchObject({ ok: true, targetIds: [] });
  });
  it("los ids elegidos salen sin repetir y en orden", () => {
    const result = validateDiscount(
      v("percent", {
        scope: "category",
        targets: [
          { id: "b", label: "B" },
          { id: "a", label: "A" },
          { id: "b", label: "B otra vez" },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: true, targetIds: ["b", "a"] });
  });
});

describe("pedido mínimo", () => {
  const min = (text: string) => v("percent", { minOrder: text });
  it("opcional: vacío = null; 0 se respeta tal como se escribió", () => {
    expect(payloadOf(min("")).minOrderAmount).toBeNull();
    expect(payloadOf(min("0")).minOrderAmount).toBe(0);
  });
  it("monto válido con coma", () => {
    expect(payloadOf(min("100")).minOrderAmount).toBe(100);
    expect(payloadOf(min("99,5")).minOrderAmount).toBe(99.5);
    expect(payloadOf(min("9999999999,99")).minOrderAmount).toBe(9_999_999_999.99);
  });
  it("negativo y desde 10.000.000.000: fuera de rango; 3 decimales y letras", () => {
    expect(errorsOf(min("-1")).minOrder).toBe("range");
    expect(errorsOf(min("10000000000")).minOrder).toBe("range");
    expect(errorsOf(min("99,999")).minOrder).toBe("decimals");
    expect(errorsOf(min("cien")).minOrder).toBe("number");
  });
});

describe("vigencia", () => {
  it("sin fechas: null y null", () => {
    expect(payloadOf(v("percent"))).toMatchObject({ startsAt: null, endsAt: null });
  });
  it("la hora se escribe en La Paz (UTC−4) y se envía en UTC", () => {
    const p = payloadOf(v("percent", { startsAt: "2026-12-01T06:00", endsAt: "2026-12-05T18:30" }));
    expect(p.startsAt).toBe("2026-12-01T10:00:00.000Z");
    expect(p.endsAt).toBe("2026-12-05T22:30:00.000Z");
  });
  it("una fecha sin hora o mal escrita no es válida", () => {
    expect(errorsOf(v("percent", { startsAt: "2026-12-01" })).startsAt).toBe("invalid");
    expect(errorsOf(v("percent", { endsAt: "mañana" })).endsAt).toBe("invalid");
  });
  it("el fin debe ser POSTERIOR al inicio: igual o antes se rechaza; un minuto después sí", () => {
    const window = (startsAt: string, endsAt: string) => v("percent", { startsAt, endsAt });
    expect(errorsOf(window("2026-12-01T06:00", "2026-12-01T06:00")).endsAt).toBe("before_start");
    expect(errorsOf(window("2026-12-01T06:00", "2026-12-01T05:59")).endsAt).toBe("before_start");
    expect(validateDiscount(window("2026-12-01T06:00", "2026-12-01T06:01")).ok).toBe(true);
  });
  it("solo inicio o solo fin son válidos en los tipos que no son flash", () => {
    expect(validateDiscount(v("percent", { startsAt: "2026-12-01T06:00" })).ok).toBe(true);
    expect(validateDiscount(v("percent", { endsAt: "2026-12-01T06:00" })).ok).toBe(true);
  });
  it("la oferta flash EXIGE inicio y fin", () => {
    expect(errorsOf(v("flash", { startsAt: "", endsAt: "" }))).toMatchObject({
      startsAt: "required",
      endsAt: "required",
    });
    expect(errorsOf(v("flash", { startsAt: "" })).startsAt).toBe("required");
    expect(errorsOf(v("flash", { endsAt: "" })).endsAt).toBe("required");
  });
});

describe("límites de uso y prioridad", () => {
  it("vacíos = sin tope", () => {
    expect(payloadOf(v("percent"))).toMatchObject({
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
    });
  });
  it("valores válidos", () => {
    expect(
      payloadOf(v("percent", { usageLimitTotal: "100", usageLimitPerCustomer: "1" })),
    ).toMatchObject({ usageLimitTotal: 100, usageLimitPerCustomer: 1 });
    expect(payloadOf(v("percent", { usageLimitTotal: "2147483647" })).usageLimitTotal).toBe(
      2147483647,
    );
  });
  it("0, negativos, decimales, letras y pasarse del entero de la base", () => {
    const total = (text: string) =>
      errorsOf(v("percent", { usageLimitTotal: text })).usageLimitTotal;
    expect(total("0")).toBe("range");
    expect(total("-3")).toBe("range");
    expect(total("2147483648")).toBe("range");
    expect(total("1,5")).toBe("integer");
    expect(total("muchos")).toBe("number");
    expect(errorsOf(v("percent", { usageLimitPerCustomer: "0" })).usageLimitPerCustomer).toBe(
      "range",
    );
  });
  it("prioridad: entero de 0 a 100.000, por defecto 100", () => {
    expect(payloadOf(v("percent")).priority).toBe(100);
    expect(payloadOf(v("percent", { priority: "0" })).priority).toBe(0);
    expect(payloadOf(v("percent", { priority: "100000" })).priority).toBe(100000);
    const priority = (text: string) => errorsOf(v("percent", { priority: text })).priority;
    expect(priority("")).toBe("required");
    expect(priority("alta")).toBe("number");
    expect(priority("1,5")).toBe("integer");
    expect(priority("-1")).toBe("range");
    expect(priority("100001")).toBe("range");
  });
});

describe("¿pide código? y casillas de combinación", () => {
  it("porcentaje y monto SIEMPRE con código, aunque la casilla diga otra cosa", () => {
    expect(payloadOf(v("percent", { requiresCoupon: false })).requiresCoupon).toBe(true);
    expect(payloadOf(v("fixed", { requiresCoupon: false })).requiresCoupon).toBe(true);
  });
  it("2×1, volumen, grupo y flash NUNCA con código, aunque la casilla diga otra cosa", () => {
    for (const kind of ["bogo", "volume", "group_price", "flash"] as const) {
      expect(payloadOf(v(kind, { requiresCoupon: true })).requiresCoupon).toBe(false);
    }
  });
  it("envío gratis y primera compra respetan lo elegido", () => {
    for (const kind of ["free_shipping", "first_purchase"] as const) {
      expect(payloadOf(v(kind, { requiresCoupon: true })).requiresCoupon).toBe(true);
      expect(payloadOf(v(kind, { requiresCoupon: false })).requiresCoupon).toBe(false);
    }
  });
  it("«se suma» y «no rebajados» se envían en un cupón que descuenta producto", () => {
    expect(payloadOf(v("percent", { stackable: true, excludeSale: true }))).toMatchObject({
      stackableWithAutomatic: true,
      excludeSaleItems: true,
    });
    expect(payloadOf(v("first_purchase", { requiresCoupon: true, stackable: true }))).toMatchObject(
      { stackableWithAutomatic: true, excludeSaleItems: false },
    );
  });
  it("en una oferta automática o en un envío gratis se envían APAGADAS aunque queden marcadas", () => {
    expect(payloadOf(v("bogo", { stackable: true, excludeSale: true }))).toMatchObject({
      stackableWithAutomatic: false,
      excludeSaleItems: false,
    });
    expect(
      payloadOf(v("free_shipping", { requiresCoupon: true, stackable: true, excludeSale: true })),
    ).toMatchObject({ stackableWithAutomatic: false, excludeSaleItems: false });
    expect(
      payloadOf(v("first_purchase", { requiresCoupon: false, stackable: true })),
    ).toMatchObject({ stackableWithAutomatic: false });
  });
  it("activo se respeta", () => {
    expect(payloadOf(v("percent", { isActive: false })).isActive).toBe(false);
  });
});

describe("varios errores a la vez", () => {
  it("devuelve todos los de cada campo, no solo el primero", () => {
    const errors = errorsOf(
      v("percent", {
        name: "",
        percent: "0",
        maxAmount: "-1",
        minOrder: "x",
        priority: "",
        usageLimitTotal: "0",
      }),
    );
    expect(errors).toEqual({
      name: "required",
      percent: "range",
      maxAmount: "range",
      minOrder: "number",
      priority: "required",
      usageLimitTotal: "range",
    });
  });
});

describe("toUpdateInput", () => {
  it("quita el tipo, el alcance y la moneda (no se cambian al editar) y deja todo lo demás", () => {
    const payload = payloadOf(v("percent", { maxAmount: "30", minOrder: "50", priority: "7" }));
    expect(toUpdateInput(payload)).toEqual({
      name: "Prueba",
      params: { kind: "percent", percent: 10, maxAmount: 30 },
      minOrderAmount: 50,
      customerGroupId: null,
      requiresCoupon: true,
      stackableWithAutomatic: false,
      excludeSaleItems: false,
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
      priority: 7,
      startsAt: null,
      endsAt: null,
      isActive: true,
    });
  });
});

describe("valuesFromDiscount (editar)", () => {
  const discount = (over: Partial<Discount> = {}): Discount => ({
    id: "d1",
    name: "Verano 10",
    kind: "percent",
    params: { kind: "percent", percent: 10, maxAmount: null },
    scope: "order",
    currency: "BOB",
    minOrderAmount: null,
    customerGroupId: null,
    requiresCoupon: true,
    stackableWithAutomatic: false,
    excludeSaleItems: false,
    usageLimitTotal: null,
    usageLimitPerCustomer: null,
    priority: 100,
    startsAt: null,
    endsAt: null,
    isActive: true,
    archived: false,
    updatedAt: "2026-11-05T10:00:00.123456+00:00",
    ...over,
  });

  it("copia los valores como los escribiría una persona (coma decimal, hora de La Paz)", () => {
    const values = valuesFromDiscount(
      discount({
        params: { kind: "percent", percent: 12.5, maxAmount: 30.5 },
        minOrderAmount: 99.9,
        usageLimitTotal: 100,
        usageLimitPerCustomer: 1,
        priority: 250,
        startsAt: "2026-12-01T10:00:00+00:00",
        endsAt: "2026-12-05T22:30:00+00:00",
        stackableWithAutomatic: true,
        excludeSaleItems: true,
        isActive: false,
      }),
      [],
    );
    expect(values).toMatchObject({
      name: "Verano 10",
      percent: "12,5",
      maxAmount: "30,5",
      minOrder: "99,9",
      usageLimitTotal: "100",
      usageLimitPerCustomer: "1",
      priority: "250",
      startsAt: "2026-12-01T06:00",
      endsAt: "2026-12-05T18:30",
      stackable: true,
      excludeSale: true,
      isActive: false,
      requiresCoupon: true,
    });
  });

  it("de ida y vuelta: abrir y guardar SIN tocar nada reenvía lo mismo, para los 8 tipos", () => {
    const cases: { input: Partial<Discount>; targets?: { id: string; label: string }[] }[] = [
      { input: {} },
      {
        input: {
          kind: "fixed",
          params: { kind: "fixed", amount: 20.5 },
          scope: "category",
          minOrderAmount: 100,
        },
        targets: [{ id: "c1", label: "Verano" }],
      },
      {
        input: {
          kind: "free_shipping",
          params: { kind: "free_shipping" },
          requiresCoupon: false,
          minOrderAmount: 200,
        },
      },
      {
        input: {
          kind: "bogo",
          params: { kind: "bogo", take: 3, pay: 2 },
          scope: "collection",
          requiresCoupon: false,
        },
        targets: [{ id: "k1", label: "Verano" }],
      },
      {
        input: {
          kind: "volume",
          params: {
            kind: "volume",
            tiers: [
              { minQty: 3, percent: 5 },
              { minQty: 6, percent: 10.25 },
            ],
          },
          requiresCoupon: false,
        },
      },
      {
        input: {
          kind: "group_price",
          params: { kind: "group_price", percent: 15, maxAmount: 40 },
          customerGroupId: "g1",
          requiresCoupon: false,
        },
      },
      {
        input: {
          kind: "flash",
          params: { kind: "flash", percent: 20, maxAmount: null },
          requiresCoupon: false,
          startsAt: "2026-12-01T10:00:00+00:00",
          endsAt: "2026-12-01T12:00:00+00:00",
        },
      },
      {
        input: {
          kind: "first_purchase",
          params: { kind: "first_purchase", percent: 10, maxAmount: null },
          requiresCoupon: true,
          stackableWithAutomatic: true,
          usageLimitPerCustomer: 1,
        },
      },
    ];
    for (const { input, targets } of cases) {
      const d = discount(input);
      const result = validateDiscount(valuesFromDiscount(d, targets ?? []));
      expect(result.ok, `${d.kind}`).toBe(true);
      if (!result.ok) continue;
      expect(result.payload).toMatchObject({
        name: d.name,
        kind: d.kind,
        params: d.params,
        scope: d.scope,
        currency: d.currency,
        minOrderAmount: d.minOrderAmount,
        customerGroupId: d.customerGroupId,
        requiresCoupon: d.requiresCoupon,
        stackableWithAutomatic: d.stackableWithAutomatic,
        excludeSaleItems: d.excludeSaleItems,
        usageLimitTotal: d.usageLimitTotal,
        usageLimitPerCustomer: d.usageLimitPerCustomer,
        priority: d.priority,
        isActive: d.isActive,
      });
      // las fechas vuelven al MISMO instante
      expect(result.payload.startsAt && new Date(result.payload.startsAt).getTime()).toBe(
        d.startsAt ? new Date(d.startsAt).getTime() : null,
      );
      expect(result.payload.endsAt && new Date(result.payload.endsAt).getTime()).toBe(
        d.endsAt ? new Date(d.endsAt).getTime() : null,
      );
    }
  });

  it("parámetros ilegibles (null): los campos del tipo arrancan vacíos y no se puede guardar sin volver a ingresarlos", () => {
    for (const [kind, field] of [
      ["percent", "percent"],
      ["fixed", "amount"],
      ["bogo", "take"],
    ] as const) {
      const values = valuesFromDiscount(discount({ kind, params: null }), []);
      expect(values[field], kind).toBe("");
      expect(validateDiscount(values).ok, kind).toBe(false);
    }
    const volume = valuesFromDiscount(discount({ kind: "volume", params: null }), []);
    expect(volume.tiers).toEqual([emptyTier()]);
    expect(validateDiscount(volume).ok).toBe(false);
  });

  it("un volumen con lista de tramos vacía arranca con un tramo en blanco", () => {
    const values = valuesFromDiscount(
      discount({ kind: "volume", params: { kind: "volume", tiers: [] } }),
      [],
    );
    expect(values.tiers).toEqual([emptyTier()]);
  });

  it("conserva los objetivos que ya tenía", () => {
    const targets = [{ id: "c1", label: "Verano" }];
    expect(valuesFromDiscount(discount({ scope: "category" }), targets).targets).toEqual(targets);
  });
});

describe("previewDescribable (vista previa a medio llenar)", () => {
  it("sin lo que pide el tipo no hay vista previa", () => {
    expect(previewDescribable(initialValues("percent", "BOB"))).toBeNull();
    expect(previewDescribable(initialValues("fixed", "BOB"))).toBeNull();
    expect(previewDescribable(initialValues("volume", "BOB"))).toBeNull();
    expect(previewDescribable({ ...initialValues("bogo", "BOB"), take: "2", pay: "2" })).toBeNull();
    expect(
      previewDescribable({ ...initialValues("bogo", "BOB"), take: "21", pay: "1" }),
    ).toBeNull();
  });
  it("lo opcional ilegible se ignora en vez de borrar la vista previa", () => {
    const d = previewDescribable({
      ...initialValues("percent", "BOB"),
      percent: "10",
      maxAmount: "abc",
      minOrder: "x",
      usageLimitTotal: "-1",
      startsAt: "mal",
    });
    expect(d).toMatchObject({
      params: { kind: "percent", percent: 10, maxAmount: null },
      minOrderAmount: null,
      usageLimitTotal: null,
      startsAt: null,
    });
  });
  it("en volumen cuentan los tramos ya completos", () => {
    const d = previewDescribable({
      ...initialValues("volume", "BOB"),
      tiers: [
        { minQty: "3", percent: "5" },
        { minQty: "", percent: "10" },
      ],
    });
    expect(d?.params).toEqual({ kind: "volume", tiers: [{ minQty: 3, percent: 5 }] });
  });
  it("aplica las mismas reglas de código y casillas que al guardar", () => {
    const bogo = previewDescribable({
      ...initialValues("bogo", "BOB"),
      stackable: true,
      requiresCoupon: true,
    });
    expect(bogo).toMatchObject({ requiresCoupon: false, stackableWithAutomatic: false });
    const percent = previewDescribable({
      ...initialValues("percent", "BOB"),
      percent: "10",
      stackable: true,
    });
    expect(percent).toMatchObject({ requiresCoupon: true, stackableWithAutomatic: true });
  });
  it("el grupo solo cuenta en el precio por tipo de cliente", () => {
    const g = (kind: DiscountKind) =>
      previewDescribable({ ...initialValues(kind, "BOB"), percent: "10", customerGroupId: "g1" })
        ?.customerGroupId;
    expect(g("group_price")).toBe("g1");
    expect(g("percent")).toBeNull();
  });
});

describe("problemText", () => {
  it("todos los problemas de todos los campos tienen texto en español (ninguno devuelve la clave)", () => {
    for (const [field, problems] of Object.entries(FIELD_PROBLEMS)) {
      for (const problem of problems) {
        const text = (problemText as (f: string, p: string) => string)(field, problem);
        expect(text, `${field}.${problem}`).not.toMatch(/^admin\./);
        expect(text.trim().length, `${field}.${problem}`).toBeGreaterThan(0);
      }
    }
  });
  it("los problemas de número comparten texto; el rango es de cada campo", () => {
    expect(problemText("percent", "number")).toBe(problemText("amount", "number"));
    expect(problemText("percent", "range")).toBe("Debe ser mayor que 0 y no pasar de 100.");
    expect(problemText("take", "range")).toBe("Debe estar entre 2 y 20.");
    expect(problemText("targets", "category")).toBe("Elige al menos una categoría.");
  });
  it("una clave inventada se vería (la prueba de arriba la detectaría)", () => {
    expect(t("admin.discounts.wizard.errors.percent.nope" as MessageKey)).toBe(
      "admin.discounts.wizard.errors.percent.nope",
    );
  });
});

describe("un valor imposible nunca llega a DiscountParams", () => {
  it("los parámetros enviados siempre cumplen las reglas de la base", () => {
    const cases: DiscountParams[] = [];
    for (const percent of ["0,01", "50", "100"]) {
      const p = payloadOf(v("percent", { percent })).params;
      cases.push(p);
    }
    for (const p of cases) {
      if (p.kind === "percent") {
        expect(p.percent).toBeGreaterThan(0);
        expect(p.percent).toBeLessThanOrEqual(100);
      }
    }
  });
});

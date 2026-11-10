import { describe, expect, it } from "vitest";
import {
  describeDiscount,
  describeParts,
  describeScope,
  describeWindow,
  formatMoment,
  formatPercent,
  type Describable,
  type DiscountNames,
} from "./describe";
import type { DiscountParams } from "./types";

const none: DiscountNames = { targets: [], group: null };
const named = (...targets: string[]): DiscountNames => ({ targets, group: null });

/** Un descuento base (porcentaje con código, todo el pedido); cada prueba cambia lo que le interesa. */
const disc = (over: Partial<Describable> & { params: DiscountParams }): Describable => ({
  kind: over.params.kind,
  scope: "order",
  currency: "BOB",
  minOrderAmount: null,
  customerGroupId: null,
  requiresCoupon: false,
  stackableWithAutomatic: false,
  excludeSaleItems: false,
  usageLimitTotal: null,
  usageLimitPerCustomer: null,
  startsAt: null,
  endsAt: null,
  ...over,
});
const pct = (percent: number, maxAmount: number | null = null): DiscountParams => ({
  kind: "percent",
  percent,
  maxAmount,
});
const effect = (d: Describable, names: DiscountNames = none) => describeParts(d, names).effect;

describe("formatPercent", () => {
  it("entero sin decimales y con coma decimal", () => {
    expect(formatPercent(10)).toBe("10 %");
    expect(formatPercent(12.5)).toBe("12,5 %");
    expect(formatPercent(0.25)).toBe("0,25 %");
    expect(formatPercent(100)).toBe("100 %");
  });
});

describe("porcentaje con código", () => {
  const base = disc({ params: pct(10), requiresCoupon: true });
  it("toda la bolsa", () => {
    expect(effect(base)).toBe("10 % en toda la bolsa con el código");
  });
  it("decimales con coma", () => {
    expect(effect(disc({ params: pct(12.5), requiresCoupon: true }))).toBe(
      "12,5 % en toda la bolsa con el código",
    );
  });
  it("con tope (monto exacto, con coma y con miles)", () => {
    expect(effect(disc({ params: pct(10, 50), requiresCoupon: true }))).toBe(
      "10 % en toda la bolsa con el código, con tope de Bs 50",
    );
    expect(effect(disc({ params: pct(10, 12.5), requiresCoupon: true }))).toBe(
      "10 % en toda la bolsa con el código, con tope de Bs 12,50",
    );
    expect(effect(disc({ params: pct(10, 1500), requiresCoupon: true }))).toBe(
      "10 % en toda la bolsa con el código, con tope de Bs 1.500",
    );
  });
  it("con mínimo de compra, después del tope", () => {
    expect(effect(disc({ params: pct(10), requiresCoupon: true, minOrderAmount: 100 }))).toBe(
      "10 % en toda la bolsa con el código (mínimo Bs 100)",
    );
    expect(effect(disc({ params: pct(10, 50), requiresCoupon: true, minOrderAmount: 100 }))).toBe(
      "10 % en toda la bolsa con el código, con tope de Bs 50 (mínimo Bs 100)",
    );
  });
  it("un mínimo de 0 es «sin mínimo»", () => {
    expect(effect(disc({ params: pct(10), requiresCoupon: true, minOrderAmount: 0 }))).toBe(
      "10 % en toda la bolsa con el código",
    );
  });
  it("alcance por categoría, colección o producto", () => {
    const d = (scope: "product" | "category" | "collection") =>
      disc({ params: pct(10), requiresCoupon: true, scope });
    expect(effect(d("category"), named("Verano"))).toBe(
      "10 % en los productos de la categoría Verano con el código",
    );
    expect(effect(d("collection"), named("Verano"))).toBe(
      "10 % en los productos de la colección Verano con el código",
    );
    expect(effect(d("product"), named("Camisa de lino"))).toBe(
      "10 % en el producto Camisa de lino con el código",
    );
  });
});

describe("monto fijo con código", () => {
  it("el ejemplo del encargo: categoría Verano con mínimo Bs 100", () => {
    const d = disc({
      params: { kind: "fixed", amount: 20 },
      requiresCoupon: true,
      scope: "category",
      minOrderAmount: 100,
    });
    expect(effect(d, named("Verano"))).toBe(
      "Bs 20 de descuento en los productos de la categoría Verano con el código (mínimo Bs 100)",
    );
  });
  it("centavos con coma y toda la bolsa", () => {
    expect(effect(disc({ params: { kind: "fixed", amount: 12.5 }, requiresCoupon: true }))).toBe(
      "Bs 12,50 de descuento en toda la bolsa con el código",
    );
  });
  it("usa el símbolo de la moneda del descuento", () => {
    expect(
      effect(disc({ params: { kind: "fixed", amount: 5 }, requiresCoupon: true, currency: "USD" })),
    ).toBe("$ 5 de descuento en toda la bolsa con el código");
  });
});

describe("envío gratis", () => {
  const free = { kind: "free_shipping" } as const;
  it("desde un monto (automático)", () => {
    expect(effect(disc({ params: free, minOrderAmount: 200 }))).toBe("Envío gratis desde Bs 200");
  });
  it("sin mínimo, y un mínimo de 0 también", () => {
    expect(effect(disc({ params: free }))).toBe("Envío gratis en todos los pedidos");
    expect(effect(disc({ params: free, minOrderAmount: 0 }))).toBe(
      "Envío gratis en todos los pedidos",
    );
  });
  it("con código", () => {
    expect(effect(disc({ params: free, minOrderAmount: 200, requiresCoupon: true }))).toBe(
      "Envío gratis desde Bs 200 con el código",
    );
    expect(effect(disc({ params: free, requiresCoupon: true }))).toBe(
      "Envío gratis en todos los pedidos con el código",
    );
  });
  it("con código NO habla de sumarse a las ofertas (el envío se resuelve aparte)", () => {
    expect(describeParts(disc({ params: free, requiresCoupon: true }), none).details).toEqual([]);
  });
});

describe("llévate N, paga M", () => {
  const bogo = (take: number, pay: number): DiscountParams => ({ kind: "bogo", take, pay });
  it("el ejemplo del encargo: 2×1 en la colección Verano", () => {
    expect(effect(disc({ params: bogo(2, 1), scope: "collection" }), named("Verano"))).toBe(
      "2×1 en la colección Verano: se regala el más barato",
    );
  });
  it("3×2 regala UNO; 4×2 y 3×1 regalan DOS", () => {
    expect(effect(disc({ params: bogo(3, 2), scope: "category" }), named("Ropa"))).toBe(
      "3×2 en la categoría Ropa: se regala el más barato",
    );
    expect(effect(disc({ params: bogo(4, 2), scope: "product" }), named("Camisa"))).toBe(
      "4×2 en el producto Camisa: se regalan los 2 más baratos",
    );
    expect(effect(disc({ params: bogo(3, 1), scope: "product" }), named("Camisa"))).toBe(
      "3×1 en el producto Camisa: se regalan los 2 más baratos",
    );
    expect(effect(disc({ params: bogo(20, 1), scope: "product" }), named("Camisa"))).toBe(
      "20×1 en el producto Camisa: se regalan los 19 más baratos",
    );
  });
  it("con mínimo de compra", () => {
    expect(
      effect(disc({ params: bogo(2, 1), scope: "category", minOrderAmount: 50 }), named("Ropa")),
    ).toBe("2×1 en la categoría Ropa: se regala el más barato (mínimo Bs 50)");
  });
  it("varias categorías en plural", () => {
    expect(effect(disc({ params: bogo(2, 1), scope: "category" }), named("Verano", "Ropa"))).toBe(
      "2×1 en las categorías Verano y Ropa: se regala el más barato",
    );
  });
});

describe("descuento por volumen", () => {
  const vol = (...tiers: [number, number][]): DiscountParams => ({
    kind: "volume",
    tiers: tiers.map(([minQty, percent]) => ({ minQty, percent })),
  });
  it("el ejemplo del encargo: 5 % desde 3 unidades y 10 % desde 6", () => {
    expect(effect(disc({ params: vol([3, 5], [6, 10]) }))).toBe(
      "5 % desde 3 unidades y 10 % desde 6",
    );
  });
  it("un solo tramo", () => {
    expect(effect(disc({ params: vol([3, 5]) }))).toBe("5 % desde 3 unidades");
  });
  it("tres tramos: comas y «y» antes del último, con decimales", () => {
    expect(effect(disc({ params: vol([2, 5], [5, 10], [10, 12.5]) }))).toBe(
      "5 % desde 2 unidades, 10 % desde 5 y 12,5 % desde 10",
    );
  });
  it("los tramos salen de menor a mayor aunque lleguen desordenados", () => {
    expect(effect(disc({ params: vol([6, 10], [3, 5]) }))).toBe(
      "5 % desde 3 unidades y 10 % desde 6",
    );
  });
  it("con alcance y con mínimo", () => {
    expect(
      effect(
        disc({ params: vol([3, 5], [6, 10]), scope: "category", minOrderAmount: 80 }),
        named("Verano"),
      ),
    ).toBe(
      "5 % desde 3 unidades y 10 % desde 6 en los productos de la categoría Verano (mínimo Bs 80)",
    );
  });
});

describe("precio por tipo de cliente", () => {
  const group = (percent: number, maxAmount: number | null = null): DiscountParams => ({
    kind: "group_price",
    percent,
    maxAmount,
  });
  it("el ejemplo del encargo: 15 % para el grupo Mayoristas", () => {
    expect(
      effect(disc({ params: group(15), customerGroupId: "g1" }), {
        targets: [],
        group: "Mayoristas",
      }),
    ).toBe("15 % para el grupo Mayoristas");
  });
  it("grupo elegido pero su nombre aún no se conoce", () => {
    expect(effect(disc({ params: group(15), customerGroupId: "g1" }))).toBe(
      "15 % para un grupo de clientes",
    );
  });
  it("todavía sin grupo (vista previa)", () => {
    expect(effect(disc({ params: group(15) }))).toBe("15 % para el grupo que elijas");
  });
  it("con alcance, tope y mínimo", () => {
    expect(
      effect(
        disc({
          params: group(15, 30),
          customerGroupId: "g1",
          scope: "collection",
          minOrderAmount: 100,
        }),
        { targets: ["Verano"], group: "Mayoristas" },
      ),
    ).toBe(
      "15 % para el grupo Mayoristas en los productos de la colección Verano, con tope de Bs 30 (mínimo Bs 100)",
    );
  });
});

describe("oferta flash", () => {
  const flash = (percent: number, maxAmount: number | null = null): DiscountParams => ({
    kind: "flash",
    percent,
    maxAmount,
  });
  it("el ejemplo del encargo (06:00 a 08:00 de La Paz = 10:00 a 12:00 UTC)", () => {
    expect(
      effect(
        disc({
          params: flash(20),
          startsAt: "2026-12-01T10:00:00.000Z",
          endsAt: "2026-12-01T12:00:00.000Z",
        }),
      ),
    ).toBe("Oferta flash: 20 % del 1 de dic. 06:00 al 1 de dic. 08:00 (hora de La Paz)");
  });
  it("la hora es la de La Paz, no la UTC: 03:59 UTC es 23:59 del día anterior", () => {
    expect(
      effect(
        disc({
          params: flash(20),
          startsAt: "2026-12-01T03:59:00.000Z",
          endsAt: "2026-12-10T22:30:00.000Z",
        }),
      ),
    ).toBe("Oferta flash: 20 % del 30 de nov. 23:59 al 10 de dic. 18:30 (hora de La Paz)");
  });
  it("con alcance, tope y mínimo", () => {
    expect(
      effect(
        disc({
          params: flash(20, 40),
          scope: "category",
          minOrderAmount: 60,
          startsAt: "2026-12-01T10:00:00.000Z",
          endsAt: "2026-12-01T12:00:00.000Z",
        }),
        named("Verano"),
      ),
    ).toBe(
      "Oferta flash: 20 % en los productos de la categoría Verano del 1 de dic. 06:00 al 1 de dic. 08:00 (hora de La Paz), con tope de Bs 40 (mínimo Bs 60)",
    );
  });
  it("sin fechas (a medio llenar) lo dice en vez de inventarlas", () => {
    expect(effect(disc({ params: flash(20) }))).toBe(
      "Oferta flash: 20 % (falta indicar cuándo empieza y cuándo termina)",
    );
    expect(effect(disc({ params: flash(20), startsAt: "2026-12-01T10:00:00.000Z" }))).toBe(
      "Oferta flash: 20 % (falta indicar cuándo empieza y cuándo termina)",
    );
  });
});

describe("primera compra", () => {
  const first = (percent: number, maxAmount: number | null = null): DiscountParams => ({
    kind: "first_purchase",
    percent,
    maxAmount,
  });
  it("el ejemplo del encargo: 10 % en tu primera compra", () => {
    expect(effect(disc({ params: first(10) }))).toBe("10 % en tu primera compra");
  });
  it("con código, con alcance, con tope y con mínimo", () => {
    expect(effect(disc({ params: first(10), requiresCoupon: true }))).toBe(
      "10 % en tu primera compra con el código",
    );
    expect(
      effect(
        disc({ params: first(10, 25), scope: "category", minOrderAmount: 90 }),
        named("Verano"),
      ),
    ).toBe(
      "10 % en tu primera compra, en los productos de la categoría Verano, con tope de Bs 25 (mínimo Bs 90)",
    );
  });
});

describe("usos y combinación con las ofertas", () => {
  const details = (over: Partial<Describable>) =>
    describeParts({ ...disc({ params: pct(10), requiresCoupon: true }), ...over }, none).details;
  it("máximo de usos: singular y plural", () => {
    expect(details({ usageLimitTotal: 1 })[0]).toBe("máx. 1 uso");
    expect(details({ usageLimitTotal: 100 })[0]).toBe("máx. 100 usos");
  });
  it("por clienta", () => {
    expect(details({ usageLimitPerCustomer: 1 })[0]).toBe("1 por clienta");
    expect(details({ usageLimitPerCustomer: 3 })[0]).toBe("3 por clienta");
  });
  it("un cupón dice si se suma o no a las ofertas, y si deja fuera lo rebajado", () => {
    expect(details({ stackableWithAutomatic: true })).toEqual(["se suma a las ofertas"]);
    expect(details({ stackableWithAutomatic: false })).toEqual([
      "no se suma a las ofertas (se aplica la mejor de las dos)",
    ]);
    expect(details({ stackableWithAutomatic: true, excludeSaleItems: true })).toEqual([
      "se suma a las ofertas",
      "no se aplica a productos ya rebajados",
    ]);
  });
  it("una oferta automática NO habla de sumarse aunque sus casillas estén marcadas", () => {
    expect(
      describeParts(
        disc({
          params: { kind: "bogo", take: 2, pay: 1 },
          scope: "product",
          stackableWithAutomatic: true,
          excludeSaleItems: true,
        }),
        named("Camisa"),
      ).details,
    ).toEqual([]);
  });
  it("la frase completa une efecto, usos y combinación con «·»", () => {
    expect(
      describeDiscount(
        disc({
          params: pct(10),
          requiresCoupon: true,
          usageLimitTotal: 100,
          usageLimitPerCustomer: 1,
          stackableWithAutomatic: true,
        }),
        none,
      ),
    ).toBe(
      "10 % en toda la bolsa con el código · máx. 100 usos · 1 por clienta · se suma a las ofertas",
    );
  });
  it("sin usos ni combinación (automático) la frase es solo el efecto, sin punto ni separador", () => {
    expect(
      describeDiscount(disc({ params: { kind: "free_shipping" }, minOrderAmount: 200 }), none),
    ).toBe("Envío gratis desde Bs 200");
  });
});

describe("nombres del alcance", () => {
  const cat = (names: DiscountNames) =>
    effect(disc({ params: pct(10), requiresCoupon: true, scope: "category" }), names);
  it("uno, dos y tres nombres", () => {
    expect(cat(named("Verano"))).toBe("10 % en los productos de la categoría Verano con el código");
    expect(cat(named("Verano", "Ropa"))).toBe(
      "10 % en los productos de las categorías Verano y Ropa con el código",
    );
    expect(cat(named("Verano", "Ropa", "Calzado"))).toBe(
      "10 % en los productos de las categorías Verano, Ropa y Calzado con el código",
    );
  });
  it("más de tres: muestra tres y resume el resto", () => {
    expect(cat(named("A", "B", "C", "D"))).toBe(
      "10 % en los productos de las categorías A, B, C y 1 más con el código",
    );
    expect(cat(named("A", "B", "C", "D", "E", "F"))).toBe(
      "10 % en los productos de las categorías A, B, C y 3 más con el código",
    );
  });
  it("hay más objetivos que nombres conocidos: cuenta los que faltan", () => {
    expect(cat({ targets: ["A", "B", "C"], targetCount: 5, group: null })).toBe(
      "10 % en los productos de las categorías A, B, C y 2 más con el código",
    );
  });
  it("sin nombres pero con cuenta (productos en el listado): singular y plural", () => {
    const prod = (count: number) =>
      effect(disc({ params: pct(10), requiresCoupon: true, scope: "product" }), {
        targets: [],
        targetCount: count,
        group: null,
      });
    expect(prod(1)).toBe("10 % en 1 producto elegido con el código");
    expect(prod(3)).toBe("10 % en 3 productos elegidos con el código");
    expect(cat({ targets: [], targetCount: 1, group: null })).toBe(
      "10 % en los productos de 1 categoría elegida con el código",
    );
    expect(cat({ targets: [], targetCount: 4, group: null })).toBe(
      "10 % en los productos de 4 categorías elegidas con el código",
    );
  });
  it("todavía sin elegir (vista previa): dice que falta elegir", () => {
    expect(cat(none)).toBe("10 % en los productos de las categorías que elijas con el código");
    expect(effect(disc({ params: pct(10), requiresCoupon: true, scope: "product" }), none)).toBe(
      "10 % en los productos que elijas con el código",
    );
    expect(effect(disc({ params: pct(10), requiresCoupon: true, scope: "collection" }), none)).toBe(
      "10 % en los productos de las colecciones que elijas con el código",
    );
  });
  it("no se pudieron leer los objetivos (null): habla de «los elegidos» sin inventar cuántos", () => {
    expect(cat({ targets: null, group: null })).toBe(
      "10 % en los productos de las categorías elegidas con el código",
    );
  });
  it("el nombre de una sola categoría con un solo objetivo conocido pero targetCount mayor es plural", () => {
    expect(cat({ targets: ["A"], targetCount: 2, group: null })).toBe(
      "10 % en los productos de las categorías A y 1 más con el código",
    );
  });
});

describe("describeScope (columna «Alcance»)", () => {
  const scope = (s: "order" | "product" | "category" | "collection", names: DiscountNames) =>
    describeScope({ scope: s }, names);
  it("todo el pedido, con o sin nombres", () => {
    expect(scope("order", none)).toBe("Todo el pedido");
    expect(scope("order", named("ignorado"))).toBe("Todo el pedido");
  });
  it("con nombres: singular y plural, y más de tres se resumen", () => {
    expect(scope("category", named("Verano"))).toBe("Categoría: Verano");
    expect(scope("category", named("Verano", "Ropa"))).toBe("Categorías: Verano y Ropa");
    expect(scope("collection", named("Verano"))).toBe("Colección: Verano");
    expect(scope("product", named("A", "B", "C", "D"))).toBe("Productos: A, B, C y 1 más");
    expect(scope("product", named("Camisa"))).toBe("Producto: Camisa");
  });
  it("solo con cuenta: «1 producto», «3 productos»", () => {
    expect(scope("product", { targets: [], targetCount: 1, group: null })).toBe("1 producto");
    expect(scope("product", { targets: [], targetCount: 3, group: null })).toBe("3 productos");
    expect(scope("category", { targets: [], targetCount: 2, group: null })).toBe("2 categorías");
  });
  it("sin objetivos: «Sin elegir todavía»; sin saberlo: «—»", () => {
    expect(scope("product", none)).toBe("Sin elegir todavía");
    expect(scope("category", { targets: null, group: null })).toBe("—");
  });
});

describe("parámetros ilegibles", () => {
  it("no inventa nada: lo dice", () => {
    const d: Describable = { ...disc({ params: pct(10) }), params: null };
    expect(effect(d)).toBe("No se pueden leer sus parámetros");
  });
});

describe("describeWindow y formatMoment", () => {
  const T1 = "2026-12-01T10:00:00.000Z"; // 06:00 en La Paz
  const T2 = "2026-12-05T22:00:00.000Z"; // 18:00 en La Paz
  it("sin fechas, solo inicio, solo fin y rango", () => {
    expect(describeWindow({ startsAt: null, endsAt: null })).toBe(
      "Sin fechas: vale desde que lo activas hasta que lo desactives",
    );
    expect(describeWindow({ startsAt: T1, endsAt: null })).toBe(
      "Vale desde el 1 de dic. 06:00 (hora de La Paz)",
    );
    expect(describeWindow({ startsAt: null, endsAt: T2 })).toBe(
      "Vale hasta el 5 de dic. 18:00 (hora de La Paz)",
    );
    expect(describeWindow({ startsAt: T1, endsAt: T2 })).toBe(
      "Vale del 1 de dic. 06:00 al 5 de dic. 18:00 (hora de La Paz)",
    );
  });
  it("con año para las tablas", () => {
    expect(formatMoment(T1, true)).toBe("1 dic. 2026, 06:00");
    expect(formatMoment("2027-05-31T20:05:00.000Z", true)).toBe("31 may. 2027, 16:05");
  });
  it("un valor ilegible se muestra tal cual, sin romper la pantalla", () => {
    expect(formatMoment("no es una fecha")).toBe("no es una fecha");
  });
});

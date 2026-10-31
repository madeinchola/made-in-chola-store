import { describe, expect, it } from "vitest";
import {
  bannerStatus,
  shownBannerId,
  validateBanner,
  type BannerFormValues,
  type BannerLike,
  type BannerOrderable,
} from "./bannerLogic";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const b = (over: Partial<BannerLike> = {}): BannerLike => ({
  isActive: true,
  archived: false,
  startsAt: null,
  endsAt: null,
  ...over,
});

describe("bannerStatus (mismas reglas que public_news_banners)", () => {
  it("sin fechas y activo: vigente", () => {
    expect(bannerStatus(b(), NOW)).toBe("live");
  });
  it("archivado gana sobre todo lo demás", () => {
    expect(bannerStatus(b({ archived: true, isActive: false }), NOW)).toBe("archived");
    expect(bannerStatus(b({ archived: true }), NOW)).toBe("archived");
  });
  it("inactivo (sin archivar): inactivo, aunque su ventana esté vigente", () => {
    expect(bannerStatus(b({ isActive: false }), NOW)).toBe("inactive");
  });
  it("empieza en el futuro: programado", () => {
    expect(bannerStatus(b({ startsAt: "2026-10-30T12:00:00.001Z" }), NOW)).toBe("scheduled");
  });
  it("límite del inicio: starts_at == ahora YA es vigente (la vista usa starts_at <= now)", () => {
    expect(bannerStatus(b({ startsAt: "2026-10-30T12:00:00.000Z" }), NOW)).toBe("live");
  });
  it("límite del fin: ends_at == ahora YA venció (la vista usa ends_at > now)", () => {
    expect(bannerStatus(b({ endsAt: "2026-10-30T12:00:00.000Z" }), NOW)).toBe("expired");
    expect(bannerStatus(b({ endsAt: "2026-10-30T12:00:00.001Z" }), NOW)).toBe("live");
  });
  it("ventana que contiene ahora: vigente; ventana pasada: vencido", () => {
    expect(
      bannerStatus(b({ startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }), NOW),
    ).toBe("live");
    expect(
      bannerStatus(b({ startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" }), NOW),
    ).toBe("expired");
  });
  it("programado gana sobre vencido si ambos se dan (fechas incoherentes en datos viejos)", () => {
    expect(
      bannerStatus(b({ startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" }), NOW),
    ).toBe("scheduled");
  });
});

describe("shownBannerId (la tienda toma el primero de la vista)", () => {
  const o = (id: string, over: Partial<BannerOrderable> = {}): BannerOrderable => ({
    id,
    createdAt: "2026-01-01T00:00:00Z",
    ...b(),
    ...over,
  });

  it("ninguno vigente: null", () => {
    expect(
      shownBannerId([o("a", { isActive: false }), o("b", { archived: true })], NOW),
    ).toBeNull();
    expect(shownBannerId([], NOW)).toBeNull();
  });
  it("gana el que empezó más recientemente", () => {
    const list = [
      o("viejo", { startsAt: "2026-09-01T00:00:00Z" }),
      o("nuevo", { startsAt: "2026-10-15T00:00:00Z" }),
    ];
    expect(shownBannerId(list, NOW)).toBe("nuevo");
  });
  it("un banner con fecha de inicio gana a uno sin fecha (nulls al final)", () => {
    expect(shownBannerId([o("sin"), o("con", { startsAt: "2020-01-01T00:00:00Z" })], NOW)).toBe(
      "con",
    );
  });
  it("con el mismo inicio desempata el creado más recientemente", () => {
    const list = [
      o("a", { createdAt: "2026-02-01T00:00:00Z" }),
      o("b", { createdAt: "2026-05-01T00:00:00Z" }),
    ];
    expect(shownBannerId(list, NOW)).toBe("b");
  });
  it("ignora los programados, vencidos, inactivos y archivados aunque sean más nuevos", () => {
    const list = [
      o("vigente", { startsAt: "2026-01-01T00:00:00Z" }),
      o("futuro", { startsAt: "2027-01-01T00:00:00Z" }),
      o("vencido", { startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-07-01T00:00:00Z" }),
      o("inactivo", { startsAt: "2026-10-20T00:00:00Z", isActive: false }),
    ];
    expect(shownBannerId(list, NOW)).toBe("vigente");
  });
  it("no depende del orden de entrada", () => {
    const a = o("a", { startsAt: "2026-03-01T00:00:00Z" });
    const c = o("c", { startsAt: "2026-04-01T00:00:00Z" });
    expect(shownBannerId([a, c], NOW)).toBe(shownBannerId([c, a], NOW));
  });
});

describe("validateBanner", () => {
  const ok: BannerFormValues = {
    message: "Envíos gratis esta semana",
    linkUrl: "",
    startsAt: "",
    endsAt: "",
    isActive: true,
  };

  it("mensaje solo: válido; sin enlace ni fechas se guardan como NULL", () => {
    expect(validateBanner(ok)).toEqual({
      ok: true,
      payload: {
        message: "Envíos gratis esta semana",
        link_url: null,
        starts_at: null,
        ends_at: null,
        is_active: true,
      },
    });
  });
  it("el mensaje se recorta y es obligatorio (1 a 200 caracteres)", () => {
    expect(validateBanner({ ...ok, message: "  hola  " })).toMatchObject({
      ok: true,
      payload: { message: "hola" },
    });
    expect(validateBanner({ ...ok, message: "   " })).toMatchObject({
      ok: false,
      errors: { message: expect.any(String) },
    });
    expect(validateBanner({ ...ok, message: "a".repeat(200) }).ok).toBe(true);
    expect(validateBanner({ ...ok, message: "a".repeat(201) }).ok).toBe(false);
    expect(validateBanner({ ...ok, message: "😀".repeat(200) }).ok).toBe(true);
  });
  it.each(["/", "/novedades", "https://madeinchola.com/promo"])(
    "enlace seguro «%s» válido",
    (linkUrl) => {
      expect(validateBanner({ ...ok, linkUrl }).ok).toBe(true);
    },
  );
  it.each([
    "http://x.com",
    "tienda.com",
    "//otro.com",
    "/\\evil",
    "javascript:alert(1)",
    "/a b",
    "https://a b",
  ])("enlace no seguro «%s» rechazado", (linkUrl) => {
    expect(validateBanner({ ...ok, linkUrl })).toMatchObject({
      ok: false,
      errors: { linkUrl: expect.any(String) },
    });
  });
  it("las fechas se interpretan en hora de La Paz (UTC−4) y se guardan en UTC", () => {
    const r = validateBanner({ ...ok, startsAt: "2026-10-29T22:00", endsAt: "2026-10-30T22:00" });
    expect(r).toMatchObject({
      ok: true,
      payload: { starts_at: "2026-10-30T02:00:00.000Z", ends_at: "2026-10-31T02:00:00.000Z" },
    });
  });
  it("el fin debe ser posterior al inicio (igual no vale, como el CHECK de la base)", () => {
    expect(
      validateBanner({ ...ok, startsAt: "2026-10-30T10:00", endsAt: "2026-10-30T10:00" }),
    ).toMatchObject({
      ok: false,
      errors: { endsAt: expect.any(String) },
    });
    expect(
      validateBanner({ ...ok, startsAt: "2026-10-30T10:00", endsAt: "2026-10-30T09:59" }).ok,
    ).toBe(false);
    expect(
      validateBanner({ ...ok, startsAt: "2026-10-30T10:00", endsAt: "2026-10-30T10:01" }).ok,
    ).toBe(true);
  });
  it("una sola fecha es válida (inicio sin fin, o fin sin inicio)", () => {
    expect(validateBanner({ ...ok, startsAt: "2026-10-30T10:00" }).ok).toBe(true);
    expect(validateBanner({ ...ok, endsAt: "2026-10-30T10:00" }).ok).toBe(true);
  });
  it("una fecha mal formada se señala en su campo", () => {
    expect(validateBanner({ ...ok, startsAt: "ayer" })).toMatchObject({
      ok: false,
      errors: { startsAt: expect.any(String) },
    });
  });
  it("junta varios errores a la vez", () => {
    const r = validateBanner({
      message: "",
      linkUrl: "x",
      startsAt: "mal",
      endsAt: "",
      isActive: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["linkUrl", "message", "startsAt"]);
  });
  it("is_active se respeta tal cual", () => {
    expect(validateBanner({ ...ok, isActive: false })).toMatchObject({
      ok: true,
      payload: { is_active: false },
    });
  });
});

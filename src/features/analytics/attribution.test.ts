import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_KEY,
  attributionFromLocation,
  captureAttribution,
  clearAttribution,
  readAttribution,
  recordOrderAttribution,
  sendMetaPurchase,
} from "./attribution";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));
const fn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/functions", () => ({ callFunction: fn }));

const loc = (search: string, pathname = "/tienda", hostname = "madeinchola.test") => ({
  search,
  pathname,
  hostname,
});
const NOW = 1_800_000_000_000;

beforeEach(() => {
  clearAttribution();
  rpc.mockReset();
  fn.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("attributionFromLocation", () => {
  it("lee los utm_*, los limpia (minúsculas, sin espacios ni controles) y los corta a 100", () => {
    const found = attributionFromLocation(
      loc(
        `?utm_source=%20Facebook%20&utm_medium=CPC&utm_campaign=lan%07zamiento&utm_content=${"x".repeat(300)}`,
      ),
      "",
      NOW,
    );
    expect(found).toMatchObject({
      utm_source: "facebook",
      utm_medium: "cpc",
      utm_campaign: "lanzamiento",
      landing_path: "/tienda",
      at: NOW,
    });
    expect(found?.utm_content).toHaveLength(100);
  });

  it("de un clic de anuncio guarda SOLO de qué tipo era, nunca el identificador", () => {
    const found = attributionFromLocation(loc("?fbclid=IwAR0-secreto-largo"), "", NOW);
    expect(found?.click_id_kind).toBe("fbclid");
    expect(JSON.stringify(found)).not.toContain("secreto");
    expect(attributionFromLocation(loc("?gclid=abc"), "", NOW)?.click_id_kind).toBe("gclid");
  });

  it("el sitio de procedencia cuenta solo si es OTRO sitio; el mismo sitio no es una procedencia", () => {
    expect(attributionFromLocation(loc(""), "https://l.facebook.com/l.php?u=x", NOW)).toMatchObject(
      { referrer_host: "l.facebook.com" },
    );
    expect(attributionFromLocation(loc(""), "https://madeinchola.test/tienda", NOW)).toBeNull();
    expect(attributionFromLocation(loc(""), "esto no es una URL", NOW)).toBeNull();
  });

  it("una visita sin parámetros ni procedencia (directo) no deja nada", () => {
    expect(attributionFromLocation(loc("?color=rojo"), "", NOW)).toBeNull();
  });
});

describe("captureAttribution", () => {
  it("guarda la campaña, y la ÚLTIMA visita con campaña gana", () => {
    captureAttribution(loc("?utm_source=facebook&utm_campaign=a"), "");
    captureAttribution(loc("?utm_source=google&utm_campaign=b"), "");
    expect(readAttribution()).toMatchObject({ utm_source: "google", utm_campaign: "b" });
  });

  it("una visita que solo viene de otro sitio NO pisa una campaña ya guardada, pero sí se guarda si no había nada", () => {
    captureAttribution(loc("", "/x"), "https://news.example.org/");
    expect(readAttribution()).toMatchObject({ referrer_host: "news.example.org" });
    captureAttribution(loc("?utm_source=facebook"), "");
    captureAttribution(loc("", "/y"), "https://otro.example.org/");
    expect(readAttribution()).toMatchObject({ utm_source: "facebook" });
    expect(readAttribution()?.referrer_host).toBeUndefined();
  });

  it("a los 30 días vence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    captureAttribution(loc("?utm_source=facebook"), "");
    expect(readAttribution()).not.toBeNull();
    vi.setSystemTime(NOW + 31 * 24 * 60 * 60 * 1000);
    expect(readAttribution()).toBeNull();
  });

  it("clearAttribution lo borra y un valor roto en el almacenamiento se ignora", () => {
    captureAttribution(loc("?utm_source=facebook"), "");
    clearAttribution();
    expect(readAttribution()).toBeNull();
    window.localStorage.setItem(ATTRIBUTION_KEY, "{roto");
    expect(readAttribution()).toBeNull();
  });
});

describe("recordOrderAttribution", () => {
  it("manda al servidor el número del pedido y lo guardado, SIN la marca de tiempo interna", async () => {
    captureAttribution(loc("?utm_source=facebook&utm_medium=cpc"), "");
    rpc.mockResolvedValue({ data: null, error: null });
    await recordOrderAttribution("MIC-000123");
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("record_order_attribution");
    expect(args.p_number).toBe("MIC-000123");
    expect(args.p_data).toMatchObject({ utm_source: "facebook", utm_medium: "cpc" });
    expect(args.p_data).not.toHaveProperty("at");
  });

  it("sin nada guardado no llama al servidor; y un fallo no rompe la compra", async () => {
    await recordOrderAttribution("MIC-000123");
    expect(rpc).not.toHaveBeenCalled();
    captureAttribution(loc("?utm_source=facebook"), "");
    rpc.mockRejectedValue(new Error("red caída"));
    await expect(recordOrderAttribution("MIC-000123")).resolves.toBeUndefined();
  });
});

describe("sendMetaPurchase", () => {
  it("llama a meta-capi con el pedido, el event_id, las cookies _fbp/_fbc y la dirección SIN parámetros ni ancla", async () => {
    document.cookie = "_fbp=fb.1.111.222; Path=/";
    document.cookie = "_fbc=fb.1.111.AbC; Path=/";
    fn.mockResolvedValue({ ok: true, data: {} });
    window.history.replaceState({}, "", "/pedido/MIC-000123?utm_source=x#ancla");
    await sendMetaPurchase("MIC-000123", "purchase.MIC-000123", "token-1");
    const [name, body, options] = fn.mock.calls[0]!;
    expect(name).toBe("meta-capi");
    expect(body).toMatchObject({
      order_number: "MIC-000123",
      event_id: "purchase.MIC-000123",
      fbp: "fb.1.111.222",
      fbc: "fb.1.111.AbC",
    });
    expect(body.source_url).toMatch(/\/pedido\/MIC-000123$/);
    expect(options).toEqual({ token: "token-1" });
    document.cookie = "_fbp=; Max-Age=0; Path=/";
    document.cookie = "_fbc=; Max-Age=0; Path=/";
  });
});

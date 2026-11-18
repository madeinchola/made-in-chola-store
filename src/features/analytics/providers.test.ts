import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startGa4, startMetaPixel } from "./providers";

type W = Record<string, unknown>;
const w = () => window as unknown as W;

function reset() {
  for (const key of ["fbq", "_fbq", "gtag", "dataLayer", "ga-disable-G-ABC123DEF4"])
    delete w()[key];
  for (const name of ["_fbp", "_fbc", "_ga", "_ga_ABC123DEF4", "_gid"])
    document.cookie = `${name}=; Max-Age=0; Path=/`;
}
beforeEach(reset);
afterEach(reset);

describe("startMetaPixel", () => {
  it("carga el script de Meta UNA vez, inicia el Pixel con su ID y no envía ninguna vista hasta que se pide", () => {
    const loadScript = vi.fn();
    startMetaPixel("1234567890123", { loadScript });
    expect(loadScript).toHaveBeenCalledWith("https://connect.facebook.net/en_US/fbevents.js");
    const fbq = w().fbq as { queue: unknown[][] };
    expect(fbq.queue).toEqual([["init", "1234567890123"]]);
  });

  it("send manda el evento con su eventID (para deduplicar con el servidor) y pageView, la vista", () => {
    const provider = startMetaPixel("1234567890123", { loadScript: vi.fn() });
    provider.send({ name: "Purchase", params: { value: 215 }, eventId: "purchase.MIC-000123" });
    provider.send({ name: "ViewContent", params: { content_ids: ["p"] } });
    provider.pageView();
    expect((w().fbq as { queue: unknown[][] }).queue.slice(1)).toEqual([
      ["track", "Purchase", { value: 215 }, { eventID: "purchase.MIC-000123" }],
      ["track", "ViewContent", { content_ids: ["p"] }],
      ["track", "PageView"],
    ]);
  });

  it("stop revoca el consentimiento, borra _fbp y _fbc y NO envía nada más", () => {
    document.cookie = "_fbp=fb.1.1.2; Path=/";
    document.cookie = "_fbc=fb.1.1.abc; Path=/";
    const provider = startMetaPixel("1234567890123", { loadScript: vi.fn() });
    provider.stop();
    const queue = (w().fbq as { queue: unknown[][] }).queue;
    expect(queue.at(-1)).toEqual(["consent", "revoke"]);
    expect(document.cookie).not.toMatch(/_fb[pc]/);
    const before = queue.length;
    provider.send({ name: "AddToCart", params: {} });
    provider.pageView();
    expect(queue.length).toBe(before);
  });

  it("volver a aceptar sin recargar reactiva el mismo Pixel (consent grant) y no carga el script otra vez", () => {
    const loadScript = vi.fn();
    startMetaPixel("1234567890123", { loadScript }).stop();
    const again = startMetaPixel("1234567890123", { loadScript });
    expect(loadScript).toHaveBeenCalledTimes(1);
    expect((w().fbq as { queue: unknown[][] }).queue.at(-1)).toEqual(["consent", "grant"]);
    again.send({ name: "Search", params: {} });
    expect((w().fbq as { queue: unknown[][] }).queue.at(-1)).toEqual(["track", "Search", {}]);
  });
});

describe("startGa4", () => {
  const entries = () => (w().dataLayer as ArrayLike<unknown>[]).map((e) => Array.from(e));

  it("carga gtag con SU ID y configura sin vista automática, sin señales de Google ni personalización de anuncios", () => {
    const loadScript = vi.fn();
    startGa4("G-ABC123DEF4", { loadScript });
    expect(loadScript).toHaveBeenCalledWith(
      "https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4",
    );
    const [first, second] = entries();
    expect(first![0]).toBe("js");
    expect(second).toEqual([
      "config",
      "G-ABC123DEF4",
      {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      },
    ]);
    expect(w()["ga-disable-G-ABC123DEF4"]).toBe(false);
  });

  it("send y pageView empujan los eventos con su ruta", () => {
    const provider = startGa4("G-ABC123DEF4", { loadScript: vi.fn() });
    provider.send({ name: "purchase", params: { transaction_id: "MIC-000123" } });
    provider.pageView("/tienda");
    const events = entries().filter((e) => e[0] === "event");
    expect(events[0]).toEqual(["event", "purchase", { transaction_id: "MIC-000123" }]);
    expect(events[1]![1]).toBe("page_view");
    expect((events[1]![2] as { page_path: string }).page_path).toBe("/tienda");
  });

  it("stop activa ga-disable, borra _ga, _ga_ y _gid y NO envía nada más", () => {
    document.cookie = "_ga=GA1.1.1.2; Path=/";
    document.cookie = "_ga_ABC123DEF4=GS1.1.1; Path=/";
    document.cookie = "_gid=GA1.1.3; Path=/";
    const provider = startGa4("G-ABC123DEF4", { loadScript: vi.fn() });
    provider.stop();
    expect(w()["ga-disable-G-ABC123DEF4"]).toBe(true);
    expect(document.cookie).not.toMatch(/_ga|_gid/);
    const before = entries().length;
    provider.send({ name: "search", params: {} });
    provider.pageView("/x");
    expect(entries().length).toBe(before);
  });

  it("volver a aceptar reactiva GA4 sin cargar el script otra vez", () => {
    const loadScript = vi.fn();
    startGa4("G-ABC123DEF4", { loadScript }).stop();
    startGa4("G-ABC123DEF4", { loadScript });
    expect(loadScript).toHaveBeenCalledTimes(1);
    expect(w()["ga-disable-G-ABC123DEF4"]).toBe(false);
  });
});

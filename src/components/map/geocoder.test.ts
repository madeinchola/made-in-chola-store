import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNominatimGeocoder,
  GeocoderError,
  getDefaultGeocoder,
  NOMINATIM_MIN_INTERVAL_MS,
  NOMINATIM_TIMEOUT_MS,
} from "./geocoder";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

const plaza = {
  place_id: 123,
  lat: "-16.4955",
  lon: "-68.1336",
  display_name: "Plaza Murillo, La Paz, Bolivia",
  extra: "se ignora",
};

/** `fetch` falso que respeta `signal` (como el real) y registra a qué hora (reloj simulado) salió cada petición. */
function fakeFetch(respond: () => Response | Promise<Response> = () => json([])) {
  const calls: { url: string; at: number; init: RequestInit }[] = [];
  const fn = vi.fn((url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), at: Date.now(), init });
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (init.signal?.aborted) return abort();
      init.signal?.addEventListener("abort", abort, { once: true });
      Promise.resolve(respond()).then(resolve, reject);
    });
  });
  return { fn: fn as unknown as typeof fetch, calls, spy: fn };
}

const never = () => new Promise<Response>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Nominatim · petición", () => {
  it("construye la URL con formato, límite, idioma, país y texto codificado", async () => {
    const { fn, calls } = fakeFetch();
    const geocoder = createNominatimGeocoder({ fetchFn: fn });
    await geocoder.search("Plaza Murillo", { country: "BO" });
    expect(calls[0]?.url).toBe(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&countrycodes=bo&q=Plaza+Murillo",
    );
  });

  it("codifica caracteres especiales (& ñ) en el texto", async () => {
    const { fn, calls } = fakeFetch();
    await createNominatimGeocoder({ fetchFn: fn }).search("Av. 6 de Agosto & Sopocachi ñ");
    // «&» → %26 · «ñ» (U+00F1) → %C3%B1 · espacio → +
    expect(calls[0]?.url).toBe(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&q=Av.+6+de+Agosto+%26+Sopocachi+%C3%B1",
    );
  });

  it("sin país (o con uno que no es ISO-2) no envía countrycodes", async () => {
    const { fn, calls } = fakeFetch();
    const geocoder = createNominatimGeocoder({ fetchFn: fn, minIntervalMs: 0 });
    await geocoder.search("Sopocachi");
    await geocoder.search("Sopocachi", { country: "Bolivia" });
    await geocoder.search("Sopocachi", { country: "B1" });
    await geocoder.search("Sopocachi", { country: "" });
    for (const call of calls) expect(call.url).not.toContain("countrycodes");
    expect(calls).toHaveLength(4);
  });

  it("el país va en minúsculas", async () => {
    const { fn, calls } = fakeFetch();
    await createNominatimGeocoder({ fetchFn: fn }).search("x y z", { country: "AR" });
    expect(calls[0]?.url).toContain("&countrycodes=ar&");
  });

  it("pide JSON y enlaza una señal de cancelación", async () => {
    const { fn, calls } = fakeFetch();
    await createNominatimGeocoder({ fetchFn: fn }).search("Sopocachi");
    expect(calls[0]?.init.headers).toEqual({ Accept: "application/json" });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("un texto vacío o solo espacios no llama a la red y devuelve []", async () => {
    const { fn, spy } = fakeFetch();
    const geocoder = createNominatimGeocoder({ fetchFn: fn });
    expect(await geocoder.search("")).toEqual([]);
    expect(await geocoder.search("    ")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("recorta el texto y lo limita a 200 caracteres", async () => {
    const { fn, calls } = fakeFetch();
    await createNominatimGeocoder({ fetchFn: fn }).search(`  ${"a".repeat(300)}  `);
    const q = new URL(calls[0]!.url).searchParams.get("q");
    expect(q).toBe("a".repeat(200));
  });
});

describe("Nominatim · respuesta", () => {
  it("convierte la respuesta en resultados (id, nombre, coordenadas) e ignora campos extra", async () => {
    const { fn } = fakeFetch(() =>
      json([
        plaza,
        { place_id: "abc-2", lat: "-16.5", lon: "-68.15", display_name: "  Centro, La Paz  " },
      ]),
    );
    const results = await createNominatimGeocoder({ fetchFn: fn }).search("Plaza");
    expect(results).toEqual([
      { id: "123", label: "Plaza Murillo, La Paz, Bolivia", lat: -16.4955, lng: -68.1336 },
      { id: "abc-2", label: "Centro, La Paz", lat: -16.5, lng: -68.15 },
    ]);
  });

  it("redondea a 6 decimales", async () => {
    const { fn } = fakeFetch(() =>
      json([{ place_id: 1, lat: "-16.12345678", lon: "-68.98765432", display_name: "X" }]),
    );
    const [first] = await createNominatimGeocoder({ fetchFn: fn }).search("xyz");
    expect(first).toMatchObject({ lat: -16.123457, lng: -68.987654 });
  });

  it("una lista vacía es un resultado válido", async () => {
    const { fn } = fakeFetch(() => json([]));
    expect(await createNominatimGeocoder({ fetchFn: fn }).search("zzzzz")).toEqual([]);
  });

  it("descarta los puntos fuera del planeta o ilegibles sin romper el resto", async () => {
    const { fn } = fakeFetch(() =>
      json([
        { place_id: 1, lat: "95", lon: "0", display_name: "latitud fuera" },
        { place_id: 2, lat: "0", lon: "181", display_name: "longitud fuera" },
        { place_id: 3, lat: "abc", lon: "0", display_name: "no numérica" },
        { place_id: 4, lat: "90", lon: "-180", display_name: "en el borde" },
      ]),
    );
    const results = await createNominatimGeocoder({ fetchFn: fn }).search("xyz");
    expect(results.map((r) => r.id)).toEqual(["4"]);
  });

  it("el nombre se limita a 300 caracteres y se devuelve como texto (el HTML no se interpreta)", async () => {
    const html = `<img src=x onerror=alert(1)>${"y".repeat(400)}`;
    const { fn } = fakeFetch(() =>
      json([{ place_id: 9, lat: "-1", lon: "-2", display_name: html }]),
    );
    const [first] = await createNominatimGeocoder({ fetchFn: fn }).search("xyz");
    expect(first?.label).toBe(html.slice(0, 300));
    expect(first?.label.startsWith("<img src=x onerror=alert(1)>")).toBe(true);
  });

  it.each([
    ["un objeto en vez de lista", { error: "boom" }],
    ["un elemento sin lat", [{ place_id: 1, lon: "1", display_name: "x" }]],
    ["lat numérica (debe ser texto)", [{ place_id: 1, lat: -16, lon: "1", display_name: "x" }]],
    ["un elemento sin nombre", [{ place_id: 1, lat: "1", lon: "1" }]],
    ["un elemento que no es objeto", ["hola"]],
    ["null", null],
  ])("rechaza con invalid_response: %s", async (_name, body) => {
    const { fn } = fakeFetch(() => json(body));
    await expect(createNominatimGeocoder({ fetchFn: fn }).search("xyz")).rejects.toMatchObject({
      name: "GeocoderError",
      kind: "invalid_response",
    });
  });

  it("un cuerpo que no es JSON es invalid_response", async () => {
    const { fn } = fakeFetch(() => new Response("<html>502</html>", { status: 200 }));
    await expect(createNominatimGeocoder({ fetchFn: fn }).search("xyz")).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});

describe("Nominatim · errores de red", () => {
  it.each([
    [429, "rate_limited"],
    [403, "rate_limited"],
    [500, "unavailable"],
    [503, "unavailable"],
    [404, "unavailable"],
  ])("HTTP %i → %s", async (status, kind) => {
    const { fn } = fakeFetch(() => new Response("", { status }));
    const promise = createNominatimGeocoder({ fetchFn: fn }).search("xyz");
    await expect(promise).rejects.toBeInstanceOf(GeocoderError);
    await expect(promise).rejects.toMatchObject({ kind });
  });

  it("sin conexión (fetch rechaza) → unavailable, y el mensaje no incluye lo buscado", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const failure = await createNominatimGeocoder({ fetchFn })
      .search("Calle Secreta 123")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GeocoderError);
    expect(failure).toMatchObject({ kind: "unavailable" });
    expect((failure as Error).message).toBe("Geocodificador: unavailable");
    expect((failure as Error).message).not.toContain("Secreta");
  });

  it("vence a los 8 s (el tiempo de espera cuenta DESDE que sale la petición)", async () => {
    expect(NOMINATIM_TIMEOUT_MS).toBe(8000);
    const { fn } = fakeFetch(never);
    const promise = createNominatimGeocoder({ fetchFn: fn }).search("xyz");
    const outcome = promise.then(
      () => "ok",
      (error: GeocoderError) => error.kind,
    );
    await vi.advanceTimersByTimeAsync(7999);
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("timeout");
  });

  it("el tiempo de espera es configurable", async () => {
    const { fn } = fakeFetch(never);
    const promise = createNominatimGeocoder({ fetchFn: fn, timeoutMs: 500 }).search("xyz");
    const outcome = promise.catch((error: GeocoderError) => error.kind);
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toBe("timeout");
  });

  it("el temporizador de espera se limpia al terminar (no queda nada pendiente)", async () => {
    const { fn } = fakeFetch(() => json([]));
    await createNominatimGeocoder({ fetchFn: fn }).search("xyz");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Nominatim · cancelación", () => {
  it("cancelar durante la petición → aborted (no timeout ni unavailable)", async () => {
    const { fn } = fakeFetch(never);
    const controller = new AbortController();
    const promise = createNominatimGeocoder({ fetchFn: fn }).search("xyz", {
      signal: controller.signal,
    });
    const outcome = promise.catch((error: GeocoderError) => error.kind);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    expect(await outcome).toBe("aborted");
    expect(vi.getTimerCount()).toBe(0); // el temporizador de espera también se limpió
  });

  it("una señal ya cancelada no llama a la red", async () => {
    const { fn, spy } = fakeFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createNominatimGeocoder({ fetchFn: fn }).search("xyz", { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "aborted" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("cancelar mientras espera su turno → aborted y la petición NUNCA sale", async () => {
    const { fn, spy } = fakeFetch();
    const geocoder = createNominatimGeocoder({ fetchFn: fn });
    await geocoder.search("primera");
    const controller = new AbortController();
    const second = geocoder.search("segunda", { signal: controller.signal });
    const outcome = second.catch((error: GeocoderError) => error.kind);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    expect(await outcome).toBe("aborted");
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("Nominatim · máximo 1 petición por segundo", () => {
  it("el intervalo mínimo por defecto es de 1100 ms", () => {
    expect(NOMINATIM_MIN_INTERVAL_MS).toBe(1100);
  });

  it("espacia las peticiones seguidas ≥ 1,1 s entre sí (0, 1100, 2200 ms)", async () => {
    const { fn, calls } = fakeFetch(() => json([]));
    const geocoder = createNominatimGeocoder({ fetchFn: fn });
    const start = Date.now();
    const all = Promise.all([
      geocoder.search("uno"),
      geocoder.search("dos"),
      geocoder.search("tres"),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.at - start)).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1099);
    expect(calls).toHaveLength(1); // 1099 ms: todavía no
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.at - start)).toEqual([0, 1100]);
    await vi.advanceTimersByTimeAsync(1099);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.at - start)).toEqual([0, 1100, 2200]);
    await all;
  });

  it("tras un periodo sin usar, la petición sale al instante", async () => {
    const { fn, calls } = fakeFetch(() => json([]));
    const geocoder = createNominatimGeocoder({ fetchFn: fn });
    await geocoder.search("uno");
    await vi.advanceTimersByTimeAsync(5000);
    const before = Date.now();
    await geocoder.search("dos");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at - before).toBe(0);
  });

  it("a los 600 ms de la anterior espera 500 ms más (hasta cumplir 1100 desde la salida de la primera)", async () => {
    const { fn, calls } = fakeFetch(() => json([]));
    const geocoder = createNominatimGeocoder({ fetchFn: fn });
    const start = Date.now();
    await geocoder.search("uno");
    await vi.advanceTimersByTimeAsync(600);
    const second = geocoder.search("dos");
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(calls[1]!.at - start).toBe(1100);
  });

  it("una petición cancelada en la cola devuelve su turno: la siguiente no espera de más", async () => {
    const { fn, calls } = fakeFetch(() => json([]));
    const geocoder = createNominatimGeocoder({ fetchFn: fn });
    const start = Date.now();
    await geocoder.search("uno"); // sale en 0 → próximo turno a 1100
    const controller = new AbortController();
    const second = geocoder.search("dos", { signal: controller.signal }); // reserva el turno de 1100…
    const secondOutcome = second.catch(() => "cancelada");
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(); // …y lo devuelve
    expect(await secondOutcome).toBe("cancelada");
    const third = geocoder.search("tres"); // en t=100 debe tomar el turno de 1100, no el de 2200
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await third;
    expect(calls.map((c) => c.at - start)).toEqual([0, 1100]);
  });

  it("cancelar una petición del MEDIO de la cola no libera su turno: ninguna otra sale a menos de 1100 ms de otra", async () => {
    const { fn, calls } = fakeFetch(() => json([]));
    const geocoder = createNominatimGeocoder({ fetchFn: fn });
    const start = Date.now();
    await geocoder.search("uno"); // sale en 0 → siguiente turno a 1100
    const controller = new AbortController();
    const second = geocoder.search("dos", { signal: controller.signal }); // turno de 1100
    const secondOutcome = second.catch(() => "cancelada");
    const third = geocoder.search("tres"); // turno de 2200
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(); // la 3.ª ya tiene su turno: el de la 2.ª no se «devuelve» a nadie
    expect(await secondOutcome).toBe("cancelada");
    const fourth = geocoder.search("cuatro"); // 3300
    const fifth = geocoder.search("cinco"); // 4400
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all([third, fourth, fifth]);
    const times = calls.map((c) => c.at - start);
    expect(times).toEqual([0, 2200, 3300, 4400]);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1100);
    }
  });

  it("el espaciado es configurable", async () => {
    const { fn, calls } = fakeFetch(() => json([]));
    const geocoder = createNominatimGeocoder({ fetchFn: fn, minIntervalMs: 250 });
    const start = Date.now();
    const both = Promise.all([geocoder.search("uno"), geocoder.search("dos")]);
    await vi.advanceTimersByTimeAsync(250);
    await both;
    expect(calls.map((c) => c.at - start)).toEqual([0, 250]);
  });
});

describe("getDefaultGeocoder", () => {
  it("es una única instancia compartida (todos los selectores se turnan la misma cuota)", () => {
    expect(getDefaultGeocoder()).toBe(getDefaultGeocoder());
  });
});

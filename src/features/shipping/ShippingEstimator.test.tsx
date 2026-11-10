import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listActiveAddresses } from "@/features/account/addresses/api";
import type { Address } from "@/features/account/addresses/types";
import {
  flush,
  makeLine,
  makeSnapshot,
  renderWithCart,
  signedIn,
  FakeCartServer,
} from "@/features/cart/cart-test-utils";
import { CartSummary } from "@/features/cart/CartSummary";
import { t, type MessageKey } from "@/i18n";
import cartSummarySource from "@/features/cart/CartSummary.tsx?raw";
import type { Destination } from "./destination";
import { forgetDestination, GUEST_OWNER, rememberDestination } from "./destinationMemory";
import estimateSource from "./estimate.ts?raw";
import estimatorSource from "./ShippingEstimator.tsx?raw";
import { quoteShipping } from "./quote";
import { quoteResult, rejectedQuote } from "./shipping-test-utils";
import hookSource from "./useShippingEstimate.ts?raw";
import { SHIPPING_ERROR_CODES, type QuoteParams, type QuoteResult, type QuoteSlot } from "./types";

// Sin red: la cotización y la libreta se simulan; el mapa real (Leaflet) se sustituye por un doble con dos botones.
vi.mock("./quote", () => ({ quoteShipping: vi.fn() }));
vi.mock("@/features/account/addresses/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/account/addresses/api")>()),
  listActiveAddresses: vi.fn(),
}));
const picker = vi.hoisted(() => ({ renders: vi.fn() }));
vi.mock("@/components/map/LocationPicker", () => ({
  LocationPicker: (props: {
    value: { lat: string; lng: string };
    onChange: (value: { lat: string; lng: string }) => void;
    hint?: string;
    country?: string;
    errors?: { lat?: string; lng?: string };
  }) => {
    picker.renders();
    return (
      <div data-testid="picker" data-country={props.country}>
        <p>{props.hint}</p>
        <button type="button" onClick={() => props.onChange({ lat: "-16.5", lng: "-68.15" })}>
          Marcar punto de prueba
        </button>
        <button type="button" onClick={() => props.onChange({ lat: "abc", lng: "-68.15" })}>
          Escribir latitud inválida
        </button>
        <output aria-label="Pin actual">{`${props.value.lat},${props.value.lng}`}</output>
        {props.errors?.lat && <p>{props.errors.lat}</p>}
      </div>
    );
  },
}));

const mockQuote = vi.mocked(quoteShipping);
const mockAddresses = vi.mocked(listActiveAddresses);

const HOME: Destination = { lat: -16.5, lng: -68.15, city: "La Paz", label: null, addressId: null };
const HOME_PARAMS = { lat: -16.5, lng: -68.15, city: "La Paz", orderAmount: 100, currency: "BOB" };

const slot = (date: string, start: string, end: string, extra: Partial<QuoteSlot> = {}) => ({
  slotId: `s-${start}`,
  date,
  start,
  end,
  capacity: 3,
  remaining: 2,
  available: true,
  ...extra,
});
const SLOTS: QuoteSlot[] = [
  slot("2026-11-09", "09:00", "11:00"),
  slot("2026-11-09", "14:00", "16:00", { remaining: 0, available: false }),
  slot("2026-11-10", "09:00", "11:00"),
];

const address = (id: string, extra: Partial<Address> = {}): Address => ({
  id,
  profileId: "user-1",
  label: id,
  recipient: "Ana",
  phone: "+59171234567",
  line1: "Av. Arce 123",
  line2: null,
  city: "La Paz",
  department: null,
  country: "BO",
  referenceText: null,
  lat: -16.5,
  lng: -68.15,
  isDefault: false,
  forShipping: true,
  forBilling: false,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...extra,
});

beforeEach(() => {
  act(() => forgetDestination());
  mockQuote.mockReset();
  mockAddresses.mockReset();
  mockAddresses.mockResolvedValue([]);
  picker.renders.mockClear();
});

const seed = (destination: Destination = HOME, owner: string = GUEST_OWNER) =>
  act(() => rememberDestination(owner, destination));

async function setup(
  lines = [makeLine("a", 1)],
  options: Parameters<typeof renderWithCart>[1] = {},
  extra: Parameters<typeof makeSnapshot>[1] = {},
) {
  const view = renderWithCart(<CartSummary />, {
    snapshot: makeSnapshot(lines, extra),
    ...options,
  });
  await flush();
  return view;
}

const summary = () => screen.getByRole("region", { name: "Resumen" });
const estimator = () => screen.getByRole("region", { name: "Calcula tu envío" });
const rows = () => Array.from(summary().querySelectorAll("dl > div")).map((r) => r.textContent);
/** Las dos regiones vivas del estimador: [cotización, franja]. */
const regions = () => within(estimator()).getAllByRole("status");
const opener = (name: string | RegExp) => within(estimator()).getByRole("button", { name });

/** Una respuesta que se resuelve cuando la prueba lo decide (para ver el estado «calculando»). */
function deferred() {
  let resolve!: (result: QuoteResult) => void;
  const promise = new Promise<QuoteResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("estimador · sin destino", () => {
  it("NO llama al servidor: invita a elegir y el resumen dice que se calcula al elegir la dirección", async () => {
    await setup();
    await flush();
    expect(mockQuote).not.toHaveBeenCalled();
    expect(rows()).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoSe calcula al elegir tu dirección",
      "TotalBs 100,00",
    ]);
    expect(
      within(estimator()).getByText(
        "Elige dónde recibirás tu pedido para ver cuánto cuesta el envío.",
      ),
    ).toBeInTheDocument();
    expect(opener("Elegir ubicación en el mapa")).toBeInTheDocument();
    expect(screen.queryByText("Total estimado")).not.toBeInTheDocument();
    expect(regions().map((r) => r.textContent)).toEqual(["", ""]);
  });

  it("no descarga el mapa ni abre nada hasta que se pide", async () => {
    await setup();
    expect(picker.renders).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("estimador · con destino: cotización y total estimado", () => {
  it("llama con los parámetros EXACTOS y muestra costo, plazo, fila de envío y «Total estimado» = 100 + 15 = Bs 115,00", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed();
    await setup();
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    expect(mockQuote).toHaveBeenCalledTimes(1);
    expect(mockQuote.mock.calls[0]![0]).toStrictEqual(HOME_PARAMS);
    expect(rows()).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoBs 15,00",
      "Total estimadoBs 115,00", // UN solo total: el de la bolsa (Bs 100,00, sin envío) no se muestra junto a «Envío»
    ]);
    expect(rows().some((row) => /^TotalBs/.test(row ?? ""))).toBe(false);
    expect(summary()).toHaveTextContent(
      "Es una estimación: al pagar, el pedido recalcula el envío y el total.",
    );
    const [quote] = regions();
    expect(quote).toHaveTextContent("Envío estimado: Bs 15,00");
    expect(quote).toHaveTextContent("Entrega estimada en 1 a 2 días");
    expect(quote).toHaveTextContent("Total estimado con envío: Bs 115,00");
    // el botón Pagar es el de siempre
    expect(screen.getByRole("link", { name: "Pagar" })).toHaveAttribute("href", "/login");
  });

  it("con miles y centavos: 1.220,00 + 25,50 = Bs 1.245,50", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 25.5 }));
    seed();
    await setup([
      makeLine("a", 2, { unit_price: 560, line_total: 1120 }),
      makeLine("b", 1, { unit_price: 100, line_total: 100 }),
    ]);
    await waitFor(() => expect(rows()).toContain("Total estimadoBs 1.245,50"));
    expect(rows()).toContain("EnvíoBs 25,50");
    expect(rows()).toContain("Subtotal (3 productos)Bs 1.220,00");
    expect(rows().some((row) => /^TotalBs/.test(row ?? ""))).toBe(false);
    expect(mockQuote.mock.calls[0]![0]).toMatchObject({ orderAmount: 1220 });
  });

  it("no pide el costo a otro método ni manda la dirección: solo lat, lng, ciudad, monto y moneda", async () => {
    mockQuote.mockResolvedValue(quoteResult());
    seed({ ...HOME, label: "Casa", addressId: "addr-1" });
    await setup();
    await waitFor(() => expect(mockQuote).toHaveBeenCalled());
    expect(Object.keys(mockQuote.mock.calls[0]![0] as QuoteParams).sort()).toEqual([
      "city",
      "currency",
      "lat",
      "lng",
      "orderAmount",
    ]);
  });

  it("envío gratis (costo 0 real): «Gratis», y el total estimado es el subtotal; nunca «Bs 0»", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 0 }));
    seed();
    await setup();
    await waitFor(() => expect(rows()).toContain("EnvíoGratis"));
    expect(rows()).toContain("Total estimadoBs 100,00");
    expect(regions()[0]).toHaveTextContent("El envío es gratis");
    expect(summary()).not.toHaveTextContent("Bs 0");
  });

  it("sin plazo en el método no dice nada del plazo", async () => {
    mockQuote.mockResolvedValue(quoteResult({ method: null }));
    seed();
    await setup();
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    expect(estimator()).not.toHaveTextContent("Entrega estimada");
  });

  it("mientras llega la respuesta: «Calculando…», sin costo ni total", async () => {
    const pending = deferred();
    mockQuote.mockReturnValue(pending.promise);
    seed();
    await setup();
    expect(rows()).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoCalculando…",
      "TotalBs 100,00",
    ]);
    expect(regions()[0]).toHaveTextContent("Calculando el envío…");
    await act(async () => pending.resolve(quoteResult({ cost: 15 })));
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
  });
});

describe("estimador · con cambios sin confirmar", () => {
  it("se atenúa y se marca ocupado mientras el servidor no confirma la cantidad (su costo aún es el del subtotal anterior)", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    const view = await setup([makeLine("a", 1)], { server });
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    const wrapper = estimator().parentElement!;
    expect(wrapper).not.toHaveAttribute("aria-busy");
    expect(wrapper).not.toHaveClass("opacity-60");

    const resume = server.pause();
    act(() => view.cart().store.setQty(view.cart().lines[0]!.variant_id, 2));
    await waitFor(() => expect(wrapper).toHaveAttribute("aria-busy", "true"));
    expect(wrapper).toHaveClass("opacity-60");

    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(wrapper).not.toHaveAttribute("aria-busy"));
    expect(wrapper).not.toHaveClass("opacity-60");
  });
});

describe("estimador · el total estimado respeta el total del servidor (descuento de S9)", () => {
  it("con un descuento ya restado en `totals.total`: Total estimado = total del servidor + envío, no subtotal + envío", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed();
    const lines = [makeLine("a", 1)]; // subtotal 100
    const snapshot = makeSnapshot(lines);
    snapshot.totals = { ...snapshot.totals, discount: 15, total: 85 }; // el servidor ya restó el descuento
    await setup(lines, {}, { totals: snapshot.totals });
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    // 85 + 15 = 100 (y NO 100 + 15 = 115: eso ignoraría el descuento de la fila de arriba)
    expect(rows()).toContain("Total estimadoBs 100,00");
    expect(rows().some((row) => /Bs 115,00/.test(row ?? ""))).toBe(false);
    // las reglas por monto siguen viendo el SUBTOTAL del pedido
    expect(mockQuote.mock.calls[0]![0]).toMatchObject({ orderAmount: 100 });
  });
});

describe("estimador · envío gratis por un descuento (S9)", () => {
  /** Una bolsa de Bs 100 con un descuento de Bs 15 (total Bs 85) y, opcionalmente, envío gratis. */
  const withFree = (free: boolean, shipping: number | null = null) => ({
    totals: { subtotal: 100, item_count: 1, line_count: 1, shipping, discount: 15, total: 85 },
    discounts: {
      applied: [],
      rejected: [],
      coupon: { status: "none" as const, code: null, reason: null, missing: null },
      free_shipping: free,
    },
  });

  it("con cotización válida de Bs 15: la fila dice «Gratis», el estimador «Envío gratis», y el total estimado es el del servidor (85) SIN sumar el costo cotizado", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed();
    await setup([makeLine("a", 1)], {}, withFree(true));
    await waitFor(() => expect(rows()).toContain("EnvíoGratis"));
    expect(rows()).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoGratis",
      "Descuento-Bs 15,00",
      "Total estimadoBs 85,00", // 85 (y NO 85 + 15 = 100)
    ]);
    const [quote] = regions();
    expect(quote).toHaveTextContent("Envío gratis");
    expect(quote).not.toHaveTextContent("Envío estimado");
    expect(quote).not.toHaveTextContent("Bs 15,00");
    expect(quote).toHaveTextContent("Total estimado con envío: Bs 85,00");
    expect(rows().some((row) => /^TotalBs/.test(row ?? ""))).toBe(false); // UN solo total a la vista
    // el servidor sigue recibiendo el SUBTOTAL del pedido para sus reglas de tarifa
    expect(mockQuote.mock.calls[0]![0]).toMatchObject({ orderAmount: 100 });
  });

  it("control: con la misma cotización y SIN envío gratis el costo sí se suma (85 + 15 = 100)", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed();
    await setup([makeLine("a", 1)], {}, withFree(false));
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    expect(rows()).toContain("Total estimadoBs 100,00");
    expect(regions()[0]).toHaveTextContent("Envío estimado: Bs 15,00");
    expect(summary()).not.toHaveTextContent("Gratis");
    expect(summary()).not.toHaveTextContent("Tienes envío gratis");
  });

  it("con un costo cotizado de 0 y envío gratis: «Gratis» y el total del servidor", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 0 }));
    seed();
    await setup([makeLine("a", 1)], {}, withFree(true));
    await waitFor(() => expect(rows()).toContain("EnvíoGratis"));
    expect(rows()).toContain("Total estimadoBs 85,00");
    expect(regions()[0]).toHaveTextContent("Envío gratis");
  });

  it("sin destino elegido: la fila sigue diciendo «Se calcula al elegir tu dirección», con la nota «Tienes envío gratis» debajo, y no se pregunta al servidor", async () => {
    await setup([makeLine("a", 1)], {}, withFree(true));
    await flush();
    expect(mockQuote).not.toHaveBeenCalled();
    expect(rows()).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoSe calcula al elegir tu direcciónTienes envío gratis",
      "Descuento-Bs 15,00",
      "TotalBs 85,00",
    ]);
    expect(screen.queryByText("Total estimado")).not.toBeInTheDocument();
    expect(summary()).not.toHaveTextContent("Gratis");
  });

  it("mientras calcula: «Calculando…» sin nota ni «Gratis» (aún no se sabe)", async () => {
    mockQuote.mockReturnValue(deferred().promise);
    seed();
    await setup([makeLine("a", 1)], {}, withFree(true));
    expect(rows()).toContain("EnvíoCalculando…");
    expect(summary()).not.toHaveTextContent("Tienes envío gratis");
    expect(summary()).not.toHaveTextContent("Gratis");
  });

  it("si el servidor no puede cotizar (fuera de cobertura): «No se pudo estimar», sin prometer «Gratis» ni total estimado", async () => {
    mockQuote.mockResolvedValue(rejectedQuote("out_of_coverage"));
    seed();
    await setup([makeLine("a", 1)], {}, withFree(true));
    await waitFor(() => expect(rows()).toContain("EnvíoNo se pudo estimar"));
    expect(summary()).not.toHaveTextContent("Gratis");
    expect(summary()).not.toHaveTextContent("Tienes envío gratis");
    expect(screen.queryByText("Total estimado")).not.toBeInTheDocument();
  });

  it("si la bolsa ya trae el envío del servidor se muestra tal cual: no se estima nada ni se pone la nota", async () => {
    seed();
    await setup([makeLine("a", 1)], {}, withFree(true, 20));
    await flush();
    expect(mockQuote).not.toHaveBeenCalled();
    expect(rows()).toContain("EnvíoBs 20,00");
    expect(summary()).not.toHaveTextContent("Tienes envío gratis");
  });
});

describe("estimador · recotiza y nunca muestra una cotización vieja con datos nuevos", () => {
  it("cambia el SUBTOTAL: se pregunta de nuevo con el monto nuevo y mientras tanto no se ve el costo anterior", async () => {
    const second = deferred();
    mockQuote.mockImplementation((params) =>
      params?.orderAmount === 100 ? Promise.resolve(quoteResult({ cost: 15 })) : second.promise,
    );
    seed();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    const view = await setup([makeLine("a", 1)], { server });
    await waitFor(() => expect(rows()).toContain("Total estimadoBs 115,00"));

    act(() => view.cart().store.setQty(view.cart().lines[0]!.variant_id, 2));
    await flush();
    await waitFor(() => expect(mockQuote).toHaveBeenCalledTimes(2));
    expect(mockQuote.mock.calls[1]![0]).toStrictEqual({ ...HOME_PARAMS, orderAmount: 200 });
    // el costo de Bs 15 era para un subtotal de Bs 100: ya no se muestra ni se suma
    expect(rows()).toEqual([
      "Subtotal (2 productos)Bs 200,00",
      "EnvíoCalculando…",
      "TotalBs 200,00",
    ]);
    expect(estimator()).not.toHaveTextContent("Bs 15,00");
    expect(summary()).not.toHaveTextContent("Total estimado");

    await act(async () => second.resolve(quoteResult({ cost: 20 })));
    await waitFor(() => expect(rows()).toContain("Total estimadoBs 220,00"));
    expect(rows()).toContain("EnvíoBs 20,00");
  });

  it("cambia el DESTINO: no se ve el costo del anterior mientras calcula, y se pregunta con las coordenadas nuevas", async () => {
    const second = deferred();
    mockQuote.mockImplementation((params) =>
      params?.city === "La Paz" ? Promise.resolve(quoteResult({ cost: 15 })) : second.promise,
    );
    seed();
    await setup();
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));

    seed({ lat: -17.4, lng: -66.1, city: "Cochabamba", label: null, addressId: null });
    await waitFor(() => expect(mockQuote).toHaveBeenCalledTimes(2));
    expect(mockQuote.mock.calls[1]![0]).toStrictEqual({
      lat: -17.4,
      lng: -66.1,
      city: "Cochabamba",
      orderAmount: 100,
      currency: "BOB",
    });
    expect(rows()).toContain("EnvíoCalculando…");
    expect(summary()).not.toHaveTextContent("Bs 15,00");
    expect(summary()).not.toHaveTextContent("Total estimado");

    await act(async () => second.resolve(quoteResult({ cost: 30 })));
    await waitFor(() => expect(rows()).toContain("Total estimadoBs 130,00"));
  });
});

describe("estimador · cuando el servidor dice que no se puede (ok: false)", () => {
  it("muestra el mensaje del primer error y NO un costo: fila sin importe, sin total estimado, sin «Bs 0»", async () => {
    mockQuote.mockResolvedValue(rejectedQuote("out_of_coverage"));
    seed();
    await setup();
    await waitFor(() =>
      expect(regions()[0]).toHaveTextContent("Todavía no entregamos en esa dirección."),
    );
    expect(regions()[0]).toHaveTextContent(
      "Prueba con otra dirección o escríbenos por WhatsApp y vemos cómo ayudarte.",
    );
    expect(rows()).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoNo se pudo estimar",
      "TotalBs 100,00",
    ]);
    expect(summary()).not.toHaveTextContent("Total estimado");
    expect(summary()).not.toHaveTextContent("Bs 0");
    expect(summary()).not.toHaveTextContent("Envío estimado");
    // no es un fallo de conexión: no se ofrece reintentar, sino elegir otra ubicación (el botón de siempre)
    expect(
      within(estimator()).queryByRole("button", { name: "Reintentar" }),
    ).not.toBeInTheDocument();
    expect(opener("Cambiar ubicación")).toBeInTheDocument();
  });

  it("aunque el servidor mandara un costo con `ok` falso, no se muestra", async () => {
    mockQuote.mockResolvedValue({ ...rejectedQuote("blocked_zone"), cost: 15 });
    seed();
    await setup();
    await waitFor(() =>
      expect(regions()[0]).toHaveTextContent("Por ahora no entregamos en esa zona."),
    );
    expect(summary()).not.toHaveTextContent("Bs 15");
    expect(summary()).not.toHaveTextContent("Total estimado");
  });

  it.each(SHIPPING_ERROR_CODES)("%s → su mensaje (no vacío) y ningún costo", async (code) => {
    mockQuote.mockResolvedValue(rejectedQuote(code));
    seed();
    await setup();
    const expected = t(`shipping.errors.${code}` as MessageKey);
    expect(expected.trim()).not.toBe("");
    await waitFor(() => expect(regions()[0]).toHaveTextContent(expected));
    expect(rows()).toContain("EnvíoNo se pudo estimar");
    expect(summary()).not.toHaveTextContent("Total estimado");
  });

  it("un código que esta versión no conoce llega como «unknown» y dice el mensaje genérico", async () => {
    mockQuote.mockResolvedValue(rejectedQuote("unknown", "system"));
    seed();
    await setup();
    await waitFor(() =>
      expect(regions()[0]).toHaveTextContent("No pudimos calcular el envío. Inténtalo de nuevo."),
    );
  });

  it("un error que se arregla reintentando (sin origen configurado) ofrece «Reintentar»", async () => {
    mockQuote.mockResolvedValueOnce(rejectedQuote("no_origin", "system"));
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    const user = userEvent.setup();
    seed();
    await setup();
    await user.click(await within(estimator()).findByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
  });
});

describe("estimador · cuando falla la red o el servidor", () => {
  it("dice que no se pudo, ofrece «Reintentar» (el foco queda en el título) y al lograrlo muestra el costo", async () => {
    mockQuote.mockRejectedValueOnce(new Error("Failed to fetch"));
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    const user = userEvent.setup();
    seed();
    await setup();
    await waitFor(() =>
      expect(regions()[0]).toHaveTextContent(
        "No pudimos calcular el envío. Inténtalo de nuevo en un momento.",
      ),
    );
    expect(rows()).toContain("EnvíoNo se pudo estimar");
    expect(summary()).not.toHaveTextContent("Total estimado");
    expect(summary()).not.toHaveTextContent("Failed to fetch"); // el error técnico no se le enseña

    await user.click(within(estimator()).getByRole("button", { name: "Reintentar" }));
    expect(screen.getByRole("heading", { name: "Calcula tu envío" })).toHaveFocus();
    await waitFor(() => expect(rows()).toContain("Total estimadoBs 115,00"));
    expect(mockQuote).toHaveBeenCalledTimes(2);
  });
});

describe("estimador · nada que cotizar", () => {
  it("una bolsa sin nada cobrable (todo agotado, subtotal 0) NO cotiza aunque haya destino", async () => {
    seed();
    await setup([
      makeLine("a", 1, {
        status: "out_of_stock",
        blocking: true,
        available: 0,
        billable_qty: 0,
        line_total: 0,
      }),
    ]);
    await flush();
    expect(mockQuote).not.toHaveBeenCalled();
    expect(rows()).toContain("EnvíoSe calcula al elegir tu dirección");
  });

  it("una bolsa sin líneas tampoco", async () => {
    seed();
    await setup([]);
    await flush();
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it("si el servidor ya informa el envío de la bolsa (S10), se muestra ese y no se estima nada", async () => {
    seed();
    const base = makeSnapshot([makeLine("a", 1)]);
    renderWithCart(<CartSummary />, {
      snapshot: { ...base, totals: { ...base.totals, shipping: 20, total: 120 } },
    });
    await flush();
    expect(mockQuote).not.toHaveBeenCalled();
    expect(rows()).toEqual(["Subtotal (1 producto)Bs 100,00", "EnvíoBs 20,00", "TotalBs 120,00"]);
    expect(screen.queryByRole("region", { name: "Calcula tu envío" })).not.toBeInTheDocument();
  });
});

describe("estimador · accesibilidad", () => {
  it("las dos regiones vivas existen ANTES del primer mensaje y son las mismas después (no nacen con el texto)", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    await setup();
    const before = regions();
    expect(before).toHaveLength(2);
    for (const region of before) {
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveAttribute("aria-atomic", "true");
      expect(region).toBeEmptyDOMElement();
    }
    seed();
    await waitFor(() => expect(regions()[0]).toHaveTextContent("Envío estimado: Bs 15,00"));
    expect(regions()[0]).toBe(before[0]);
    expect(regions()[1]).toBe(before[1]);
  });

  it("el estimador es una región con nombre y su título es un encabezado enfocable por programa", async () => {
    await setup();
    const title = screen.getByRole("heading", { name: "Calcula tu envío", level: 3 });
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(estimator()).toHaveAccessibleName("Calcula tu envío");
  });

  it("los botones miden al menos 44 px", async () => {
    mockQuote.mockRejectedValue(new Error("sin red"));
    seed();
    await setup();
    for (const button of within(estimator()).getAllByRole("button")) {
      expect(button).toHaveClass("min-h-11");
    }
  });
});

describe("estimador · fecha y franja (opcional)", () => {
  const withSlots = (
    onCheck: (params: QuoteParams) => QuoteResult | Promise<QuoteResult> = (params) =>
      quoteResult({
        slots: SLOTS,
        selected: {
          date: params.deliveryDate!,
          slotId: params.slotId!,
          start: "09:00",
          end: "11:00",
        },
      }),
  ) =>
    mockQuote.mockImplementation(async (params) =>
      params?.slotId ? onCheck(params) : quoteResult({ cost: 15, slots: SLOTS }),
    );

  it("«Programar entrega» solo aparece con una cotización válida que traiga franjas", async () => {
    mockQuote.mockResolvedValue(quoteResult({ slots: [] }));
    seed();
    await setup();
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    expect(screen.queryByRole("button", { name: /Programar entrega/ })).not.toBeInTheDocument();
  });

  it("no aparece con un error del servidor, aunque este traiga franjas", async () => {
    mockQuote.mockResolvedValue({ ...rejectedQuote("out_of_coverage"), slots: SLOTS });
    seed();
    await setup();
    await waitFor(() => expect(regions()[0]).toHaveTextContent("Todavía no entregamos"));
    expect(screen.queryByRole("button", { name: /Programar entrega/ })).not.toBeInTheDocument();
  });

  it("muestra las franjas por fecha; las llenas deshabilitadas con «Llena»; elegir manda deliveryDate + slotId y confirma", async () => {
    withSlots();
    const user = userEvent.setup();
    seed();
    await setup();
    const toggle = await screen.findByRole("button", { name: "Programar entrega (opcional)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "lun 9 nov" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "mar 10 nov" })).toBeInTheDocument();
    const full = screen.getByRole("radio", { name: "lun 9 nov, 14:00 a 16:00, llena" });
    expect(full).toBeDisabled();
    expect(screen.getByText("Llena")).toBeInTheDocument();
    expect(mockQuote).toHaveBeenCalledTimes(1); // abrir la lista no pregunta nada

    await user.click(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" }));
    await waitFor(() =>
      expect(regions()[1]).toHaveTextContent("Entrega programada: lun 9 nov, 09:00 a 11:00"),
    );
    expect(mockQuote).toHaveBeenCalledTimes(2);
    expect(mockQuote.mock.calls[1]![0]).toStrictEqual({
      ...HOME_PARAMS,
      deliveryDate: "2026-11-09",
      slotId: "s-09:00",
    });
    // el costo y el total siguen ahí: la franja se valida aparte
    expect(rows()).toContain("EnvíoBs 15,00");
    expect(rows()).toContain("Total estimadoBs 115,00");
    expect(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" })).toBeChecked();
  });

  it("mientras el servidor comprueba la franja lo dice, y no la da por buena hasta que responde", async () => {
    const check = deferred();
    withSlots(() => check.promise);
    const user = userEvent.setup();
    seed();
    await setup();
    await user.click(await screen.findByRole("button", { name: "Programar entrega (opcional)" }));
    await user.click(screen.getByRole("radio", { name: "mar 10 nov, 09:00 a 11:00" }));
    await waitFor(() => expect(regions()[1]).toHaveTextContent("Comprobando disponibilidad…"));
    expect(regions()[1]).not.toHaveTextContent("Entrega programada");
    await act(async () =>
      check.resolve(
        quoteResult({
          slots: SLOTS,
          selected: { date: "2026-11-10", slotId: "s-09:00", start: "09:00", end: "11:00" },
        }),
      ),
    );
    await waitFor(() =>
      expect(regions()[1]).toHaveTextContent("Entrega programada: mar 10 nov, 09:00 a 11:00"),
    );
  });

  it.each(["slot_full", "date_too_soon", "slot_not_found", "date_blocked"] as const)(
    "el servidor rechaza la franja con %s: se muestra su mensaje y el costo y el total NO desaparecen",
    async (code) => {
      withSlots(() => ({ ...rejectedQuote(code, "slot"), slots: SLOTS }));
      const user = userEvent.setup();
      seed();
      await setup();
      await user.click(await screen.findByRole("button", { name: "Programar entrega (opcional)" }));
      await user.click(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" }));
      await waitFor(() =>
        expect(regions()[1]).toHaveTextContent(t(`shipping.errors.${code}` as MessageKey)),
      );
      expect(regions()[1]).not.toHaveTextContent("Entrega programada");
      expect(rows()).toContain("EnvíoBs 15,00");
      expect(rows()).toContain("Total estimadoBs 115,00");
    },
  );

  it("si la franja se llenó de última hora, la lista se actualiza con lo que dice el servidor", async () => {
    const nowFull = SLOTS.map((s) =>
      s.date === "2026-11-09" && s.start === "09:00" ? { ...s, remaining: 0, available: false } : s,
    );
    withSlots(() => ({ ...rejectedQuote("slot_full", "slot"), slots: nowFull }));
    const user = userEvent.setup();
    seed();
    await setup();
    await user.click(await screen.findByRole("button", { name: "Programar entrega (opcional)" }));
    await user.click(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" }));
    const updated = await screen.findByRole("radio", { name: "lun 9 nov, 09:00 a 11:00, llena" });
    expect(updated).toBeDisabled();
  });

  it("un fallo de red al comprobar la franja se puede reintentar", async () => {
    let attempts = 0;
    withSlots((params) => {
      attempts += 1;
      if (attempts === 1) throw new Error("Failed to fetch");
      return quoteResult({
        slots: SLOTS,
        selected: {
          date: params.deliveryDate!,
          slotId: params.slotId!,
          start: "09:00",
          end: "11:00",
        },
      });
    });
    const user = userEvent.setup();
    seed();
    await setup();
    await user.click(await screen.findByRole("button", { name: "Programar entrega (opcional)" }));
    await user.click(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" }));
    await waitFor(() =>
      expect(regions()[1]).toHaveTextContent("No pudimos calcular el envío. Inténtalo de nuevo"),
    );
    await user.click(within(estimator()).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(regions()[1]).toHaveTextContent("Entrega programada"));
    expect(rows()).toContain("EnvíoBs 15,00");
  });

  it("se puede quitar la elección: lo dice, el foco va al botón «Programar entrega» y no se pregunta de nuevo", async () => {
    withSlots();
    const user = userEvent.setup();
    seed();
    await setup();
    const toggle = await screen.findByRole("button", { name: "Programar entrega (opcional)" });
    await user.click(toggle);
    await user.click(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" }));
    await waitFor(() => expect(regions()[1]).toHaveTextContent("Entrega programada"));
    const calls = mockQuote.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Quitar fecha elegida" }));
    expect(regions()[1]).toHaveTextContent("Quitaste la fecha de entrega.");
    expect(regions()[1]).not.toHaveTextContent("Entrega programada");
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Quitar fecha elegida" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" })).not.toBeChecked();
    expect(mockQuote.mock.calls.length).toBe(calls);
  });

  it("la franja elegida sigue ahí al cambiar el subtotal (se valida otra vez con el monto nuevo)", async () => {
    withSlots();
    const user = userEvent.setup();
    seed();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    const view = await setup([makeLine("a", 1)], { server });
    await user.click(await screen.findByRole("button", { name: "Programar entrega (opcional)" }));
    await user.click(screen.getByRole("radio", { name: "lun 9 nov, 09:00 a 11:00" }));
    await waitFor(() => expect(regions()[1]).toHaveTextContent("Entrega programada"));
    act(() => view.cart().store.setQty(view.cart().lines[0]!.variant_id, 2));
    await flush();
    await waitFor(() =>
      expect(mockQuote.mock.calls.at(-1)![0]).toStrictEqual({
        ...HOME_PARAMS,
        orderAmount: 200,
        deliveryDate: "2026-11-09",
        slotId: "s-09:00",
      }),
    );
    await waitFor(() => expect(regions()[1]).toHaveTextContent("Entrega programada"));
  });
});

describe("estimador · recuerda el destino mientras la pestaña esté abierta", () => {
  it("al volver a la bolsa (la página se monta de nuevo) no hay que elegirlo otra vez", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed();
    const first = await setup();
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    first.unmount();
    await setup();
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    expect(mockQuote).toHaveBeenCalledTimes(2);
  });

  it("no guarda nada en el almacenamiento del navegador", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    localStorage.clear();
    sessionStorage.clear();
    seed();
    await setup();
    await waitFor(() => expect(rows()).toContain("EnvíoBs 15,00"));
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toMatch(/-16\.5|-68\.15|La Paz/);
  });

  it("lo que eligió una persona (o una invitada) NO lo ve otra: con sesión no aparece el destino de la invitada", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed(HOME, GUEST_OWNER);
    await setup([makeLine("a", 1)], { auth: signedIn() });
    await flush();
    expect(mockQuote).not.toHaveBeenCalled();
    expect(rows()).toContain("EnvíoSe calcula al elegir tu dirección");
  });
});

describe("estimador · el mapa (cajón bajo demanda)", () => {
  it("abre un diálogo con el selector, sin decir que el pin es opcional y acotado a Bolivia", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(opener("Elegir ubicación en el mapa"));
    const dialog = await screen.findByRole("dialog", { name: "Tu ubicación de entrega" });
    expect(within(dialog).getByTestId("picker")).toHaveAttribute("data-country", "BO");
    expect(
      within(dialog).getByText("Marca el punto de entrega: hace falta para calcular el envío."),
    ).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(/no se guarda en tu cuenta/);
  });

  it("confirmar sin ciudad ni punto: avisa de las dos cosas, lleva el foco a la ciudad y NO pregunta al servidor", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(opener("Elegir ubicación en el mapa"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Usar esta ubicación" }));
    expect(within(dialog).getByText("Escribe tu ciudad.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Marca tu ubicación en el mapa o escribe la latitud y la longitud."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Ciudad" })).toHaveFocus();
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it("solo falta el punto: el foco va al aviso del punto", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(opener("Elegir ubicación en el mapa"));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Ciudad" }), "La Paz");
    await user.click(within(dialog).getByRole("button", { name: "Usar esta ubicación" }));
    expect(
      within(dialog).getByText("Marca tu ubicación en el mapa o escribe la latitud y la longitud."),
    ).toHaveFocus();
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it("una coordenada mal escrita se señala (y no se pregunta nada)", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(opener("Elegir ubicación en el mapa"));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Ciudad" }), "La Paz");
    await user.click(within(dialog).getByRole("button", { name: "Escribir latitud inválida" }));
    await user.click(within(dialog).getByRole("button", { name: "Usar esta ubicación" }));
    expect(
      within(dialog).getByText("Escribe un número con punto o coma decimal, por ejemplo -16.5."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Revisa la ubicación: la latitud o la longitud no es válida."),
    ).toHaveFocus();
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it("con punto y ciudad: cierra, vuelve el foco al botón que lo abrió, cotiza y lo recuerda", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    const user = userEvent.setup();
    await setup();
    const trigger = opener("Elegir ubicación en el mapa");
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Ciudad" }), "  La Paz ");
    await user.click(within(dialog).getByRole("button", { name: "Marcar punto de prueba" }));
    await user.click(within(dialog).getByRole("button", { name: "Usar esta ubicación" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(rows()).toContain("Total estimadoBs 115,00"));
    expect(mockQuote.mock.calls[0]![0]).toStrictEqual(HOME_PARAMS);
    // el MISMO botón (ahora «Cambiar ubicación») recupera el foco
    expect(opener("Cambiar ubicación")).toBe(trigger);
    expect(trigger).toHaveFocus();
    expect(estimator()).toHaveTextContent("Enviar a la ubicación que marcaste (La Paz).");
    expect(
      within(estimator()).queryByText(
        "Elige dónde recibirás tu pedido para ver cuánto cuesta el envío.",
      ),
    ).not.toBeInTheDocument();
  });

  it("cancelar cierra, devuelve el foco y no cambia nada", async () => {
    const user = userEvent.setup();
    await setup();
    const trigger = opener("Elegir ubicación en el mapa");
    await user.click(trigger);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(mockQuote).not.toHaveBeenCalled();
    expect(rows()).toContain("EnvíoSe calcula al elegir tu dirección");
  });

  it("al cambiar la ubicación el formulario arranca con lo que ya se había marcado", async () => {
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    const user = userEvent.setup();
    seed();
    await setup();
    await user.click(opener("Cambiar ubicación"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Ciudad" })).toHaveValue("La Paz");
    expect(within(dialog).getByRole("status", { name: "Pin actual" })).toHaveTextContent(
      "-16.5,-68.15",
    );
  });
});

describe("estimador · con sesión: direcciones guardadas", () => {
  const user1 = signedIn();

  it("lista las direcciones de ENVÍO (no las solo de facturación) y elegir una con pin cotiza con SUS coordenadas", async () => {
    mockAddresses.mockResolvedValue([
      address("Casa", { lat: -16.51, lng: -68.12, city: "La Paz" }),
      address("Taller", { forShipping: false, forBilling: true }),
      address("Oficina", { lat: -17.39, lng: -66.15, city: "Cochabamba" }),
    ]);
    mockQuote.mockResolvedValue(quoteResult({ cost: 22 }));
    const user = userEvent.setup();
    await setup([makeLine("a", 1)], { auth: user1 });
    const group = await screen.findByRole("group", { name: "Tus direcciones" });
    expect(mockAddresses).toHaveBeenCalledWith("user-1");
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(within(group).queryByText("Taller")).not.toBeInTheDocument();
    expect(mockQuote).not.toHaveBeenCalled(); // listar no cotiza: hay que elegir

    await user.click(within(group).getByRole("radio", { name: /Oficina/ }));
    await waitFor(() => expect(rows()).toContain("Total estimadoBs 122,00"));
    expect(mockQuote.mock.calls[0]![0]).toStrictEqual({
      lat: -17.39,
      lng: -66.15,
      city: "Cochabamba",
      orderAmount: 100,
      currency: "BOB",
    });
    expect(within(group).getByRole("radio", { name: /Oficina/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /Casa/ })).not.toBeChecked();
    // la libreta de direcciones con sesión usa el botón de «otra ubicación»
    expect(opener("Usar otra ubicación")).toBeInTheDocument();
  });

  it("una dirección SIN pin pide ubicarla en el mapa (con su ciudad ya escrita) y no cotiza hasta confirmar", async () => {
    mockAddresses.mockResolvedValue([
      address("Oficina", { lat: null, lng: null, city: "El Alto" }),
    ]);
    mockQuote.mockResolvedValue(quoteResult({ cost: 18 }));
    const user = userEvent.setup();
    await setup([makeLine("a", 1)], { auth: user1 });
    const radio = await screen.findByRole("radio", { name: /Oficina/ });
    expect(radio).toHaveAccessibleDescription("Falta ubicarla en el mapa");

    await user.click(radio);
    const dialog = await screen.findByRole("dialog", { name: "Ubica «Oficina» en el mapa" });
    expect(within(dialog).getByRole("textbox", { name: "Ciudad" })).toHaveValue("El Alto");
    expect(radio).not.toBeChecked();
    expect(mockQuote).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Marcar punto de prueba" }));
    await user.click(within(dialog).getByRole("button", { name: "Usar esta ubicación" }));
    await waitFor(() => expect(rows()).toContain("Total estimadoBs 118,00"));
    expect(mockQuote.mock.calls[0]![0]).toStrictEqual({
      lat: -16.5,
      lng: -68.15,
      city: "El Alto",
      orderAmount: 100,
      currency: "BOB",
    });
    expect(screen.getByRole("radio", { name: /Oficina/ })).toBeChecked();
    // el punto es solo para esta estimación: no se escribió en la libreta
    expect(mockAddresses).toHaveBeenCalledTimes(1);
  });

  it("sin direcciones guardadas lo dice y sigue ofreciendo marcar otra ubicación", async () => {
    await setup([makeLine("a", 1)], { auth: user1 });
    expect(
      await screen.findByText("No tienes direcciones guardadas para envíos."),
    ).toBeInTheDocument();
    expect(opener("Usar otra ubicación")).toBeInTheDocument();
  });

  it("si la libreta no carga lo dice y deja reintentar, sin tumbar el estimador", async () => {
    mockAddresses.mockRejectedValueOnce(new Error("sin red"));
    mockAddresses.mockResolvedValue([address("Casa")]);
    const user = userEvent.setup();
    await setup([makeLine("a", 1)], { auth: user1 });
    expect(await screen.findByText("No pudimos cargar tus direcciones.")).toBeInTheDocument();
    expect(opener("Usar otra ubicación")).toBeInTheDocument();
    await user.click(within(estimator()).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("radio", { name: /Casa/ })).toBeInTheDocument();
  });

  it("una dirección recordada que ya no existe en la libreta se descarta (no se estima para una dirección ajena a su libreta)", async () => {
    mockAddresses.mockResolvedValue([address("Casa")]);
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed({ ...HOME, label: "Vieja", addressId: "Vieja" }, "user-1");
    await setup([makeLine("a", 1)], { auth: user1 });
    await waitFor(() => expect(rows()).toContain("EnvíoSe calcula al elegir tu dirección"));
    expect(summary()).not.toHaveTextContent("Total estimado");
  });

  it("una dirección recordada que se movió en la libreta se vuelve a cotizar con su lugar nuevo", async () => {
    mockAddresses.mockResolvedValue([
      address("Casa", { lat: -17.4, lng: -66.1, city: "Cochabamba" }),
    ]);
    mockQuote.mockResolvedValue(quoteResult({ cost: 15 }));
    seed({ ...HOME, label: "Casa", addressId: "Casa" }, "user-1");
    await setup([makeLine("a", 1)], { auth: user1 });
    await waitFor(() =>
      expect(mockQuote.mock.calls.at(-1)![0]).toStrictEqual({
        lat: -17.4,
        lng: -66.1,
        city: "Cochabamba",
        orderAmount: 100,
        currency: "BOB",
      }),
    );
  });
});

describe("estimador · el código pesado va aparte (no entra en la página de la bolsa)", () => {
  // Los imports estáticos de TIPOS se borran al compilar; lo que cuenta son los imports de valores y los dinámicos.
  const runtimeImports = (source: string) =>
    [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]!);

  const HEAVY = [
    "@/components/map/LocationPicker",
    "./DestinationSheet",
    "./SavedAddresses",
    "@/features/account/addresses/hooks",
    "@/features/account/addresses/api",
    "leaflet",
  ];

  it.each([
    ["CartSummary", cartSummarySource],
    ["ShippingEstimator", estimatorSource],
    ["useShippingEstimate", hookSource],
    ["estimate", estimateSource],
  ])("%s no importa el mapa, el cajón ni la libreta de forma estática", (_name, source) => {
    const imports = runtimeImports(source);
    for (const heavy of HEAVY) expect(imports).not.toContain(heavy);
    expect(imports.some((i) => i.includes("leaflet"))).toBe(false);
  });

  it("el estimador los pide con import() dinámico (fragmentos aparte)", () => {
    expect(estimatorSource).toMatch(/import\("\.\/SavedAddresses"\)/);
    expect(estimatorSource).toMatch(/import\("\.\/DestinationSheet"\)/);
  });

  it("sin sesión no se descarga la libreta ni se pide nada de ella", async () => {
    await setup();
    await flush();
    expect(mockAddresses).not.toHaveBeenCalled();
  });
});

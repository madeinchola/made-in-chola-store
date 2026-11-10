import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProductBySlug } from "@/features/catalog/catalogService";
import type { ProductSummary } from "@/features/catalog/types";
import { subscribeToTracking, type TrackEvent } from "@/features/storefront/analytics/track";
import { money } from "@/lib/money";
import { CartPage } from "./CartPage";
import {
  FakeCartServer,
  flush,
  makeLine,
  makeSnapshot,
  renderWithCart,
  signedIn,
} from "./cart-test-utils";
import type { CartLine, CartSnapshot } from "./types";

vi.mock("@/features/catalog/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog/catalogService")>()),
  getProductBySlug: vi.fn(),
}));
vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://cdn.test/${path}`,
}));

const related = (
  id: string,
  name: string,
  extra: Partial<ProductSummary> = {},
): ProductSummary => ({
  id,
  slug: `rel-${id}`,
  name,
  isNew: false,
  price: money(45000, "BOB"),
  colorsCount: 1,
  soldOut: false,
  coverPath: null,
  coverAlt: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...extra,
});

function serveRelated(products: ProductSummary[] | "error" | "none") {
  vi.mocked(getProductBySlug).mockReset();
  if (products === "error") {
    vi.mocked(getProductBySlug).mockRejectedValue(new Error("sin red"));
  } else if (products === "none") {
    vi.mocked(getProductBySlug).mockResolvedValue(null);
  } else {
    vi.mocked(getProductBySlug).mockResolvedValue({
      product: {
        ...related("p-a", "Chaqueta a"),
        model: null,
        description: "",
        materials: null,
        washcare: null,
      },
      colors: [],
      sizes: [],
      variants: [],
      images: [],
      related: products,
    });
  }
}

const events: TrackEvent[] = [];
let off: () => void;
beforeEach(() => {
  events.length = 0;
  off = subscribeToTracking((event) => events.push(event));
  serveRelated("none");
});
afterEach(() => off());

async function setup(lines: CartLine[] | null, options: Parameters<typeof renderWithCart>[1] = {}) {
  const snapshot: CartSnapshot | null = lines ? makeSnapshot(lines) : null;
  const view = renderWithCart(<CartPage />, { snapshot, ...options });
  await flush();
  return view;
}

/** La región viva sr-only de la página («Cargando…», «Agregando…»): un `<p role="status" class="sr-only">` directo del contenedor. */
const spokenStatus = () =>
  screen
    .getAllByRole("status")
    .find((el) => el.tagName === "P" && el.classList.contains("sr-only") && !el.closest("li"))!;
/** La región viva de AVISOS de la página: lo primero que sigue al título. */
const noticeRegion = () =>
  screen.getByRole("heading", { level: 1 }).nextElementSibling as HTMLElement;

describe("CartPage · estructura", () => {
  it("UN solo h1 «Tu bolsa», título del documento y sin indexar", async () => {
    await setup([makeLine("a", 1)]);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Tu bolsa");
    expect(document.title).toBe("Tu bolsa · Made In Chola");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,follow",
    );
  });

  it("con productos: lista de líneas, resumen y botón Pagar", async () => {
    await setup([makeLine("a", 2, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })], {
      auth: signedIn(),
    });
    const list = screen.getByRole("list", { name: "Productos en tu bolsa" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Resumen" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagar" })).toHaveAttribute("href", "/checkout");
  });

  it("muestra la cuenta regresiva de la reserva y los avisos del servidor", async () => {
    const snapshot = makeSnapshot(
      [makeLine("a", 1, { status: "out_of_stock", blocking: true, available: 0 })],
      { reservation: { state: "held", expires_at: new Date(Date.now() + 120_000).toISOString() } },
    );
    renderWithCart(<CartPage />, { snapshot });
    await flush();
    expect(screen.getByText(/Reservamos tus productos durante 0[12]:/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Se agotó");
  });

  it("cargando (aún sin respuesta del servidor): anuncia la carga y no confunde con «vacía»", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    const resume = server.pause();
    renderWithCart(<CartPage />, { server, auth: signedIn() });
    await flush();
    // lo dice una región viva sr-only montada desde el primer pintado; el esqueleto no es `aria-busy` (algunos lectores no
    // anuncian lo que hay dentro de un contenedor ocupado)
    const spoken = spokenStatus();
    expect(spoken).toHaveTextContent("Cargando tu bolsa…");
    expect(document.querySelector("[aria-busy]")).toBeNull();
    expect(screen.queryByText("Tu bolsa está vacía")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByRole("region", { name: "Resumen" })).toBeInTheDocument();
    expect(spokenStatus()).toBe(spoken); // el mismo nodo: la región no se recrea, cambia su texto
    expect(spoken).toBeEmptyDOMElement();
  });

  it("al entrar revalida la bolsa con el servidor", async () => {
    const { server } = await setup([makeLine("a", 1)], { auth: signedIn() });
    expect(server.callsOf("get").length).toBeGreaterThanOrEqual(1);
  });
});

describe("CartPage · estabilidad del diseño (CLS)", () => {
  // El pie es alto: si la página mide menos que el marcador de carga de la ruta (100svh), sube de golpe al aparecer el
  // contenido. Se comprueba que el contenedor reserva esa altura en cada estado.
  const root = () => screen.getByRole("heading", { level: 1 }).parentElement;

  it("con productos, vacía y cargando: el contenedor reserva la altura de la pantalla", async () => {
    await setup([makeLine("a", 1)]);
    expect(root()).toHaveClass("min-h-[100svh]");
    cleanup();
    await setup([]);
    expect(root()).toHaveClass("min-h-[100svh]");
    cleanup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    server.pause();
    renderWithCart(<CartPage />, { server, auth: signedIn() });
    await flush();
    expect(root()).toHaveClass("min-h-[100svh]");
  });
});

describe("CartPage · bolsa vacía", () => {
  it("estado amable con enlace a la tienda; sigue habiendo un único h1", async () => {
    await setup([]);
    expect(
      screen.getAllByRole("status").some((el) => el.textContent?.includes("Tu bolsa está vacía")),
    ).toBe(true);
    expect(screen.getByRole("link", { name: "Ir a la tienda" })).toHaveAttribute("href", "/tienda");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Resumen" })).not.toBeInTheDocument();
  });

  it("un invitado que nunca agregó nada (sin token) ve la bolsa vacía sin pedir nada al servidor", async () => {
    const { server } = await setup(null);
    expect(screen.getByText("Tu bolsa está vacía")).toBeInTheDocument();
    expect(server.calls).toHaveLength(0);
  });

  it("quitar la última línea lleva a la bolsa vacía y el foco al título", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 1, { name: "Falda" })]);
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    await flush();
    expect(screen.getByText("Tu bolsa está vacía")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Tu bolsa" })).toHaveFocus();
  });

  it("no hay sugerencias con la bolsa vacía", async () => {
    serveRelated([related("r1", "Sombrero")]);
    await setup([]);
    expect(screen.queryByText("Completa tu look")).not.toBeInTheDocument();
    expect(getProductBySlug).not.toHaveBeenCalled();
  });
});

describe("CartPage · view_cart", () => {
  const viewCart = () => events.filter((e) => e.name === "view_cart");

  it("una sola vez por visita, con los totales del servidor", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 2, { unit_price: 560, line_total: 1120 }), makeLine("b", 1)]);
    expect(viewCart()).toEqual([{ name: "view_cart", items: 3, value: 1220, currency: "BOB" }]);
    // cambios y nuevas lecturas del servidor no repiten el evento
    await user.click(screen.getAllByRole("button", { name: /^Aumentar la cantidad de / })[0]!);
    await flush();
    expect(viewCart()).toHaveLength(1);
  });

  it("otra visita (la página se vuelve a montar) emite otro", async () => {
    const view = await setup([makeLine("a", 1)]);
    expect(viewCart()).toHaveLength(1);
    view.unmount();
    await setup([makeLine("a", 1)]);
    expect(viewCart()).toHaveLength(2);
  });

  it("con la bolsa vacía no se emite", async () => {
    await setup([]);
    expect(viewCart()).toHaveLength(0);
  });

  it("espera a tener datos: un usuario con sesión emite cuando llega la respuesta del servidor", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 4)]));
    const resume = server.pause();
    renderWithCart(<CartPage />, { server, auth: signedIn() });
    await flush();
    expect(viewCart()).toHaveLength(0);
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(viewCart()).toEqual([{ name: "view_cart", items: 4, value: 400, currency: "BOB" }]);
  });
});

describe("CartPage · Completa tu look", () => {
  it("relacionados del producto de la PRIMERA línea, sin lo que ya está en la bolsa ni lo agotado, máximo 4", async () => {
    serveRelated([
      related("p-b", "Ya en la bolsa"), // coincide con el producto de la línea «b»
      related("r1", "Sombrero"),
      related("r2", "Cartera", { soldOut: true }),
      related("r3", "Bufanda"),
      related("r4", "Cinturón"),
      related("r5", "Collar"),
      related("r6", "Pulsera"),
    ]);
    await setup([makeLine("a", 1), makeLine("b", 1)]);
    const section = await screen.findByRole("region", { name: "Completa tu look" });
    expect(getProductBySlug).toHaveBeenCalledWith("chaqueta-a");
    const names = within(section)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(names).toEqual(["Sombrero", "Bufanda", "Cinturón", "Collar"]);
    expect(
      within(section).getByRole("heading", { level: 2, name: "Completa tu look" }),
    ).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Sombrero" })).toHaveAttribute(
      "href",
      "/producto/rel-r1",
    );
  });

  it.each([
    ["sin relacionados", [] as ProductSummary[]],
    ["todos ya en la bolsa", [related("p-a", "Chaqueta a")]],
    ["todos agotados", [related("r1", "X", { soldOut: true })]],
  ])("%s: la sección no se muestra", async (_name, products) => {
    serveRelated(products);
    await setup([makeLine("a", 1)]);
    await vi.waitFor(() => expect(getProductBySlug).toHaveBeenCalled());
    await flush();
    expect(screen.queryByText("Completa tu look")).not.toBeInTheDocument();
  });

  it("si la consulta falla, la página sigue funcionando sin la sección", async () => {
    serveRelated("error");
    await setup([makeLine("a", 1)]);
    await vi.waitFor(() => expect(getProductBySlug).toHaveBeenCalled());
    await flush();
    expect(screen.queryByText("Completa tu look")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Resumen" })).toBeInTheDocument();
  });
});

describe("CartPage · la bolsa no se pudo leer", () => {
  it("con sesión y sin red NO dice «Tu bolsa está vacía» (quien tiene productos los vería desaparecer): dice que no se pudo cargar", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 3)]));
    server.forced = { ok: false, status: 0, code: "network", message: "network" };
    renderWithCart(<CartPage />, { server, auth: signedIn() });
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tu bolsa");
    expect(screen.queryByText("Tu bolsa está vacía")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ir a la tienda" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reintentar" })).toHaveLength(1); // sin repetir el aviso de conexión
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tu bolsa");
  });

  it("también con un error del servidor (503)", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 3)]));
    server.forced = { ok: false, status: 503, code: "unavailable", message: "unavailable" };
    renderWithCart(<CartPage />, { server, auth: signedIn() });
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tu bolsa");
    expect(screen.queryByText("Tu bolsa está vacía")).not.toBeInTheDocument();
  });

  it("«Reintentar» vuelve a leer y, con red, aparece la bolsa", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 3)]));
    server.forced = { ok: false, status: 0, code: "network", message: "network" };
    renderWithCart(<CartPage />, { server, auth: signedIn() });
    await flush();
    server.forced = null;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Resumen" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Cantidad de / })).toHaveValue("3");
  });

  it("un invitado con bolsa guardada sigue viendo su bolsa aunque no haya red (tiene copia local)", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 2)]));
    server.forced = { ok: false, status: 0, code: "network", message: "network" };
    await setup([makeLine("a", 2)], { server });
    expect(screen.queryByText("No pudimos cargar tu bolsa")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Cantidad de / })).toHaveValue("2");
  });
});

describe("CartPage · «Deshacer» en línea", () => {
  it("al quitar aparece «Quitaste X» con «Deshacer» EN LA PÁGINA (alcanzable con Tab, no un toast) y deshacer devuelve la línea", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 2, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]);
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    const notice = screen.getByText("Quitaste «Falda» de la bolsa");
    expect(notice).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Cantidad de Falda" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    await flush();
    expect(screen.getByRole("textbox", { name: "Cantidad de Falda" })).toHaveValue("2");
    expect(screen.queryByText("Quitaste «Falda» de la bolsa")).not.toBeInTheDocument();
  });

  it("quitar la última muestra la bolsa vacía Y el «Deshacer»", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 1, { name: "Falda" })]);
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    await flush();
    expect(screen.getByText("Tu bolsa está vacía")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });

  it("el aviso desaparece solo a los 8 segundos (lo decide el almacén)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setup([makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]);
      await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
      expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_900);
      });
      expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument(); // a los 7,9 s sigue
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument(); // a los 8,2 s ya no
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CartPage · el resumen sigue «actualizando» al quitar una línea", () => {
  it("quitar A (Bs 100) deja el resumen atenuado y «Actualizando…» mientras el servidor no confirma; luego se actualiza", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(
      makeSnapshot([makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]),
    );
    await setup([makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })], {
      server,
    });
    const summary = screen.getByRole("region", { name: "Resumen" });
    // la región viva de la CABECERA del resumen (el estimador de envío trae las suyas, más abajo)
    const status = within(
      within(summary).getByRole("heading", { level: 2 }).parentElement!,
    ).getByRole("status");
    expect(status).toBeEmptyDOMElement();
    const resume = server.pause();
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    // aunque la línea quitada ya no esté en la lista; sin `aria-busy` (ocultaría la región viva a algunos lectores)
    expect(summary).not.toHaveAttribute("aria-busy");
    expect(status).toHaveTextContent("Actualizando…");
    expect(summary.querySelector("dl")).toHaveClass("opacity-60");
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(summary).not.toHaveAttribute("aria-busy");
    expect(status).toBeEmptyDOMElement();
    expect(summary.querySelector("dl")).not.toHaveClass("opacity-60");
  });
});

describe("CartPage · avisos de sincronización", () => {
  it("sin conexión: el aviso aparece arriba y la bolsa sigue visible", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    const { cart } = await setup([makeLine("a", 1)], { server });
    server.forced = { ok: false, status: 0, code: "network", message: "network" };
    const region = noticeRegion();
    expect(region).toBeEmptyDOMElement(); // existe antes del aviso
    act(() => cart().store.setQty("a", 2));
    await flush();
    expect(
      screen.getByText("Sin conexión. Enviaremos tus cambios cuando vuelva la conexión."),
    ).toBeInTheDocument();
    // …y el aviso entró dentro de ella (la región viva que ya existía), sin `role` propio
    expect(noticeRegion()).toBe(region);
    expect(region).toHaveTextContent("Sin conexión.");
    expect(region.querySelectorAll("[role]")).toHaveLength(0);
    expect(screen.getByRole("textbox", { name: /^Cantidad de / })).toHaveValue("2");
  });
});

describe("CartPage · regiones vivas persistentes y foco", () => {
  const failingAdd = (server: FakeCartServer) => {
    server.onSetItem = () => ({
      ok: true,
      data: {
        token_state: "ok",
        server_time: new Date().toISOString(),
        cart: server.snapshot,
        outcome: "out_of_stock",
        requested: 1,
        applied: 0,
      },
    });
  };

  it("la región de avisos existe, vacía, antes del primero y un alta que no cabe entra en ESE nodo aunque la página cambie de rama (vacía → con altas → vacía)", async () => {
    const server = new FakeCartServer(makeSnapshot([]));
    failingAdd(server);
    const { cart } = await setup([], { server });
    const region = noticeRegion();
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "false");
    expect(region).toBeEmptyDOMElement();

    act(() => cart().store.setQty("otra", 1)); // «Agregando…» y luego el servidor dice que se agotó
    await flush();
    expect(noticeRegion()).toBe(region);
    expect(region).toHaveTextContent("No pudimos agregar ese producto: se agotó.");
    expect(region.querySelectorAll("[role]")).toHaveLength(0); // el aviso no nace con su propio `role`
  });

  it("mientras se agrega, la región sr-only dice «Agregando a tu bolsa…» (mismo nodo, cambia el texto)", async () => {
    const server = new FakeCartServer(makeSnapshot([]));
    const { cart } = await setup([], { server });
    const spoken = spokenStatus();
    expect(spoken).toBeEmptyDOMElement();
    const resume = server.pause();
    act(() => cart().store.setQty("nuevo", 1));
    expect(spokenStatus()).toBe(spoken);
    expect(spoken).toHaveTextContent("Agregando a tu bolsa…");
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(spoken).toBeEmptyDOMElement();
  });

  it("cerrar el aviso (X) con el foco en el botón lleva el foco al título «Tu bolsa», no al <body>", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([]));
    failingAdd(server);
    const { cart } = await setup([], { server });
    act(() => cart().store.setQty("otra", 1));
    await flush();
    const close = screen.getByRole("button", { name: "Cerrar aviso" });
    await user.click(close);
    expect(close).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "Tu bolsa" })).toHaveFocus();
  });

  it("«Deshacer»: el aviso se va al pulsarlo y el foco pasa al título (no al <body>)", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 2, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]);
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    const undo = screen.getByRole("button", { name: "Deshacer" });
    expect(noticeRegion()).toContainElement(undo); // el aviso entró en la región de avisos
    await user.click(undo);
    await flush();
    expect(undo).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "Tu bolsa" })).toHaveFocus();
  });

  it("«Reintentar» de «No pudimos cargar tu bolsa»: al cargar, el botón se va y el foco pasa al título", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 3)]));
    server.forced = { ok: false, status: 0, code: "network", message: "network" };
    renderWithCart(<CartPage />, { server, auth: signedIn() });
    await flush();
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    server.forced = null;
    await user.click(retry);
    await flush();
    expect(await screen.findByRole("region", { name: "Resumen" })).toBeInTheDocument();
    expect(retry).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "Tu bolsa" })).toHaveFocus();
  });
});

describe("CartPage · descuentos y cupón (S9)", () => {
  const rowsOf = () =>
    Array.from(screen.getByRole("region", { name: "Resumen" }).querySelectorAll("dl > div")).map(
      (row) => row.textContent,
    );

  /** Dos prendas de Bs 100 y un servidor que conoce el cupón VERANO10 (10 %). */
  function twoItems() {
    const lines = [makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })];
    const server = new FakeCartServer(makeSnapshot(lines));
    server.coupons = { VERANO10: { percent: 10 } };
    return { lines, server };
  }

  it("el resumen trae el bloque del cupón y la lista de líneas sigue siendo solo de productos", async () => {
    await setup([makeLine("a", 2, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]);
    const summary = screen.getByRole("region", { name: "Resumen" });
    expect(within(summary).getByRole("group", { name: "¿Tienes un cupón?" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Productos en tu bolsa" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("aplicar un cupón desde la página: línea tachada, resumen con desglose y total neto, foco en la tarjeta del cupón y el anuncio en SU región (no en la de la página)", async () => {
    const user = userEvent.setup();
    const { lines, server } = twoItems();
    await setup(lines, { server });
    await user.type(screen.getByRole("textbox", { name: "Código de cupón" }), "verano10");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    await flush();
    // 10 % de Bs 100 = Bs 10 por línea → baja Bs 20 de Bs 200 → se paga Bs 180
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText(/Total de la línea:/)).toHaveTextContent(
      "Total de la línea: Bs 90,00, antes Bs 100,00",
    );
    expect(within(items[1]!).getByText(/Total de la línea:/)).toHaveTextContent(
      "Total de la línea: Bs 90,00, antes Bs 100,00",
    );
    expect(rowsOf()).toEqual([
      "Subtotal (2 productos)Bs 200,00",
      "EnvíoSe calcula al elegir tu dirección",
      "Descuento-Bs 20,00Cupón VERANO10: −Bs 20,00",
      "TotalBs 180,00",
    ]);
    expect(screen.getByText("Cupón VERANO10", { selector: "p" })).toHaveFocus();
    expect(spokenStatus()).toBeEmptyDOMElement(); // la región de la página no habla del cupón
    expect(screen.getByText("Cupón aplicado: Cupón VERANO10")).toBeInTheDocument();
    // «Actualizando…» es de las cantidades pendientes, no del cupón
    expect(screen.getByRole("region", { name: "Resumen" }).querySelector("dl")).not.toHaveClass(
      "opacity-60",
    );
  });

  it("una bolsa que ya llega con el cupón aplicado (la clienta vuelve a la página) lo muestra de entrada, con «Quitar» y sin el campo", async () => {
    const line = makeLine("a", 2, {
      name: "Falda",
      discount: 20,
      final_total: 180,
      discount_offers: [
        { discount_id: "d1", name: "Cupón VERANO10", kind: "percent", amount: 20, coupon: true },
      ],
    });
    const snapshot = makeSnapshot([line], {
      totals: {
        subtotal: 200,
        item_count: 2,
        line_count: 1,
        shipping: null,
        discount: 20,
        total: 180,
      },
      discounts: {
        applied: [
          {
            discount_id: "d1",
            coupon_id: "c1",
            name: "Cupón VERANO10",
            kind: "percent",
            amount: 20,
            automatic: false,
            free_shipping: false,
          },
        ],
        rejected: [],
        coupon: {
          status: "applied",
          code: "VERANO10",
          reason: null,
          missing: null,
          name: "Cupón VERANO10",
        },
        free_shipping: false,
      },
    });
    await setup(null, { snapshot });
    expect(screen.getByRole("button", { name: "Quitar el cupón VERANO10" })).toBeInTheDocument();
    expect(screen.getByText("Ahorras Bs 20,00")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Código de cupón" })).not.toBeInTheDocument();
    expect(rowsOf()).toContain("TotalBs 180,00");
  });

  it("un cambio de cantidad con cupón puesto rehace los importes de la línea y del resumen con lo que manda el servidor", async () => {
    const user = userEvent.setup();
    const lines = [makeLine("a", 1, { name: "Falda" })];
    const server = new FakeCartServer(makeSnapshot(lines));
    server.coupons = { VERANO10: { percent: 10 } };
    await setup(lines, { server });
    await user.type(screen.getByRole("textbox", { name: "Código de cupón" }), "verano10{Enter}");
    await flush();
    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    await flush();
    // 2 × Bs 100 = Bs 200 → 10 % = Bs 20 → Bs 180
    expect(screen.getByText(/Total de la línea:/)).toHaveTextContent(
      "Total de la línea: Bs 180,00, antes Bs 200,00",
    );
    expect(rowsOf()).toContain("TotalBs 180,00");
    expect(rowsOf()).toContain("Descuento-Bs 20,00Cupón VERANO10: −Bs 20,00");
  });

  it("una foto vieja guardada antes de S9 (sin campos de descuento) se ve igual que siempre y no rompe", async () => {
    await setup([makeLine("a", 1, { name: "Falda" })]);
    expect(rowsOf()).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoSe calcula al elegir tu dirección",
      "TotalBs 100,00",
    ]);
    expect(document.querySelector("s")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Código de cupón" })).toBeInTheDocument();
  });

  it("el resumen conserva su desplazamiento propio en pantallas grandes (el bloque del cupón no lo rompe)", async () => {
    await setup([makeLine("a", 1)]);
    const summary = screen.getByRole("region", { name: "Resumen" });
    expect(summary).toHaveClass("lg:sticky", "lg:overflow-y-auto");
  });
});

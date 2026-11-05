import { act, screen, within } from "@testing-library/react";
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
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tu bolsa…");
    expect(screen.queryByText("Tu bolsa está vacía")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByRole("region", { name: "Resumen" })).toBeInTheDocument();
  });

  it("al entrar revalida la bolsa con el servidor", async () => {
    const { server } = await setup([makeLine("a", 1)], { auth: signedIn() });
    expect(server.callsOf("get").length).toBeGreaterThanOrEqual(1);
  });
});

describe("CartPage · bolsa vacía", () => {
  it("estado amable con enlace a la tienda; sigue habiendo un único h1", async () => {
    await setup([]);
    expect(screen.getByRole("status")).toHaveTextContent("Tu bolsa está vacía");
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
  it("quitar A (Bs 100) deja el resumen atenuado y ocupado mientras el servidor no confirma; luego se actualiza", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(
      makeSnapshot([makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]),
    );
    await setup([makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })], {
      server,
    });
    const resume = server.pause();
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    const summary = screen.getByRole("region", { name: "Resumen" });
    expect(summary).toHaveAttribute("aria-busy", "true"); // aunque la línea quitada ya no esté en la lista
    expect(summary.querySelector("dl")).toHaveClass("opacity-60");
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(summary).not.toHaveAttribute("aria-busy");
  });
});

describe("CartPage · avisos de sincronización", () => {
  it("sin conexión: el aviso aparece arriba y la bolsa sigue visible", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    const { cart } = await setup([makeLine("a", 1)], { server });
    server.forced = { ok: false, status: 0, code: "network", message: "network" };
    act(() => cart().store.setQty("a", 2));
    await flush();
    expect(
      screen.getByText(
        "Sin conexión. Mantén esta pestaña abierta: enviaremos tus cambios cuando vuelva la conexión.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Cantidad de / })).toHaveValue("2");
  });
});

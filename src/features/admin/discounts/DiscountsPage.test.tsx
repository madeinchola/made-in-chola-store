import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { DiscountsPage } from "./DiscountsPage";
import type { Discount, DiscountTarget } from "./types";

const api = vi.hoisted(() => ({
  listDiscounts: vi.fn(),
  listDiscountUsage: vi.fn(),
  listAllTargets: vi.fn(),
  listTargets: vi.fn(),
  listGroups: vi.fn(),
  createDiscount: vi.fn(),
  updateDiscount: vi.fn(),
  setDiscountActive: vi.fn(),
  setDiscountArchived: vi.fn(),
  addTarget: vi.fn(),
  setTargetArchived: vi.fn(),
}));
vi.mock("./api", () => api);
const productsApi = vi.hoisted(() => ({
  listCategoryOptions: vi.fn(),
  listCollectionOptions: vi.fn(),
  searchProductsForRelation: vi.fn(),
}));
vi.mock("../products/api", () => productsApi);
const configApi = vi.hoisted(() => ({ listCurrencies: vi.fn() }));
vi.mock("../config/api", () => configApi);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// «Códigos» es de otra pantalla: aquí solo importa que se abra con el descuento correcto.
vi.mock("./CouponsDialog", async () => {
  const { createElement } = await import("react");
  return {
    CouponsDialog: (props: { discount: { name: string }; open: boolean }) =>
      props.open
        ? createElement(
            "div",
            { role: "dialog", "aria-label": "Códigos simulados" },
            props.discount.name,
          )
        : null,
  };
});

const VERSION = "2026-11-05T10:00:00.123456+00:00";
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
  stackableWithAutomatic: true,
  excludeSaleItems: false,
  usageLimitTotal: 100,
  usageLimitPerCustomer: null,
  priority: 100,
  startsAt: null,
  endsAt: null,
  isActive: true,
  archived: false,
  updatedAt: VERSION,
  ...over,
});
const target = (over: Partial<DiscountTarget> = {}): DiscountTarget => ({
  id: "t1",
  discountId: "d2",
  productId: null,
  categoryId: null,
  collectionId: "k1",
  archived: false,
  updatedAt: VERSION,
  ...over,
});

/** Un descuento de cada estado. Las fechas son lejanas para que el estado no dependa de «hoy». */
const ALL = [
  discount({ id: "d5", name: "Vieja", archived: true, priority: 900 }),
  discount({ id: "d6", name: "Terminó en 2020", endsAt: "2020-01-01T00:00:00.000Z" }),
  discount({
    id: "d3",
    name: "Envío gratis",
    kind: "free_shipping",
    params: { kind: "free_shipping" },
    requiresCoupon: false,
    usageLimitTotal: null,
    minOrderAmount: 200,
    isActive: false,
    priority: 200,
  }),
  discount({ id: "d7", name: "Agotado 5", usageLimitTotal: 5 }),
  discount({
    id: "d4",
    name: "Flash diciembre",
    kind: "flash",
    params: { kind: "flash", percent: 20, maxAmount: null },
    requiresCoupon: false,
    usageLimitTotal: null,
    startsAt: "2099-12-01T10:00:00.000Z",
    endsAt: "2099-12-01T12:00:00.000Z",
  }),
  discount({
    id: "d2",
    name: "2×1 Verano",
    kind: "bogo",
    params: { kind: "bogo", take: 2, pay: 1 },
    scope: "collection",
    requiresCoupon: false,
    usageLimitTotal: null,
    priority: 300,
  }),
  discount(),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DiscountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dialog = () => screen.getByRole("dialog");
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const firstLines = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0]?.querySelector("p")?.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  api.listDiscounts.mockResolvedValue([discount()]);
  api.listDiscountUsage.mockResolvedValue([]);
  api.listAllTargets.mockResolvedValue([]);
  api.listTargets.mockResolvedValue([]);
  api.listGroups.mockResolvedValue([]);
  api.setDiscountActive.mockResolvedValue("2026-11-05T12:00:00.000001+00:00");
  api.setDiscountArchived.mockResolvedValue("2026-11-05T12:00:00.000001+00:00");
  productsApi.listCategoryOptions.mockResolvedValue([]);
  productsApi.listCollectionOptions.mockResolvedValue([
    { id: "k1", name: "Verano", archived: false },
  ]);
  productsApi.searchProductsForRelation.mockResolvedValue([]);
  configApi.listCurrencies.mockResolvedValue([
    { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2, enabled: true },
  ]);
});

describe("Descuentos: lista y estados", () => {
  it("muestra «Cargando…» mientras llega la lista", () => {
    api.listDiscounts.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("si falla la carga lo dice y «Reintentar» vuelve a pedirla", async () => {
    api.listDiscounts.mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
    api.listDiscounts.mockResolvedValueOnce([discount({ name: "Tras reintentar" })]);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Tras reintentar")).toBeInTheDocument();
    expect(api.listDiscounts).toHaveBeenCalledTimes(2);
  });

  it("sin descuentos: explica y ofrece crear el primero (abre el paso 1 del asistente)", async () => {
    api.listDiscounts.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Todavía no hay descuentos/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear el primer descuento" }));
    const d = within(dialog());
    expect(d.getByRole("heading", { name: "Nuevo descuento" })).toBeInTheDocument();
    expect(d.getByText(/Paso 1 de 2/)).toBeInTheDocument();
  });

  it("«Nuevo descuento» abre el asistente en el paso 1", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    await userEvent.click(screen.getByRole("button", { name: "Nuevo descuento" }));
    expect(within(dialog()).getByText(/Paso 1 de 2/)).toBeInTheDocument();
  });

  it("un h2 (el h1 es del marco) y botones de al menos 44 px", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    expect(screen.getByRole("heading", { level: 2, name: "Descuentos" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    for (const name of [
      "Nuevo descuento",
      "Editar el descuento «Verano 10»",
      "Desactivar el descuento «Verano 10»",
      "Ver los códigos del descuento «Verano 10»",
      "Archivar el descuento «Verano 10»",
    ]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
  });
});

describe("Descuentos: contenido de cada fila", () => {
  beforeEach(() => {
    api.listDiscounts.mockResolvedValue(ALL);
    api.listDiscountUsage.mockResolvedValue([
      { discountId: "d1", used: 12, customers: 9, amount: 120 },
      { discountId: "d7", used: 5, customers: 5, amount: 50 },
    ]);
    api.listAllTargets.mockResolvedValue([target()]);
  });

  it("activos primero (a igual estado, mayor prioridad) y los archivados al final", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    // activos: 2×1 (prioridad 300) y Verano 10 (100); luego programado, agotado, inactivo, vencido y archivado
    expect(firstLines()).toEqual([
      "2×1 Verano",
      "Verano 10",
      "Flash diciembre",
      "Agotado 5",
      "Envío gratis",
      "Terminó en 2020",
      "Vieja",
    ]);
  });

  it("cada fila dice qué hace con los valores exactos, su tipo, alcance, vigencia, usos y estado", async () => {
    renderPage();
    await screen.findByText("Verano 10");

    const pct = within(rowOf("Verano 10"));
    expect(pct.getByText("Porcentaje con código · Con código")).toBeInTheDocument();
    expect(pct.getByText("10 % en toda la bolsa con el código")).toBeInTheDocument();
    expect(pct.getByText("máx. 100 usos · se suma a las ofertas")).toBeInTheDocument();
    expect(pct.getByText("Todo el pedido")).toBeInTheDocument();
    expect(pct.getByText("Sin fechas")).toBeInTheDocument();
    expect(pct.getByText("12 de 100")).toBeInTheDocument();
    expect(pct.getByText("Activo")).toBeInTheDocument();

    const bogo = within(rowOf("2×1 Verano"));
    expect(bogo.getByText("Llévate varias, paga menos · Automático")).toBeInTheDocument();
    // la colección sale por su NOMBRE, leído de las colecciones del panel
    expect(
      bogo.getByText("2×1 en la colección Verano: se regala el más barato"),
    ).toBeInTheDocument();
    expect(bogo.getByText("Colección: Verano")).toBeInTheDocument();
    expect(bogo.getByText("0")).toBeInTheDocument(); // sin usos todavía y sin tope: solo la cuenta

    const flash = within(rowOf("Flash diciembre"));
    expect(
      flash.getByText("Oferta flash: 20 % del 1 de dic. 06:00 al 1 de dic. 08:00 (hora de La Paz)"),
    ).toBeInTheDocument();
    expect(flash.getByText("1 dic. 2099, 06:00 – 1 dic. 2099, 08:00")).toBeInTheDocument();
    expect(flash.getByText("Hora de La Paz")).toBeInTheDocument();
    expect(flash.getByText("Programado")).toBeInTheDocument();

    expect(within(rowOf("Agotado 5")).getByText("5 de 5")).toBeInTheDocument();
    expect(within(rowOf("Agotado 5")).getByText("Agotado")).toBeInTheDocument();
    const free = within(rowOf("Envío gratis"));
    expect(free.getByText("Envío gratis desde Bs 200")).toBeInTheDocument();
    expect(free.getByText("Inactivo")).toBeInTheDocument();
    expect(within(rowOf("Terminó en 2020")).getByText("Vencido")).toBeInTheDocument();
    expect(within(rowOf("Vieja")).getByText("Archivado")).toBeInTheDocument();
  });

  it("el estado es TEXTO además del color (cada insignia dice su estado)", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    const states = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[5]?.textContent);
    expect(states).toEqual([
      "Activo",
      "Activo",
      "Programado",
      "Agotado",
      "Inactivo",
      "Vencido",
      "Archivado",
    ]);
  });

  it("«Códigos» solo en los que piden código; las filas archivadas ofrecen Restaurar y no Activar/Archivar", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    expect(
      within(rowOf("Verano 10")).getByRole("button", { name: /Ver los códigos/ }),
    ).toBeInTheDocument();
    expect(within(rowOf("2×1 Verano")).queryByRole("button", { name: /códigos/ })).toBeNull();
    expect(within(rowOf("Envío gratis")).queryByRole("button", { name: /códigos/ })).toBeNull();
    const old = within(rowOf("Vieja"));
    expect(old.getByRole("button", { name: "Restaurar el descuento «Vieja»" })).toBeInTheDocument();
    expect(old.queryByRole("button", { name: /Archivar/ })).toBeNull();
    expect(old.queryByRole("button", { name: /Activar|Desactivar/ })).toBeNull();
  });

  it("un descuento con parámetros ilegibles lo avisa en vez de inventar qué hace", async () => {
    api.listDiscounts.mockResolvedValue([discount({ name: "Rota", params: null })]);
    renderPage();
    const row = within(await screen.findByText("Rota").then((e) => e.closest("tr") as HTMLElement));
    expect(row.getByText("Formato inválido")).toBeInTheDocument();
    expect(row.getByText(/No se pueden leer sus parámetros/)).toBeInTheDocument();
  });

  it("productos: se resumen por cantidad; categorías con su nombre completo (con la categoría madre)", async () => {
    api.listDiscounts.mockResolvedValue([
      discount({ id: "p", name: "Por productos", scope: "product" }),
      discount({ id: "c", name: "Por categoría", scope: "category" }),
    ]);
    api.listAllTargets.mockResolvedValue([
      target({ id: "a", discountId: "p", collectionId: null, productId: "x1" }),
      target({ id: "b", discountId: "p", collectionId: null, productId: "x2" }),
      target({ id: "c", discountId: "c", collectionId: null, categoryId: "c2" }),
    ]);
    productsApi.listCategoryOptions.mockResolvedValue([
      { id: "c1", name: "Mujer", archived: false, parentId: null },
      { id: "c2", name: "Verano", archived: false, parentId: "c1" },
    ]);
    renderPage();
    await screen.findByText("Por productos");
    expect(within(rowOf("Por productos")).getByText("2 productos")).toBeInTheDocument();
    expect(
      within(rowOf("Por productos")).getByText("10 % en 2 productos elegidos con el código"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(rowOf("Por categoría")).getByText("Categoría: Mujer › Verano"),
      ).toBeInTheDocument(),
    );
  });

  it("si no se pueden leer los usos lo avisa y no inventa contadores", async () => {
    api.listDiscountUsage.mockRejectedValue(new Error("sin permiso"));
    renderPage();
    await screen.findByText("Verano 10");
    expect(await screen.findByText(/No pudimos leer cuántas veces se usó/)).toBeInTheDocument();
    expect(within(rowOf("Verano 10")).queryByText(/de 100/)).toBeNull();
  });
});

describe("Descuentos: activar y desactivar", () => {
  it("desactivar manda la versión leída y avisa", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    await userEvent.click(
      screen.getByRole("button", { name: "Desactivar el descuento «Verano 10»" }),
    );
    await waitFor(() => expect(api.setDiscountActive).toHaveBeenCalledTimes(1));
    expect(api.setDiscountActive).toHaveBeenCalledWith("d1", VERSION, false);
    expect(toast.success).toHaveBeenCalledWith("Descuento desactivado.");
  });

  it("activar uno apagado manda true", async () => {
    api.listDiscounts.mockResolvedValue([discount({ isActive: false })]);
    renderPage();
    await screen.findByText("Verano 10");
    await userEvent.click(screen.getByRole("button", { name: "Activar el descuento «Verano 10»" }));
    await waitFor(() => expect(api.setDiscountActive).toHaveBeenCalledWith("d1", VERSION, true));
    expect(toast.success).toHaveBeenCalledWith("Descuento activado.");
  });

  it("si alguien lo cambió antes: avisa del conflicto y refresca la lista", async () => {
    api.setDiscountActive.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Verano 10");
    const callsBefore = api.listDiscounts.mock.calls.length;
    await userEvent.click(
      screen.getByRole("button", { name: "Desactivar el descuento «Verano 10»" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Otra persona guardó cambios"),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listDiscounts.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("un error de la base se muestra tal cual", async () => {
    api.setDiscountActive.mockRejectedValue(new AppError("unknown", "No pudimos guardar."));
    renderPage();
    await screen.findByText("Verano 10");
    await userEvent.click(
      screen.getByRole("button", { name: "Desactivar el descuento «Verano 10»" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No pudimos guardar."));
  });
});

describe("Descuentos: archivar y restaurar", () => {
  it("pide confirmar y no archiva hasta confirmar; confirmar manda la versión leída", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    await userEvent.click(
      screen.getByRole("button", { name: "Archivar el descuento «Verano 10»" }),
    );
    const d = within(dialog());
    expect(
      d.getByRole("heading", { name: "¿Archivar el descuento «Verano 10»?" }),
    ).toBeInTheDocument();
    expect(d.getByText(/sus códigos dejarán de funcionar/)).toBeInTheDocument();
    expect(api.setDiscountArchived).not.toHaveBeenCalled();

    await userEvent.click(d.getByRole("button", { name: "Archivar descuento" }));
    await waitFor(() => expect(api.setDiscountArchived).toHaveBeenCalledTimes(1));
    expect(api.setDiscountArchived).toHaveBeenCalledWith("d1", VERSION, true);
    expect(toast.success).toHaveBeenCalledWith("Descuento archivado.");
  });

  it("«Cancelar» no archiva nada", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    await userEvent.click(
      screen.getByRole("button", { name: "Archivar el descuento «Verano 10»" }),
    );
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setDiscountArchived).not.toHaveBeenCalled();
  });

  it("restaurar no pide confirmación y manda archived=false", async () => {
    api.listDiscounts.mockResolvedValue([discount({ name: "Vieja", archived: true })]);
    renderPage();
    await screen.findByText("Vieja");
    await userEvent.click(screen.getByRole("button", { name: "Restaurar el descuento «Vieja»" }));
    await waitFor(() => expect(api.setDiscountArchived).toHaveBeenCalledTimes(1));
    expect(api.setDiscountArchived).toHaveBeenCalledWith("d1", VERSION, false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Descuento restaurado.");
  });

  it("si alguien lo cambió antes: avisa, no archiva y refresca la lista", async () => {
    api.setDiscountArchived.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Verano 10");
    const callsBefore = api.listDiscounts.mock.calls.length;
    await userEvent.click(
      screen.getByRole("button", { name: "Archivar el descuento «Verano 10»" }),
    );
    await userEvent.click(within(dialog()).getByRole("button", { name: "Archivar descuento" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Otra persona guardó cambios"),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listDiscounts.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe("Descuentos: Editar y Códigos", () => {
  it("«Códigos» abre la pantalla de códigos de ESE descuento", async () => {
    api.listDiscounts.mockResolvedValue([
      discount({ id: "a", name: "Uno" }),
      discount({ id: "b", name: "Dos", priority: 1 }),
    ]);
    renderPage();
    await screen.findByText("Dos");
    await userEvent.click(
      screen.getByRole("button", { name: "Ver los códigos del descuento «Dos»" }),
    );
    expect(screen.getByRole("dialog", { name: "Códigos simulados" })).toHaveTextContent("Dos");
  });

  it("«Editar» abre el asistente en un solo paso, con los valores del descuento", async () => {
    renderPage();
    await screen.findByText("Verano 10");
    await userEvent.click(screen.getByRole("button", { name: "Editar el descuento «Verano 10»" }));
    const d = within(dialog());
    expect(await d.findByRole("heading", { name: "Editar descuento" })).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveValue("Verano 10");
    expect(d.queryByText(/Paso 1 de 2/)).not.toBeInTheDocument();
  });
});

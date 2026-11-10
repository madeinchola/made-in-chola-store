import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { DiscountDialog } from "./DiscountDialog";
import type { Discount, DiscountInput, DiscountTarget } from "./types";

const api = vi.hoisted(() => ({
  createDiscount: vi.fn(),
  updateDiscount: vi.fn(),
  listTargets: vi.fn(),
  addTarget: vi.fn(),
  setTargetArchived: vi.fn(),
  setDiscountActive: vi.fn(),
  listGroups: vi.fn(),
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
const productRows = vi.hoisted(() => ({ rows: [] as { id: string; name: string }[] }));
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        in: (_column: string, ids: string[]) =>
          Promise.resolve({
            data: productRows.rows.filter((r) => ids.includes(r.id)),
            error: null,
          }),
      }),
    }),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

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
  stackableWithAutomatic: false,
  excludeSaleItems: false,
  usageLimitTotal: null,
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
  discountId: "d1",
  productId: null,
  categoryId: "c1",
  collectionId: null,
  archived: false,
  updatedAt: "V-T1",
  ...over,
});

/** Lo que el asistente manda al crear, salvo lo que cada prueba cambia. */
const BASE: Omit<DiscountInput, "name" | "kind" | "params" | "scope" | "requiresCoupon"> = {
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

function renderDialog(existing: Discount | null = null) {
  const onOpenChange = vi.fn();
  const onOpenCodes = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DiscountDialog
        open
        onOpenChange={onOpenChange}
        discount={existing}
        onOpenCodes={onOpenCodes}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onOpenCodes };
}
const d = () => within(screen.getByRole("dialog"));
const pickType = (name: RegExp) => userEvent.click(d().getByRole("button", { name }));
const fill = async (label: string, text: string) => {
  const el = d().getByLabelText(label);
  await userEvent.clear(el);
  if (text !== "") await userEvent.type(el, text);
};
const submit = (label = "Crear descuento") =>
  userEvent.click(d().getByRole("button", { name: label }));
const createdFrom = (input: DiscountInput): Discount =>
  discount({ ...input, id: "nuevo", archived: false, updatedAt: VERSION });

beforeEach(() => {
  vi.clearAllMocks();
  productRows.rows = [];
  api.createDiscount.mockImplementation(async (input: DiscountInput) => createdFrom(input));
  api.updateDiscount.mockResolvedValue("V2");
  api.listTargets.mockResolvedValue([]);
  api.addTarget.mockResolvedValue(target({ id: "nuevo-objetivo" }));
  api.setTargetArchived.mockResolvedValue("V-T2");
  api.setDiscountActive.mockResolvedValue("V3");
  api.listGroups.mockResolvedValue([
    { id: "g1", name: "Mayoristas", description: null, archived: false, updatedAt: VERSION },
    { id: "g2", name: "Antiguo", description: null, archived: true, updatedAt: VERSION },
  ]);
  productsApi.listCategoryOptions.mockResolvedValue([
    { id: "c1", name: "Verano", archived: false, parentId: null },
    { id: "c2", name: "Ropa", archived: false, parentId: null },
  ]);
  productsApi.listCollectionOptions.mockResolvedValue([
    { id: "k1", name: "Otoño", archived: false },
  ]);
  productsApi.searchProductsForRelation.mockResolvedValue([
    { id: "p1", code: "CAM-1", name: "Camisa de lino" },
  ]);
  configApi.listCurrencies.mockResolvedValue([
    { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2, enabled: true },
  ]);
});

describe("Asistente: paso 1 (elegir el tipo)", () => {
  it("una tarjeta por tipo, cada una con su explicación en una frase", () => {
    renderDialog();
    expect(d().getByRole("heading", { name: "Nuevo descuento" })).toBeInTheDocument();
    expect(d().getByText(/Paso 1 de 2/)).toBeInTheDocument();
    const cards = d().getAllByRole("button", {
      name: /Un|La|No|Cuantas|Una|Solo|Porcentaje|Monto|Envío|Llévate|Descuento|Precio|Oferta|Primera/,
    });
    const titles = cards
      .map((c) => c.querySelector("span")?.textContent)
      .filter((x): x is string => Boolean(x));
    expect(titles).toEqual([
      "Porcentaje con código",
      "Monto fijo con código",
      "Envío gratis",
      "Llévate varias, paga menos",
      "Descuento por volumen",
      "Precio por tipo de cliente",
      "Oferta flash",
      "Primera compra",
    ]);
    expect(
      d().getByText("Cuantas más unidades lleva la clienta, más porcentaje de descuento."),
    ).toBeInTheDocument();
    expect(
      d().getByText(
        "Un porcentaje menos solo entre dos momentos: empieza y termina a una hora exacta.",
      ),
    ).toBeInTheDocument();
  });

  it("elegir una tarjeta lleva al paso 2 de ese tipo, con el foco en el nombre", async () => {
    renderDialog();
    await pickType(/Oferta flash/);
    expect(d().getByText(/Paso 2 de 2: completa los datos de «Oferta flash»/)).toBeInTheDocument();
    await waitFor(() => expect(d().getByLabelText("Nombre")).toHaveFocus());
  });

  it("«Atrás» vuelve al paso 1 con el tipo marcado; elegir otro conserva el nombre y reinicia lo demás", async () => {
    renderDialog();
    await pickType(/Porcentaje con código/);
    await fill("Nombre", "Mi nombre");
    await fill("Porcentaje de descuento (%)", "10");
    await userEvent.click(d().getByRole("button", { name: "Atrás" }));
    expect(d().getByText(/Paso 1 de 2/)).toBeInTheDocument();
    expect(d().getByRole("button", { name: /Porcentaje con código/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await pickType(/Llévate varias/);
    expect(d().getByLabelText("Nombre")).toHaveValue("Mi nombre");
    expect(d().queryByLabelText("Porcentaje de descuento (%)")).not.toBeInTheDocument();
    expect(d().getByLabelText("La clienta se lleva (unidades)")).toHaveValue("2");
  });

  it("un clic fuera del diálogo NO lo cierra ni pierde lo escrito (solo Cancelar, la X o Esc)", async () => {
    const { onOpenChange } = renderDialog();
    await pickType(/Porcentaje con código/);
    await fill("Nombre", "Lo que escribí");
    // el fondo del diálogo bloquea los clics (pointer-events: none): se simula el toque fuera a mano
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.click(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(d().getByLabelText("Nombre")).toHaveValue("Lo que escribí");
  });

  it("«Cancelar» cierra sin crear nada", async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.click(d().getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.createDiscount).not.toHaveBeenCalled();
  });
});

describe("Asistente: crear UN descuento de cada uno de los 8 tipos (DiscountInput exacto)", () => {
  it("1. porcentaje con código: ofrece abrir «Códigos» y los abre con el descuento creado", async () => {
    const { onOpenChange, onOpenCodes } = renderDialog();
    await pickType(/Porcentaje con código/);
    await fill("Nombre", "  Verano 10  ");
    await fill("Porcentaje de descuento (%)", "10");
    await fill("Tope del descuento (Bs)", "50");
    await fill("Pedido mínimo (Bs)", "100");
    await fill("Máximo de usos en total", "100");
    await userEvent.click(d().getByLabelText("Se suma a las ofertas automáticas"));
    await submit();

    await waitFor(() => expect(api.createDiscount).toHaveBeenCalledTimes(1));
    const expected: DiscountInput = {
      ...BASE,
      name: "Verano 10",
      kind: "percent",
      params: { kind: "percent", percent: 10, maxAmount: 50 },
      scope: "order",
      requiresCoupon: true,
      minOrderAmount: 100,
      usageLimitTotal: 100,
      stackableWithAutomatic: true,
    };
    expect(api.createDiscount).toHaveBeenCalledWith(expected);
    expect(api.addTarget).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Descuento creado.");
    // pide código: no se cierra solo, ofrece agregar códigos
    expect(await d().findByRole("heading", { name: "Descuento creado" })).toBeInTheDocument();
    expect(d().getByText(/todavía no tiene ninguno/)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(d().getByRole("button", { name: "Agregar códigos" }));
    expect(onOpenCodes).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nuevo", name: "Verano 10" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("2. monto fijo con código, por categoría: crea el descuento y DESPUÉS agrega la categoría", async () => {
    renderDialog();
    await pickType(/Monto fijo con código/);
    await fill("Nombre", "Bs 20 de verano");
    await fill("Monto del descuento (Bs)", "20");
    await userEvent.selectOptions(d().getByLabelText("Alcance"), "Categorías");
    await userEvent.click(await d().findByLabelText("Verano"));
    await fill("Pedido mínimo (Bs)", "100");
    // la vista previa lee exactamente lo que se guardaría
    expect(
      within(screen.getByRole("region", { name: "Así se leerá" })).getByText(
        "Bs 20 de descuento en los productos de la categoría Verano con el código (mínimo Bs 100)",
      ),
    ).toBeInTheDocument();
    await submit();

    await waitFor(() => expect(api.createDiscount).toHaveBeenCalledTimes(1));
    expect(api.createDiscount).toHaveBeenCalledWith({
      ...BASE,
      name: "Bs 20 de verano",
      kind: "fixed",
      params: { kind: "fixed", amount: 20 },
      scope: "category",
      requiresCoupon: true,
      minOrderAmount: 100,
    });
    await waitFor(() => expect(api.addTarget).toHaveBeenCalledTimes(1));
    expect(api.addTarget).toHaveBeenCalledWith({ discountId: "nuevo", categoryId: "c1" });
    expect(api.createDiscount.mock.invocationCallOrder[0]).toBeLessThan(
      api.addTarget.mock.invocationCallOrder[0]!,
    );
  });

  it("3. envío gratis (automático, desde Bs 200): se cierra solo y no ofrece códigos", async () => {
    const { onOpenChange } = renderDialog();
    await pickType(/Envío gratis/);
    await fill("Nombre", "Envío gratis desde 200");
    await fill("Pedido mínimo (Bs)", "200");
    expect(
      d().getByText("Se aplica solo cuando la clienta cumple las condiciones."),
    ).toBeInTheDocument();
    expect(d().queryByLabelText("Se suma a las ofertas automáticas")).not.toBeInTheDocument();
    await submit();
    await waitFor(() => expect(api.createDiscount).toHaveBeenCalledTimes(1));
    expect(api.createDiscount).toHaveBeenCalledWith({
      ...BASE,
      name: "Envío gratis desde 200",
      kind: "free_shipping",
      params: { kind: "free_shipping" },
      scope: "order",
      requiresCoupon: false,
      minOrderAmount: 200,
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Descuento creado.");
  });

  it("4. 2×1 de un producto elegido con la búsqueda", async () => {
    renderDialog();
    await pickType(/Llévate varias/);
    await fill("Nombre", "2×1 camisas");
    expect(d().getByLabelText("La clienta se lleva (unidades)")).toHaveValue("2");
    expect(d().getByLabelText("y paga (unidades)")).toHaveValue("1");
    // el 2×1 no admite «todo el pedido»
    expect(
      within(d().getByLabelText("Alcance"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Productos concretos", "Categorías", "Colecciones"]);
    await userEvent.type(d().getByLabelText("Buscar producto por nombre o código"), "cam");
    await userEvent.click(await d().findByRole("button", { name: "Agregar Camisa de lino" }));
    expect(d().getByText("Camisa de lino")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Así se leerá" })).getByText(
        "2×1 en el producto Camisa de lino: se regala el más barato",
      ),
    ).toBeInTheDocument();
    await submit();

    await waitFor(() => expect(api.createDiscount).toHaveBeenCalledTimes(1));
    expect(api.createDiscount).toHaveBeenCalledWith({
      ...BASE,
      name: "2×1 camisas",
      kind: "bogo",
      params: { kind: "bogo", take: 2, pay: 1 },
      scope: "product",
      requiresCoupon: false,
    });
    await waitFor(() =>
      expect(api.addTarget).toHaveBeenCalledWith({ discountId: "nuevo", productId: "p1" }),
    );
  });

  it("5. volumen con dos tramos", async () => {
    renderDialog();
    await pickType(/Descuento por volumen/);
    await fill("Nombre", "Más llevas, menos pagas");
    const first = within(d().getByRole("group", { name: "Tramo 1" }));
    await userEvent.type(first.getByLabelText("Desde (unidades)"), "3");
    await userEvent.type(first.getByLabelText("Descuento (%)"), "5");
    await userEvent.click(d().getByRole("button", { name: "Agregar tramo" }));
    const second = within(d().getByRole("group", { name: "Tramo 2" }));
    await userEvent.type(second.getByLabelText("Desde (unidades)"), "6");
    await userEvent.type(second.getByLabelText("Descuento (%)"), "10");
    expect(
      within(screen.getByRole("region", { name: "Así se leerá" })).getByText(
        "5 % desde 3 unidades y 10 % desde 6",
      ),
    ).toBeInTheDocument();
    await submit();

    await waitFor(() => expect(api.createDiscount).toHaveBeenCalledTimes(1));
    expect(api.createDiscount).toHaveBeenCalledWith({
      ...BASE,
      name: "Más llevas, menos pagas",
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

  it("6. precio por tipo de cliente: el grupo archivado no se ofrece", async () => {
    renderDialog();
    await pickType(/Precio por tipo de cliente/);
    await fill("Nombre", "Precio mayorista");
    await fill("Porcentaje de descuento (%)", "15");
    const select = await d().findByLabelText("Grupo de clientes");
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Elige un grupo", "Mayoristas"]),
    );
    await userEvent.selectOptions(select, "Mayoristas");
    expect(
      within(screen.getByRole("region", { name: "Así se leerá" })).getByText(
        "15 % para el grupo Mayoristas",
      ),
    ).toBeInTheDocument();
    await submit();

    await waitFor(() => expect(api.createDiscount).toHaveBeenCalledTimes(1));
    expect(api.createDiscount).toHaveBeenCalledWith({
      ...BASE,
      name: "Precio mayorista",
      kind: "group_price",
      params: { kind: "group_price", percent: 15, maxAmount: null },
      scope: "order",
      requiresCoupon: false,
      customerGroupId: "g1",
    });
  });

  it("7. oferta flash: la hora se escribe en La Paz y se envía en UTC", async () => {
    renderDialog();
    await pickType(/Oferta flash/);
    await fill("Nombre", "Flash de diciembre");
    await fill("Porcentaje de descuento (%)", "20");
    fireEvent.change(d().getByLabelText("Empieza (hora de La Paz, obligatorio)"), {
      target: { value: "2026-12-01T06:00" },
    });
    fireEvent.change(d().getByLabelText("Termina (hora de La Paz, obligatorio)"), {
      target: { value: "2026-12-01T08:00" },
    });
    expect(
      within(screen.getByRole("region", { name: "Así se leerá" })).getByText(
        "Oferta flash: 20 % del 1 de dic. 06:00 al 1 de dic. 08:00 (hora de La Paz)",
      ),
    ).toBeInTheDocument();
    await submit();

    await waitFor(() => expect(api.createDiscount).toHaveBeenCalledTimes(1));
    expect(api.createDiscount).toHaveBeenCalledWith({
      ...BASE,
      name: "Flash de diciembre",
      kind: "flash",
      params: { kind: "flash", percent: 20, maxAmount: null },
      scope: "order",
      requiresCoupon: false,
      startsAt: "2026-12-01T10:00:00.000Z",
      endsAt: "2026-12-01T12:00:00.000Z",
    });
  });

  it("8. primera compra con código, una vez por clienta y sumándose a las ofertas", async () => {
    renderDialog();
    await pickType(/Primera compra/);
    await fill("Nombre", "Bienvenida");
    await fill("Porcentaje de descuento (%)", "10");
    // a elección: arranca automático
    expect(d().getByLabelText("Automático")).toBeChecked();
    await userEvent.click(d().getByLabelText("Con código"));
    await fill("Máximo de usos por clienta", "1");
    await userEvent.click(d().getByLabelText("Se suma a las ofertas automáticas"));
    await userEvent.click(d().getByLabelText("No aplicar a productos ya rebajados"));
    await submit();

    await waitFor(() => expect(api.createDiscount).toHaveBeenCalledTimes(1));
    expect(api.createDiscount).toHaveBeenCalledWith({
      ...BASE,
      name: "Bienvenida",
      kind: "first_purchase",
      params: { kind: "first_purchase", percent: 10, maxAmount: null },
      scope: "order",
      requiresCoupon: true,
      usageLimitPerCustomer: 1,
      stackableWithAutomatic: true,
      excludeSaleItems: true,
    });
  });
});

describe("Asistente: vista previa, validación y errores", () => {
  it("la vista previa se actualiza mientras se escribe", async () => {
    renderDialog();
    await pickType(/Porcentaje con código/);
    const preview = within(screen.getByRole("region", { name: "Así se leerá" }));
    expect(preview.getByText(/Completa los datos/)).toBeInTheDocument();
    await fill("Porcentaje de descuento (%)", "12,5");
    expect(preview.getByText("12,5 % en toda la bolsa con el código")).toBeInTheDocument();
    expect(
      preview.getByText("no se suma a las ofertas (se aplica la mejor de las dos)"),
    ).toBeInTheDocument();
    await fill("Máximo de usos por clienta", "1");
    expect(preview.getByText("1 por clienta")).toBeInTheDocument();
    await fill("Porcentaje de descuento (%)", "abc");
    expect(preview.getByText(/Completa los datos/)).toBeInTheDocument();
  });

  it("validación: nada se envía, cada campo explica su problema y el foco va al primero", async () => {
    renderDialog();
    await pickType(/Oferta flash/);
    await fill("Prioridad", "");
    await submit();
    expect(api.createDiscount).not.toHaveBeenCalled();
    expect(d().getByText("Escribe un nombre para el descuento.")).toBeInTheDocument();
    expect(d().getByText("Escribe el porcentaje.")).toBeInTheDocument();
    expect(d().getByText("La oferta flash necesita fecha y hora de inicio.")).toBeInTheDocument();
    expect(d().getByText("La oferta flash necesita fecha y hora de fin.")).toBeInTheDocument();
    expect(d().getByText("Escribe la prioridad.")).toBeInTheDocument();
    expect(d().getByLabelText("Nombre")).toHaveFocus();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("más de 2 decimales y fin anterior al inicio se rechazan con su explicación", async () => {
    renderDialog();
    await pickType(/Oferta flash/);
    await fill("Nombre", "X");
    await fill("Porcentaje de descuento (%)", "10,555");
    fireEvent.change(d().getByLabelText("Empieza (hora de La Paz, obligatorio)"), {
      target: { value: "2026-12-01T08:00" },
    });
    fireEvent.change(d().getByLabelText("Termina (hora de La Paz, obligatorio)"), {
      target: { value: "2026-12-01T08:00" },
    });
    await submit();
    expect(d().getByText(/Usa como máximo 2 decimales/)).toBeInTheDocument();
    expect(d().getByText("El fin debe ser posterior al inicio.")).toBeInTheDocument();
    expect(api.createDiscount).not.toHaveBeenCalled();
    expect(d().getByLabelText("Porcentaje de descuento (%)")).toHaveFocus();
  });

  it("un alcance de categorías sin elegir ninguna falla y el foco va a la primera casilla", async () => {
    renderDialog();
    await pickType(/Porcentaje con código/);
    await fill("Nombre", "X");
    await fill("Porcentaje de descuento (%)", "10");
    await userEvent.selectOptions(d().getByLabelText("Alcance"), "Categorías");
    await d().findByLabelText("Verano");
    await submit();
    expect(d().getByText("Elige al menos una categoría.")).toBeInTheDocument();
    expect(d().getByLabelText("Verano")).toHaveFocus();
    expect(api.createDiscount).not.toHaveBeenCalled();
  });

  it("2×1: «paga» igual a «llévate» se rechaza", async () => {
    renderDialog();
    await pickType(/Llévate varias/);
    await fill("Nombre", "X");
    await fill("y paga (unidades)", "2");
    await submit();
    expect(d().getByText("Debe ser menor que las unidades que se lleva.")).toBeInTheDocument();
  });

  it("volumen: cantidades que no crecen se rechazan en la fila que falla", async () => {
    renderDialog();
    await pickType(/Descuento por volumen/);
    await fill("Nombre", "X");
    const first = within(d().getByRole("group", { name: "Tramo 1" }));
    await userEvent.type(first.getByLabelText("Desde (unidades)"), "5");
    await userEvent.type(first.getByLabelText("Descuento (%)"), "5");
    await userEvent.click(d().getByRole("button", { name: "Agregar tramo" }));
    const second = within(d().getByRole("group", { name: "Tramo 2" }));
    await userEvent.type(second.getByLabelText("Desde (unidades)"), "5");
    await userEvent.type(second.getByLabelText("Descuento (%)"), "10");
    await submit();
    expect(
      second.getByText("Debe ser mayor que la cantidad del tramo anterior."),
    ).toBeInTheDocument();
    expect(first.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.createDiscount).not.toHaveBeenCalled();
  });

  it("un error de la base al guardar se muestra y el diálogo sigue abierto con lo escrito", async () => {
    api.createDiscount.mockRejectedValue(
      new AppError("unknown", "No pudimos guardar el descuento."),
    );
    renderDialog();
    await pickType(/Monto fijo con código/);
    await fill("Nombre", "Con error");
    await fill("Monto del descuento (Bs)", "20");
    await submit();
    expect(await d().findByText("No pudimos guardar el descuento.")).toBeInTheDocument();
    expect(d().getByLabelText("Nombre")).toHaveValue("Con error");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("si el descuento se crea pero falla agregar un objetivo, lo dice con su nombre y el motivo (y no canta éxito)", async () => {
    api.addTarget.mockImplementation(async (input: { categoryId: string }) => {
      if (input.categoryId === "c2")
        throw new AppError("unknown", "Esa categoría ya está en el descuento.");
      return target();
    });
    renderDialog();
    await pickType(/Porcentaje con código/);
    await fill("Nombre", "Dos categorías");
    await fill("Porcentaje de descuento (%)", "10");
    await userEvent.selectOptions(d().getByLabelText("Alcance"), "Categorías");
    await userEvent.click(await d().findByLabelText("Verano"));
    await userEvent.click(d().getByLabelText("Ropa"));
    await submit();

    const alert = await d().findByRole("alert");
    expect(alert).toHaveTextContent("no pudimos agregar a su alcance: Ropa.");
    expect(alert).toHaveTextContent("Esa categoría ya está en el descuento.");
    expect(alert).toHaveTextContent("pulsa «Editar»");
    expect(api.createDiscount).toHaveBeenCalledTimes(1);
    expect(api.addTarget).toHaveBeenCalledTimes(2); // la segunda no frena a la primera
    expect(toast.success).not.toHaveBeenCalled();
    // y el descuento a medio hacer NO queda encendido (con la versión recién leída)
    expect(api.setDiscountActive).toHaveBeenCalledExactlyOnceWith("nuevo", VERSION, false);
    expect(alert).toHaveTextContent("Lo dejamos DESACTIVADO");
  });

  it("si además no se puede apagar, lo dice fuerte para que lo apaguen a mano", async () => {
    api.addTarget.mockRejectedValue(new AppError("unknown", "No se pudo."));
    api.setDiscountActive.mockRejectedValue(new AppError("unknown", "Sin conexión."));
    renderDialog();
    await pickType(/Porcentaje con código/);
    await fill("Nombre", "Una categoría");
    await fill("Porcentaje de descuento (%)", "10");
    await userEvent.selectOptions(d().getByLabelText("Alcance"), "Categorías");
    await userEvent.click(await d().findByLabelText("Verano"));
    await submit();
    const alert = await d().findByRole("alert");
    expect(alert).toHaveTextContent("tampoco pudimos desactivarlo");
    expect(alert).toHaveTextContent("ENCENDIDO");
  });

  it("un descuento que ya se crea apagado no intenta apagarse de nuevo si falla un objetivo", async () => {
    api.addTarget.mockRejectedValue(new AppError("unknown", "No se pudo."));
    renderDialog();
    await pickType(/Porcentaje con código/);
    await fill("Nombre", "Apagado");
    await fill("Porcentaje de descuento (%)", "10");
    await userEvent.click(d().getByLabelText("Activo"));
    await userEvent.selectOptions(d().getByLabelText("Alcance"), "Categorías");
    await userEvent.click(await d().findByLabelText("Verano"));
    await submit();
    await d().findByRole("alert");
    expect(api.setDiscountActive).not.toHaveBeenCalled();
  });
});

describe("Asistente: editar", () => {
  const openEdit = async (existing: Discount) => {
    const handlers = renderDialog(existing);
    await d().findByRole("heading", { name: "Editar descuento" });
    return handlers;
  };

  it("un solo paso; el tipo, el alcance y la moneda se muestran fijos", async () => {
    await openEdit(discount({ scope: "order", requiresCoupon: true }));
    expect(d().queryByText(/Paso/)).not.toBeInTheDocument();
    expect(
      d().getByText(
        "Tipo: Porcentaje con código. No se puede cambiar después de crear el descuento.",
      ),
    ).toBeInTheDocument();
    expect(d().getByText(/Alcance: Todo el pedido\./)).toBeInTheDocument();
    expect(d().getByText(/Moneda: BOB\./)).toBeInTheDocument();
    expect(d().queryByLabelText("Alcance")).not.toBeInTheDocument();
    expect(d().queryByRole("button", { name: "Atrás" })).not.toBeInTheDocument();
    expect(d().queryByRole("button", { name: /Oferta flash/ })).not.toBeInTheDocument();
  });

  it("guarda con la versión LEÍDA y manda solo lo editable (sin tipo, alcance ni moneda)", async () => {
    const { onOpenChange } = await openEdit(
      discount({
        params: { kind: "percent", percent: 12.5, maxAmount: 30.5 },
        minOrderAmount: 99.9,
        usageLimitTotal: 100,
        startsAt: "2026-12-01T10:00:00+00:00",
        endsAt: "2026-12-05T22:30:00+00:00",
        stackableWithAutomatic: true,
      }),
    );
    expect(d().getByLabelText("Nombre")).toHaveValue("Verano 10");
    expect(d().getByLabelText("Porcentaje de descuento (%)")).toHaveValue("12,5");
    expect(d().getByLabelText("Tope del descuento (Bs)")).toHaveValue("30,5");
    expect(d().getByLabelText("Pedido mínimo (Bs)")).toHaveValue("99,9");
    expect(d().getByLabelText("Empieza (hora de La Paz)")).toHaveValue("2026-12-01T06:00");
    expect(d().getByLabelText("Termina (hora de La Paz)")).toHaveValue("2026-12-05T18:30");
    expect(d().getByLabelText("Se suma a las ofertas automáticas")).toBeChecked();

    await userEvent.type(d().getByLabelText("Nombre"), " v2");
    await submit("Guardar cambios");
    await waitFor(() => expect(api.updateDiscount).toHaveBeenCalledTimes(1));
    const [id, version, payload] = api.updateDiscount.mock.calls[0]!;
    expect(id).toBe("d1");
    expect(version).toBe(VERSION); // la versión EXACTA que leyó, microsegundos incluidos
    expect(payload).toEqual({
      name: "Verano 10 v2",
      params: { kind: "percent", percent: 12.5, maxAmount: 30.5 },
      minOrderAmount: 99.9,
      customerGroupId: null,
      requiresCoupon: true,
      stackableWithAutomatic: true,
      excludeSaleItems: false,
      usageLimitTotal: 100,
      usageLimitPerCustomer: null,
      priority: 100,
      startsAt: "2026-12-01T10:00:00.000Z",
      endsAt: "2026-12-05T22:30:00.000Z",
      isActive: true,
    });
    expect(api.createDiscount).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Descuento actualizado.");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("carga lo ya elegido; al guardar agrega lo nuevo y archiva lo quitado (con la versión de CADA objetivo)", async () => {
    api.listTargets.mockResolvedValue([
      target({ id: "t1", categoryId: "c1", updatedAt: "V-T1" }),
      target({ id: "t9", categoryId: "c3", updatedAt: "V-T9" }),
    ]);
    productsApi.listCategoryOptions.mockResolvedValue([
      { id: "c1", name: "Verano", archived: false, parentId: null },
      { id: "c2", name: "Ropa", archived: false, parentId: null },
      { id: "c3", name: "Calzado", archived: false, parentId: null },
    ]);
    await openEdit(discount({ scope: "category" }));
    expect(await d().findByLabelText("Verano")).toBeChecked();
    expect(d().getByLabelText("Calzado")).toBeChecked();
    expect(d().getByLabelText("Ropa")).not.toBeChecked();

    await userEvent.click(d().getByLabelText("Calzado")); // quitar
    await userEvent.click(d().getByLabelText("Ropa")); // agregar
    await submit("Guardar cambios");
    await waitFor(() => expect(api.updateDiscount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.setTargetArchived).toHaveBeenCalledTimes(1));
    expect(api.addTarget).toHaveBeenCalledTimes(1);
    expect(api.addTarget).toHaveBeenCalledWith({ discountId: "d1", categoryId: "c2" });
    expect(api.setTargetArchived).toHaveBeenCalledWith("t9", "V-T9", true);
  });

  it("productos ya elegidos: se muestran por NOMBRE (se leen aparte) y se pueden quitar", async () => {
    productRows.rows = [{ id: "p1", name: "Camisa de lino" }];
    api.listTargets.mockResolvedValue([target({ categoryId: null, productId: "p1" })]);
    await openEdit(discount({ scope: "product" }));
    expect(await d().findByText("Camisa de lino")).toBeInTheDocument();
    await userEvent.click(d().getByRole("button", { name: "Quitar Camisa de lino" }));
    expect(d().getByText("Todavía no elegiste ninguno.")).toBeInTheDocument();
    await submit("Guardar cambios");
    // sin ningún producto no se puede guardar
    expect(d().getByText("Elige al menos un producto.")).toBeInTheDocument();
    expect(api.updateDiscount).not.toHaveBeenCalled();
  });

  it("si no se pueden leer los objetivos lo dice y deja reintentar (no abre un formulario vacío)", async () => {
    api.listTargets.mockRejectedValueOnce(new Error("sin red"));
    renderDialog(discount({ scope: "category" }));
    expect(await d().findByText("No pudimos leer lo que ya estaba elegido.")).toBeInTheDocument();
    expect(d().queryByLabelText("Nombre")).not.toBeInTheDocument();
    api.listTargets.mockResolvedValue([target()]);
    await userEvent.click(d().getByRole("button", { name: "Reintentar" }));
    expect(await d().findByLabelText("Nombre")).toBeInTheDocument();
    expect(await d().findByLabelText("Verano")).toBeChecked();
  });

  it("conflicto de edición: banner, no guarda, bloquea Guardar y «Recargar» cierra", async () => {
    api.updateDiscount.mockRejectedValue(new StaleVersionError());
    const { onOpenChange } = await openEdit(discount());
    await userEvent.type(d().getByLabelText("Nombre"), " editado");
    await submit("Guardar cambios");

    const banner = await d().findByText("Alguien más modificó esto");
    expect(banner.closest('[role="alert"]')).toHaveTextContent(/no se guardó nada tuyo/);
    expect(toast.success).not.toHaveBeenCalled();
    expect(d().getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    await userEvent.click(d().getByRole("button", { name: "Recargar la versión actual" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("si el descuento se guarda pero falla un objetivo: avisa, sigue abierto y el reintento usa la versión NUEVA", async () => {
    api.listTargets.mockResolvedValue([target()]);
    api.addTarget.mockRejectedValueOnce(new AppError("unknown", "No pudimos agregar."));
    const { onOpenChange } = await openEdit(discount({ scope: "category" }));
    await userEvent.click(await d().findByLabelText("Ropa"));
    await submit("Guardar cambios");
    const alert = await d().findByText(/Se guardaron los cambios del descuento/);
    expect(alert).toHaveTextContent("Ropa");
    expect(alert).toHaveTextContent("No pudimos agregar.");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    await submit("Guardar cambios");
    await waitFor(() => expect(api.updateDiscount).toHaveBeenCalledTimes(2));
    expect(api.updateDiscount.mock.calls[0]![1]).toBe(VERSION);
    expect(api.updateDiscount.mock.calls[1]![1]).toBe("V2"); // la que devolvió el primer guardado
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Descuento actualizado.");
  });

  it("parámetros ilegibles: avisa, los campos arrancan vacíos y no deja guardar hasta volver a ingresarlos", async () => {
    await openEdit(discount({ params: null }));
    expect(d().getByText(/no se pueden leer: vuelve a ingresarlos/)).toBeInTheDocument();
    expect(d().getByLabelText("Porcentaje de descuento (%)")).toHaveValue("");
    await submit("Guardar cambios");
    expect(d().getByText("Escribe el porcentaje.")).toBeInTheDocument();
    expect(api.updateDiscount).not.toHaveBeenCalled();
  });

  it("envío gratis o primera compra: se puede pasar de automático a con código (y avisa lo que pasa con los códigos)", async () => {
    await openEdit(
      discount({
        kind: "first_purchase",
        params: { kind: "first_purchase", percent: 10, maxAmount: null },
        requiresCoupon: true,
      }),
    );
    expect(d().getByLabelText("Con código")).toBeChecked();
    expect(d().getByText(/los códigos que ya creaste dejan de funcionar/)).toBeInTheDocument();
    await userEvent.click(d().getByLabelText("Automático"));
    await submit("Guardar cambios");
    await waitFor(() => expect(api.updateDiscount).toHaveBeenCalledTimes(1));
    expect(api.updateDiscount.mock.calls[0]![2]).toMatchObject({
      requiresCoupon: false,
      stackableWithAutomatic: false,
      excludeSaleItems: false,
    });
  });
});

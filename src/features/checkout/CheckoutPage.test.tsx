import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customerProfile } from "@/test/auth-test-utils";
import { makeLine, makeSnapshot, renderWithCart, signedIn } from "@/features/cart/cart-test-utils";
import { CheckoutPage } from "./CheckoutPage";
import {
  ADDRESS,
  createdResponse,
  METHODS,
  PAYMENT,
  previewFor,
  rawQuote,
} from "./checkout-test-utils";
import type { CheckoutChoices } from "./types";

const api = vi.hoisted(() => ({
  previewCheckout: vi.fn(),
  createOrder: vi.fn(),
  cancelOrder: vi.fn(),
}));
vi.mock("./checkoutApi", () => api);
const addresses = vi.hoisted(() => ({
  listActiveAddresses: vi.fn(),
  listDeliveryCountries: vi.fn(),
}));
vi.mock("@/features/account/addresses/api", async (original) => ({
  ...(await original<typeof import("@/features/account/addresses/api")>()),
  ...addresses,
}));
const tax = vi.hoisted(() => ({ listTaxProfiles: vi.fn() }));
vi.mock("@/features/account/tax/api", async (original) => ({
  ...(await original<typeof import("@/features/account/tax/api")>()),
  ...tax,
}));
vi.mock("./checkoutHooks", async (original) => ({
  ...(await original<typeof import("./checkoutHooks")>()),
  useShippingMethods: () => ({ data: METHODS, isPending: false, isError: false }),
}));

const ok = <T,>(data: T) => ({ ok: true as const, data });
const snapshot = () => makeSnapshot([makeLine("v1", 2)]);
const auth = () => signedIn({ profile: { ...customerProfile, phone_e164: "+59171234567" } });

function Confirmation() {
  const location = useLocation();
  return (
    <p data-testid="confirmation">{`${location.pathname}|${JSON.stringify(location.state)}`}</p>
  );
}

function renderPage(options: { snapshot?: ReturnType<typeof snapshot> | null } = {}) {
  return renderWithCart(
    <Routes>
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/pedido/:numero" element={<Confirmation />} />
    </Routes>,
    {
      snapshot: options.snapshot === undefined ? snapshot() : options.snapshot,
      auth: auth(),
      path: "/checkout",
    },
  );
}

const button = (name: RegExp | string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  addresses.listActiveAddresses.mockResolvedValue([ADDRESS]);
  addresses.listDeliveryCountries.mockResolvedValue([{ code: "BO", name: "Bolivia" }]);
  tax.listTaxProfiles.mockResolvedValue([]);
  api.previewCheckout.mockImplementation(async (choices: CheckoutChoices) =>
    ok({ outcome: "preview", checkout: previewFor(choices) }),
  );
});

async function ready() {
  expect(await screen.findByRole("button", { name: "Enviar pedido por WhatsApp" })).toBeEnabled();
  await waitFor(() => expect(screen.getByTestId("checkout-total")).toHaveTextContent("Bs 215,00"));
}

describe("CheckoutPage · formulario único", () => {
  it("muestra contacto precargado, entrega, pago y el resumen con los importes del servidor", async () => {
    renderPage();
    await ready();
    expect(screen.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre completo")).toHaveValue("Ana Cliente");
    expect(screen.getByLabelText("Teléfono (WhatsApp)")).toHaveValue("+591 7123 4567");
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveValue("ana@test.com");
    // entrega a domicilio y la dirección predeterminada, elegidas por omisión
    expect(screen.getByRole("radio", { name: /Entrega a domicilio/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Casa/ })).toBeChecked();
    // pago: WhatsApp elegido por omisión
    expect(screen.getByRole("radio", { name: /Pedir por WhatsApp/ })).toBeChecked();
    // resumen: 2 × 100,00 + envío 15,00 = 215,00 (todo viene del servidor)
    const summary = screen.getByRole("region", { name: "Resumen" });
    expect(within(summary).getByText("Subtotal").nextElementSibling).toHaveTextContent("Bs 200,00");
    expect(within(summary).getByText("Envío").nextElementSibling).toHaveTextContent("Bs 15,00");
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("Bs 215,00");
    expect(within(summary).getByText("Impuestos incluidos.")).toBeInTheDocument();
  });

  it("pide la vista previa con lo elegido y NO manda precios ni identidad", async () => {
    renderPage();
    await ready();
    const choices = api.previewCheckout.mock.calls.at(-1)![0] as CheckoutChoices;
    expect(choices).toMatchObject({ shippingMethod: "delivery", addressId: "ad-1" });
    // el pago NO viaja en la vista previa (no cambia ningún importe) y solo se pide una vez, ya con la dirección
    expect(Object.keys(choices).sort()).toEqual(["addressId", "shippingMethod"]);
    expect(api.previewCheckout).toHaveBeenCalledTimes(1);
  });

  it("el recojo en tienda quita la dirección y deja el envío en «Sin costo»", async () => {
    renderPage();
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: /Recojo en el taller/ }));
    await waitFor(() =>
      expect(screen.getByTestId("checkout-total")).toHaveTextContent("Bs 200,00"),
    );
    expect(screen.queryByRole("radio", { name: /Casa/ })).not.toBeInTheDocument();
    const choices = api.previewCheckout.mock.calls.at(-1)![0] as CheckoutChoices;
    expect(choices.shippingMethod).toBe("recojo");
    expect(choices.addressId).toBeUndefined();
  });

  it("una dirección sin ubicación avisa y ofrece ubicarla; sin dirección no hay total (nada de «total» sin envío)", async () => {
    addresses.listActiveAddresses.mockResolvedValue([{ ...ADDRESS, lat: null, lng: null }]);
    api.previewCheckout.mockImplementation(async (choices: CheckoutChoices) =>
      ok({
        outcome: "preview",
        checkout: {
          ...previewFor(choices),
          ok: false,
          errors: [{ code: "location_required", field: "location" }],
          totals: { subtotal: 200, discount: 0, shipping: null, shipping_discount: 0, total: null },
          shipping: {
            method: null,
            quote: rawQuote({
              ok: false,
              cost: null,
              errors: [{ code: "location_required", field: "location" }],
            }),
            address: null,
            slot: null,
          },
        },
      }),
    );
    renderPage();
    // el formulario aparece de una vez (esqueleto → formulario): se espera a que esté montado y estable
    await screen.findByLabelText("Nombre completo");
    expect(
      await screen.findByText("Falta ubicarla en el mapa para calcular el envío."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ubicar «Casa» en el mapa" })).toBeInTheDocument();
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("—");
    expect(screen.getByText("Se calcula al elegir tu dirección")).toBeInTheDocument();
  });

  it("un método de pago no disponible queda deshabilitado, con su motivo, y no se elige solo", async () => {
    const methods = [PAYMENT[0]!, { ...PAYMENT[1]!, available: false, reason: "not_available" }];
    api.previewCheckout.mockImplementation(async (choices: CheckoutChoices) =>
      ok({ outcome: "preview", checkout: previewFor(choices, {}, methods) }),
    );
    renderPage();
    await ready();
    const cod = screen.getByRole("radio", { name: /Efectivo contra entrega/ });
    expect(cod).toBeDisabled();
    expect(screen.getByText("No disponible para este pedido")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Pedir por WhatsApp/ })).toBeChecked();
  });

  it("con la bolsa vacía muestra el estado vacío con camino a la tienda", async () => {
    renderPage({ snapshot: makeSnapshot([]) });
    expect(await screen.findByText("Tu bolsa está vacía")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a la tienda" })).toHaveAttribute("href", "/tienda");
    expect(api.previewCheckout).not.toHaveBeenCalled();
  });
});

describe("CheckoutPage · vista previa fresca y estabilidad", () => {
  /** Respuestas de la vista previa que la prueba suelta a mano, en orden de llegada. */
  function manualPreviews() {
    const waiting: (() => void)[] = [];
    api.previewCheckout.mockImplementation(
      (choices: CheckoutChoices) =>
        new Promise((resolve) => {
          waiting.push(() => resolve(ok({ outcome: "preview", checkout: previewFor(choices) })));
        }),
    );
    return {
      release: () => waiting.splice(0).forEach((fn) => fn()),
      pending: () => waiting.length,
    };
  }

  it("hasta tener formas de entrega, direcciones y la vista previa muestra un esqueleto: el formulario aparece DE UNA VEZ", async () => {
    const previews = manualPreviews();
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Finalizar compra" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Preparando tu compra…");
    expect(screen.queryByLabelText("Nombre completo")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Resumen" })).not.toBeInTheDocument();
    // una sola vista previa (ya con dirección y sin esperar el método de pago); mientras no llega, el esqueleto sigue
    await waitFor(() => expect(previews.pending()).toBe(1));
    expect(screen.queryByLabelText("Nombre completo")).not.toBeInTheDocument();
    previews.release();
    expect(await screen.findByLabelText("Nombre completo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar pedido por WhatsApp" })).toBeEnabled();
  });

  it("al elegir otra cosa que cambia los números, mientras llega la vista previa nueva el botón espera («Calculando…») y NO envía con la vieja", async () => {
    renderPage();
    await ready();
    const previews = manualPreviews();
    await userEvent.click(screen.getByRole("radio", { name: /Recojo en el taller/ }));
    const waiting = await screen.findByRole("button", { name: "Calculando tu total…" });
    expect(waiting).toBeDisabled();
    await userEvent.click(waiting);
    expect(api.createOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(previews.pending()).toBe(1));
    previews.release();
    expect(await screen.findByRole("button", { name: "Enviar pedido por WhatsApp" })).toBeEnabled();
    await waitFor(() =>
      expect(screen.getByTestId("checkout-total")).toHaveTextContent("Bs 200,00"),
    );
  });

  it("elegir otro método de pago NO vuelve a pedir la vista previa (no cambia ningún importe)", async () => {
    renderPage();
    await ready();
    const calls = api.previewCheckout.mock.calls.length;
    await userEvent.click(screen.getByRole("radio", { name: /Efectivo contra entrega/ }));
    expect(await screen.findByRole("button", { name: "Confirmar pedido" })).toBeEnabled();
    expect(api.previewCheckout.mock.calls.length).toBe(calls);
  });
});

describe("CheckoutPage · validación y envío", () => {
  it("un contacto incompleto NO envía nada: explica cada campo y lleva el foco al primero", async () => {
    renderPage();
    await ready();
    await userEvent.clear(screen.getByLabelText("Nombre completo"));
    await userEvent.clear(screen.getByLabelText("Teléfono (WhatsApp)"));
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    expect(api.createOrder).not.toHaveBeenCalled();
    // el mensaje aparece junto al campo Y en el resumen de errores
    expect((await screen.findAllByText("Escribe tu nombre.")).length).toBe(2);
    expect(screen.getAllByText("Escribe tu teléfono.").length).toBe(2);
    expect(screen.getByLabelText("Nombre completo")).toHaveFocus();
    expect(screen.getByLabelText("Nombre completo")).toHaveAttribute("aria-invalid", "true");
    const summary = screen.getByText("Revisa tu pedido").closest('[role="alert"]');
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("Hay algo que corregir antes de enviarlo:");
  });

  it("crea el pedido con el total que el servidor mostró, el contacto normalizado y una llave de idempotencia; luego navega a la confirmación", async () => {
    api.createOrder.mockResolvedValue(ok(createdResponse()));
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    const probe = await screen.findByTestId("confirmation");
    expect(probe).toHaveTextContent("/pedido/MIC-000123|");
    expect(probe).toHaveTextContent('"justCreated":true');
    expect(probe).toHaveTextContent('"kind":"whatsapp"');
    expect(api.createOrder).toHaveBeenCalledTimes(1);
    const [choices, contact, expected, key] = api.createOrder.mock.calls[0]!;
    expect(choices).toMatchObject({ shippingMethod: "delivery", addressId: "ad-1" });
    expect(contact).toEqual({ name: "Ana Cliente", email: "ana@test.com", phone: "+59171234567" });
    expect(expected).toBe(215); // el total que VIO, no uno calculado aquí
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("anti doble envío: un segundo clic mientras se envía no crea otro pedido y el botón se bloquea", async () => {
    let finish: (value: unknown) => void = () => {};
    api.createOrder.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await ready();
    const submit = button("Enviar pedido por WhatsApp");
    await userEvent.click(submit);
    await userEvent.click(submit);
    await userEvent.click(submit);
    expect(await screen.findByRole("button", { name: "Enviando tu pedido…" })).toBeDisabled();
    expect(api.createOrder).toHaveBeenCalledTimes(1);
    finish(ok(createdResponse()));
    await screen.findByTestId("confirmation");
  });

  it("si cambió el total (BR-CHK-04) NO se crea: muestra antes y ahora, y al confirmar reenvía con el MISMO identificador y el nuevo total", async () => {
    api.createOrder
      .mockResolvedValueOnce(
        ok({ outcome: "changed", reason: "total", expected_total: 215, actual_total: 230 }),
      )
      .mockResolvedValueOnce(ok(createdResponse({ total: 230 })));
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    const dialog = await screen.findByRole("dialog", { name: "Cambió el total de tu pedido" });
    expect(within(dialog).getByText("Antes").nextElementSibling).toHaveTextContent("Bs 215,00");
    expect(within(dialog).getByText("Ahora").nextElementSibling).toHaveTextContent("Bs 230,00");
    expect(screen.queryByTestId("confirmation")).not.toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Confirmar con el nuevo total" }),
    );
    await screen.findByTestId("confirmation");
    expect(api.createOrder).toHaveBeenCalledTimes(2);
    expect(api.createOrder.mock.calls[1]![2]).toBe(230);
    expect(api.createOrder.mock.calls[1]![3]).toBe(api.createOrder.mock.calls[0]![3]); // misma llave: un solo pedido
  });

  it("un precio que subió (garantía vencida) obliga a volver a la bolsa: no ofrece confirmar", async () => {
    api.createOrder.mockResolvedValue(
      ok({
        outcome: "changed",
        reason: "price",
        lines: [
          {
            ...previewFor({ shippingMethod: "delivery" }).lines[0]!,
            price_notice: "expired_raised",
            blocking: true,
            unit_price: 120,
          },
        ],
      }),
    );
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    const dialog = await screen.findByRole("dialog", { name: "Cambió el precio de un producto" });
    expect(
      within(dialog).getByText("Chaqueta v1: subió de precio a Bs 120,00."),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Confirmar con el nuevo total" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Revisar mi bolsa" })).toHaveAttribute(
      "href",
      "/carrito",
    );
  });

  it("sin stock: lista cada línea con lo que quedó y solo ofrece volver a la bolsa", async () => {
    api.createOrder.mockResolvedValue(
      ok({
        outcome: "unavailable",
        lines: [
          {
            ...previewFor({ shippingMethod: "delivery" }).lines[0]!,
            status: "low_stock",
            available: 1,
          },
        ],
      }),
    );
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    const dialog = await screen.findByRole("dialog", {
      name: "Algunos productos ya no están disponibles",
    });
    expect(within(dialog).getByText("Chaqueta v1: solo quedan 1.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Confirmar/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("confirmation")).not.toBeInTheDocument();
  });

  it("un rechazo del servidor (franja llena) se explica en el resumen de errores y junto a la sección", async () => {
    api.createOrder.mockResolvedValue(
      ok({ outcome: "rejected", errors: [{ code: "slot_full", field: "slot" }] }),
    );
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    const title = await screen.findByText("Revisa tu pedido");
    const alert = title.closest('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toMatch(/franja/i);
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.queryByTestId("confirmation")).not.toBeInTheDocument();
  });

  it("un corte de red no pierde nada: avisa que NO se envió y deja reintentar con la MISMA llave", async () => {
    api.createOrder
      .mockResolvedValueOnce({ ok: false, status: 0, code: "network", message: "network" })
      .mockResolvedValueOnce(ok(createdResponse()));
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    expect(
      await screen.findByText(/No pudimos confirmar si tu pedido se envió/),
    ).toBeInTheDocument();
    expect(button("Enviar pedido por WhatsApp")).toBeEnabled();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    await screen.findByTestId("confirmation");
    expect(api.createOrder.mock.calls[1]![3]).toBe(api.createOrder.mock.calls[0]![3]);
  });

  it("M3: si la persona CAMBIA algo antes de reintentar (el pago, el contacto), es otra compra: otra llave", async () => {
    api.createOrder
      .mockResolvedValueOnce({ ok: false, status: 0, code: "network", message: "network" })
      .mockResolvedValueOnce({ ok: false, status: 0, code: "network", message: "network" })
      .mockResolvedValueOnce(ok(createdResponse()));
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    await screen.findByText(/No pudimos confirmar si tu pedido se envió/);
    // 1) cambia el método de pago
    await userEvent.click(screen.getByRole("radio", { name: /Efectivo contra entrega/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmar pedido" }));
    await waitFor(() => expect(api.createOrder).toHaveBeenCalledTimes(2));
    const [, , , firstKey] = api.createOrder.mock.calls[0]!;
    const [secondChoices, , , secondKey] = api.createOrder.mock.calls[1]!;
    expect(secondChoices.paymentMethod).toBe("cash_on_delivery");
    expect(secondKey).not.toBe(firstKey);
    // 2) cambia el teléfono
    await screen.findByText(/No pudimos confirmar si tu pedido se envió/);
    const phone = screen.getByLabelText("Teléfono (WhatsApp)");
    await userEvent.clear(phone);
    await userEvent.type(phone, "+591 7999 8888");
    await userEvent.click(button("Confirmar pedido"));
    await screen.findByTestId("confirmation");
    const [, thirdContact, , thirdKey] = api.createOrder.mock.calls[2]!;
    expect(thirdContact.phone).toBe("+59179998888");
    expect(thirdKey).not.toBe(secondKey);
  });

  it("M3: si el servidor dice «idempotency_conflict», lo explica y la próxima compra lleva otra llave", async () => {
    api.createOrder
      .mockResolvedValueOnce(
        ok({ outcome: "rejected", errors: [{ code: "idempotency_conflict", field: "order" }] }),
      )
      .mockResolvedValueOnce(ok(createdResponse()));
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    expect(
      (await screen.findAllByText(/Cambiaste algo mientras se enviaba/)).length,
    ).toBeGreaterThan(0);
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    await screen.findByTestId("confirmation");
    expect(api.createOrder.mock.calls[1]![3]).not.toBe(api.createOrder.mock.calls[0]![3]);
  });

  it.each([
    ["too_many_open_orders", /varios pedidos esperando confirmación/],
    ["stale_prices", /Los precios de tu bolsa cambiaron/],
  ])("el rechazo «%s» tiene su propia frase (no el mensaje genérico)", async (code, message) => {
    api.createOrder.mockResolvedValue(ok({ outcome: "rejected", errors: [{ code }] }));
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No pudimos crear tu pedido/)).not.toBeInTheDocument();
  });

  it("B3: «Necesito factura» sin datos fiscales NO envía el pedido sin factura: lo explica junto a la sección", async () => {
    renderPage();
    await ready();
    await userEvent.click(screen.getByRole("checkbox", { name: "Necesito factura" }));
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    expect(api.createOrder).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/Elige tus datos fiscales o desmarca/)).length).toBe(2);
    // al desmarcar, el pedido sale (sin datos fiscales, a propósito)
    api.createOrder.mockResolvedValue(ok(createdResponse()));
    await userEvent.click(screen.getByRole("checkbox", { name: "Necesito factura" }));
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    await screen.findByTestId("confirmation");
    expect(api.createOrder.mock.calls[0]![0].taxProfileId).toBeUndefined();
  });

  it("B3: con datos fiscales guardados y «Necesito factura», el pedido sale con ellos", async () => {
    tax.listTaxProfiles.mockResolvedValue([
      {
        id: "tp-1",
        docType: "nit",
        docNumber: "1020304050",
        legalName: "Ana SRL",
        isDefault: true,
        archived: false,
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ]);
    api.createOrder.mockResolvedValue(ok(createdResponse()));
    renderPage();
    await ready();
    await userEvent.click(screen.getByRole("checkbox", { name: "Necesito factura" }));
    await waitFor(() => expect(screen.getByLabelText("Datos fiscales")).toHaveValue("tp-1"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Enviar pedido por WhatsApp" }),
    );
    await screen.findByTestId("confirmation");
    expect(api.createOrder.mock.calls[0]![0].taxProfileId).toBe("tp-1");
  });

  it("B4: si dejó de valer un descuento NO se ofrece confirmar un total que el servidor no dio: «Ver el nuevo total» cierra el aviso", async () => {
    api.createOrder.mockResolvedValue(
      ok({ outcome: "changed", reason: "discount", failed: [{ reason: "coupon_exhausted" }] }),
    );
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    const dialog = await screen.findByRole("dialog", { name: "Cambió el total de tu pedido" });
    expect(within(dialog).getByText(/dejó de estar disponible/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Confirmar con el nuevo total" }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Ver el nuevo total" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createOrder).toHaveBeenCalledTimes(1);
  });

  it("429 y sesión vencida tienen su propio mensaje", async () => {
    api.createOrder.mockResolvedValueOnce({
      ok: false,
      status: 429,
      code: "rate_limited",
      message: "x",
      retryAfter: 30,
    });
    renderPage();
    await ready();
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    expect(await screen.findByText(/demasiados intentos seguidos/)).toBeInTheDocument();
    api.createOrder.mockResolvedValueOnce({
      ok: false,
      status: 401,
      code: "invalid_session",
      message: "x",
    });
    await userEvent.click(button("Enviar pedido por WhatsApp"));
    expect(
      await screen.findByText("Tu sesión venció. Inicia sesión para continuar."),
    ).toBeInTheDocument();
  });

  it("contra entrega cambia el texto del botón a «Confirmar pedido»", async () => {
    renderPage();
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: /Efectivo contra entrega/ }));
    expect(await screen.findByRole("button", { name: "Confirmar pedido" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enviar pedido por WhatsApp" }),
    ).not.toBeInTheDocument();
  });
});

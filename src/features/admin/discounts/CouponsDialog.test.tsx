import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { CouponsDialog } from "./CouponsDialog";
import type { Coupon, Discount, Redemption } from "./types";

const api = vi.hoisted(() => ({
  listCoupons: vi.fn(),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  setCouponArchived: vi.fn(),
  generateCouponCodes: vi.fn(),
  listRedemptions: vi.fn(),
  listDiscounts: vi.fn(),
  listDiscountUsage: vi.fn(),
  listAllTargets: vi.fn(),
  listTargets: vi.fn(),
  listGroups: vi.fn(),
  listMembers: vi.fn(),
  searchProfiles: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const VERSION = "2026-11-05T10:00:00.123456+00:00";

const discount = (over: Partial<Discount> = {}): Discount => ({
  id: "d1",
  name: "Verano 2026",
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

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: "c1",
  discountId: "d1",
  code: "Verano-10",
  codeNormalized: "VERAN010",
  isActive: true,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  archived: false,
  updatedAt: VERSION,
  ...over,
});

const redemption = (over: Partial<Redemption> = {}): Redemption => ({
  id: "r1",
  discountId: "d1",
  discountName: "Verano 2026",
  couponId: "c1",
  couponCode: "Verano-10",
  profileId: "p1",
  customerName: "Ana",
  customerEmail: "ana@correo.com",
  ownerType: "order",
  ownerId: "o1",
  amount: 10,
  currency: "BOB",
  status: "applied",
  createdAt: "2026-11-05T12:00:00+00:00",
  ...over,
});

let onOpenChange: ReturnType<typeof vi.fn>;

function renderDialog(d: Discount = discount(), open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (isOpen: boolean) => (
    <QueryClientProvider client={client}>
      <CouponsDialog discount={d} open={isOpen} onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
  const view = render(ui(open));
  return { ...view, setOpen: (isOpen: boolean) => view.rerender(ui(isOpen)) };
}
/** El diálogo de más arriba (con uno anidado abierto, el de códigos queda oculto para los lectores). */
const dialogs = () => screen.getAllByRole("dialog", { hidden: true });
const top = () => within(dialogs().at(-1) as HTMLElement);
const rowOf = (code: string) =>
  screen.getByText(code, { selector: "span" }).closest("tr") as HTMLElement;
const open = async (name: string) => await userEvent.click(screen.getByRole("button", { name }));

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

beforeEach(() => {
  vi.clearAllMocks();
  onOpenChange = vi.fn();
  api.listCoupons.mockResolvedValue([coupon()]);
  api.listRedemptions.mockResolvedValue([]);
  api.listDiscounts.mockResolvedValue([]);
  api.updateCoupon.mockResolvedValue("2026-11-05T12:00:00.000001+00:00");
  api.setCouponArchived.mockResolvedValue("2026-11-05T12:00:00.000001+00:00");
  api.createCoupon.mockResolvedValue(coupon({ id: "nuevo" }));
});

describe("Códigos: lista y estados", () => {
  it("el diálogo lleva el nombre del descuento y su explicación", async () => {
    renderDialog();
    await screen.findByText("Verano-10");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Códigos de «Verano 2026»" })).toBeInTheDocument();
    expect(screen.getByText(/«Verano-10» y «VERANO 10» son el mismo código/)).toBeInTheDocument();
  });

  it("muestra «Cargando…» mientras llegan los códigos", () => {
    api.listCoupons.mockReturnValue(new Promise(() => undefined));
    renderDialog();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("si falla la carga lo dice y «Reintentar» vuelve a pedirlo", async () => {
    api.listCoupons.mockRejectedValueOnce(new Error("sin red"));
    renderDialog();
    expect(await screen.findByText("No pudimos cargar los datos")).toBeInTheDocument();
    api.listCoupons.mockResolvedValueOnce([coupon({ code: "Tras-reintento" })]);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Tras-reintento")).toBeInTheDocument();
    expect(api.listCoupons).toHaveBeenCalledTimes(2);
  });

  it("vacío: explica cómo agregar y el botón de descargar queda apagado", async () => {
    api.listCoupons.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText(/Este descuento todavía no tiene códigos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar todos (CSV)" })).toBeDisabled();
  });

  it("cada código con su estado, usos y vigencia en hora de La Paz; los archivados al final", async () => {
    api.listCoupons.mockResolvedValue([
      coupon({ id: "a", code: "Verano-10", usageLimit: 3 }),
      coupon({ id: "b", code: "APAGADO", codeNormalized: "APAGAD0", isActive: false }),
      coupon({ id: "c", code: "VIEJO", endsAt: "2020-01-01T04:00:00Z" }),
      coupon({ id: "d", code: "FUTURO", startsAt: "2099-01-01T04:00:00Z" }),
      coupon({ id: "e", code: "UNICO", usageLimit: 1 }),
      coupon({ id: "f", code: "ARCH", archived: true }),
      coupon({ id: "g", code: "DEVUELTO", usageLimit: 1 }),
    ]);
    api.listRedemptions.mockResolvedValue([
      redemption({ id: "1", couponId: "a", status: "applied" }),
      redemption({ id: "2", couponId: "e", status: "reserved" }),
      redemption({ id: "3", couponId: "g", status: "reverted" }),
    ]);
    renderDialog();
    await screen.findByText("Verano-10");
    await waitFor(() => expect(within(rowOf("Verano-10")).getByText("1 de 3")).toBeInTheDocument());

    const order = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0]?.textContent);
    expect(order).toEqual(["Verano-10", "APAGADO", "VIEJO", "FUTURO", "UNICO", "DEVUELTO", "ARCH"]);

    expect(within(rowOf("Verano-10")).getByText("Activo")).toBeInTheDocument();
    expect(within(rowOf("Verano-10")).getByText("Sin fechas propias")).toBeInTheDocument();
    expect(within(rowOf("APAGADO")).getByText("Apagado")).toBeInTheDocument();
    expect(within(rowOf("VIEJO")).getByText("Vencido")).toBeInTheDocument();
    expect(within(rowOf("VIEJO")).getByText("Hasta 1 ene 2020, 00:00")).toBeInTheDocument();
    expect(within(rowOf("FUTURO")).getByText("Aún no empieza")).toBeInTheDocument();
    expect(within(rowOf("FUTURO")).getByText("Desde 1 ene 2099, 00:00")).toBeInTheDocument();
    // Un uso reservado con tope 1 → agotado.
    expect(within(rowOf("UNICO")).getByText("Agotado")).toBeInTheDocument();
    expect(within(rowOf("UNICO")).getByText("1 de 1 (un solo uso)")).toBeInTheDocument();
    // Un uso devuelto NO cuenta: sigue activo con 0 usos.
    expect(within(rowOf("DEVUELTO")).getByText("Activo")).toBeInTheDocument();
    expect(within(rowOf("DEVUELTO")).getByText("0 de 1 (un solo uso)")).toBeInTheDocument();
    const archived = within(rowOf("ARCH"));
    expect(archived.getByText("Archivado")).toBeInTheDocument();
    expect(archived.getByRole("button", { name: "Restaurar el código ARCH" })).toBeInTheDocument();
    expect(
      archived.queryByRole("button", { name: /Archivar|Apagar|Editar/ }),
    ).not.toBeInTheDocument();
    expect(archived.getByRole("button", { name: "Copiar el código ARCH" })).toBeInTheDocument();
  });

  it("el código se muestra TAL CUAL lo escribió, no normalizado", async () => {
    api.listCoupons.mockResolvedValue([coupon({ code: "Verano-10", codeNormalized: "VERAN010" })]);
    renderDialog();
    expect(await screen.findByText("Verano-10", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("VERAN010")).not.toBeInTheDocument();
  });

  it("sin leer los usos no se adivina «agotado» y lo avisa", async () => {
    api.listCoupons.mockResolvedValue([coupon({ code: "UNICO", usageLimit: 1 })]);
    api.listRedemptions.mockRejectedValue(new Error("falla"));
    renderDialog();
    expect(
      await screen.findByText(/No pudimos leer cuántas veces se usó cada código/),
    ).toBeInTheDocument();
    expect(within(rowOf("UNICO")).getByText("Activo")).toBeInTheDocument();
    expect(within(rowOf("UNICO")).getByText("—")).toBeInTheDocument();
  });

  it("si la consulta de usos llegó al tope de 1000 avisa que los números pueden quedar cortos", async () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      redemption({ id: `r${i}`, couponId: null }),
    );
    api.listRedemptions.mockResolvedValue(many);
    renderDialog();
    expect(await screen.findByText(/solo se leen los últimos 1000/)).toBeInTheDocument();
  });
  it("con 999 usos no avisa", async () => {
    api.listRedemptions.mockResolvedValue(
      Array.from({ length: 999 }, (_, i) => redemption({ id: `r${i}`, couponId: null })),
    );
    renderDialog();
    await screen.findByText("Verano-10");
    await waitFor(() => expect(api.listRedemptions).toHaveBeenCalled());
    expect(screen.queryByText(/solo se leen los últimos/)).not.toBeInTheDocument();
  });

  it("pide los usos de ESTE descuento", async () => {
    renderDialog();
    await screen.findByText("Verano-10");
    expect(api.listCoupons).toHaveBeenCalledWith("d1");
    expect(api.listRedemptions).toHaveBeenCalledWith("d1");
  });

  it("un descuento sin código no tiene códigos: lo explica y no ofrece agregar", async () => {
    renderDialog(discount({ requiresCoupon: false }));
    expect(await screen.findByText(/se aplica solo, sin código/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar un código" })).not.toBeInTheDocument();
  });

  it("un descuento archivado no deja generar códigos al azar, pero sí verlos y agregar a mano", async () => {
    renderDialog(discount({ archived: true }));
    await screen.findByText("Verano-10");
    expect(screen.getByText(/Este descuento está archivado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generar al azar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar un código" })).toBeInTheDocument();
  });

  it("Esc cierra el diálogo; cerrarlo y abrirlo de nuevo olvida lo escrito", async () => {
    const view = renderDialog();
    await screen.findByText("Verano-10");
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar un código" }), "algo");
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    view.setOpen(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.setOpen(true);
    expect(await screen.findByRole("searchbox", { name: "Buscar un código" })).toHaveValue("");
  });

  it("los botones y campos miden al menos 44 px de alto", async () => {
    renderDialog();
    await screen.findByText("Verano-10");
    for (const name of [
      "Agregar un código",
      "Generar al azar",
      "Descargar todos (CSV)",
      "Copiar el código Verano-10",
      "Apagar el código Verano-10",
      "Editar la vigencia y el tope del código Verano-10",
      "Archivar el código Verano-10",
    ]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
    expect(screen.getByRole("searchbox", { name: "Buscar un código" }).className).toContain(
      "min-h-11",
    );
  });
});

describe("Códigos: búsqueda y paginación", () => {
  it("busca sin importar mayúsculas, espacios, guiones ni 0/O, y cuenta lo que muestra", async () => {
    api.listCoupons.mockResolvedValue([
      coupon({ id: "a", code: "VERANO-10", codeNormalized: "VERAN010" }),
      coupon({ id: "b", code: "invierno-5", codeNormalized: "1NV1ERN05" }),
      coupon({ id: "c", code: "PROMO", codeNormalized: "PR0M0" }),
    ]);
    renderDialog();
    await screen.findByText("VERANO-10");
    expect(screen.getByText("3 códigos")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Buscar un código" });
    await userEvent.type(search, "verano 10");
    expect(screen.getByText("Mostrando 1 de 3 códigos")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("VERANO-10")).toBeInTheDocument();
    expect(screen.queryByText("PROMO")).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    expect(screen.getByText("Ningún código coincide con «zzz».")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("con 120 códigos pinta 50 y «Mostrar más» agrega de 50 en 50; una búsqueda nueva vuelve a 50", async () => {
    api.listCoupons.mockResolvedValue(
      Array.from({ length: 120 }, (_, i) =>
        coupon({
          id: `c${i}`,
          code: `CODE-${String(i).padStart(3, "0")}`,
          codeNormalized: `CODE${i}`,
        }),
      ),
    );
    renderDialog();
    await screen.findByText("CODE-000");
    expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(screen.getByText("120 códigos")).toBeInTheDocument();
    await open("Mostrar más (70 restantes)");
    expect(screen.getAllByRole("row")).toHaveLength(101);
    await open("Mostrar más (20 restantes)");
    expect(screen.getAllByRole("row")).toHaveLength(121);
    expect(screen.queryByRole("button", { name: /Mostrar más/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar un código" }), "code-");
    expect(screen.getAllByRole("row")).toHaveLength(51);
  });

  it("un solo código dice «1 código»", async () => {
    renderDialog();
    expect(await screen.findByText("1 código")).toBeInTheDocument();
  });
});

describe("Códigos: apagar, encender, archivar, restaurar", () => {
  it("apagar envía la versión leída y conserva vigencia y tope; avisa en el diálogo y con un aviso emergente", async () => {
    api.listCoupons.mockResolvedValue([
      coupon({ usageLimit: 3, startsAt: "2026-01-01T04:00:00Z", endsAt: "2099-01-01T04:00:00Z" }),
    ]);
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Apagar el código Verano-10");
    await waitFor(() =>
      expect(api.updateCoupon).toHaveBeenCalledWith("c1", VERSION, {
        isActive: false,
        startsAt: "2026-01-01T04:00:00Z",
        endsAt: "2099-01-01T04:00:00Z",
        usageLimit: 3,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Código apagado.");
    expect(await screen.findByText("Código apagado.", { selector: "span" })).toBeInTheDocument();
    // La lista se refrescó.
    expect(api.listCoupons.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("encender un código apagado envía isActive=true", async () => {
    api.listCoupons.mockResolvedValue([coupon({ isActive: false })]);
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Encender el código Verano-10");
    await waitFor(() =>
      expect(api.updateCoupon).toHaveBeenCalledWith("c1", VERSION, {
        isActive: true,
        startsAt: null,
        endsAt: null,
        usageLimit: null,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Código encendido.");
  });

  it("un error al apagar se muestra con su mensaje", async () => {
    api.updateCoupon.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Apagar el código Verano-10");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("conflicto al apagar: banner de «Alguien más modificó esto», no se avisa éxito y la lista se refresca", async () => {
    api.updateCoupon.mockRejectedValue(new StaleVersionError());
    renderDialog();
    await screen.findByText("Verano-10");
    const before = api.listCoupons.mock.calls.length;
    await open("Apagar el código Verano-10");
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listCoupons.mock.calls.length).toBeGreaterThan(before));
    await open("Recargar la versión actual");
    expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument();
  });

  it("archivar pide confirmación, explica que el código sigue reservado y envía la versión leída", async () => {
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Archivar el código Verano-10");
    const confirm = top();
    expect(
      confirm.getByRole("heading", { name: "¿Archivar el código Verano-10?" }),
    ).toBeInTheDocument();
    expect(
      confirm.getByText(/El código sigue reservado: no se puede crear otro igual/),
    ).toBeInTheDocument();
    expect(api.setCouponArchived).not.toHaveBeenCalled();
    await userEvent.click(confirm.getByRole("button", { name: "Archivar código" }));
    await waitFor(() => expect(api.setCouponArchived).toHaveBeenCalledWith("c1", VERSION, true));
    expect(toast.success).toHaveBeenCalledWith("Código archivado.");
  });

  it("cancelar no archiva nada", async () => {
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Archivar el código Verano-10");
    await userEvent.click(top().getByRole("button", { name: "Cancelar" }));
    expect(api.setCouponArchived).not.toHaveBeenCalled();
  });

  it("un error de la base al archivar deja la confirmación abierta y muestra el mensaje", async () => {
    api.setCouponArchived.mockRejectedValue(
      new AppError("unknown", "No se pudo completar la operación. Inténtalo de nuevo."),
    );
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Archivar el código Verano-10");
    await userEvent.click(top().getByRole("button", { name: "Archivar código" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "No se pudo completar la operación. Inténtalo de nuevo.",
      ),
    );
    expect(
      top().getByRole("heading", { name: "¿Archivar el código Verano-10?" }),
    ).toBeInTheDocument();
  });

  it("conflicto al archivar: se cierra la confirmación y queda el banner", async () => {
    api.setCouponArchived.mockRejectedValue(new StaleVersionError());
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Archivar el código Verano-10");
    await userEvent.click(top().getByRole("button", { name: "Archivar código" }));
    expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
    await waitFor(() => expect(dialogs()).toHaveLength(1));
  });

  it("restaurar es directo (sin confirmación) y envía archived=false", async () => {
    api.listCoupons.mockResolvedValue([coupon({ archived: true })]);
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Restaurar el código Verano-10");
    await waitFor(() => expect(api.setCouponArchived).toHaveBeenCalledWith("c1", VERSION, false));
    expect(toast.success).toHaveBeenCalledWith("Código restaurado.");
    expect(dialogs()).toHaveLength(1);
  });
});

describe("Códigos: copiar", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("copia el código tal cual y lo anuncia en una región de estado dentro del diálogo", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    renderDialog();
    await screen.findByText("Verano-10");
    setClipboard(writeText);
    await open("Copiar el código Verano-10");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Verano-10"));
    const live = await screen.findByText("Copiaste el código Verano-10.", { selector: "span" });
    expect(live.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole("dialog").contains(live)).toBe(true);
  });

  it("si el navegador no deja copiar, lo dice y deja el texto a la vista", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denegado"));
    renderDialog();
    await screen.findByText("Verano-10");
    setClipboard(writeText);
    await open("Copiar el código Verano-10");
    expect(
      await screen.findByText(/No pudimos copiar automáticamente/, { selector: "span" }),
    ).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("No pudimos copiar"));
    expect(screen.getByText("Verano-10", { selector: "span" })).toBeInTheDocument();
  });

  it("sin API de portapapeles (página sin HTTPS) también lo dice, sin romper", async () => {
    renderDialog();
    await screen.findByText("Verano-10");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await open("Copiar el código Verano-10");
    expect(
      await screen.findByText(/No pudimos copiar automáticamente/, { selector: "span" }),
    ).toBeInTheDocument();
  });
});

describe("Códigos: editar vigencia y tope", () => {
  const openEdit = async () => {
    await screen.findByText("Verano-10");
    await open("Editar la vigencia y el tope del código Verano-10");
    return top();
  };

  it("trae los datos del código en hora de La Paz y no deja cambiar el código", async () => {
    api.listCoupons.mockResolvedValue([
      coupon({
        startsAt: "2026-11-05T12:00:00+00:00",
        endsAt: "2099-12-01T04:00:00+00:00",
        usageLimit: 3,
        isActive: false,
      }),
    ]);
    renderDialog();
    const d = await openEdit();
    expect(d.getByRole("heading", { name: "Editar el código Verano-10" })).toBeInTheDocument();
    expect(d.getByLabelText("Empieza (hora de La Paz)")).toHaveValue("2026-11-05T08:00");
    expect(d.getByLabelText("Termina (hora de La Paz)")).toHaveValue("2099-12-01T00:00");
    expect(d.getByLabelText("Usos máximos de este código")).toHaveValue("3");
    expect(d.getByRole("checkbox", { name: "Código encendido" })).not.toBeChecked();
    expect(d.queryByLabelText("Código")).not.toBeInTheDocument();
  });

  it("envía EXACTAMENTE vigencia (hora de La Paz → UTC), tope y encendido con la versión leída", async () => {
    renderDialog();
    const d = await openEdit();
    fireEvent.change(d.getByLabelText("Empieza (hora de La Paz)"), {
      target: { value: "2030-01-01T08:00" },
    });
    fireEvent.change(d.getByLabelText("Termina (hora de La Paz)"), {
      target: { value: "2030-02-01T00:00" },
    });
    await userEvent.type(d.getByLabelText("Usos máximos de este código"), "5");
    await userEvent.click(d.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.updateCoupon).toHaveBeenCalledWith("c1", VERSION, {
        isActive: true,
        startsAt: "2030-01-01T12:00:00.000Z",
        endsAt: "2030-02-01T04:00:00.000Z",
        usageLimit: 5,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Código actualizado.");
    await waitFor(() => expect(dialogs()).toHaveLength(1));
  });

  it("vaciar los campos quita la vigencia y el tope (null)", async () => {
    api.listCoupons.mockResolvedValue([
      coupon({ startsAt: "2026-11-05T12:00:00+00:00", usageLimit: 3 }),
    ]);
    renderDialog();
    const d = await openEdit();
    fireEvent.change(d.getByLabelText("Empieza (hora de La Paz)"), { target: { value: "" } });
    await userEvent.clear(d.getByLabelText("Usos máximos de este código"));
    await userEvent.click(d.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.updateCoupon).toHaveBeenCalledWith("c1", VERSION, {
        isActive: true,
        startsAt: null,
        endsAt: null,
        usageLimit: null,
      }),
    );
  });

  it("fin antes del inicio y tope inválido: cada mensaje junto a su campo, foco al primero, no se envía", async () => {
    renderDialog();
    const d = await openEdit();
    fireEvent.change(d.getByLabelText("Empieza (hora de La Paz)"), {
      target: { value: "2030-02-01T00:00" },
    });
    fireEvent.change(d.getByLabelText("Termina (hora de La Paz)"), {
      target: { value: "2030-01-01T00:00" },
    });
    await userEvent.type(d.getByLabelText("Usos máximos de este código"), "0");
    await userEvent.click(d.getByRole("button", { name: "Guardar cambios" }));
    expect(d.getByLabelText("Termina (hora de La Paz)")).toHaveAccessibleDescription(
      "El final debe ser después del inicio.",
    );
    expect(d.getByLabelText("Usos máximos de este código")).toHaveAccessibleDescription(
      expect.stringContaining("Escribe un número entero de 1 en adelante"),
    );
    expect(d.getByLabelText("Termina (hora de La Paz)")).toHaveFocus();
    expect(api.updateCoupon).not.toHaveBeenCalled();
  });

  it("conflicto: banner dentro del diálogo, Guardar bloqueado, y «Recargar» cierra y refresca", async () => {
    api.updateCoupon.mockRejectedValue(new StaleVersionError());
    renderDialog();
    const d = await openEdit();
    const before = api.listCoupons.mock.calls.length;
    await userEvent.click(d.getByRole("button", { name: "Guardar cambios" }));
    expect(await d.findByText("Alguien más modificó esto")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listCoupons.mock.calls.length).toBeGreaterThan(before));
    await userEvent.click(d.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(dialogs()).toHaveLength(1));
  });

  it("un error de la base se muestra con su mensaje y el diálogo sigue abierto", async () => {
    api.updateCoupon.mockRejectedValue(
      new AppError(
        "validation",
        "Algún dato no cumple las reglas permitidas. Revisa los valores ingresados.",
      ),
    );
    renderDialog();
    const d = await openEdit();
    await userEvent.click(d.getByRole("button", { name: "Guardar cambios" }));
    expect(await d.findByText(/Algún dato no cumple las reglas/)).toBeInTheDocument();
    expect(dialogs()).toHaveLength(2);
  });

  it("Cancelar cierra sin guardar", async () => {
    renderDialog();
    const d = await openEdit();
    await userEvent.click(d.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(dialogs()).toHaveLength(1));
    expect(api.updateCoupon).not.toHaveBeenCalled();
  });
});

describe("Códigos: agregar a mano", () => {
  const openManual = async () => {
    await screen.findByText("Verano-10");
    await open("Agregar un código");
    return within(screen.getByRole("form", { name: "Agregar un código a mano" }));
  };

  it("abre el formulario con el foco en el código", async () => {
    renderDialog();
    const f = await openManual();
    expect(f.getByLabelText("Código")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Agregar un código" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("envía EXACTAMENTE el código recortado, con vigencia en UTC y tope; luego avisa, cierra y devuelve el foco", async () => {
    renderDialog();
    const f = await openManual();
    await userEvent.type(f.getByLabelText("Código"), "  Verano-20 ");
    fireEvent.change(f.getByLabelText("Empieza (hora de La Paz)"), {
      target: { value: "2030-01-01T08:00" },
    });
    fireEvent.change(f.getByLabelText("Termina (hora de La Paz)"), {
      target: { value: "2030-02-01T00:00" },
    });
    await userEvent.type(f.getByLabelText("Usos máximos de este código"), "1");
    await userEvent.click(f.getByRole("checkbox", { name: "Código encendido" }));
    await userEvent.click(f.getByRole("button", { name: "Agregar código" }));
    await waitFor(() =>
      expect(api.createCoupon).toHaveBeenCalledWith({
        discountId: "d1",
        code: "Verano-20",
        isActive: false,
        startsAt: "2030-01-01T12:00:00.000Z",
        endsAt: "2030-02-01T04:00:00.000Z",
        usageLimit: 1,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Código Verano-20 agregado.");
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Agregar un código a mano" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Agregar un código" })).toHaveFocus(),
    );
    expect(api.listCoupons.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("sin fechas ni tope envía nulls y encendido", async () => {
    renderDialog();
    const f = await openManual();
    await userEvent.type(f.getByLabelText("Código"), "NUEVO");
    await userEvent.click(f.getByRole("button", { name: "Agregar código" }));
    await waitFor(() =>
      expect(api.createCoupon).toHaveBeenCalledWith({
        discountId: "d1",
        code: "NUEVO",
        isActive: true,
        startsAt: null,
        endsAt: null,
        usageLimit: null,
      }),
    );
  });

  it("muestra cómo se comparará el código (VERANO-20 → VERAN020)", async () => {
    renderDialog();
    const f = await openManual();
    await userEvent.type(f.getByLabelText("Código"), "Verano-20");
    expect(
      f.getByText("Se compara como «VERAN020»: otro código que quede igual no se podrá crear."),
    ).toBeInTheDocument();
  });

  it.each([
    ["", "Escribe el código."],
    ["ab", "El código necesita al menos 4 letras o números (los guiones no cuentan)."],
    ["ab-c", "El código necesita al menos 4 letras o números (los guiones no cuentan)."],
    ["a".repeat(33), "El código admite hasta 32 caracteres."],
    ["ver ano", "Usa solo letras sin tilde, números y guion: sin espacios ni otros símbolos."],
    ["añejo", "Usa solo letras sin tilde, números y guion: sin espacios ni otros símbolos."],
    ["-abc", "El código debe empezar con una letra o un número."],
  ])("código %j → «%s», con el foco en el campo y sin enviar", async (text, message) => {
    renderDialog();
    const f = await openManual();
    if (text) await userEvent.type(f.getByLabelText("Código"), text);
    await userEvent.click(f.getByRole("button", { name: "Agregar código" }));
    expect(f.getByLabelText("Código")).toHaveAccessibleDescription(message);
    expect(f.getByLabelText("Código")).toHaveFocus();
    expect(api.createCoupon).not.toHaveBeenCalled();
  });

  it("avisa del duplicado NORMALIZADO con el mensaje de la base y dice con cuál choca; no envía", async () => {
    api.listCoupons.mockResolvedValue([coupon({ code: "VERANO10", codeNormalized: "VERAN010" })]);
    renderDialog();
    await screen.findByText("VERANO10");
    await open("Agregar un código");
    const f = within(screen.getByRole("form", { name: "Agregar un código a mano" }));
    await userEvent.type(f.getByLabelText("Código"), "Verano-10");
    await userEvent.click(f.getByRole("button", { name: "Agregar código" }));
    expect(f.getByLabelText("Código")).toHaveAccessibleDescription(
      "Ya existe un cupón con ese código (se comparan sin importar mayúsculas, espacios ni guiones). Choca con «VERANO10».",
    );
    expect(f.getByLabelText("Código")).toHaveFocus();
    expect(api.createCoupon).not.toHaveBeenCalled();
  });

  it("un duplicado que solo conoce la base (otro descuento) se muestra junto al código y deja reintentar", async () => {
    api.createCoupon.mockRejectedValue(
      new AppError(
        "conflict",
        "Ya existe un cupón con ese código (se comparan sin importar mayúsculas, espacios ni guiones).",
      ),
    );
    renderDialog();
    const f = await openManual();
    await userEvent.type(f.getByLabelText("Código"), "OTRO-DESCUENTO");
    await userEvent.click(f.getByRole("button", { name: "Agregar código" }));
    await waitFor(() =>
      expect(f.getByLabelText("Código")).toHaveAccessibleDescription(
        "Ya existe un cupón con ese código (se comparan sin importar mayúsculas, espacios ni guiones).",
      ),
    );
    expect(f.getByLabelText("Código")).toHaveFocus();
    expect(f.getByLabelText("Código")).toHaveValue("OTRO-DESCUENTO");
    expect(toast.success).not.toHaveBeenCalled();
    // Al corregir, el aviso se va.
    await userEvent.type(f.getByLabelText("Código"), "-2");
    expect(f.queryByText(/Ya existe un cupón/)).not.toBeInTheDocument();
  });

  it("otro error de la base se muestra en un aviso del formulario", async () => {
    api.createCoupon.mockRejectedValue(
      new AppError("validation", "solo un descuento que pide código puede tener cupones"),
    );
    renderDialog();
    const f = await openManual();
    await userEvent.type(f.getByLabelText("Código"), "NUEVO");
    await userEvent.click(f.getByRole("button", { name: "Agregar código" }));
    expect(await f.findByRole("alert")).toHaveTextContent(
      "solo un descuento que pide código puede tener cupones",
    );
  });

  it("un doble clic en Agregar envía una sola vez", async () => {
    let resolve: (c: Coupon) => void = () => undefined;
    api.createCoupon.mockReturnValue(new Promise<Coupon>((r) => (resolve = r)));
    renderDialog();
    const f = await openManual();
    await userEvent.type(f.getByLabelText("Código"), "UNICO-CLIC");
    await userEvent.dblClick(f.getByRole("button", { name: "Agregar código" }));
    expect(api.createCoupon).toHaveBeenCalledTimes(1);
    resolve(coupon({ id: "n" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("«Cerrar» y el botón de la barra cierran el formulario sin enviar", async () => {
    renderDialog();
    const f = await openManual();
    await userEvent.type(f.getByLabelText("Código"), "BORRADOR");
    await userEvent.click(f.getByRole("button", { name: "Cerrar" }));
    expect(
      screen.queryByRole("form", { name: "Agregar un código a mano" }),
    ).not.toBeInTheDocument();
    expect(api.createCoupon).not.toHaveBeenCalled();
    await open("Agregar un código");
    await open("Agregar un código");
    expect(
      screen.queryByRole("form", { name: "Agregar un código a mano" }),
    ).not.toBeInTheDocument();
  });
});

describe("Códigos: generar al azar", () => {
  const openGenerate = async () => {
    await screen.findByText("Verano-10");
    await open("Generar al azar");
    return within(screen.getByRole("region", { name: "Generar códigos al azar" }));
  };
  const fifty = Array.from({ length: 50 }, (_, i) => `VERANO-C${i}`);

  it("genera 50 códigos y envía los parámetros EXACTOS (cantidad, prefijo, largo y un solo uso = tope 1)", async () => {
    api.generateCouponCodes.mockResolvedValue(fifty);
    renderDialog();
    const g = await openGenerate();
    await userEvent.type(g.getByLabelText("Cantidad de códigos"), "50");
    await userEvent.type(g.getByLabelText("Prefijo (opcional)"), "VERANO");
    await userEvent.clear(g.getByLabelText("Largo de cada código"));
    await userEvent.type(g.getByLabelText("Largo de cada código"), "10");
    await userEvent.click(g.getByRole("checkbox", { name: "Un solo uso por código" }));
    await userEvent.click(g.getByRole("button", { name: "Generar códigos" }));
    await waitFor(() => expect(api.generateCouponCodes).toHaveBeenCalledTimes(1));
    expect(api.generateCouponCodes).toHaveBeenCalledWith({
      discountId: "d1",
      count: 50,
      prefix: "VERANO",
      length: 10,
      usageLimit: 1,
    });
    expect(toast.success).toHaveBeenCalledWith("Se generaron 50 códigos.");
    const heading = await screen.findByRole("heading", { name: "Se generaron 50 códigos" });
    expect(heading).toHaveFocus();
    const list = screen.getByRole("region", { name: "Códigos generados" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(fifty);
    expect(list).toHaveAttribute("tabindex", "0");
    // La lista de códigos del descuento se refrescó.
    expect(api.listCoupons.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("con los valores por defecto: sin prefijo, largo 8 y sin tope", async () => {
    api.generateCouponCodes.mockResolvedValue(["ABCD2345"]);
    renderDialog();
    const g = await openGenerate();
    await userEvent.type(g.getByLabelText("Cantidad de códigos"), "1");
    await userEvent.click(g.getByRole("button", { name: "Generar códigos" }));
    await waitFor(() =>
      expect(api.generateCouponCodes).toHaveBeenCalledWith({
        discountId: "d1",
        count: 1,
        prefix: null,
        length: 8,
        usageLimit: null,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Se generó 1 código.");
    expect(await screen.findByRole("heading", { name: "Se generó 1 código" })).toBeInTheDocument();
  });

  it("el foco arranca en la cantidad", async () => {
    renderDialog();
    const g = await openGenerate();
    expect(g.getByLabelText("Cantidad de códigos")).toHaveFocus();
  });

  it.each([
    ["", "8", "", "Cantidad de códigos", "Escribe cuántos códigos quieres."],
    ["0", "8", "", "Cantidad de códigos", "La cantidad debe ser un número entero de 1 a 500."],
    ["501", "8", "", "Cantidad de códigos", "La cantidad debe ser un número entero de 1 a 500."],
    [
      "5",
      "8",
      "AB-CD",
      "Prefijo (opcional)",
      "El prefijo admite solo letras sin tilde y números, hasta 8.",
    ],
    [
      "5",
      "8",
      "ABCDEFGHI",
      "Prefijo (opcional)",
      "El prefijo admite solo letras sin tilde y números, hasta 8.",
    ],
    ["5", "5", "", "Largo de cada código", "El largo debe ser un número entero de 6 a 20."],
    ["5", "21", "", "Largo de cada código", "El largo debe ser un número entero de 6 a 20."],
  ])(
    "cantidad %j, largo %j, prefijo %j → mensaje junto a «%s», con foco y sin enviar",
    async (count, length, prefix, label, message) => {
      renderDialog();
      const g = await openGenerate();
      if (count) await userEvent.type(g.getByLabelText("Cantidad de códigos"), count);
      await userEvent.clear(g.getByLabelText("Largo de cada código"));
      await userEvent.type(g.getByLabelText("Largo de cada código"), length);
      if (prefix) await userEvent.type(g.getByLabelText("Prefijo (opcional)"), prefix);
      await userEvent.click(g.getByRole("button", { name: "Generar códigos" }));
      expect(g.getByLabelText(label)).toHaveAccessibleDescription(expect.stringContaining(message));
      expect(g.getByLabelText(label)).toHaveFocus();
      expect(api.generateCouponCodes).not.toHaveBeenCalled();
    },
  );

  it("500 es el máximo aceptado", async () => {
    api.generateCouponCodes.mockResolvedValue(["AAAA2222"]);
    renderDialog();
    const g = await openGenerate();
    await userEvent.type(g.getByLabelText("Cantidad de códigos"), "500");
    await userEvent.click(g.getByRole("button", { name: "Generar códigos" }));
    await waitFor(() =>
      expect(api.generateCouponCodes).toHaveBeenCalledWith(expect.objectContaining({ count: 500 })),
    );
  });

  it("un error de la base se muestra en el formulario y no deja resultados", async () => {
    api.generateCouponCodes.mockRejectedValue(
      new AppError("not_found", "el descuento no existe o no pide código"),
    );
    renderDialog();
    const g = await openGenerate();
    await userEvent.type(g.getByLabelText("Cantidad de códigos"), "5");
    await userEvent.click(g.getByRole("button", { name: "Generar códigos" }));
    expect(await g.findByRole("alert")).toHaveTextContent(
      "el descuento no existe o no pide código",
    );
    expect(screen.queryByRole("region", { name: "Códigos generados" })).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un doble clic en Generar envía una sola vez", async () => {
    let resolve: (codes: string[]) => void = () => undefined;
    api.generateCouponCodes.mockReturnValue(new Promise<string[]>((r) => (resolve = r)));
    renderDialog();
    const g = await openGenerate();
    await userEvent.type(g.getByLabelText("Cantidad de códigos"), "3");
    await userEvent.dblClick(g.getByRole("button", { name: "Generar códigos" }));
    expect(api.generateCouponCodes).toHaveBeenCalledTimes(1);
    resolve(["AAAA2222", "BBBB3333", "CCCC4444"]);
    expect(
      await screen.findByRole("heading", { name: "Se generaron 3 códigos" }),
    ).toBeInTheDocument();
  });

  describe("copiar y descargar lo generado", () => {
    let blobs: Blob[];
    let clicked: { download: string; href: string }[];
    beforeEach(() => {
      blobs = [];
      clicked = [];
      Object.assign(URL, {
        createObjectURL: vi.fn((b: Blob) => {
          blobs.push(b);
          return "blob:http://localhost/x";
        }),
        revokeObjectURL: vi.fn(),
      });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        clicked.push({ download: this.download, href: this.getAttribute("href") ?? "" });
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      Reflect.deleteProperty(navigator, "clipboard");
    });
    const readText = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(
            new TextDecoder("utf-8", { ignoreBOM: true }).decode(reader.result as ArrayBuffer),
          );
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });
    const generateTwo = async (singleUse: boolean) => {
      api.generateCouponCodes.mockResolvedValue(["AB23CD45", "EF67GH89"]);
      renderDialog();
      const g = await openGenerate();
      await userEvent.type(g.getByLabelText("Cantidad de códigos"), "2");
      if (singleUse)
        await userEvent.click(g.getByRole("checkbox", { name: "Un solo uso por código" }));
      await userEvent.click(g.getByRole("button", { name: "Generar códigos" }));
      await screen.findByRole("heading", { name: "Se generaron 2 códigos" });
    };

    it("«Copiar todos» copia un código por línea y lo anuncia", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      await generateTwo(false);
      setClipboard(writeText);
      await open("Copiar todos");
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("AB23CD45\nEF67GH89"));
      expect(
        await screen.findByText("Copiaste 2 códigos.", { selector: "span" }),
      ).toBeInTheDocument();
    });

    it("el CSV de lo generado trae código, tope (1 si es de un solo uso) y vigencia vacía, con BOM y CRLF", async () => {
      await generateTwo(true);
      await open("Descargar CSV de lo generado");
      expect(clicked).toHaveLength(1);
      expect(clicked[0]?.download).toMatch(/^codigos-verano-2026-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(await readText(blobs[0] as Blob)).toBe(
        "﻿Código,Tope de usos,Empieza (hora de La Paz),Termina (hora de La Paz)\r\n" +
          "AB23CD45,1,,\r\nEF67GH89,1,,\r\n",
      );
      expect(toast.success).toHaveBeenCalledWith("Descargamos el archivo con 2 códigos.");
    });

    it("sin «un solo uso» la celda del tope va vacía", async () => {
      await generateTwo(false);
      await open("Descargar CSV de lo generado");
      expect(await readText(blobs[0] as Blob)).toContain("\r\nAB23CD45,,,\r\nEF67GH89,,,\r\n");
    });

    it("«Listo» oculta los códigos generados", async () => {
      await generateTwo(false);
      await open("Listo");
      expect(screen.queryByRole("region", { name: "Códigos generados" })).not.toBeInTheDocument();
    });

    it("al cerrar el diálogo los códigos generados desaparecen y no quedan en ningún almacenamiento ni en la consola", async () => {
      const spies = (["log", "info", "warn", "debug"] as const).map((m) => vi.spyOn(console, m));
      api.generateCouponCodes.mockResolvedValue(["SECRETO2", "SECRETO3"]);
      const view = renderDialog();
      const g = await openGenerate();
      await userEvent.type(g.getByLabelText("Cantidad de códigos"), "2");
      await userEvent.click(g.getByRole("button", { name: "Generar códigos" }));
      await screen.findByRole("heading", { name: "Se generaron 2 códigos" });
      for (const store of [localStorage, sessionStorage]) {
        expect(JSON.stringify({ ...store })).not.toContain("SECRETO");
      }
      expect(location.href).not.toContain("SECRETO");
      view.setOpen(false);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      view.setOpen(true);
      await screen.findByText("Verano-10");
      expect(screen.queryByText("SECRETO2")).not.toBeInTheDocument();
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRETO");
    });
  });
});

describe("Códigos: descargar todos", () => {
  let blobs: Blob[];
  let clicked: string[];
  beforeEach(() => {
    blobs = [];
    clicked = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blobs.push(b);
        return "blob:http://localhost/y";
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("baja TODOS los códigos del descuento (archivados incluidos) con tope y vigencia en hora de La Paz", async () => {
    api.listCoupons.mockResolvedValue([
      coupon({
        id: "a",
        code: "Verano-10",
        usageLimit: 3,
        startsAt: "2026-11-05T12:00:00Z",
        endsAt: "2026-12-01T04:00:00Z",
      }),
      coupon({ id: "b", code: "SIN-TOPE" }),
      coupon({ id: "c", code: "ARCH", archived: true, usageLimit: 1 }),
    ]);
    renderDialog();
    await screen.findByText("Verano-10");
    await open("Descargar todos (CSV)");
    expect(clicked[0]).toMatch(/^codigos-verano-2026-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(new TextDecoder("utf-8", { ignoreBOM: true }).decode(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blobs[0] as Blob);
    });
    expect(text).toBe(
      "﻿Código,Tope de usos,Empieza (hora de La Paz),Termina (hora de La Paz)\r\n" +
        "Verano-10,3,2026-11-05 08:00,2026-12-01 00:00\r\n" +
        "SIN-TOPE,,,\r\n" +
        "ARCH,1,,\r\n",
    );
    expect(toast.success).toHaveBeenCalledWith("Descargamos el archivo con 3 códigos.");
  });
});

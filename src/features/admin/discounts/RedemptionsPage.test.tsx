import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedemptionsPage } from "./RedemptionsPage";
import type { Discount, Redemption } from "./types";

const api = vi.hoisted(() => ({
  listRedemptions: vi.fn(),
  listDiscounts: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const red = (over: Partial<Redemption> = {}): Redemption => ({
  id: "r1",
  discountId: "d1",
  discountName: "Verano",
  couponId: null,
  couponCode: null,
  profileId: "p1",
  customerName: "Ana",
  customerEmail: "ana@correo.com",
  ownerType: "order",
  ownerId: "3f2a91bc-aaaa-bbbb-cccc-000000000001",
  amount: 10,
  currency: "BOB",
  status: "applied",
  createdAt: "2026-11-05T18:30:00Z",
  ...over,
});
const discount = (over: Partial<Discount> = {}): Discount => ({
  id: "d1",
  name: "Verano",
  kind: "percent",
  params: { kind: "percent", percent: 10, maxAmount: null },
  scope: "order",
  currency: "BOB",
  minOrderAmount: null,
  customerGroupId: null,
  requiresCoupon: false,
  stackableWithAutomatic: false,
  excludeSaleItems: false,
  usageLimitTotal: null,
  usageLimitPerCustomer: null,
  priority: 100,
  startsAt: null,
  endsAt: null,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-05T10:00:00+00:00",
  ...over,
});

const R1 = red({
  id: "r1",
  couponId: "c1",
  couponCode: "VERANO-10",
  customerName: "María Pérez",
  customerEmail: "maria@correo.com",
  ownerId: "3f2a91bc-aaaa-bbbb-cccc-000000000001",
  amount: 10,
  status: "applied",
  createdAt: "2026-11-05T18:30:00Z",
});
const R2 = red({
  id: "r2",
  discountId: "d2",
  discountName: "Navidad",
  profileId: null,
  customerName: null,
  customerEmail: null,
  ownerType: "cart",
  ownerId: "abcdef01-aaaa-bbbb-cccc-000000000002",
  amount: 5.5,
  status: "reserved",
  createdAt: "2026-11-06T13:00:00Z",
});
const R3 = red({
  id: "r3",
  customerName: "Luis Rojas",
  customerEmail: null,
  ownerType: "manual",
  ownerId: "99999999-aaaa-bbbb-cccc-000000000003",
  amount: 20,
  status: "reverted",
  createdAt: "2026-11-04T12:00:00Z",
});
const R4 = red({
  id: "r4",
  ownerId: "11111111-aaaa-bbbb-cccc-000000000004",
  amount: 3,
  currency: "USD",
  status: "applied",
  createdAt: "2026-11-03T12:00:00Z",
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RedemptionsPage />
    </QueryClientProvider>,
  );
}
const dataRows = () => screen.getAllByRole("row").slice(1);
const totals = () => {
  const box = screen.getByLabelText("Totales de lo que ves");
  const value = (label: string) => within(box).getByText(label).nextElementSibling?.textContent;
  return {
    records: value("Registros"),
    active: value("Usos vigentes"),
    amount: value("Total descontado"),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listRedemptions.mockResolvedValue([R1, R2, R3, R4]);
  api.listDiscounts.mockResolvedValue([
    discount({ id: "d1", name: "Verano" }),
    discount({ id: "d2", name: "Navidad" }),
    discount({ id: "d3", name: "Viejo", archived: true }),
  ]);
});

describe("Redenciones: estados y estructura", () => {
  it("un h2 «Redenciones» (el h1 es del marco) y una frase de qué es", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    expect(screen.getByRole("heading", { level: 2, name: "Redenciones" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText(/Solo puedes verlo y descargarlo; no se edita/)).toBeInTheDocument();
  });

  it("«Cargando…» mientras llegan los datos, y sin totales ni descarga posible", () => {
    api.listRedemptions.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Totales de lo que ves")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar CSV" })).toBeDisabled();
  });

  it("si falla la carga lo dice y «Reintentar» vuelve a pedirlo", async () => {
    api.listRedemptions.mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    expect(await screen.findByText("No pudimos cargar los datos")).toBeInTheDocument();
    expect(screen.queryByLabelText("Totales de lo que ves")).not.toBeInTheDocument();
    api.listRedemptions.mockResolvedValueOnce([R1]);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("María Pérez")).toBeInTheDocument();
    expect(api.listRedemptions).toHaveBeenCalledTimes(2);
  });

  it("vacío: explica cuándo aparecerán y no ofrece quitar filtros (no hay ninguno)", async () => {
    api.listRedemptions.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Todavía no hay redenciones/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar filtros" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar CSV" })).toBeDisabled();
    expect(screen.queryByLabelText("Totales de lo que ves")).not.toBeInTheDocument();
  });

  it("explica los tres estados", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    const help = screen.getByText("¿Qué significa cada estado?").closest("details") as HTMLElement;
    expect(
      within(help).getByText(/Reservado: la clienta lo usó al hacer su pedido/),
    ).toBeInTheDocument();
    expect(within(help).getByText(/Aplicado: el pedido se confirmó/)).toBeInTheDocument();
    expect(within(help).getByText(/Devuelto: el pedido no siguió adelante/)).toBeInTheDocument();
  });
});

describe("Redenciones: la tabla", () => {
  it("cada columna con su dato: fecha de La Paz, descuento, código, clienta (nombre y correo), pedido, monto y estado", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Fecha (hora de La Paz)",
      "Descuento",
      "Código usado",
      "Clienta",
      "Pedido",
      "Monto descontado",
      "Estado",
    ]);
    const row = within(screen.getByText("María Pérez").closest("tr") as HTMLElement);
    expect(row.getByText("5 nov 2026, 14:30")).toBeInTheDocument();
    expect(row.getByText("Verano")).toBeInTheDocument();
    expect(row.getByText("VERANO-10")).toBeInTheDocument();
    expect(row.getByText("maria@correo.com")).toBeInTheDocument();
    expect(row.getByText("Pedido 3f2a91bc")).toBeInTheDocument();
    expect(row.getByText("Bs 10,00")).toBeInTheDocument();
    expect(row.getByText("Aplicado")).toBeInTheDocument();
  });

  it("sin código dice «Sin código»; sin cuenta dice «Sin cuenta (invitada)»; el estado va en texto", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    const row = within(
      screen.getByText("Navidad", { selector: "span" }).closest("tr") as HTMLElement,
    );
    expect(row.getByText("Sin código")).toBeInTheDocument();
    expect(row.getByText("Sin cuenta (invitada)")).toBeInTheDocument();
    expect(row.getByText("Bolsa abcdef01")).toBeInTheDocument();
    expect(row.getByText("Reservado")).toBeInTheDocument();
    expect(row.getByText("Bs 5,50")).toBeInTheDocument();
  });

  it("una redención cuyo descuento ya no se puede leer no rompe la fila", async () => {
    api.listRedemptions.mockResolvedValue([red({ discountName: null })]);
    renderPage();
    expect(await screen.findByText("Descuento no disponible")).toBeInTheDocument();
  });

  it("orden por fecha DESCENDENTE por defecto; el encabezado de fecha lo invierte y lo anuncia", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    expect(dataRows().map((r) => within(r).getAllByRole("cell")[0]?.textContent)).toEqual([
      "6 nov 2026, 09:00",
      "5 nov 2026, 14:30",
      "4 nov 2026, 08:00",
      "3 nov 2026, 08:00",
    ]);
    const header = screen.getByRole("columnheader", { name: /Fecha/ });
    expect(header).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(within(header).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: /Fecha/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(dataRows().map((r) => within(r).getAllByRole("cell")[0]?.textContent)).toEqual([
      "3 nov 2026, 08:00",
      "4 nov 2026, 08:00",
      "5 nov 2026, 14:30",
      "6 nov 2026, 09:00",
    ]);
  });

  it("pide las últimas 1000 de TODOS los descuentos al abrir", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    expect(api.listRedemptions).toHaveBeenCalledWith(null);
  });
});

describe("Redenciones: totales visibles (calculados a mano)", () => {
  it("4 registros, 3 usos vigentes (el devuelto no cuenta) y Bs 10 + 5,50 = Bs 15,50 más $ 3,00", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    expect(totals()).toEqual({ records: "4", active: "3", amount: "Bs 15,50 · $ 3,00" });
    expect(screen.getByText("No cuenta los devueltos.")).toBeInTheDocument();
  });

  it("al filtrar por estado los totales siguen a lo que se ve", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "reverted");
    expect(dataRows()).toHaveLength(1);
    // Solo el devuelto de Bs 20: 1 registro, 0 usos vigentes y NADA descontado.
    expect(totals()).toEqual({ records: "1", active: "0", amount: "Bs 0,00" });
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "applied");
    expect(dataRows()).toHaveLength(2);
    expect(totals()).toEqual({ records: "2", active: "2", amount: "Bs 10,00 · $ 3,00" });
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "reserved");
    expect(totals()).toEqual({ records: "1", active: "1", amount: "Bs 5,50" });
  });

  it("0,10 + 0,20 es exactamente Bs 0,30", async () => {
    api.listRedemptions.mockResolvedValue([
      red({ id: "a", amount: 0.1 }),
      red({ id: "b", amount: 0.2 }),
    ]);
    renderPage();
    await screen.findAllByText("Ana");
    expect(totals().amount).toBe("Bs 0,30");
  });
});

describe("Redenciones: filtros", () => {
  it("el selector de descuentos lista «Todos», cada descuento por nombre y marca los archivados", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    const select = screen.getByLabelText("Descuento");
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Todos los descuentos", "Navidad", "Verano", "Viejo (archivado)"]),
    );
  });

  it("elegir un descuento pide SOLO ese descuento a la base", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    await waitFor(() =>
      expect(within(screen.getByLabelText("Descuento")).getAllByRole("option")).toHaveLength(4),
    );
    api.listRedemptions.mockResolvedValue([R2]);
    await userEvent.selectOptions(screen.getByLabelText("Descuento"), "d2");
    await waitFor(() => expect(api.listRedemptions).toHaveBeenLastCalledWith("d2"));
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(totals()).toEqual({ records: "1", active: "1", amount: "Bs 5,50" });
  });

  it("sin coincidencias avisa y «Quitar filtros» los limpia", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    api.listRedemptions.mockResolvedValue([]);
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "reserved");
    await userEvent.selectOptions(screen.getByLabelText("Descuento"), "d3").catch(() => undefined);
    expect(
      await screen.findByText("Ninguna redención coincide con los filtros."),
    ).toBeInTheDocument();
    api.listRedemptions.mockResolvedValue([R1, R2, R3, R4]);
    await userEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(screen.getByLabelText("Estado")).toHaveValue("all");
    expect(screen.getByLabelText("Descuento")).toHaveValue("all");
    expect(await screen.findByText("María Pérez")).toBeInTheDocument();
  });

  it("los filtros no se guardan en la dirección ni en el almacenamiento del navegador", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "applied");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("Redenciones: aviso del tope de la consulta", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => red({ id: `r${i}`, createdAt: "2026-11-05T18:30:00Z" }));

  it("con 1000 filas avisa «Mostrando las últimas 1000»", async () => {
    api.listRedemptions.mockResolvedValue(many(1000));
    renderPage();
    expect(await screen.findByText(/Mostrando las últimas 1000 redenciones/)).toBeInTheDocument();
    expect(screen.getByText(/filtra por descuento para ver las de uno solo/)).toBeInTheDocument();
  });
  it("con 999 no avisa", async () => {
    api.listRedemptions.mockResolvedValue(many(999));
    renderPage();
    await screen.findAllByText("Ana");
    expect(screen.queryByText(/Mostrando las últimas/)).not.toBeInTheDocument();
  });
  it("sigue avisando aunque el filtro de estado deje menos filas (el tope es de la consulta)", async () => {
    api.listRedemptions.mockResolvedValue(many(1000));
    renderPage();
    await screen.findByText(/Mostrando las últimas 1000 redenciones/);
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "reverted");
    expect(screen.getByText(/Mostrando las últimas 1000 redenciones/)).toBeInTheDocument();
  });
});

describe("Redenciones: exportar CSV", () => {
  let blobs: Blob[];
  let downloads: string[];
  beforeEach(() => {
    blobs = [];
    downloads = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blobs.push(b);
        return "blob:http://localhost/r";
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const readText = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(new TextDecoder("utf-8", { ignoreBOM: true }).decode(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  const HEADER =
    "﻿Fecha (hora de La Paz),Descuento,Código usado,Clienta,Correo,Origen,Referencia,Monto descontado,Moneda,Estado\r\n";

  it("descarga TODO lo filtrado, en el orden de la tabla, con el contenido exacto", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    await userEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^redenciones-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await readText(blobs[0] as Blob)).toBe(
      HEADER +
        "2026-11-06 09:00,Navidad,,,,Bolsa,abcdef01-aaaa-bbbb-cccc-000000000002,5.50,BOB,Reservado\r\n" +
        "2026-11-05 14:30,Verano,VERANO-10,María Pérez,maria@correo.com,Pedido,3f2a91bc-aaaa-bbbb-cccc-000000000001,10.00,BOB,Aplicado\r\n" +
        "2026-11-04 08:00,Verano,,Luis Rojas,,Manual,99999999-aaaa-bbbb-cccc-000000000003,20.00,BOB,Devuelto\r\n" +
        "2026-11-03 08:00,Verano,,Ana,ana@correo.com,Pedido,11111111-aaaa-bbbb-cccc-000000000004,3.00,USD,Aplicado\r\n",
    );
    expect(toast.success).toHaveBeenCalledWith("Descargamos el archivo con 4 redenciones.");
  });

  it("solo exporta lo que se ve con el filtro de estado y respeta el orden ascendente elegido", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "applied");
    await userEvent.click(
      within(screen.getByRole("columnheader", { name: /Fecha/ })).getByRole("button"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(await readText(blobs[0] as Blob)).toBe(
      HEADER +
        "2026-11-03 08:00,Verano,,Ana,ana@correo.com,Pedido,11111111-aaaa-bbbb-cccc-000000000004,3.00,USD,Aplicado\r\n" +
        "2026-11-05 14:30,Verano,VERANO-10,María Pérez,maria@correo.com,Pedido,3f2a91bc-aaaa-bbbb-cccc-000000000001,10.00,BOB,Aplicado\r\n",
    );
    expect(toast.success).toHaveBeenCalledWith("Descargamos el archivo con 2 redenciones.");
  });

  it("el nombre del archivo lleva el descuento elegido (sin tildes ni símbolos)", async () => {
    api.listDiscounts.mockResolvedValue([discount({ id: "d1", name: "¡Verano Mágico 2026!" })]);
    renderPage();
    await screen.findByText("María Pérez");
    await waitFor(() =>
      expect(within(screen.getByLabelText("Descuento")).getAllByRole("option")).toHaveLength(2),
    );
    api.listRedemptions.mockResolvedValue([R1]);
    await userEvent.selectOptions(screen.getByLabelText("Descuento"), "d1");
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(downloads[0]).toMatch(/^redenciones-verano-magico-2026-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("neutraliza fórmulas y escapa comillas, comas y saltos de línea en los datos de la clienta", async () => {
    api.listRedemptions.mockResolvedValue([
      red({
        customerName: '=HYPERLINK("http://x")',
        customerEmail: "+1@x.com",
        discountName: 'Oferta "2x1", ¡ya!\nhoy',
      }),
    ]);
    renderPage();
    await screen.findByText(/HYPERLINK/);
    await userEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    const csv = await readText(blobs[0] as Blob);
    expect(csv).toContain(`,"Oferta ""2x1"", ¡ya!\nhoy",,"'=HYPERLINK(""http://x"")",'+1@x.com,`);
  });

  it("sin filas el botón está apagado y no se descarga nada", async () => {
    api.listRedemptions.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/Todavía no hay redenciones/);
    const button = screen.getByRole("button", { name: "Descargar CSV" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(downloads).toHaveLength(0);
  });

  it("explica qué hacer si la hoja de cálculo lo muestra en una sola columna", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    expect(screen.getByText(/lo muestra todo en una sola columna/)).toBeInTheDocument();
  });
});

describe("Redenciones: accesibilidad táctil", () => {
  it("los botones y selectores miden al menos 44 px de alto", async () => {
    renderPage();
    await screen.findByText("María Pérez");
    expect(screen.getByRole("button", { name: "Descargar CSV" }).className).toContain("min-h-11");
    expect(screen.getByLabelText("Descuento").className).toContain("min-h-11");
    expect(screen.getByLabelText("Estado").className).toContain("min-h-11");
  });
});

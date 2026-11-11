import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaleVersionError } from "../lib/versioned";
import { MethodsPage } from "./MethodsPage";
import type { MethodRow } from "./types";

const api = vi.hoisted(() => ({
  listMethods: vi.fn(),
  updateMethod: vi.fn(),
  uploadQrImage: vi.fn(),
  qrPublicUrl: vi.fn((path: string) => `https://cdn.test/${path}`),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const method = (over: Partial<MethodRow> = {}): MethodRow => ({
  id: "m-qr",
  country: "BO",
  code: "qr_manual",
  provider: "manual_qr",
  name: "Pago con QR (ejemplo)",
  description: null,
  isActive: false,
  sortOrder: 5,
  maxAmount: null,
  windowMinutes: 1440,
  blockedForBlacklisted: false,
  accountDetails: null,
  qrImagePath: null,
  archivedAt: null,
  updatedAt: "2026-11-10T10:00:00+00:00",
  ...over,
});
const WHATSAPP = method({
  id: "m-wa",
  code: "whatsapp",
  provider: "whatsapp",
  name: "WhatsApp",
  isActive: true,
  windowMinutes: null,
  sortOrder: 10,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MethodsPage />
    </QueryClientProvider>,
  );
}
const PNG = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "qr.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  api.qrPublicUrl.mockImplementation((path: string) => `https://cdn.test/${path}`);
  api.listMethods.mockResolvedValue([method(), WHATSAPP]);
  api.updateMethod.mockResolvedValue("2026-11-10T11:00:00+00:00");
  URL.createObjectURL = vi.fn(() => "blob:qr");
  URL.revokeObjectURL = vi.fn();
});

const openQr = async () => {
  renderPage();
  await userEvent.click(
    await screen.findByRole("button", { name: "Editar el método Pago con QR (ejemplo)" }),
  );
  return screen.findByRole("dialog", { name: "Editar «Pago con QR (ejemplo)»" });
};

describe("MethodsPage", () => {
  it("lista los métodos con su tipo, su tiempo para pagar y si están encendidos", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Métodos de pago" });
    expect(within(table).getByText("Pago con QR (ejemplo)")).toBeInTheDocument();
    expect(within(table).getByText("24 horas")).toBeInTheDocument();
    expect(within(table).getByText("Sin límite")).toBeInTheDocument();
    expect(within(table).getByText("Encendido")).toBeInTheDocument();
    expect(within(table).getByText("Apagado")).toBeInTheDocument();
    expect(screen.getByText(/marcados «\(ejemplo\)» son de muestra/)).toBeInTheDocument();
  });

  it("no muestra el método de cobro QR automático (solo el QR manual, WhatsApp y los demás)", async () => {
    api.listMethods.mockResolvedValue([
      method(),
      method({
        id: "m-auto",
        code: "qr_auto",
        provider: "qr_api",
        name: "Pago con QR, confirmación automática (ejemplo)",
        sortOrder: 6,
      }),
      WHATSAPP,
    ]);
    renderPage();
    const table = await screen.findByRole("table", { name: "Métodos de pago" });
    expect(within(table).getByText("Pago con QR (ejemplo)")).toBeInTheDocument();
    expect(within(table).getByText("WhatsApp", { selector: "p" })).toBeInTheDocument();
    expect(within(table).queryByText(/confirmación automática/)).not.toBeInTheDocument();
    expect(within(table).queryByText("qr_auto")).not.toBeInTheDocument();
    expect(screen.queryByText(/autom/i)).not.toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3); // cabecera + 2 métodos
  });

  it("guardar sin tocar nada manda los mismos valores, con la versión que se leyó", async () => {
    const dialog = within(await openQr());
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateMethod).toHaveBeenCalledTimes(1));
    expect(api.updateMethod).toHaveBeenCalledWith("m-qr", "2026-11-10T10:00:00+00:00", {
      name: "Pago con QR (ejemplo)",
      description: null,
      account_details: null,
      window_minutes: 1440,
      max_amount: null,
      is_active: false,
      blocked_for_blacklisted: false,
      qr_image_path: null,
    });
    expect(toast.success).toHaveBeenCalledWith("Método actualizado.");
  });

  it("encender un QR sin imagen ni cuenta se explica junto a los campos y NO guarda", async () => {
    const dialog = within(await openQr());
    await userEvent.click(dialog.getByRole("checkbox", { name: /Encendido/ }));
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    expect(
      await dialog.findByText("Un método QR encendido necesita la imagen del QR."),
    ).toBeInTheDocument();
    expect(
      dialog.getByText("Un método QR encendido necesita los datos de tu cuenta."),
    ).toBeInTheDocument();
    expect(api.updateMethod).not.toHaveBeenCalled();
  });

  it("con la imagen nueva y la cuenta, la sube primero y guarda con su ruta", async () => {
    api.uploadQrImage.mockResolvedValue("qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png");
    const dialog = within(await openQr());
    await userEvent.click(dialog.getByRole("checkbox", { name: /Encendido/ }));
    await userEvent.type(dialog.getByLabelText("Datos de tu cuenta"), "Banco Ejemplo · 123-456");
    await userEvent.upload(dialog.getByLabelText("Imagen del QR"), PNG());
    expect(dialog.getByAltText("QR actual de tu banco")).toHaveAttribute("src", "blob:qr");
    expect(dialog.getByText(/Imagen nueva lista/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateMethod).toHaveBeenCalledTimes(1));
    expect(api.uploadQrImage).toHaveBeenCalledWith(expect.any(File), "png");
    expect(api.updateMethod.mock.calls[0]![2]).toMatchObject({
      is_active: true,
      account_details: "Banco Ejemplo · 123-456",
      qr_image_path: "qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png",
    });
  });

  it("un QR que ya tiene imagen se muestra y conserva su ruta al guardar otros cambios", async () => {
    api.listMethods.mockResolvedValue([
      method({
        qrImagePath: "qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png",
        accountDetails: "Banco",
        isActive: true,
      }),
    ]);
    const dialog = within(await openQr());
    expect(dialog.getByAltText("QR actual de tu banco")).toHaveAttribute(
      "src",
      "https://cdn.test/qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png",
    );
    await userEvent.clear(dialog.getByLabelText(/^Nombre/));
    await userEvent.type(dialog.getByLabelText(/^Nombre/), "Pago con QR");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateMethod).toHaveBeenCalledTimes(1));
    expect(api.uploadQrImage).not.toHaveBeenCalled();
    expect(api.updateMethod.mock.calls[0]![2]).toMatchObject({
      name: "Pago con QR",
      qr_image_path: "qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png",
    });
  });

  it("una imagen que no es PNG, JPG ni WebP, o de más de 2 MB, se explica y no se sube", async () => {
    const dialog = within(await openQr());
    const input = dialog.getByLabelText("Imagen del QR");
    await userEvent
      .setup({ applyAccept: false })
      .upload(input, new File(["<svg/>"], "qr.svg", { type: "image/svg+xml" }));
    expect(await dialog.findByText("La imagen debe ser PNG, JPG o WebP.")).toBeInTheDocument();
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "qr.png", { type: "image/png" });
    await userEvent.upload(input, big);
    expect(await dialog.findByText("La imagen pesa más de 2 MB.")).toBeInTheDocument();
    expect(api.uploadQrImage).not.toHaveBeenCalled();
  });

  it("la ventana fuera de 1 a 1440 minutos se explica y no guarda", async () => {
    const dialog = within(await openQr());
    await userEvent.clear(dialog.getByLabelText(/Minutos para pagar/));
    await userEvent.type(dialog.getByLabelText(/Minutos para pagar/), "2000");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    expect(
      await dialog.findByText("Escribe un número de minutos entre 1 y 1440."),
    ).toBeInTheDocument();
    expect(api.updateMethod).not.toHaveBeenCalled();
  });

  it("si otra persona lo cambió mientras tanto, avisa del conflicto y no pisa en silencio", async () => {
    api.updateMethod.mockRejectedValue(new StaleVersionError());
    const dialog = within(await openQr());
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    expect(await dialog.findByRole("alert")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("un método que no es QR (WhatsApp) no pide imagen ni cuenta", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Editar el método WhatsApp" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Editar «WhatsApp»" }));
    expect(dialog.queryByLabelText("Imagen del QR")).not.toBeInTheDocument();
    expect(dialog.queryByLabelText("Datos de tu cuenta")).not.toBeInTheDocument();
    // tampoco ofrece «Minutos para pagar»: un método que no es QR no vence (escribirle una ventana cancelaría sus pedidos solos)
    expect(dialog.queryByLabelText(/Minutos para pagar/)).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateMethod).toHaveBeenCalledTimes(1));
    expect(api.updateMethod.mock.calls[0]![2]).toMatchObject({
      window_minutes: null,
      qr_image_path: null,
    });
  });

  it("si falla la lectura ofrece reintentar", async () => {
    api.listMethods.mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table", { name: "Métodos de pago" })).toBeInTheDocument();
  });
});

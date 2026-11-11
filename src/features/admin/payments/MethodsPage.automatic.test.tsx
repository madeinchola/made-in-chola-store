import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MethodsPage } from "./MethodsPage";
import type { MethodRow } from "./types";

/**
 * Con el interruptor ENCENDIDO (`AUTOMATIC_QR_IN_UI = true`) el método de cobro QR automático aparece en Métodos de pago.
 * `MethodsPage.test.tsx` cubre el apagado (lo que se ve hoy).
 */
vi.mock("@/features/payments/automaticQr", () => ({ AUTOMATIC_QR_IN_UI: true }));

const api = vi.hoisted(() => ({
  listMethods: vi.fn(),
  updateMethod: vi.fn(),
  uploadQrImage: vi.fn(),
  qrPublicUrl: vi.fn((path: string) => `https://cdn.test/${path}`),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const method = (over: Partial<MethodRow> = {}): MethodRow => ({
  id: "m-auto",
  country: "BO",
  code: "qr_auto",
  provider: "qr_api",
  name: "Pago con QR, confirmación automática (ejemplo)",
  description: null,
  isActive: false,
  sortOrder: 6,
  maxAmount: null,
  windowMinutes: 1440,
  blockedForBlacklisted: false,
  accountDetails: null,
  qrImagePath: null,
  archivedAt: null,
  updatedAt: "2026-11-10T10:00:00+00:00",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.listMethods.mockResolvedValue([method()]);
});

describe("MethodsPage · con el QR automático encendido", () => {
  it("lista el método automático con su tipo «QR automático»", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MethodsPage />
      </QueryClientProvider>,
    );
    const table = await screen.findByRole("table", { name: "Métodos de pago" });
    expect(
      within(table).getByText("Pago con QR, confirmación automática (ejemplo)"),
    ).toBeInTheDocument();
    expect(within(table).getByText("QR automático")).toBeInTheDocument();
  });
});

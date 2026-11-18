import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CookieBanner, OPEN_PREFERENCES_EVENT } from "./CookieBanner";
import {
  acceptAll,
  hasConsent,
  readConsent,
  resetConsentForTests,
  saveConsent,
} from "./consentStore";

const catalog = vi.hoisted(() => ({ getStoreSettings: vi.fn() }));
vi.mock("@/features/catalog/catalogService", async (original) => ({
  ...(await original<typeof import("@/features/catalog/catalogService")>()),
  ...catalog,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const IDS = { analytics_meta_pixel_id: "1234567890123", analytics_ga4_id: "G-ABC123DEF4" };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CookieBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const banner = () => screen.queryByTestId("cookie-banner");
const settled = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

beforeEach(() => {
  vi.clearAllMocks();
  resetConsentForTests();
  catalog.getStoreSettings.mockResolvedValue(IDS);
});

describe("CookieBanner", () => {
  it("si la tienda no tiene ninguna herramienta opcional conectada, NO aparece (no hay nada que preguntar)", async () => {
    catalog.getStoreSettings.mockResolvedValue({
      analytics_meta_pixel_id: "",
      analytics_ga4_id: "",
    });
    mount();
    await settled();
    expect(banner()).not.toBeInTheDocument();
  });

  it("con herramientas conectadas y sin decisión aparece, con los tres botones y el enlace a la política, sin mover el foco", async () => {
    mount();
    const region = await screen.findByTestId("cookie-banner");
    expect(region).toHaveAccessibleName("Aviso de cookies");
    expect(within(region).getByRole("button", { name: "Aceptar todas" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Solo las necesarias" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Personalizar" })).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Política de cookies" })).toHaveAttribute(
      "href",
      "/legal/cookies",
    );
    // no es un modal: nada lo captura ni le roba el foco a la página
    expect(
      document.activeElement === document.body || !region.contains(document.activeElement),
    ).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("«Aceptar todas» guarda ambas categorías y el aviso desaparece", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Aceptar todas" }));
    expect(readConsent()).toMatchObject({ analytics: true, marketing: true });
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });

  it("«Solo las necesarias» rechaza lo opcional con la MISMA facilidad, y el aviso desaparece", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Solo las necesarias" }));
    expect(readConsent()).toMatchObject({ analytics: false, marketing: false });
    expect(hasConsent("analytics") || hasConsent("marketing")).toBe(false);
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });

  it("«Personalizar» abre las preferencias: las necesarias fijas y activas, las otras apagadas por omisión; guardar aplica la elección", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Personalizar" }));
    const dialog = await screen.findByRole("dialog", { name: "Preferencias de cookies" });
    const necessary = within(dialog).getByRole("checkbox", { name: "Necesarias" });
    expect(necessary).toBeChecked();
    expect(necessary).toBeDisabled();
    const analytics = within(dialog).getByRole("checkbox", { name: "Analítica" });
    const marketing = within(dialog).getByRole("checkbox", { name: "Marketing" });
    expect(analytics).not.toBeChecked();
    expect(marketing).not.toBeChecked();
    await userEvent.click(analytics);
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar preferencias" }));
    expect(readConsent()).toMatchObject({ analytics: true, marketing: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(banner()).not.toBeInTheDocument();
  });

  it("cerrar las preferencias sin guardar NO decide nada y el aviso sigue ahí", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Personalizar" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(readConsent()).toBeNull();
    expect(banner()).toBeInTheDocument();
  });

  it("quien ya decidió no ve el aviso, pero puede reabrir las preferencias (desde el pie) y las ve con lo elegido; retirar es posible", async () => {
    saveConsent({ analytics: true, marketing: true });
    mount();
    await settled();
    expect(banner()).not.toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT)));
    const dialog = await screen.findByRole("dialog", { name: "Preferencias de cookies" });
    expect(within(dialog).getByRole("checkbox", { name: "Analítica" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Marketing" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Solo las necesarias" }));
    expect(readConsent()).toMatchObject({ analytics: false, marketing: false });
  });

  it("en las preferencias, «Aceptar todas» también está a un clic", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Personalizar" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Aceptar todas" }));
    expect(readConsent()).toMatchObject({ analytics: true, marketing: true });
  });

  it("si ya había decidido, NO se vuelve a mostrar tras volver a entrar", async () => {
    acceptAll();
    mount();
    await settled();
    expect(banner()).not.toBeInTheDocument();
  });
});

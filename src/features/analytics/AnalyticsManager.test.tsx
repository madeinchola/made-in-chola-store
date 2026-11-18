import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptAll,
  rejectOptional,
  resetConsentForTests,
  saveConsent,
} from "@/features/consent/consentStore";
import { track } from "@/features/storefront/analytics/track";
import { AnalyticsManager } from "./AnalyticsManager";
import { ATTRIBUTION_KEY } from "./attribution";

const catalog = vi.hoisted(() => ({ getStoreSettings: vi.fn() }));
vi.mock("@/features/catalog/catalogService", async (original) => ({
  ...(await original<typeof import("@/features/catalog/catalogService")>()),
  ...catalog,
}));

const meta = vi.hoisted(() => ({ send: vi.fn(), pageView: vi.fn(), stop: vi.fn() }));
const ga = vi.hoisted(() => ({ send: vi.fn(), pageView: vi.fn(), stop: vi.fn() }));
const start = vi.hoisted(() => ({ meta: vi.fn(), ga: vi.fn() }));
vi.mock("./providers", () => ({
  startMetaPixel: (id: string) => {
    start.meta(id);
    return meta;
  },
  startGa4: (id: string) => {
    start.ga(id);
    return ga;
  },
}));

const IDS = { analytics_meta_pixel_id: "1234567890123", analytics_ga4_id: "G-ABC123DEF4" };
let navigate: ReturnType<typeof useNavigate>;
function Nav() {
  navigate = useNavigate();
  return null;
}

function mount(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AnalyticsManager />
        <Nav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const settled = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
const purchase = {
  name: "purchase",
  transactionId: "MIC-000123",
  value: 215,
  currency: "BOB",
  items: 2,
  shipping: 15,
  discount: 0,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  resetConsentForTests();
  window.localStorage.removeItem(ATTRIBUTION_KEY);
  catalog.getStoreSettings.mockResolvedValue(IDS);
});

describe("AnalyticsManager", () => {
  it("sin consentimiento NO arranca ningún proveedor, aunque haya IDs", async () => {
    mount();
    await settled();
    expect(start.meta).not.toHaveBeenCalled();
    expect(start.ga).not.toHaveBeenCalled();
    track(purchase);
    expect(meta.send).not.toHaveBeenCalled();
    expect(ga.send).not.toHaveBeenCalled();
  });

  it("con consentimiento pero SIN IDs configurados, tampoco arranca nada", async () => {
    catalog.getStoreSettings.mockResolvedValue({
      analytics_meta_pixel_id: "",
      analytics_ga4_id: "",
    });
    acceptAll();
    mount();
    await settled();
    expect(start.meta).not.toHaveBeenCalled();
    expect(start.ga).not.toHaveBeenCalled();
  });

  it("un ID inválido en los ajustes no arranca ni inyecta nada", async () => {
    catalog.getStoreSettings.mockResolvedValue({
      analytics_meta_pixel_id: "12');alert(1);//",
      analytics_ga4_id: "UA-1-1",
    });
    acceptAll();
    mount();
    await settled();
    expect(start.meta).not.toHaveBeenCalled();
    expect(start.ga).not.toHaveBeenCalled();
  });

  it("solo marketing: arranca Meta (con su vista de página) y NO GA4; los eventos van únicamente a Meta, ya traducidos", async () => {
    saveConsent({ analytics: false, marketing: true });
    mount();
    await waitFor(() => expect(start.meta).toHaveBeenCalledWith("1234567890123"));
    expect(start.ga).not.toHaveBeenCalled();
    expect(meta.pageView).toHaveBeenCalledTimes(1);
    track(purchase);
    expect(meta.send).toHaveBeenCalledWith({
      name: "Purchase",
      eventId: "purchase.MIC-000123",
      params: { num_items: 2, value: 215, currency: "BOB" },
    });
    expect(ga.send).not.toHaveBeenCalled();
    // un evento sin equivalente en Meta no se envía
    meta.send.mockClear();
    track({ name: "view_cart", items: 1, value: 10, currency: "BOB" });
    expect(meta.send).not.toHaveBeenCalled();
  });

  it("solo analítica: arranca GA4 con su ID y su vista de página, y los eventos van a GA4", async () => {
    saveConsent({ analytics: true, marketing: false });
    mount("/tienda");
    await waitFor(() => expect(start.ga).toHaveBeenCalledWith("G-ABC123DEF4"));
    expect(start.meta).not.toHaveBeenCalled();
    expect(ga.pageView).toHaveBeenCalledWith("/");
    track({ name: "search", query: "chaqueta", results: 3 });
    expect(ga.send).toHaveBeenCalledWith({ name: "search", params: { search_term: "chaqueta" } });
    expect(meta.send).not.toHaveBeenCalled();
  });

  it("aceptar DESPUÉS de cargar la página los arranca en ese momento", async () => {
    mount();
    await settled();
    expect(start.meta).not.toHaveBeenCalled();
    act(() => void acceptAll());
    await waitFor(() => expect(start.meta).toHaveBeenCalledTimes(1));
    expect(start.ga).toHaveBeenCalledTimes(1);
  });

  it("RETIRAR el consentimiento detiene los proveedores y los eventos dejan de salir", async () => {
    acceptAll();
    mount();
    await waitFor(() => expect(start.meta).toHaveBeenCalled());
    await waitFor(() => expect(start.ga).toHaveBeenCalled());
    act(() => void rejectOptional());
    expect(meta.stop).toHaveBeenCalledTimes(1);
    expect(ga.stop).toHaveBeenCalledTimes(1);
    meta.send.mockClear();
    ga.send.mockClear();
    track(purchase);
    expect(meta.send).not.toHaveBeenCalled();
    expect(ga.send).not.toHaveBeenCalled();
  });

  it("retirar solo marketing deja GA4 funcionando", async () => {
    acceptAll();
    mount();
    await waitFor(() => expect(start.ga).toHaveBeenCalled());
    act(() => void saveConsent({ analytics: true, marketing: false }));
    expect(meta.stop).toHaveBeenCalledTimes(1);
    expect(ga.stop).not.toHaveBeenCalled();
    track({ name: "search", query: "q", results: 1 });
    expect(ga.send).toHaveBeenCalledTimes(1);
  });

  it("cada cambio de página manda su vista a los proveedores activos (la primera ya la mandó el arranque)", async () => {
    acceptAll();
    mount("/");
    await waitFor(() => expect(start.ga).toHaveBeenCalled());
    meta.pageView.mockClear();
    ga.pageView.mockClear();
    act(() => void navigate("/tienda"));
    await waitFor(() => expect(ga.pageView).toHaveBeenCalledWith("/tienda"));
    expect(meta.pageView).toHaveBeenCalledTimes(1);
  });

  it("atribución: con analítica guarda el origen de la visita; al retirarla lo BORRA", async () => {
    acceptAll();
    window.history.replaceState({}, "", "/?utm_source=Facebook&utm_medium=cpc");
    mount("/");
    await waitFor(() => expect(window.localStorage.getItem(ATTRIBUTION_KEY)).toContain("facebook"));
    act(() => void rejectOptional());
    await waitFor(() => expect(window.localStorage.getItem(ATTRIBUTION_KEY)).toBeNull());
    window.history.replaceState({}, "", "/");
  });

  it("atribución: sin consentimiento de analítica NO se guarda nada", async () => {
    saveConsent({ analytics: false, marketing: true });
    window.history.replaceState({}, "", "/?utm_source=facebook");
    mount("/");
    await settled();
    expect(window.localStorage.getItem(ATTRIBUTION_KEY)).toBeNull();
    window.history.replaceState({}, "", "/");
  });
});

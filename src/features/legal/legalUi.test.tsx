import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAuth, WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { businessVariables } from "./businessVariables";
import { LegalPage } from "./LegalPage";
import { ReacceptGate } from "./ReacceptGate";
import type { LegalDocument } from "./types";

const api = vi.hoisted(() => ({
  fetchLegalDocument: vi.fn(),
  fetchLegalIndex: vi.fn(),
  fetchPendingLegal: vi.fn(),
  acceptLegalAgain: vi.fn(),
}));
vi.mock("./legalApi", async (original) => ({
  ...(await original<typeof import("./legalApi")>()),
  ...api,
}));
const catalog = vi.hoisted(() => ({ getStoreSettings: vi.fn() }));
vi.mock("@/features/catalog/catalogService", async (original) => ({
  ...(await original<typeof import("@/features/catalog/catalogService")>()),
  ...catalog,
}));

const doc = (over: Partial<LegalDocument> = {}): LegalDocument => ({
  kind: "terms",
  title: "Términos y condiciones",
  requiresAcceptance: true,
  version: 3,
  effectiveAt: "2026-11-20T04:00:00Z",
  changeNote: null,
  body: "## Quiénes somos\n\n{{razon_social}} con NIT {{nit}}.\n\n- Primero\n- Segundo\n\nEscríbenos a {{correo}}.",
  ...over,
});

function renderWith(ui: React.ReactElement, auth: AuthContextValue = fakeAuth(), path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WithAuth value={auth}>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  catalog.getStoreSettings.mockResolvedValue({
    business_name: "Made In Chola",
    legal_tax_id: "",
    contact_email: "hola@madeinchola.test",
  });
});

describe("businessVariables", () => {
  it("toma los datos del negocio de los ajustes públicos y deja vacío lo que falta o no es texto", () => {
    expect(
      businessVariables({ business_name: "Chola SRL", legal_address: "Calle 1", contact_phone: 5 }),
    ).toEqual({
      razon_social: "Chola SRL",
      nit: "",
      direccion: "Calle 1",
      correo: "",
      telefono: "",
    });
    expect(businessVariables(undefined).razon_social).toBe("");
  });
});

describe("LegalPage", () => {
  it("muestra el texto vigente con su versión y fecha (en hora de La Paz), los datos del negocio y avisa lo que falta", async () => {
    api.fetchLegalDocument.mockResolvedValue(doc());
    api.fetchLegalIndex.mockResolvedValue([]);
    renderWith(<LegalPage kind="terms" />);
    // el título sale de inmediato; lo demás espera a que llegue el texto
    await screen.findByTestId("legal-body");
    expect(
      screen.getByRole("heading", { level: 1, name: "Términos y condiciones" }),
    ).toBeInTheDocument();
    // 2026-11-20T04:00Z son las 00:00 del 20 en La Paz
    expect(
      screen.getByText("Versión 3 · vigente desde el 20 de noviembre de 2026"),
    ).toBeInTheDocument();
    // «##» del texto es un h3: el h1 es el título de la página y «#» queda como h2
    expect(screen.getByRole("heading", { level: 3, name: "Quiénes somos" })).toBeInTheDocument();
    const body = screen.getByTestId("legal-body");
    expect(body).toHaveTextContent("Made In Chola con NIT [dato por definir].");
    expect(body).toHaveTextContent("hola@madeinchola.test");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(api.fetchLegalDocument).toHaveBeenCalledWith("terms");
  });

  it("sin versión publicada lo dice y no inventa texto", async () => {
    api.fetchLegalDocument.mockResolvedValue(doc({ version: null, effectiveAt: null, body: null }));
    renderWith(<LegalPage kind="privacy" />);
    expect(
      await screen.findByText("Este documento todavía no está publicado."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("legal-body")).not.toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,follow",
    );
  });

  it("publicado se indexa; y enlaza a los otros cuatro documentos (no a sí mismo)", async () => {
    api.fetchLegalDocument.mockResolvedValue(doc());
    renderWith(<LegalPage kind="terms" />);
    await screen.findByTestId("legal-body");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index,follow",
    );
    const nav = screen.getByRole("navigation", { name: "Otros documentos" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/legal/privacidad",
      "/legal/cookies",
      "/legal/envios",
      "/legal/reembolsos",
    ]);
  });

  it("un error de red se avisa", async () => {
    api.fetchLegalDocument.mockRejectedValue(new Error("boom"));
    renderWith(<LegalPage kind="terms" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el documento.");
  });
});

describe("ReacceptGate", () => {
  const session = { access_token: "tok", user: { id: "u1" } } as unknown as Session;
  const signedIn = () => fakeAuth({ status: "authenticated", session });
  const index = [doc({ changeNote: "Ahora cobramos el envío por zonas." })];

  it("a quien no tiene sesión no le consulta ni le muestra nada", async () => {
    renderWith(<ReacceptGate />, fakeAuth());
    await new Promise((r) => setTimeout(r, 30));
    expect(api.fetchPendingLegal).not.toHaveBeenCalled();
    expect(api.fetchLegalIndex).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sin nada pendiente no abre el aviso", async () => {
    api.fetchPendingLegal.mockResolvedValue({});
    api.fetchLegalIndex.mockResolvedValue(index);
    renderWith(<ReacceptGate />, signedIn());
    await waitFor(() => expect(api.fetchPendingLegal).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.fetchLegalIndex).not.toHaveBeenCalled();
  });

  it("con una versión nueva muestra qué cambió, enlaza al texto y al aceptar manda las versiones con la sesión", async () => {
    api.fetchPendingLegal.mockResolvedValueOnce({ terms: 3 }).mockResolvedValue({});
    api.fetchLegalIndex.mockResolvedValue(index);
    api.acceptLegalAgain.mockResolvedValue({ ok: true });
    renderWith(<ReacceptGate />, signedIn());
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Términos y condiciones (versión 3): Ahora cobramos el envío por zonas.",
    );
    expect(screen.getByRole("link", { name: /Leer Términos y condiciones/ })).toHaveAttribute(
      "href",
      "/legal/terminos",
    );
    await userEvent.click(screen.getByRole("button", { name: "Acepto" }));
    await waitFor(() => expect(api.acceptLegalAgain).toHaveBeenCalledWith({ terms: 3 }, "tok"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("en el pago NO se abre (ahí ya está la casilla y el aviso taparía el formulario)", async () => {
    api.fetchPendingLegal.mockResolvedValue({ terms: 1, privacy: 1 });
    api.fetchLegalIndex.mockResolvedValue(index);
    renderWith(<ReacceptGate />, signedIn(), "/checkout");
    await waitFor(() => expect(api.fetchPendingLegal).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.fetchLegalIndex).not.toHaveBeenCalled();
  });

  it("«Ahora no» lo cierra sin aceptar nada", async () => {
    api.fetchPendingLegal.mockResolvedValue({ terms: 3, privacy: 2 });
    api.fetchLegalIndex.mockResolvedValue(index);
    renderWith(<ReacceptGate />, signedIn());
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.acceptLegalAgain).not.toHaveBeenCalled();
  });

  it("si el servidor dice que el texto volvió a cambiar (legal_outdated) lo explica, se queda abierto y vuelve a consultar", async () => {
    api.fetchPendingLegal.mockResolvedValueOnce({ terms: 3 }).mockResolvedValue({ terms: 4 });
    api.fetchLegalIndex.mockResolvedValue(index);
    api.acceptLegalAgain.mockResolvedValue({ ok: false, code: "legal_outdated" });
    renderWith(<ReacceptGate />, signedIn());
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Acepto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Actualizamos los textos legales/);
    await waitFor(() => expect(api.fetchPendingLegal).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog")).toHaveTextContent("versión 4");
  });

  it("un fallo al guardar se avisa y no cierra el aviso", async () => {
    api.fetchPendingLegal.mockResolvedValue({ privacy: 2 });
    api.fetchLegalIndex.mockResolvedValue([]);
    api.acceptLegalAgain.mockResolvedValue({ ok: false, code: "network" });
    renderWith(<ReacceptGate />, signedIn());
    await screen.findByRole("dialog");
    // sin índice el título sale de los textos fijos
    expect(screen.getByRole("dialog")).toHaveTextContent("Política de privacidad (versión 2)");
    await userEvent.click(screen.getByRole("button", { name: "Acepto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar tu aceptación");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

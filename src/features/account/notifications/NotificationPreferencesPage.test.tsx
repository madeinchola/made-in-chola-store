import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { asCustomer, customerProfile, WithAuth } from "@/test/auth-test-utils";
import type { StoredPreferences } from "./api";

const api = vi.hoisted(() => ({
  getNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
  DEFAULT_PREFERENCES: {
    channel: "auto",
    marketingEmail: false,
    marketingWhatsapp: false,
    consentAt: null,
  },
}));
vi.mock("./api", () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { NotificationPreferencesPage } from "./NotificationPreferencesPage";

vi.setConfig({ testTimeout: 20_000 });

const stored = (
  over: Partial<StoredPreferences["preferences"]> = {},
  exists = true,
): StoredPreferences => ({
  exists,
  preferences: {
    channel: "auto",
    marketingEmail: false,
    marketingWhatsapp: false,
    consentAt: null,
    ...over,
  },
});

const withBoth = (): AuthContextValue =>
  asCustomer({
    profile: { ...customerProfile, email: "ana@test.com", phone_e164: "+59170000001" },
  });

function renderPage(auth: AuthContextValue = withBoth()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WithAuth value={auth}>
        <MemoryRouter>
          <NotificationPreferencesPage />
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
  return { queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getNotificationPreferences.mockResolvedValue(stored({}, false));
});

describe("NotificationPreferencesPage", () => {
  it("explica que los avisos del pedido no se pueden apagar y ofrece elegir el canal", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Notificaciones" })).toBeInTheDocument();
    expect(await screen.findByText(/no se pueden desactivar/)).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "¿Por dónde prefieres recibirlos?" });
    expect(within(group).getByRole("radio", { name: "Automático" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Correo" })).toBeEnabled();
    expect(within(group).getByRole("radio", { name: "WhatsApp" })).toBeEnabled();
    expect(screen.getByText("Te escribimos a ana@test.com.")).toBeInTheDocument();
    expect(screen.getByText("Te escribimos al +59170000001.")).toBeInTheDocument();
  });

  it("no ofrece WhatsApp si no tiene teléfono, ni correo si no tiene correo, y dice qué hacer", async () => {
    renderPage(
      asCustomer({ profile: { ...customerProfile, email: "ana@test.com", phone_e164: null } }),
    );
    const group = await screen.findByRole("radiogroup");
    expect(within(group).getByRole("radio", { name: "WhatsApp" })).toBeDisabled();
    expect(
      screen.getByText("Agrega un teléfono en tu perfil para elegir esta opción."),
    ).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Correo" })).toBeEnabled();
  });

  it("una cuenta solo con teléfono: el correo no se puede elegir", async () => {
    renderPage(
      asCustomer({ profile: { ...customerProfile, email: null, phone_e164: "+59170000001" } }),
    );
    const group = await screen.findByRole("radiogroup");
    expect(within(group).getByRole("radio", { name: "Correo" })).toBeDisabled();
    expect(
      screen.getByText("Agrega un correo en tu perfil para elegir esta opción."),
    ).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Automático" })).toBeEnabled();
  });

  it("si prefería un medio que ya no tiene, se lo dice (no cree que sale por ahí)", async () => {
    api.getNotificationPreferences.mockResolvedValue(stored({ channel: "whatsapp" }));
    renderPage(
      asCustomer({ profile: { ...customerProfile, email: "ana@test.com", phone_e164: null } }),
    );
    expect(await screen.findByText(/No tienes whatsapp guardado/)).toBeInTheDocument();
  });

  it("las novedades arrancan APAGADAS (consentimiento explícito)", async () => {
    renderPage();
    expect(
      await screen.findByRole("checkbox", { name: "Quiero recibir novedades por correo" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Quiero recibir novedades por WhatsApp" }),
    ).not.toBeChecked();
    expect(screen.getByText(/Hoy no enviamos promociones/)).toBeInTheDocument();
    expect(screen.queryByText(/Aceptaste el/)).not.toBeInTheDocument();
  });

  it("con el consentimiento ya dado, muestra desde cuándo", async () => {
    api.getNotificationPreferences.mockResolvedValue(
      stored({ marketingEmail: true, consentAt: "2026-11-15T18:30:00Z" }),
    );
    renderPage();
    expect(
      await screen.findByRole("checkbox", { name: "Quiero recibir novedades por correo" }),
    ).toBeChecked();
    expect(screen.getByText(/Aceptaste el 15 de noviembre de 2026/)).toBeInTheDocument();
  });

  it("sin cambios no guarda nada", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Guardar preferencias" }));
    expect(api.saveNotificationPreferences).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith("No cambiaste nada.");
  });

  it("la PRIMERA vez crea la fila; guarda el canal y las novedades elegidos", async () => {
    api.saveNotificationPreferences.mockResolvedValue({
      channel: "whatsapp",
      marketingEmail: true,
      marketingWhatsapp: false,
      consentAt: "2026-11-16T10:00:00Z",
    });
    renderPage();
    await userEvent.click(await screen.findByRole("radio", { name: "WhatsApp" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Quiero recibir novedades por correo" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar preferencias" }));
    await waitFor(() => expect(api.saveNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(api.saveNotificationPreferences).toHaveBeenCalledWith(
      customerProfile.id,
      { channel: "whatsapp", marketingEmail: true, marketingWhatsapp: false },
      false,
    );
    expect(toast.success).toHaveBeenCalledWith("Preferencias guardadas.");
  });

  it("después de guardar, las siguientes veces ACTUALIZA (la fila ya existe) y no hay un falso «cambios»", async () => {
    api.saveNotificationPreferences.mockResolvedValue({
      channel: "email",
      marketingEmail: false,
      marketingWhatsapp: false,
      consentAt: null,
    });
    renderPage();
    await userEvent.click(await screen.findByRole("radio", { name: "Correo" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar preferencias" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("radio", { name: "Automático" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar preferencias" }));
    await waitFor(() => expect(api.saveNotificationPreferences).toHaveBeenCalledTimes(2));
    expect(api.saveNotificationPreferences.mock.calls[1]![2]).toBe(true);
  });

  it("cambiar SOLO las novedades por WhatsApp ya es un cambio que se puede guardar", async () => {
    api.saveNotificationPreferences.mockResolvedValue({
      channel: "auto",
      marketingEmail: false,
      marketingWhatsapp: true,
      consentAt: "2026-11-16T10:00:00Z",
    });
    renderPage();
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Quiero recibir novedades por WhatsApp" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar preferencias" }));
    await waitFor(() => expect(api.saveNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(api.saveNotificationPreferences.mock.calls[0]![1]).toEqual({
      channel: "auto",
      marketingEmail: false,
      marketingWhatsapp: true,
    });
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("quitar el consentimiento se guarda como apagado", async () => {
    api.getNotificationPreferences.mockResolvedValue(
      stored({ marketingEmail: true, marketingWhatsapp: true, consentAt: "2026-11-15T18:30:00Z" }),
    );
    api.saveNotificationPreferences.mockResolvedValue({
      channel: "auto",
      marketingEmail: false,
      marketingWhatsapp: false,
      consentAt: null,
    });
    renderPage();
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Quiero recibir novedades por correo" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Quiero recibir novedades por WhatsApp" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar preferencias" }));
    await waitFor(() => expect(api.saveNotificationPreferences).toHaveBeenCalled());
    expect(api.saveNotificationPreferences.mock.calls[0]![1]).toEqual({
      channel: "auto",
      marketingEmail: false,
      marketingWhatsapp: false,
    });
    expect(api.saveNotificationPreferences.mock.calls[0]![2]).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Aceptaste el/)).not.toBeInTheDocument());
  });

  it("si falla al guardar, lo dice en la pantalla y conserva lo que el usuario eligió", async () => {
    api.saveNotificationPreferences.mockRejectedValue(new Error("sin conexión"));
    renderPage();
    await userEvent.click(await screen.findByRole("radio", { name: "Correo" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar preferencias" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sin conexión");
    expect(screen.getByRole("radio", { name: "Correo" })).toBeChecked();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un doble clic no guarda dos veces", async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.saveNotificationPreferences.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await userEvent.click(await screen.findByRole("radio", { name: "Correo" }));
    const button = screen.getByRole("button", { name: "Guardar preferencias" });
    await userEvent.dblClick(button);
    expect(api.saveNotificationPreferences).toHaveBeenCalledTimes(1);
    finish({ channel: "email", marketingEmail: false, marketingWhatsapp: false, consentAt: null });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("si no cargan, ofrece reintentar", async () => {
    api.getNotificationPreferences
      .mockRejectedValueOnce(new Error("caído"))
      .mockResolvedValueOnce(stored({}, false));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByRole("radiogroup")).toBeInTheDocument();
  });
});

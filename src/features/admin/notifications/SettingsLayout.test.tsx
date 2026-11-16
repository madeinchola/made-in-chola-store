import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../config/api";
import type { SettingRow } from "../config/types";
import { StaleVersionError } from "../lib/versioned";
import * as apiModule from "./api";
import { NotificationsLayout } from "./NotificationsLayout";
import { SettingsPage } from "./SettingsPage";
import type { NotificationHealth } from "./types";

vi.mock("./api", async () => (await import("./apiMock")).createApiMock());
vi.mock("../config/api", () => ({ listSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
const api = vi.mocked(apiModule);
const config = vi.mocked(configApi);

function mount(node: React.ReactNode, path = "/admin/notificaciones/envio") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const health = (over: Partial<NotificationHealth> = {}): NotificationHealth => ({
  enabled: true,
  emailProvider: "none",
  fromEmailSet: false,
  whatsappMode: "manual",
  workerConfigured: false,
  due: 0,
  oldestDueMinutes: null,
  lastSentAt: null,
  recipients: 2,
  ...over,
});

const row = (key: string, value: unknown, type: SettingRow["valueType"] = "text"): SettingRow => ({
  key,
  value,
  valueType: type,
  isPublic: false,
  description: null,
  updatedAt: `v-${key}`,
});
const SETTINGS: SettingRow[] = [
  row("notify_enabled", true, "bool"),
  row("notify_email_provider", "none"),
  row("notify_from_name", "Made In Chola"),
  row("notify_from_email", ""),
  row("notify_reply_to", ""),
  row("notify_whatsapp_mode", "manual"),
  row("notify_max_attempts", 8, "int"),
  row("notify_backoff_seconds", 60, "int"),
  row("alert_recipients", ""),
];

beforeEach(() => {
  vi.clearAllMocks();
  api.notificationHealth.mockResolvedValue(health());
  api.notificationCounts.mockResolvedValue({});
  config.listSettings.mockResolvedValue(SETTINGS);
  config.saveSettings.mockResolvedValue([]);
});

describe("SettingsPage: envío y alertas", () => {
  it("muestra de un vistazo qué falta para que los correos salgan", async () => {
    mount(<SettingsPage />);
    const heading = await screen.findByRole("heading", { name: "Cómo está el envío" });
    const list = await waitFor(() => {
      const found = heading.closest("section")!.querySelector("ul");
      if (!found) throw new Error("la lista aún no cargó");
      return found;
    });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
    const item = (name: string) => within(list).getByText(name).closest("li") as HTMLElement;
    expect(within(item("Proveedor de correo")).getByText("Falta")).toBeInTheDocument();
    expect(
      within(item("Proveedor de correo")).getByText("Ninguno (los avisos esperan)"),
    ).toBeInTheDocument();
    expect(within(item("Correo remitente")).getByText("Sin configurar")).toBeInTheDocument();
    expect(within(item("Envío automático (worker)")).getByText("Falta")).toBeInTheDocument();
    expect(within(item("Notificaciones encendidas")).getByText("Listo")).toBeInTheDocument();
    expect(
      within(item("Quién recibe las alertas internas")).getByText("2 correos"),
    ).toBeInTheDocument();
    expect(within(item("Último correo enviado")).getByText("Ninguno todavía")).toBeInTheDocument();
  });

  it("con todo listo, cada fila dice «Listo» y la fecha del último envío", async () => {
    api.notificationHealth.mockResolvedValue(
      health({
        emailProvider: "resend",
        fromEmailSet: true,
        workerConfigured: true,
        lastSentAt: "2026-11-15T18:30:00Z",
      }),
    );
    mount(<SettingsPage />);
    const heading = await screen.findByRole("heading", { name: "Cómo está el envío" });
    const list = await waitFor(() => {
      const found = heading.closest("section")!.querySelector("ul");
      if (!found) throw new Error("la lista aún no cargó");
      return found;
    });
    await waitFor(() => expect(within(list).getAllByText("Listo")).toHaveLength(6));
    expect(within(list).getByText(/14:30/)).toBeInTheDocument();
  });

  it("carga los ajustes en el formulario, con WhatsApp fijo en modo manual", async () => {
    mount(<SettingsPage />);
    expect(await screen.findByLabelText("Nombre del remitente")).toHaveValue("Made In Chola");
    expect(screen.getByLabelText("Intentos antes de dar un aviso por perdido")).toHaveValue("8");
    expect(screen.getByLabelText("Espera inicial entre intentos (segundos)")).toHaveValue("60");
    expect(screen.getByLabelText("Proveedor de correo")).toHaveValue("none");
    expect(screen.getByRole("switch", { name: "Enviar notificaciones" })).toBeChecked();
    expect(screen.getByLabelText("WhatsApp")).toBeDisabled();
    expect(
      screen.queryByRole("option", { name: /Pruebas \(solo desarrollo\)/ }),
    ).not.toBeInTheDocument();
  });

  it("si el proveedor guardado es el de pruebas, lo muestra tal cual (no lo oculta)", async () => {
    config.listSettings.mockResolvedValue(
      SETTINGS.map((s) =>
        s.key === "notify_email_provider" ? row("notify_email_provider", "fake") : s,
      ),
    );
    mount(<SettingsPage />);
    expect(
      await screen.findByRole("option", { name: /Pruebas \(solo desarrollo\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Proveedor de correo")).toHaveValue("fake");
  });

  it("guarda SOLO lo que cambió, con su tipo y su versión", async () => {
    config.saveSettings.mockResolvedValue([
      { key: "notify_email_provider", ok: true, updatedAt: "n1" },
      { key: "notify_from_email", ok: true, updatedAt: "n2" },
      { key: "notify_max_attempts", ok: true, updatedAt: "n3" },
      { key: "notify_enabled", ok: true, updatedAt: "n4" },
      { key: "alert_recipients", ok: true, updatedAt: "n5" },
    ]);
    mount(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Proveedor de correo"), "resend");
    await userEvent.type(screen.getByLabelText("Correo remitente"), "  pedidos@chola.test ");
    const attempts = screen.getByLabelText("Intentos antes de dar un aviso por perdido");
    await userEvent.clear(attempts);
    await userEvent.type(attempts, "10");
    await userEvent.click(screen.getByRole("switch", { name: "Enviar notificaciones" }));
    await userEvent.type(
      screen.getByLabelText("Correos que reciben las alertas internas"),
      "a@b.co, c@d.co",
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(config.saveSettings).toHaveBeenCalledTimes(1));
    const changes = config.saveSettings.mock.calls[0]![0];
    expect(changes).toEqual([
      { key: "notify_enabled", value: false, updatedAt: "v-notify_enabled" },
      { key: "notify_email_provider", value: "resend", updatedAt: "v-notify_email_provider" },
      { key: "notify_from_email", value: "pedidos@chola.test", updatedAt: "v-notify_from_email" },
      { key: "notify_max_attempts", value: 10, updatedAt: "v-notify_max_attempts" },
      { key: "alert_recipients", value: "a@b.co, c@d.co", updatedAt: "v-alert_recipients" },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Ajustes guardados.");
  });

  it("un texto con espacios de más se guarda recortado (el navegador solo lo hace en los campos de correo)", async () => {
    config.saveSettings.mockResolvedValue([{ key: "notify_from_name", ok: true, updatedAt: "n1" }]);
    mount(<SettingsPage />);
    const name = await screen.findByLabelText("Nombre del remitente");
    await userEvent.clear(name);
    await userEvent.type(name, "   Chola Textil   ");
    await userEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(config.saveSettings).toHaveBeenCalledTimes(1));
    expect(config.saveSettings.mock.calls[0]![0]).toEqual([
      { key: "notify_from_name", value: "Chola Textil", updatedAt: "v-notify_from_name" },
    ]);
  });

  it("sin cambios no guarda nada y lo dice", async () => {
    mount(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Guardar ajustes" }));
    expect(config.saveSettings).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith("No cambiaste nada.");
  });

  it("un dato inválido se marca en su campo y bloquea el guardado", async () => {
    mount(<SettingsPage />);
    await userEvent.type(await screen.findByLabelText("Correo remitente"), "Sin-Arroba");
    await userEvent.clear(screen.getByLabelText("Intentos antes de dar un aviso por perdido"));
    await userEvent.type(screen.getByLabelText("Intentos antes de dar un aviso por perdido"), "99");
    await userEvent.type(
      screen.getByLabelText("Correos que reciben las alertas internas"),
      "bien@b.co, mal",
    );
    expect(
      screen.getByText("Escribe un correo válido, en minúsculas (o déjalo vacío)."),
    ).toBeInTheDocument();
    expect(screen.getByText("Debe ser un número entre 1 y 20.")).toBeInTheDocument();
    expect(screen.getByText("«mal» no es un correo válido.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    expect(config.saveSettings).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Corrige los campos marcados antes de guardar.");
  });

  it("si otra persona cambió un ajuste, no lo pisa y lo dice; si la base rechaza uno, muestra su mensaje", async () => {
    config.saveSettings.mockResolvedValue([
      { key: "notify_from_name", ok: false, stale: true, error: new Error("x") as never },
      {
        key: "notify_from_email",
        ok: false,
        stale: false,
        error: Object.assign(new Error("La base lo rechazó"), { code: "validation" }) as never,
      },
    ]);
    mount(<SettingsPage />);
    const name = await screen.findByLabelText("Nombre del remitente");
    await userEvent.clear(name);
    await userEvent.type(name, "Chola");
    await userEvent.type(screen.getByLabelText("Correo remitente"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const message = vi.mocked(toast.error).mock.calls[0]![0] as string;
    expect(message).toContain("La base lo rechazó");
    expect(message).toContain(new StaleVersionError().message);
  });

  it("explica, paso a paso, lo que debe hacer el dueño para activar los correos", async () => {
    mount(<SettingsPage />);
    const steps = (
      await screen.findByRole("heading", { name: /Para que los correos salgan/ })
    ).closest("section")!;
    expect(within(steps).getAllByRole("listitem")).toHaveLength(6);
    expect(within(steps).getByText(/RESEND_API_KEY/)).toBeInTheDocument();
    expect(within(steps).getByText(/notify_worker_url/)).toBeInTheDocument();
    expect(within(steps).getByText(/notify_worker_key/)).toBeInTheDocument();
    expect(within(steps).getByText(/SPF, DKIM y DMARC/)).toBeInTheDocument();
  });

  it("enlaza a los umbrales de stock, que viven en Ajustes", async () => {
    mount(<SettingsPage />);
    expect(await screen.findByRole("link", { name: /umbrales de stock/ })).toHaveAttribute(
      "href",
      "/admin/ajustes",
    );
  });

  it("si los ajustes no cargan, ofrece reintentar", async () => {
    config.listSettings.mockRejectedValueOnce(new Error("caído")).mockResolvedValueOnce(SETTINGS);
    mount(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Nombre del remitente")).toBeInTheDocument();
  });
});

describe("NotificationsLayout", () => {
  const layout = (path = "/admin/notificaciones") =>
    mount(
      <Routes>
        <Route path="/admin/notificaciones" element={<NotificationsLayout />}>
          <Route index element={<p>REGISTRO</p>} />
          <Route path="plantillas" element={<p>PLANTILLAS</p>} />
          <Route path="envio" element={<p>ENVÍO</p>} />
        </Route>
      </Routes>,
      path,
    );

  it("tiene un único título, las tres secciones como enlaces y marca la actual", async () => {
    layout();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Notificaciones" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Secciones de Notificaciones" });
    expect(within(nav).getByRole("link", { name: "Registro" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Plantillas" })).toHaveAttribute(
      "href",
      "/admin/notificaciones/plantillas",
    );
    expect(within(nav).getByRole("link", { name: "Envío y alertas" })).toHaveAttribute(
      "href",
      "/admin/notificaciones/envio",
    );
    expect(screen.getByText("REGISTRO")).toBeInTheDocument();
  });

  it("muestra POR QUÉ no están saliendo los avisos, con un enlace para arreglarlo", async () => {
    layout();
    const banner = await screen.findByRole("status");
    expect(
      within(banner).getByText("Ahora mismo no están saliendo todos los avisos:"),
    ).toBeInTheDocument();
    expect(
      within(banner).getByText(/Aún no hay un proveedor de correo conectado/),
    ).toBeInTheDocument();
    expect(within(banner).getByText(/Vault de Supabase/)).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: "Ver qué falta" })).toHaveAttribute(
      "href",
      "/admin/notificaciones/envio",
    );
  });

  it("con todo en orden, no hay aviso", async () => {
    api.notificationHealth.mockResolvedValue(
      health({ emailProvider: "resend", fromEmailSet: true, workerConfigured: true }),
    );
    layout();
    await screen.findByRole("heading", { level: 1, name: "Notificaciones" });
    await waitFor(() => expect(api.notificationHealth).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      screen.queryByText("Ahora mismo no están saliendo todos los avisos:"),
    ).not.toBeInTheDocument();
  });

  it("la pestaña Registro lleva la cuenta de lo que pide atención (por enviar a mano, perdidos y fallados)", async () => {
    api.notificationCounts.mockResolvedValue({
      manual: 3,
      dead: 1,
      failed: 2,
      sent: 50,
      pending: 9,
    });
    layout();
    expect(await screen.findByLabelText("6 avisos piden atención")).toHaveTextContent("6");
  });

  it("sin nada que atender, no hay insignia; con más de 99, dice 99+", async () => {
    api.notificationCounts.mockResolvedValue({ sent: 10 });
    const first = layout();
    await screen.findByRole("heading", { level: 1, name: "Notificaciones" });
    await waitFor(() => expect(api.notificationCounts).toHaveBeenCalled());
    expect(screen.queryByLabelText(/piden atención/)).not.toBeInTheDocument();
    first.unmount();
    api.notificationCounts.mockResolvedValue({ dead: 120 });
    layout();
    expect(await screen.findByLabelText("120 avisos piden atención")).toHaveTextContent("99+");
  });

  it("navega entre las secciones", async () => {
    layout();
    await userEvent.click(await screen.findByRole("link", { name: "Plantillas" }));
    expect(screen.getByText("PLANTILLAS")).toBeInTheDocument();
  });
});

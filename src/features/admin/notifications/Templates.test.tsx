import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "./api";
import { FunctionError } from "./apiMock";
import { StaleVersionError } from "../lib/versioned";
import { TemplateEditor } from "./TemplateEditor";
import { TemplatesPage } from "./TemplatesPage";
import type { PreviewResponse, TemplateRow } from "./types";

vi.mock("./api", async () => (await import("./apiMock")).createApiMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
const api = vi.mocked(apiModule);
const WAIT = { timeout: 3000 };

function mount(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const template = (over: Partial<TemplateRow> = {}): TemplateRow => ({
  id: 1,
  key: "order_shipped",
  channel: "email",
  locale: "es",
  audience: "customer",
  subject: "Tu pedido {{order_number}} va en camino",
  body: "Hola {{customer_name}},\n\ntu pedido salió.",
  ctaLabel: "Ver mi pedido",
  active: true,
  isDefault: true,
  updatedAt: "2026-11-16T10:00:00.123456+00:00",
  ...over,
});

const response = (over: Partial<PreviewResponse["preview"]> = {}): PreviewResponse => ({
  preview: {
    ok: true,
    errors: [],
    unknown: [],
    warnings: [],
    subject: "Tu pedido MIC-000123 va en camino",
    text: "Hola Ana,\n\ntu pedido salió.",
    html: "<!doctype html><html><body><p>Hola Ana</p></body></html>",
    length: 24,
    ...over,
  },
  variables: [
    { name: "customer_name", description: "Primer nombre de la clienta", audience: "customer" },
    { name: "order_number", description: "Número del pedido", audience: "both" },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.previewTemplate.mockResolvedValue(response());
});

describe("TemplatesPage", () => {
  it("agrupa las plantillas de la clienta y las alertas internas, con su estado y el aviso «Por revisar»", async () => {
    api.listTemplates.mockResolvedValue([
      template(),
      template({
        id: 2,
        key: "order_delivered",
        channel: "whatsapp",
        isDefault: false,
        active: false,
      }),
      template({ id: 3, key: "order_new", audience: "admin", isDefault: false }),
    ]);
    mount(<TemplatesPage />);
    expect(
      await screen.findByRole("heading", { name: "Avisos para tus clientas" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Alertas internas (para ti y tu equipo)" }),
    ).toBeInTheDocument();
    const customers = await screen.findByRole("table", {
      name: "Plantillas de los avisos para clientas",
    });
    expect(within(customers).getByText("Pedido enviado")).toBeInTheDocument();
    expect(within(customers).getByText("Por revisar")).toBeInTheDocument();
    expect(within(customers).getByText("Apagada")).toBeInTheDocument();
    expect(within(customers).getByText("WhatsApp")).toBeInTheDocument();
    const admin = await screen.findByRole("table", { name: "Plantillas de las alertas internas" });
    expect(within(admin).getByText("Nuevo pedido (alerta)")).toBeInTheDocument();
    expect(within(admin).queryByText("Por revisar")).not.toBeInTheDocument();
  });

  it("«Editar» abre el editor de esa plantilla y pide su vista previa", async () => {
    api.listTemplates.mockResolvedValue([template()]);
    mount(<TemplatesPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Editar «Pedido enviado» (Correo)" }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(api.previewTemplate).toHaveBeenCalledTimes(1), WAIT);
    expect(api.previewTemplate).toHaveBeenCalledWith({
      channel: "email",
      audience: "customer",
      subject: "Tu pedido {{order_number}} va en camino",
      body: "Hola {{customer_name}},\n\ntu pedido salió.",
      ctaLabel: "Ver mi pedido",
    });
  });

  it("sin plantillas por un fallo, ofrece reintentar", async () => {
    api.listTemplates.mockRejectedValueOnce(new Error("caído")).mockResolvedValueOnce([template()]);
    mount(<TemplatesPage />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Reintentar" }))[0]!);
    expect(await screen.findByText("Pedido enviado")).toBeInTheDocument();
  });
});

describe("TemplateEditor", () => {
  const open = (over: Partial<TemplateRow> = {}) => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    mount(<TemplateEditor template={template(over)} onClose={onClose} onSaved={onSaved} />);
    return { onClose, onSaved };
  };

  it("muestra los campos de un correo, el aviso del texto de arranque y la vista previa en un marco AISLADO", async () => {
    open();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Asunto")).toHaveValue(
      "Tu pedido {{order_number}} va en camino",
    );
    expect(within(dialog).getByLabelText("Mensaje")).toHaveValue(
      "Hola {{customer_name}},\n\ntu pedido salió.",
    );
    expect(within(dialog).getByLabelText("Texto del botón")).toHaveValue("Ver mi pedido");
    expect(within(dialog).getByText(/texto de arranque/)).toBeInTheDocument();
    const frame = await within(dialog).findByTitle("Vista previa del correo", {}, WAIT);
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("Hola Ana"));
    expect(within(dialog).getByText("Tu pedido MIC-000123 va en camino")).toBeInTheDocument();
  });

  it("no llama a la vista previa en cada tecla: espera a que dejes de escribir", async () => {
    open();
    await screen.findByTitle("Vista previa del correo", {}, WAIT);
    api.previewTemplate.mockClear();
    const body = screen.getByLabelText("Mensaje");
    await userEvent.type(body, " uno dos tres");
    await waitFor(() => expect(api.previewTemplate).toHaveBeenCalled(), WAIT);
    expect(api.previewTemplate).toHaveBeenCalledTimes(1);
    expect(api.previewTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.stringContaining("uno dos tres") }),
    );
  });

  it("una respuesta vieja que llega tarde NO pisa la vista previa más nueva", async () => {
    let slow: (value: PreviewResponse) => void = () => undefined;
    api.previewTemplate
      .mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)))
      .mockResolvedValueOnce(response({ subject: "VERSIÓN NUEVA" }));
    open();
    await waitFor(() => expect(api.previewTemplate).toHaveBeenCalledTimes(1), WAIT);
    await userEvent.type(screen.getByLabelText("Mensaje"), "!");
    await waitFor(() => expect(api.previewTemplate).toHaveBeenCalledTimes(2), WAIT);
    expect(await screen.findByText("VERSIÓN NUEVA")).toBeInTheDocument();
    slow(response({ subject: "VERSIÓN VIEJA" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("VERSIÓN VIEJA")).not.toBeInTheDocument();
    expect(screen.getByText("VERSIÓN NUEVA")).toBeInTheDocument();
  });

  it("ofrece las variables de la lista y las inserta donde está el cursor", async () => {
    open();
    const chip = await screen.findByRole(
      "button",
      { name: /Insertar la variable order_number/ },
      WAIT,
    );
    const area = screen.getByLabelText("Mensaje") as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(5, 5);
    await userEvent.click(chip);
    expect(area.value).toBe("Hola {{order_number}}{{customer_name}},\n\ntu pedido salió.");
  });

  it("un error de la vista previa (variable que no existe) se muestra y IMPIDE guardar", async () => {
    api.previewTemplate.mockResolvedValue(
      response({ ok: false, errors: ["unknown_variable"], unknown: ["customer_nmae"] }),
    );
    open();
    expect(await screen.findByText(/customer_nmae/, {}, WAIT)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));
    expect(
      await screen.findByText("Corrige los errores marcados antes de guardar."),
    ).toBeInTheDocument();
    expect(api.saveTemplate).not.toHaveBeenCalled();
  });

  it("no guarda antes de que termine la vista previa", async () => {
    api.previewTemplate.mockReturnValue(new Promise(() => undefined));
    open();
    await userEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));
    expect(
      await screen.findByText("Espera un momento a que termine la vista previa."),
    ).toBeInTheDocument();
    expect(api.saveTemplate).not.toHaveBeenCalled();
  });

  it("guarda lo escrito (con su versión), avisa y cierra", async () => {
    api.saveTemplate.mockResolvedValue("2026-11-16T11:00:00+00:00");
    const { onSaved } = open();
    await screen.findByTitle("Vista previa del correo", {}, WAIT);
    const subject = screen.getByLabelText("Asunto");
    await userEvent.clear(subject);
    await userEvent.type(subject, "Salió tu pedido");
    await screen.findByTitle("Vista previa del correo", {}, WAIT);
    await waitFor(
      () =>
        expect(api.previewTemplate).toHaveBeenLastCalledWith(
          expect.objectContaining({ subject: "Salió tu pedido" }),
        ),
      WAIT,
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));
    await waitFor(() => expect(api.saveTemplate).toHaveBeenCalledTimes(1));
    const [saved, draft] = api.saveTemplate.mock.calls[0]!;
    expect(saved.updatedAt).toBe("2026-11-16T10:00:00.123456+00:00");
    expect(draft).toEqual({
      subject: "Salió tu pedido",
      body: "Hola {{customer_name}},\n\ntu pedido salió.",
      ctaLabel: "Ver mi pedido",
      active: true,
    });
    expect(toast.success).toHaveBeenCalledWith("Plantilla guardada.");
    expect(onSaved).toHaveBeenCalled();
  });

  it("si otra persona la editó mientras tanto, no la pisa y lo explica", async () => {
    api.saveTemplate.mockRejectedValue(new StaleVersionError());
    const { onSaved } = open();
    await screen.findByTitle("Vista previa del correo", {}, WAIT);
    await userEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));
    expect(await screen.findByText(/Otra persona editó esta plantilla/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("apagarla la guarda apagada y avisa que mientras tanto no se envía", async () => {
    api.saveTemplate.mockResolvedValue("x");
    open();
    await screen.findByTitle("Vista previa del correo", {}, WAIT);
    await userEvent.click(screen.getByRole("switch", { name: "Esta plantilla está activa" }));
    expect(screen.getByText(/no se envía a nadie/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));
    await waitFor(() => expect(api.saveTemplate).toHaveBeenCalled());
    expect(api.saveTemplate.mock.calls[0]![1]).toEqual(expect.objectContaining({ active: false }));
  });

  describe("envío de prueba", () => {
    const click = async () =>
      userEvent.click(await screen.findByRole("button", { name: "Enviarme una prueba" }));

    it("manda la plantilla en edición y avisa que revises tu bandeja", async () => {
      api.sendTestEmail.mockResolvedValue({ sent: true });
      open();
      await screen.findByTitle("Vista previa del correo", {}, WAIT);
      await click();
      await waitFor(() =>
        expect(api.sendTestEmail).toHaveBeenCalledWith({
          channel: "email",
          audience: "customer",
          subject: "Tu pedido {{order_number}} va en camino",
          body: "Hola {{customer_name}},\n\ntu pedido salió.",
          ctaLabel: "Ver mi pedido",
        }),
      );
      expect(toast.success).toHaveBeenCalledWith(
        "Te enviamos la prueba. Revisa tu bandeja (y la de spam).",
      );
    });

    it("un correo de pruebas no sale al mundo real y lo dice", async () => {
      api.sendTestEmail.mockResolvedValue({ sent: false, reason: "reserved_domain" });
      open();
      await screen.findByTitle("Vista previa del correo", {}, WAIT);
      await click();
      await waitFor(() =>
        expect(toast.message).toHaveBeenCalledWith(
          "Ese correo es de pruebas: no sale al mundo real.",
        ),
      );
    });

    it("sin proveedor configurado, explica qué hacer (no un error genérico)", async () => {
      api.sendTestEmail.mockRejectedValue(new FunctionError("provider_not_configured", 409, "x"));
      open();
      await screen.findByTitle("Vista previa del correo", {}, WAIT);
      await click();
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("Aún no hay un proveedor de correo configurado"),
        ),
      );
    });

    it("un error desconocido muestra su mensaje", async () => {
      api.sendTestEmail.mockRejectedValue(new Error("algo raro"));
      open();
      await screen.findByTitle("Vista previa del correo", {}, WAIT);
      await click();
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("algo raro"));
    });

    it("no se ofrece si la plantilla tiene errores", async () => {
      api.previewTemplate.mockResolvedValue(response({ ok: false, errors: ["syntax"] }));
      open();
      await screen.findByText(/llave suelta/, {}, WAIT);
      expect(screen.getByRole("button", { name: "Enviarme una prueba" })).toBeDisabled();
    });
  });

  describe("WhatsApp", () => {
    const wa = {
      channel: "whatsapp" as const,
      subject: "",
      ctaLabel: null,
      body: "Hola {{customer_name}}, tu pedido salió.",
    };

    it("no pide asunto ni botón, no ofrece el envío de prueba y muestra el mensaje con su conteo", async () => {
      api.previewTemplate.mockResolvedValue(
        response({ subject: "", html: null, text: "Hola Ana, tu pedido salió.", length: 26 }),
      );
      open(wa);
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).queryByLabelText("Asunto")).not.toBeInTheDocument();
      expect(within(dialog).queryByLabelText("Texto del botón")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "Enviarme una prueba" }),
      ).not.toBeInTheDocument();
      expect(
        await within(dialog).findByText("Hola Ana, tu pedido salió.", {}, WAIT),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("26 de 1000 caracteres")).toBeInTheDocument();
      expect(within(dialog).queryByTitle("Vista previa del correo")).not.toBeInTheDocument();
    });

    it("avisa cuando WhatsApp recortaría el mensaje", async () => {
      api.previewTemplate.mockResolvedValue(
        response({
          ok: false,
          errors: ["body_too_long"],
          warnings: ["whatsapp_truncated"],
          html: null,
          subject: "",
        }),
      );
      open(wa);
      expect(await screen.findByText(/WhatsApp lo recortaría/, {}, WAIT)).toBeInTheDocument();
      expect(screen.getByText("El mensaje es demasiado largo.")).toBeInTheDocument();
    });
  });

  it("si no se puede preparar la vista previa, lo dice", async () => {
    api.previewTemplate.mockRejectedValue(new Error("sin red"));
    open();
    expect(
      await screen.findByText(/No se pudo preparar la vista previa/, {}, WAIT),
    ).toBeInTheDocument();
  });

  it("sin plantilla, no muestra nada", () => {
    mount(<TemplateEditor template={null} onClose={() => undefined} onSaved={() => undefined} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

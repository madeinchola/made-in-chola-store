import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { SettingsPage } from "./SettingsPage";
import type { SettingRow } from "./types";

const api = vi.hoisted(() => ({
  listSettings: vi.fn(),
  saveSettings: vi.fn(),
  listBanners: vi.fn(),
  createBanner: vi.fn(),
  updateBanner: vi.fn(),
  setBannerActive: vi.fn(),
  setBannerArchived: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// UnsavedChangesGuard exige un router de datos: aquí solo se comprueba qué `dirty` recibe.
vi.mock("../ui/UnsavedChangesGuard", () => ({
  UnsavedChangesGuard: ({ dirty }: { dirty: boolean }) => (
    <div data-testid="guard" data-dirty={String(dirty)} />
  ),
}));

const row = (
  key: string,
  value: unknown,
  valueType: SettingRow["valueType"],
  v = 1,
): SettingRow => ({
  key,
  value,
  valueType,
  isPublic: true,
  description: null,
  updatedAt: `2026-10-29T10:00:00.00000${v}+00:00`,
});

// Los 15 ajustes sembrados en la base, con sus valores reales.
const ROWS: SettingRow[] = [
  row("base_currency", "BOB", "text"),
  row("business_name", "Made In Chola", "text"),
  row("contact_email", "info@madeinchola.com", "email"),
  row("contact_phone", "+541140893614", "phone_e164"),
  row("default_out_of_stock_behavior", "sold_out", "text"),
  row("pdp_assistance_text", "Texto de ayuda", "text"),
  row("pdp_shipping_return_text", "Envíos y devoluciones", "text"),
  row("reservation_ttl_minutes", 10, "int"),
  row("social_facebook", "https://www.facebook.com/MIC.MADEINCHOLA", "url"),
  row("social_instagram", "https://www.instagram.com/madeinchola/", "url"),
  row("social_tiktok", "https://www.tiktok.com/@madeinchola", "url"),
  row("social_youtube", "https://www.youtube.com/@madeinchola9876", "url"),
  row("stock_critical_threshold", 2, "int"),
  row("stock_low_threshold", 5, "int"),
  row("whatsapp_orders", "+59167528677", "phone_e164"),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = async (label: string, text: string) => {
  const user = userEvent.setup();
  const el = field(label);
  await user.clear(el);
  if (text) await user.type(el, text);
};
const save = () => userEvent.setup().click(screen.getByRole("button", { name: "Guardar ajustes" }));
const lastChanges = () =>
  api.saveSettings.mock.lastCall?.[0] as { key: string; value: unknown; updatedAt: string }[];

beforeEach(() => {
  vi.clearAllMocks();
  api.listSettings.mockResolvedValue(ROWS);
  api.listBanners.mockResolvedValue([]);
  api.saveSettings.mockImplementation(async (changes: { key: string }[]) =>
    changes.map((c, i) => ({
      key: c.key,
      ok: true,
      updatedAt: `2026-10-30T10:00:00.00000${i + 1}+00:00`,
    })),
  );
});

describe("SettingsPage: carga y presentación", () => {
  it("agrupa los ajustes en las cuatro secciones, cada una con su título", async () => {
    renderPage();
    for (const name of [
      "Negocio y contacto",
      "Redes sociales",
      "Textos de la ficha de producto",
      "Inventario",
    ]) {
      expect(await screen.findByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("muestra el valor real de cada ajuste (los enteros como texto)", async () => {
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    expect(field("Nombre del negocio").value).toBe("Made In Chola");
    expect(field("Correo de contacto").value).toBe("info@madeinchola.com");
    expect(field("WhatsApp de pedidos").value).toBe("+59167528677");
    expect(field("Instagram").value).toBe("https://www.instagram.com/madeinchola/");
    expect(field("Umbral de stock bajo").value).toBe("5");
    expect(field("Umbral de stock crítico").value).toBe("2");
    expect(
      (screen.getByLabelText("Cuando no hay stock (valor por defecto)") as HTMLSelectElement).value,
    ).toBe("sold_out");
  });

  it("la moneda base y el tiempo de reserva son de solo lectura y lo dicen", async () => {
    renderPage();
    await screen.findByLabelText("Moneda base");
    expect(field("Moneda base")).toHaveAttribute("readonly");
    expect(field("Minutos que se retiene un carrito")).toHaveAttribute("readonly");
    expect(field("Moneda base").value).toBe("BOB");
    expect(field("Minutos que se retiene un carrito").value).toBe("10");
  });

  it("aclara que los umbrales son globales y que cada variante puede tener los suyos", async () => {
    renderPage();
    expect(await screen.findByText(/umbrales GLOBALES/)).toBeInTheDocument();
    expect(screen.getByText(/Cada variante puede tener los suyos propios/)).toBeInTheDocument();
  });

  it("un ajuste que el código conoce pero la base no tiene no se muestra (no se puede editar lo que no existe)", async () => {
    api.listSettings.mockResolvedValue(ROWS.filter((r) => r.key !== "social_tiktok"));
    renderPage();
    await screen.findByLabelText("Instagram");
    expect(screen.queryByLabelText("TikTok")).not.toBeInTheDocument();
  });

  it("estado de carga y error con reintento", async () => {
    const user = userEvent.setup();
    api.listSettings.mockRejectedValueOnce(new AppError("network", "x"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los ajustes.");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Nombre del negocio")).toBeInTheDocument();
  });
});

describe("SettingsPage: guardar", () => {
  it("sin cambios avisa y no llama a la base", async () => {
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await save();
    expect(toast.info).toHaveBeenCalledWith("No hay cambios para guardar.");
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it("guarda SOLO la clave que cambió, con la versión leída tal cual (microsegundos incluidos)", async () => {
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "Chola Store");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
    expect(lastChanges()).toEqual([
      { key: "business_name", value: "Chola Store", updatedAt: "2026-10-29T10:00:00.000001+00:00" },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Ajustes guardados.");
  });

  it("los enteros viajan como NÚMERO y el resto como texto", async () => {
    renderPage();
    await screen.findByLabelText("Umbral de stock bajo");
    await type("Umbral de stock bajo", "12");
    await type("Contacto".length ? "Correo de contacto" : "", "ventas@madeinchola.com");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    const changes = lastChanges();
    expect(changes.find((c) => c.key === "stock_low_threshold")?.value).toBe(12);
    expect(changes.find((c) => c.key === "contact_email")?.value).toBe("ventas@madeinchola.com");
  });

  it("normaliza antes de guardar: correo en minúsculas, teléfono sin separadores; y el campo muestra lo guardado", async () => {
    renderPage();
    await screen.findByLabelText("Correo de contacto");
    await type("Correo de contacto", "  Ventas@MadeInChola.COM ");
    await type("WhatsApp de pedidos", "+591 7123-4567");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    const changes = lastChanges();
    expect(changes.find((c) => c.key === "contact_email")?.value).toBe("ventas@madeinchola.com");
    expect(changes.find((c) => c.key === "whatsapp_orders")?.value).toBe("+59171234567");
    await waitFor(() => expect(field("Correo de contacto").value).toBe("ventas@madeinchola.com"));
    expect(field("WhatsApp de pedidos").value).toBe("+59171234567");
  });

  it("tras guardar, el siguiente guardado usa la versión NUEVA que devolvió la base (no la vieja)", async () => {
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "Uno");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("guard")).toHaveAttribute("data-dirty", "false"));
    await type("Nombre del negocio", "Dos");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2));
    expect(lastChanges()[0]?.updatedAt).toBe("2026-10-30T10:00:00.000001+00:00");
  });

  it("el cambio que solo difiere en espacios NO cuenta como cambio", async () => {
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "  Made In Chola  ");
    await save();
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId("guard")).toHaveAttribute("data-dirty", "false");
  });

  it("un doble clic no guarda dos veces (el botón se bloquea mientras guarda)", async () => {
    let finish: (v: unknown) => void = () => {};
    api.saveSettings.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "Chola Store");
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Guardar ajustes" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Guardando…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Guardando…" }));
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    finish([{ key: "business_name", ok: true, updatedAt: "x" }]);
    await screen.findByRole("button", { name: "Guardar ajustes" });
  });

  it("avisa al guardia de cambios sin guardar mientras haya algo distinto", async () => {
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    expect(screen.getByTestId("guard")).toHaveAttribute("data-dirty", "false");
    await type("Nombre del negocio", "Otro");
    expect(screen.getByTestId("guard")).toHaveAttribute("data-dirty", "true");
    await type("Nombre del negocio", "Made In Chola");
    expect(screen.getByTestId("guard")).toHaveAttribute("data-dirty", "false");
  });
});

describe("SettingsPage: validación (las reglas de la base)", () => {
  it.each([
    ["Correo de contacto", "sin-arroba", "Escribe un correo válido"],
    ["Correo de contacto", "a@b", "Escribe un correo válido"],
    ["WhatsApp de pedidos", "59167528677", "Escribe el teléfono con código de país"],
    ["WhatsApp de pedidos", "+123", "Escribe el teléfono con código de país"],
    ["Instagram", "http://instagram.com/x", "empiece con https://"],
    ["Instagram", "", "obligatorio"],
    ["Umbral de stock bajo", "-1", "número entero"],
    ["Umbral de stock bajo", "1.5", "número entero"],
  ])("%s = «%s» muestra su error y NO llama a la base", async (label, text, message) => {
    renderPage();
    await screen.findByLabelText(label);
    await type(label, text);
    await save();
    expect(await screen.findByText(new RegExp(message, "i"))).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(field(label)).toHaveAttribute("aria-invalid", "true");
  });

  it("el error de un campo aparece al salir de él, sin esperar a guardar", async () => {
    renderPage();
    await screen.findByLabelText("Correo de contacto");
    const user = userEvent.setup();
    await type("Correo de contacto", "mal");
    expect(screen.queryByText(/Escribe un correo válido/)).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText(/Escribe un correo válido/)).toBeInTheDocument();
  });

  it("el nombre del negocio es obligatorio", async () => {
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "   ");
    await save();
    expect(await screen.findByText("Este dato es obligatorio.")).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it("el umbral crítico no puede superar al bajo; igualdad sí", async () => {
    renderPage();
    await screen.findByLabelText("Umbral de stock crítico");
    await type("Umbral de stock crítico", "9");
    await save();
    expect(
      await screen.findByText("El umbral crítico (9) no puede superar al de aviso (5)."),
    ).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
    await type("Umbral de stock crítico", "5");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
  });

  it("un dato viejo inválido que NO se tocó no bloquea guardar otro cambio", async () => {
    api.listSettings.mockResolvedValue(
      ROWS.map((r) => (r.key === "contact_email" ? { ...r, value: "Mal Correo" } : r)),
    );
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "Chola Store");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    expect(lastChanges().map((c) => c.key)).toEqual(["business_name"]);
  });

  it("el foco va al primer campo con error", async () => {
    renderPage();
    await screen.findByLabelText("Correo de contacto");
    await type("Correo de contacto", "mal");
    await save();
    await waitFor(() => expect(field("Correo de contacto")).toHaveFocus());
  });
});

describe("SettingsPage: orden de guardado de los umbrales", () => {
  it("subir ambos (5/2 → 20/6): primero el de aviso, luego el crítico", async () => {
    renderPage();
    await screen.findByLabelText("Umbral de stock bajo");
    await type("Umbral de stock bajo", "20");
    await type("Umbral de stock crítico", "6");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    expect(lastChanges().map((c) => c.key)).toEqual([
      "stock_low_threshold",
      "stock_critical_threshold",
    ]);
  });

  it("bajar ambos (5/2 → 1/1): primero el crítico, luego el de aviso", async () => {
    renderPage();
    await screen.findByLabelText("Umbral de stock bajo");
    await type("Umbral de stock bajo", "1");
    await type("Umbral de stock crítico", "1");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    expect(lastChanges().map((c) => c.key)).toEqual([
      "stock_critical_threshold",
      "stock_low_threshold",
    ]);
  });
});

describe("SettingsPage: errores del servidor", () => {
  it("un fallo de una clave se muestra en SU campo, las demás se guardan, y lo fallido sigue como pendiente", async () => {
    api.saveSettings.mockResolvedValue([
      { key: "business_name", ok: true, updatedAt: "2026-10-30T10:00:00.000001+00:00" },
      {
        key: "contact_email",
        ok: false,
        stale: false,
        error: new AppError("validation", "el ajuste debe ser un correo válido"),
      },
    ]);
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "Chola Store");
    await type("Correo de contacto", "ventas@madeinchola.com");
    await save();
    expect(
      await screen.findByText(/No se pudo guardar: el ajuste debe ser un correo válido/),
    ).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Se guardaron 1 ajustes, pero 1 no"),
    );
    expect(field("Correo de contacto")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("guard")).toHaveAttribute("data-dirty", "true"); // el correo sigue sin guardar
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("editar el campo con error retira el aviso del servidor (ya no corresponde)", async () => {
    api.saveSettings.mockResolvedValue([
      {
        key: "contact_email",
        ok: false,
        stale: false,
        error: new AppError("validation", "rechazado"),
      },
    ]);
    renderPage();
    await screen.findByLabelText("Correo de contacto");
    await type("Correo de contacto", "ventas@madeinchola.com");
    await save();
    await screen.findByText(/rechazado/);
    await type("Correo de contacto", "otro@madeinchola.com");
    expect(screen.queryByText(/rechazado/)).not.toBeInTheDocument();
  });

  it("conflicto de edición: avisa en su campo, muestra el banner y 'Recargar' relee y reinicia el formulario", async () => {
    api.saveSettings.mockResolvedValue([
      { key: "business_name", ok: false, stale: true, error: new AppError("conflict", "x") },
    ]);
    renderPage();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "Mi versión");
    await save();
    const alert = await screen.findByText("Alguien más modificó esto");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Otra persona cambió este ajuste/)).toBeInTheDocument();

    api.listSettings.mockResolvedValue(
      ROWS.map((r) =>
        r.key === "business_name" ? { ...r, value: "Versión de la otra persona" } : r,
      ),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() =>
      expect(field("Nombre del negocio").value).toBe("Versión de la otra persona"),
    );
    expect(screen.queryByText("Alguien más modificó esto")).not.toBeInTheDocument();
  });
});

describe("SettingsPage: banner dentro de la pantalla", () => {
  it("incluye la sección del banner de noticias", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Banner de noticias" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo banner" })).toBeInTheDocument();
  });

  it("los ajustes y el banner son independientes: abrir el diálogo no marca cambios sin guardar", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo banner" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("guard")).toHaveAttribute("data-dirty", "false");
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Mensaje"), { target: { value: "x" } });
    expect(screen.getByTestId("guard")).toHaveAttribute("data-dirty", "false");
  });
});

describe("SettingsPage: volver a la pantalla tras guardar", () => {
  it("se ven los valores GUARDADOS y su versión nueva (no una caché vieja), y editar de nuevo no da falso conflicto", async () => {
    const NEW_VERSION = "2026-10-30T10:00:00.000009+00:00";
    let rows = ROWS;
    api.listSettings.mockImplementation(async () => rows);
    api.saveSettings.mockImplementation(async (changes: { key: string; value: unknown }[]) => {
      rows = rows.map((r) => {
        const c = changes.find((x) => x.key === r.key);
        return c ? { ...r, value: c.value, updatedAt: NEW_VERSION } : r;
      });
      return changes.map((c) => ({ key: c.key, ok: true, updatedAt: NEW_VERSION }));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mount = () =>
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <SettingsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );

    const first = mount();
    await screen.findByLabelText("Nombre del negocio");
    await type("Nombre del negocio", "Made In Chola QA");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
    first.unmount(); // el admin se va a otra pantalla…

    mount(); // …y vuelve a Ajustes
    await waitFor(() => expect(field("Nombre del negocio").value).toBe("Made In Chola QA"));

    // editar esa misma clave otra vez usa la versión NUEVA (con la vieja sería un falso conflicto)
    await type("Nombre del negocio", "Made In Chola QA 2");
    await save();
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2));
    expect(lastChanges()).toEqual([
      { key: "business_name", value: "Made In Chola QA 2", updatedAt: NEW_VERSION },
    ]);
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { BannersSection } from "./BannersSection";
import type { Banner } from "./types";

const api = vi.hoisted(() => ({
  listBanners: vi.fn(),
  createBanner: vi.fn(),
  updateBanner: vi.fn(),
  setBannerActive: vi.fn(),
  setBannerArchived: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Fechas relativas al reloj real de la prueba: lejos en el pasado y en el futuro para que nunca dependan de "hoy".
const PAST = "2000-01-01T00:00:00+00:00";
const FUTURE = "2099-01-01T00:00:00+00:00";

const banner = (over: Partial<Banner> = {}): Banner => ({
  id: "b1",
  message: "Envío gratis esta semana",
  linkUrl: null,
  isActive: true,
  startsAt: null,
  endsAt: null,
  archived: false,
  createdAt: "2026-10-01T10:00:00+00:00",
  updatedAt: "2026-10-01T10:00:00.123456+00:00",
  ...over,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BannersSection />
    </QueryClientProvider>,
  );
}

const rowOf = (message: string) => screen.getByText(message).closest("tr") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.listBanners.mockResolvedValue([banner()]);
  api.createBanner.mockResolvedValue(banner({ id: "nuevo" }));
  api.updateBanner.mockResolvedValue("v2");
  api.setBannerActive.mockResolvedValue("v2");
  api.setBannerArchived.mockResolvedValue("v2");
});

describe("BannersSection: lista y estados", () => {
  it("muestra cada banner con su estado calculado", async () => {
    api.listBanners.mockResolvedValue([
      banner({ id: "1", message: "Banner uno" }),
      banner({ id: "2", message: "Banner dos", startsAt: FUTURE }),
      banner({ id: "3", message: "Banner tres", endsAt: PAST }),
      banner({ id: "4", message: "Banner cuatro", isActive: false }),
      banner({ id: "5", message: "Banner cinco", archived: true }),
    ]);
    renderSection();
    await screen.findByText("Banner uno");
    expect(within(rowOf("Banner uno")).getByText("Vigente")).toBeInTheDocument();
    expect(within(rowOf("Banner dos")).getByText("Programado")).toBeInTheDocument();
    expect(within(rowOf("Banner tres")).getByText("Vencido")).toBeInTheDocument();
    expect(within(rowOf("Banner cuatro")).getByText("Inactivo")).toBeInTheDocument();
    expect(within(rowOf("Banner cinco")).getByText("Archivado")).toBeInTheDocument();
  });

  it("marca SOLO el banner que la tienda muestra (el vigente que empezó más recientemente)", async () => {
    api.listBanners.mockResolvedValue([
      banner({ id: "viejo", message: "Viejo", startsAt: "2020-01-01T00:00:00+00:00" }),
      banner({ id: "nuevo", message: "Nuevo", startsAt: "2025-01-01T00:00:00+00:00" }),
      banner({ id: "futuro", message: "Futuro", startsAt: FUTURE }),
    ]);
    renderSection();
    await screen.findByText("Nuevo");
    expect(within(rowOf("Nuevo")).getByText("Se muestra ahora en la tienda")).toBeInTheDocument();
    expect(
      within(rowOf("Viejo")).queryByText("Se muestra ahora en la tienda"),
    ).not.toBeInTheDocument();
    expect(
      within(rowOf("Futuro")).queryByText("Se muestra ahora en la tienda"),
    ).not.toBeInTheDocument();
  });

  it("sin ningún banner vigente lo dice (la tienda no muestra ninguno)", async () => {
    api.listBanners.mockResolvedValue([banner({ isActive: false })]);
    renderSection();
    expect(await screen.findByText(/no hay ningún banner vigente/)).toBeInTheDocument();
  });

  it("explica que solo se muestra un banner a la vez", async () => {
    renderSection();
    expect(await screen.findByText(/Solo se muestra UN banner a la vez/)).toBeInTheDocument();
  });

  it("muestra enlace y vigencia legibles (sin enlace / siempre)", async () => {
    api.listBanners.mockResolvedValue([
      banner({
        id: "a",
        message: "Con enlace",
        linkUrl: "/novedades",
        startsAt: "2026-10-30T02:00:00+00:00",
      }),
      banner({ id: "b", message: "Sin nada" }),
    ]);
    renderSection();
    await screen.findByText("Con enlace");
    expect(within(rowOf("Con enlace")).getByText("/novedades")).toBeInTheDocument();
    expect(within(rowOf("Con enlace")).getByText(/Desde 29\/10\/26.*22:00/)).toBeInTheDocument(); // hora de La Paz
    expect(within(rowOf("Sin nada")).getByText("Sin enlace")).toBeInTheDocument();
    expect(within(rowOf("Sin nada")).getByText("Siempre")).toBeInTheDocument();
  });

  it("sin banners: estado vacío; con error: reintento", async () => {
    api.listBanners.mockResolvedValueOnce([]);
    const { unmount } = renderSection();
    expect(await screen.findByText("Todavía no hay banners.")).toBeInTheDocument();
    unmount();
    api.listBanners.mockRejectedValueOnce(new AppError("network", "x"));
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los datos");
  });
});

describe("BannersSection: crear y editar", () => {
  const openCreate = async (fresh = true) => {
    if (fresh) renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo banner" }));
    return { user, dialog: within(await screen.findByRole("dialog", { name: "Nuevo banner" })) };
  };

  it("crea un banner: manda el mensaje recortado y NULL en lo que quedó vacío; refresca la lista y avisa", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Mensaje"), "  ¡Nuevos ingresos!  ");
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    await waitFor(() => expect(api.createBanner).toHaveBeenCalledTimes(1));
    expect(api.createBanner).toHaveBeenCalledWith({
      message: "¡Nuevos ingresos!",
      link_url: null,
      starts_at: null,
      ends_at: null,
      is_active: true,
    });
    expect(toast.success).toHaveBeenCalledWith("Banner creado.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listBanners.mock.calls.length).toBeGreaterThan(1); // la lista se volvió a pedir
  });

  it("las fechas se escriben en hora de La Paz y se guardan en UTC", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Mensaje"), "Promo");
    fireEvent.change(dialog.getByLabelText("Empieza (hora de La Paz)"), {
      target: { value: "2026-10-29T22:00" },
    });
    fireEvent.change(dialog.getByLabelText("Termina (hora de La Paz)"), {
      target: { value: "2026-10-30T22:00" },
    });
    await user.type(dialog.getByLabelText(/Enlace/), "/novedades");
    await user.click(dialog.getByRole("checkbox", { name: "Activo" }));
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    await waitFor(() => expect(api.createBanner).toHaveBeenCalled());
    expect(api.createBanner).toHaveBeenCalledWith({
      message: "Promo",
      link_url: "/novedades",
      starts_at: "2026-10-30T02:00:00.000Z",
      ends_at: "2026-10-31T02:00:00.000Z",
      is_active: false,
    });
  });

  it("valida en el cliente: mensaje vacío, enlace no seguro y fin anterior al inicio; no llama a la base", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText(/Enlace/), "http://inseguro.com");
    fireEvent.change(dialog.getByLabelText("Empieza (hora de La Paz)"), {
      target: { value: "2026-10-30T10:00" },
    });
    fireEvent.change(dialog.getByLabelText("Termina (hora de La Paz)"), {
      target: { value: "2026-10-30T09:00" },
    });
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    expect(await dialog.findByText("Escribe el mensaje del banner.")).toBeInTheDocument();
    expect(dialog.getByText(/Usa una ruta interna/)).toBeInTheDocument();
    expect(dialog.getByText("El fin debe ser posterior al inicio.")).toBeInTheDocument();
    expect(api.createBanner).not.toHaveBeenCalled();
    expect(dialog.getByLabelText("Mensaje")).toHaveAttribute("aria-invalid", "true");
  });

  it("el mensaje admite 200 caracteres y no 201", async () => {
    const { user, dialog } = await openCreate();
    fireEvent.change(dialog.getByLabelText("Mensaje"), { target: { value: "a".repeat(201) } });
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    expect(await dialog.findByText("El mensaje admite hasta 200 caracteres.")).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText("Mensaje"), { target: { value: "a".repeat(200) } });
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    await waitFor(() => expect(api.createBanner).toHaveBeenCalledTimes(1));
  });

  it("si la base rechaza, el diálogo queda abierto con el motivo (no se pierde lo escrito)", async () => {
    api.createBanner.mockRejectedValue(new AppError("validation", "el enlace no es seguro"));
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Mensaje"), "Promo");
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("el enlace no es seguro");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.getByLabelText("Mensaje")).toHaveValue("Promo");
  });

  it("el botón de guardar se bloquea mientras guarda: un doble clic crea un solo banner", async () => {
    let finish: (v: unknown) => void = () => {};
    api.createBanner.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Mensaje"), "Promo");
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    const busy = await dialog.findByRole("button", { name: "Guardando…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(api.createBanner).toHaveBeenCalledTimes(1);
    finish(banner());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("al editar, el formulario trae los datos del banner (fechas en hora de La Paz) y actualiza con SU versión", async () => {
    api.listBanners.mockResolvedValue([
      banner({
        id: "e1",
        message: "Original",
        linkUrl: "https://madeinchola.com/promo",
        startsAt: "2026-10-30T02:00:00+00:00",
        endsAt: "2026-10-31T02:00:00+00:00",
        isActive: false,
        updatedAt: "2026-10-01T10:00:00.654321+00:00",
      }),
    ]);
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar el banner «Original»" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Editar banner" }));
    expect(dialog.getByLabelText("Mensaje")).toHaveValue("Original");
    expect(dialog.getByLabelText(/Enlace/)).toHaveValue("https://madeinchola.com/promo");
    expect(dialog.getByLabelText("Empieza (hora de La Paz)")).toHaveValue("2026-10-29T22:00");
    expect(dialog.getByLabelText("Termina (hora de La Paz)")).toHaveValue("2026-10-30T22:00");
    expect(dialog.getByRole("checkbox", { name: "Activo" })).not.toBeChecked();

    await user.clear(dialog.getByLabelText("Mensaje"));
    await user.type(dialog.getByLabelText("Mensaje"), "Editado");
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    await waitFor(() => expect(api.updateBanner).toHaveBeenCalledTimes(1));
    const [sent, payload] = api.updateBanner.mock.calls[0] as [Banner, Record<string, unknown>];
    expect(sent.id).toBe("e1");
    expect(sent.updatedAt).toBe("2026-10-01T10:00:00.654321+00:00"); // la versión leída, intacta
    expect(payload).toMatchObject({
      message: "Editado",
      link_url: "https://madeinchola.com/promo",
      starts_at: "2026-10-30T02:00:00.000Z",
      ends_at: "2026-10-31T02:00:00.000Z",
      is_active: false,
    });
    expect(toast.success).toHaveBeenCalledWith("Banner actualizado.");
  });

  it("si otra persona lo editó antes, avisa del conflicto y NO pisa su cambio", async () => {
    api.updateBanner.mockRejectedValue(new StaleVersionError());
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Editar el banner/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Guardar banner" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Otra persona guardó cambios mientras editabas",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("reabrir el diálogo de alta lo deja en blanco (no arrastra lo escrito antes)", async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText("Mensaje"), "borrador");
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const again = await openCreate(false);
    expect(again.dialog.getByLabelText("Mensaje")).toHaveValue("");
  });
});

describe("BannersSection: activar, archivar y restaurar", () => {
  it("activar/desactivar es inmediato y manda la versión del banner", async () => {
    const b = banner({ updatedAt: "2026-10-01T10:00:00.999999+00:00" });
    api.listBanners.mockResolvedValue([b]);
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Desactivar: «Envío gratis esta semana»" }),
    );
    await waitFor(() => expect(api.setBannerActive).toHaveBeenCalledWith(b, false));
    expect(toast.success).toHaveBeenCalledWith("Banner desactivado.");
  });

  it("un banner inactivo ofrece 'Activar'", async () => {
    api.listBanners.mockResolvedValue([banner({ isActive: false })]);
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Activar: «Envío gratis esta semana»" }),
    );
    await waitFor(() => expect(api.setBannerActive).toHaveBeenCalledWith(expect.anything(), true));
  });

  it("archivar pide confirmación explícita y solo archiva al confirmar", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Archivar: «Envío gratis esta semana»" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar este banner?" });
    expect(within(dialog).getByText(/No se borra: podrás restaurarlo/)).toBeInTheDocument();
    expect(api.setBannerArchived).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Archivar banner" }));
    await waitFor(() => expect(api.setBannerArchived).toHaveBeenCalledTimes(1));
    expect(api.setBannerArchived.mock.calls[0]?.[1]).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Banner archivado.");
  });

  it("cancelar la confirmación NO archiva", async () => {
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Archivar: / }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setBannerArchived).not.toHaveBeenCalled();
  });

  it("un banner archivado ofrece 'Restaurar' (inmediato) y no ofrece activar", async () => {
    api.listBanners.mockResolvedValue([banner({ archived: true })]);
    renderSection();
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: /Restaurar: / })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Activar: |Desactivar: / }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Restaurar: / }));
    await waitFor(() =>
      expect(api.setBannerArchived).toHaveBeenCalledWith(expect.anything(), false),
    );
    expect(toast.success).toHaveBeenCalledWith("Banner restaurado.");
  });

  it("si la acción falla, lo avisa con el motivo y vuelve a leer la lista", async () => {
    api.setBannerActive.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Desactivar: / }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("un conflicto de edición al activar muestra el aviso de conflicto", async () => {
    api.setBannerActive.mockRejectedValue(new StaleVersionError());
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Desactivar: / }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Otra persona guardó cambios"),
      ),
    );
  });
});

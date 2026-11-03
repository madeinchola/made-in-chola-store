import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/components/layout/layout-test-utils";
import { AppError } from "@/lib/errors";
import { asCustomer, customerProfile } from "@/test/auth-test-utils";
import { AddressesPage } from "./AddressesPage";
import type { Address } from "./types";

const api = vi.hoisted(() => ({
  listActiveAddresses: vi.fn(),
  listArchivedAddresses: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  archiveAddress: vi.fn(),
  restoreAddress: vi.fn(),
  setDefaultAddress: vi.fn(),
  listDeliveryCountries: vi.fn(),
}));
vi.mock("./api", () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
// El mapa real (Leaflet) no se necesita aquí: se prueba aparte. Este es un sustituto mínimo.
vi.mock("@/components/map/LeafletMap", () => ({
  default: () => <div data-testid="fake-map" />,
}));

const PROFILE = customerProfile.id;

const address = (id: string, over: Partial<Address> = {}): Address => ({
  id,
  profileId: PROFILE,
  label: `Dirección ${id}`,
  recipient: "Ana Cliente",
  phone: "+59171234567",
  line1: `Calle ${id} #1`,
  line2: null,
  city: "La Paz",
  department: "La Paz",
  country: "BO",
  referenceText: null,
  lat: null,
  lng: null,
  isDefault: false,
  forShipping: true,
  forBilling: false,
  archivedAt: null,
  createdAt: "2026-11-01T10:00:00+00:00",
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});

const CASA = address("casa", {
  label: "Casa",
  recipient: "Ana Cliente",
  line1: "Calle 21 de Calacoto #123",
  line2: "Piso 2",
  city: "La Paz",
  department: "La Paz",
  referenceText: "Puerta verde, frente a la farmacia",
  lat: -16.5,
  lng: -68.15,
  isDefault: true,
  forBilling: true,
});
const OFICINA = address("oficina", {
  label: "Oficina",
  recipient: "Luis Pérez",
  phone: "+34612345678",
  line1: "Av. Arce 2345",
  city: "Santa Cruz",
  department: "Santa Cruz",
});
const VIEJA = address("vieja", {
  label: "Vieja",
  archivedAt: "2026-10-20T10:00:00+00:00",
});

const twenty = () =>
  Array.from({ length: 20 }, (_, i) => address(`d${i}`, { label: `Dir ${i}`, isDefault: i === 0 }));

const renderPage = (auth = asCustomer()) => renderWithApp(<AddressesPage />, { auth });

beforeEach(() => {
  vi.clearAllMocks();
  api.listActiveAddresses.mockResolvedValue([CASA, OFICINA]);
  api.listArchivedAddresses.mockResolvedValue([]);
  api.listDeliveryCountries.mockResolvedValue([{ code: "BO", name: "Bolivia" }]);
  api.createAddress.mockResolvedValue(address("nueva"));
  api.updateAddress.mockResolvedValue(address("casa"));
  api.archiveAddress.mockResolvedValue(address("oficina"));
  api.restoreAddress.mockResolvedValue(address("vieja"));
  api.setDefaultAddress.mockResolvedValue(address("oficina"));
});

const card = (label: string) => screen.getByRole("article", { name: label });
const addButton = () => screen.getByRole("button", { name: "Agregar dirección" });

/** Rellena los campos obligatorios (el destinatario ya viene del perfil: «Ana Cliente»). */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Etiqueta *"), "Casa");
  await user.type(screen.getByLabelText("Teléfono de contacto *"), "71234567");
  await user.selectOptions(screen.getByLabelText("Departamento *"), "La Paz");
  await user.type(screen.getByLabelText("Ciudad *"), "La Paz");
  await user.type(screen.getByLabelText("Calle y número *"), "Calle 21 #123");
}
const saveButton = () => screen.getByRole("button", { name: /^Guardar dirección$|^Guardando…$/ });

describe("AddressesPage · lista", () => {
  it("muestra el título y, mientras carga, un indicador accesible (esqueleto)", async () => {
    api.listActiveAddresses.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Direcciones" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus direcciones…");
  });

  it("lista las direcciones con sus datos, en el orden recibido, y consulta con el id del cliente", async () => {
    renderPage();
    const casa = await screen.findByRole("article", { name: "Casa" });
    expect(api.listActiveAddresses).toHaveBeenCalledWith(PROFILE);
    expect(api.listArchivedAddresses).toHaveBeenCalledWith(PROFILE);
    const items = screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"));
    expect(items).toHaveLength(2);
    expect(screen.getAllByRole("article")[0]).toBe(casa);
    expect(within(casa).getByRole("heading", { level: 3, name: "Casa" })).toBeInTheDocument();
    expect(within(casa).getByText("Ana Cliente")).toBeInTheDocument();
    expect(within(casa).getByText("Calle 21 de Calacoto #123, Piso 2")).toBeInTheDocument();
    expect(within(casa).getByText("La Paz, La Paz, Bolivia")).toBeInTheDocument();
    expect(within(casa).getByText("Teléfono: +591 7123 4567")).toBeInTheDocument();
    expect(
      within(casa).getByText("Referencia: Puerta verde, frente a la farmacia"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 de 20 direcciones activas")).toBeInTheDocument();
  });

  it("la insignia «Predeterminada» solo está en la predeterminada; los usos se ven como texto", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    expect(within(card("Casa")).getByText("Predeterminada")).toBeInTheDocument();
    expect(within(card("Oficina")).queryByText("Predeterminada")).not.toBeInTheDocument();
    expect(within(card("Casa")).getByText("Envío")).toBeInTheDocument();
    expect(within(card("Casa")).getByText("Facturación")).toBeInTheDocument();
    expect(within(card("Oficina")).getByText("Envío")).toBeInTheDocument();
    expect(within(card("Oficina")).queryByText("Facturación")).not.toBeInTheDocument();
  });

  it("indica si la dirección tiene pin en el mapa o no", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    expect(within(card("Casa")).getByText("Con ubicación en el mapa")).toBeInTheDocument();
    expect(within(card("Oficina")).getByText("Sin ubicación en el mapa")).toBeInTheDocument();
  });

  it("una dirección sin teléfono o sin referencia no deja huecos ni «null»", async () => {
    api.listActiveAddresses.mockResolvedValue([
      address("a", { label: "Sola", phone: null, referenceText: null, line2: null }),
    ]);
    renderPage();
    const sola = await screen.findByRole("article", { name: "Sola" });
    expect(within(sola).queryByText(/Teléfono/)).not.toBeInTheDocument();
    expect(within(sola).queryByText(/Referencia/)).not.toBeInTheDocument();
    expect(sola.textContent).not.toMatch(/null|undefined/);
    expect(within(sola).getByText("Calle a #1")).toBeInTheDocument();
  });

  it("el nombre del país sale de la lista de países habilitados; con un código desconocido se muestra el código", async () => {
    api.listActiveAddresses.mockResolvedValue([
      address("a", { label: "Rara", country: "ZZ", department: null, city: "Ciudad" }),
    ]);
    renderPage();
    const rara = await screen.findByRole("article", { name: "Rara" });
    expect(within(rara).getByText("Ciudad, ZZ")).toBeInTheDocument();
  });

  it("todo texto del usuario se pinta como TEXTO (nunca como HTML)", async () => {
    const hostile = '<img src=x onerror="alert(1)"><script>window.hacked=1</script>';
    api.listActiveAddresses.mockResolvedValue([
      address("x", { label: hostile, recipient: hostile, line1: hostile, referenceText: hostile }),
    ]);
    const { container } = renderPage();
    await screen.findByRole("article", { name: hostile });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
    expect(within(card(hostile)).getByText(`Referencia: ${hostile}`)).toBeInTheDocument();
  });

  it("sin direcciones: estado vacío con una única acción «Agregar dirección»", async () => {
    api.listActiveAddresses.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("Aún no tienes direcciones")).toBeInTheDocument();
    expect(
      screen.getByText("Agrega la primera: la usaremos para tus envíos y tu facturación."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Agregar dirección" })).toHaveLength(1);
    expect(screen.queryByText(/direcciones activas/)).not.toBeInTheDocument();
  });

  it("error al cargar: mensaje con «Reintentar», que vuelve a pedir la lista", async () => {
    api.listActiveAddresses.mockRejectedValueOnce(new AppError("network", "sin red"));
    const user = userEvent.setup();
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar tus direcciones");
    expect(alert).toHaveTextContent("Revisa tu conexión e inténtalo de nuevo.");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("article", { name: "Casa" })).toBeInTheDocument();
    expect(api.listActiveAddresses).toHaveBeenCalledTimes(2);
  });
});

describe("AddressesPage · tope de 20 direcciones activas", () => {
  it("con 19 todavía se puede agregar: sin aviso y el botón abre el formulario", async () => {
    api.listActiveAddresses.mockResolvedValue(twenty().slice(0, 19));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("19 de 20 direcciones activas");
    expect(addButton()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/Alcanzaste el máximo/)).not.toBeInTheDocument();
    await user.click(addButton());
    expect(await screen.findByRole("dialog", { name: "Agregar dirección" })).toBeInTheDocument();
  });

  it("con 20 el botón se EXPLICA (aria-disabled, no disabled, enlazado al aviso) y no abre nada", async () => {
    api.listActiveAddresses.mockResolvedValue(twenty());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("20 de 20 direcciones activas");
    const notice = screen.getByText(
      "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar otra.",
    );
    expect(addButton()).toHaveAttribute("aria-disabled", "true");
    expect(addButton()).not.toBeDisabled();
    expect(addButton()).toHaveAttribute("aria-describedby", notice.id);
    await user.click(addButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("con 20 activas, «Restaurar» también se explica y no llama a la API", async () => {
    api.listActiveAddresses.mockResolvedValue(twenty());
    api.listArchivedAddresses.mockResolvedValue([VIEJA]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("20 de 20 direcciones activas");
    await user.click(screen.getByRole("button", { name: /Archivadas \(1\)/ }));
    const restore = screen.getByRole("button", { name: "Restaurar dirección Vieja" });
    expect(restore).toHaveAttribute("aria-disabled", "true");
    expect(restore).not.toBeDisabled();
    const notice = screen.getByText(
      "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar otra.",
    );
    expect(restore).toHaveAttribute("aria-describedby", notice.id);
    expect(
      screen.getByText(
        "No puedes restaurar direcciones mientras tengas 20 activas: archiva alguna primero.",
      ),
    ).toBeInTheDocument();
    await user.click(restore);
    expect(api.restoreAddress).not.toHaveBeenCalled();
  });
});

describe("AddressesPage · archivar (nunca borrar)", () => {
  it("pide confirmación explicando que no se elimina, y NO archiva hasta confirmar", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Oficina" });
    await user.click(screen.getByRole("button", { name: "Archivar dirección Oficina" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar esta dirección?" });
    expect(dialog).toHaveTextContent(
      "«Oficina» dejará de usarse en tus compras. No se elimina: puedes restaurarla desde «Archivadas».",
    );
    expect(within(dialog).queryByText(/predeterminada/)).not.toBeInTheDocument();
    expect(api.archiveAddress).not.toHaveBeenCalled();
  });

  it("Cancelar cierra sin archivar", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Oficina" });
    await user.click(screen.getByRole("button", { name: "Archivar dirección Oficina" }));
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.archiveAddress).not.toHaveBeenCalled();
  });

  it("al archivar la predeterminada, el diálogo avisa de que otra pasará a serlo", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(screen.getByRole("button", { name: "Archivar dirección Casa" }));
    expect(
      await screen.findByText(
        "Es tu dirección predeterminada: la más reciente de las que te queden pasará a serlo.",
      ),
    ).toBeInTheDocument();
  });

  it("confirmar archiva esa dirección, avisa, actualiza la lista y deja el foco en el título (el botón ya no existe)", async () => {
    api.listActiveAddresses
      .mockResolvedValueOnce([CASA, OFICINA])
      .mockResolvedValue([{ ...OFICINA, isDefault: true }]); // la base promovió a la que quedaba
    api.listArchivedAddresses
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ...CASA, isDefault: false, archivedAt: "2026-11-02T10:00:00+00:00" }]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(screen.getByRole("button", { name: "Archivar dirección Casa" }));
    await user.click(await screen.findByRole("button", { name: "Archivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.archiveAddress).toHaveBeenCalledWith(PROFILE, "casa");
    expect(toast.success).toHaveBeenCalledWith("Dirección archivada");
    // La lista ya refleja el cambio: Oficina es ahora la predeterminada.
    expect(screen.queryByRole("article", { name: "Casa" })).not.toBeInTheDocument();
    expect(within(card("Oficina")).getByText("Predeterminada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Archivadas \(1\)/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Direcciones" })).toHaveFocus(),
    );
  });

  it("archivar la única dirección deja el estado vacío", async () => {
    api.listActiveAddresses.mockResolvedValueOnce([CASA]).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(screen.getByRole("button", { name: "Archivar dirección Casa" }));
    await user.click(await screen.findByRole("button", { name: "Archivar" }));
    expect(await screen.findByText("Aún no tienes direcciones")).toBeInTheDocument();
  });

  it("si falla, el diálogo se queda abierto con el motivo y no avisa de éxito", async () => {
    api.archiveAddress.mockRejectedValue(
      new AppError("unauthorized", "Tu sesión venció. Inicia sesión de nuevo."),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Oficina" });
    await user.click(screen.getByRole("button", { name: "Archivar dirección Oficina" }));
    await user.click(await screen.findByRole("button", { name: "Archivar" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Tu sesión venció. Inicia sesión de nuevo.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    // Se puede reintentar.
    api.archiveAddress.mockResolvedValue(address("oficina"));
    await user.click(within(dialog).getByRole("button", { name: "Archivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.archiveAddress).toHaveBeenCalledTimes(2);
  });

  it("mientras archiva: el botón usa aria-disabled, el diálogo no se cierra con Esc y un segundo clic no repite la acción", async () => {
    let finish: (value: Address) => void = () => {};
    api.archiveAddress.mockImplementation(
      () => new Promise<Address>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Oficina" });
    await user.click(screen.getByRole("button", { name: "Archivar dirección Oficina" }));
    await user.click(await screen.findByRole("button", { name: "Archivar" }));
    const working = await screen.findByRole("button", { name: "Archivando…" });
    expect(working).toHaveAttribute("aria-disabled", "true");
    expect(working).not.toBeDisabled();
    await user.click(working);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(api.archiveAddress).toHaveBeenCalledTimes(1);
    finish(address("oficina"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("AddressesPage · archivadas y restaurar", () => {
  it("sin archivadas no hay sección", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    expect(screen.queryByRole("button", { name: /Archivadas/ })).not.toBeInTheDocument();
  });

  it("la sección está plegada por defecto, se despliega y se vuelve a plegar (aria-expanded)", async () => {
    api.listArchivedAddresses.mockResolvedValue([VIEJA]);
    const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findByRole("button", { name: "Archivadas (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("article", { name: "Vieja" })).not.toBeInTheDocument(); // plegada: no está en el árbol accesible
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(
        "Las direcciones archivadas no se usan en tus compras. Puedes restaurarlas cuando quieras.",
      ),
    ).toBeVisible();
    const vieja = screen.getByRole("article", { name: "Vieja" });
    expect(
      within(vieja).getByRole("button", { name: "Restaurar dirección Vieja" }),
    ).toBeInTheDocument();
    // Las archivadas NO ofrecen editar, archivar ni predeterminada.
    expect(
      within(vieja).queryByRole("button", { name: /Editar|Archivar|predeterminada/ }),
    ).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("article", { name: "Vieja" })).not.toBeInTheDocument();
  });

  it("el botón de la sección controla el panel que despliega", async () => {
    api.listArchivedAddresses.mockResolvedValue([VIEJA]);
    renderPage();
    const toggle = await screen.findByRole("button", { name: "Archivadas (1)" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
  });

  it("restaurar llama a la API, avisa, la dirección vuelve a la lista activa y recibe el foco", async () => {
    api.listActiveAddresses
      .mockResolvedValueOnce([CASA])
      .mockResolvedValue([CASA, { ...VIEJA, archivedAt: null }]);
    api.listArchivedAddresses.mockResolvedValueOnce([VIEJA]).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Archivadas (1)" }));
    await user.click(screen.getByRole("button", { name: "Restaurar dirección Vieja" }));
    await waitFor(() => expect(api.restoreAddress).toHaveBeenCalledWith(PROFILE, "vieja"));
    expect(toast.success).toHaveBeenCalledWith("Dirección restaurada");
    const restored = await screen.findByRole("article", { name: "Vieja" });
    await waitFor(() => expect(restored).toHaveFocus());
    expect(screen.queryByRole("button", { name: /Archivadas/ })).not.toBeInTheDocument();
  });

  it("si la base rechaza la restauración, se explica con un aviso y no se mueve nada", async () => {
    api.listArchivedAddresses.mockResolvedValue([VIEJA]);
    api.restoreAddress.mockRejectedValue(
      new AppError(
        "validation",
        "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar o restaurar otra.",
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Archivadas (1)" }));
    await user.click(screen.getByRole("button", { name: "Restaurar dirección Vieja" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar o restaurar otra.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("article", { name: "Vieja" })).toBeInTheDocument();
  });

  it("si fallan solo las archivadas, las activas se ven y hay un aviso con «Reintentar»", async () => {
    api.listArchivedAddresses.mockRejectedValueOnce(new AppError("network", "x"));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("article", { name: "Casa" })).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar las direcciones archivadas.");
    api.listArchivedAddresses.mockResolvedValue([VIEJA]);
    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("button", { name: "Archivadas (1)" })).toBeInTheDocument();
  });
});

describe("AddressesPage · marcar como predeterminada", () => {
  it("el botón solo existe en las que no lo son", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    expect(
      within(card("Casa")).queryByRole("button", { name: /predeterminada/ }),
    ).not.toBeInTheDocument();
    expect(
      within(card("Oficina")).getByRole("button", {
        name: "Marcar la dirección Oficina como predeterminada",
      }),
    ).toBeInTheDocument();
  });

  it("llama a la API, avisa, refresca la lista (la anterior deja de serlo) y enfoca la tarjeta", async () => {
    api.listActiveAddresses.mockResolvedValueOnce([CASA, OFICINA]).mockResolvedValue([
      { ...OFICINA, isDefault: true },
      { ...CASA, isDefault: false },
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(
      screen.getByRole("button", { name: "Marcar la dirección Oficina como predeterminada" }),
    );
    await waitFor(() => expect(api.setDefaultAddress).toHaveBeenCalledWith(PROFILE, "oficina"));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("«Oficina» es ahora tu dirección predeterminada"),
    );
    await waitFor(() => expect(card("Oficina")).toHaveFocus());
    expect(within(card("Oficina")).getByText("Predeterminada")).toBeInTheDocument();
    expect(within(card("Casa")).queryByText("Predeterminada")).not.toBeInTheDocument();
    // Oficina ahora va primero.
    expect(screen.getAllByRole("article")[0]).toBe(card("Oficina"));
  });

  it("mientras se aplica, el botón usa aria-disabled y un segundo clic no repite la llamada", async () => {
    let finish: (value: Address) => void = () => {};
    api.setDefaultAddress.mockImplementation(
      () => new Promise<Address>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    const button = screen.getByRole("button", {
      name: "Marcar la dirección Oficina como predeterminada",
    });
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(api.setDefaultAddress).toHaveBeenCalledTimes(1);
    finish(address("oficina"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("con una acción en curso, el botón de OTRA tarjeta no lanza una segunda llamada", async () => {
    let finish: (value: Address) => void = () => {};
    api.setDefaultAddress.mockImplementation(
      () => new Promise<Address>((resolve) => (finish = resolve)),
    );
    api.listActiveAddresses.mockResolvedValue([
      CASA,
      OFICINA,
      address("taller", { label: "Taller" }),
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Taller" });
    await user.click(
      screen.getByRole("button", { name: "Marcar la dirección Oficina como predeterminada" }),
    );
    await waitFor(() => expect(api.setDefaultAddress).toHaveBeenCalledTimes(1));
    await user.click(
      screen.getByRole("button", { name: "Marcar la dirección Taller como predeterminada" }),
    );
    expect(api.setDefaultAddress).toHaveBeenCalledTimes(1);
    expect(api.setDefaultAddress).toHaveBeenCalledWith(PROFILE, "oficina");
    finish(address("oficina"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("si falla, avisa con el motivo y no anuncia éxito", async () => {
    api.setDefaultAddress.mockRejectedValue(
      new AppError("network", "No hay conexión con el servidor."),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(
      screen.getByRole("button", { name: "Marcar la dirección Oficina como predeterminada" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No hay conexión con el servidor."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("AddressesPage · formulario: crear", () => {
  it("se abre como diálogo accesible titulado, con el destinatario del perfil y los usos por defecto", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    const dialog = await screen.findByRole("dialog", { name: "Agregar dirección" });
    expect(within(dialog).getByLabelText("Quién recibe *")).toHaveValue("Ana Cliente");
    expect(within(dialog).getByRole("checkbox", { name: "Envío" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Facturación" })).not.toBeChecked();
    expect(within(dialog).getByLabelText("País *")).toHaveValue("BO");
  });

  it("autocompletado correcto y teclado numérico para el teléfono", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    const attr = (label: string, name: string) => screen.getByLabelText(label).getAttribute(name);
    expect(attr("Quién recibe *", "autocomplete")).toBe("name");
    expect(attr("Calle y número *", "autocomplete")).toBe("address-line1");
    expect(attr("Edificio, piso o departamento", "autocomplete")).toBe("address-line2");
    expect(attr("Ciudad *", "autocomplete")).toBe("address-level2");
    expect(attr("Departamento *", "autocomplete")).toBe("address-level1");
    expect(attr("País *", "autocomplete")).toBe("country");
    expect(attr("Teléfono de contacto *", "autocomplete")).toBe("tel-national");
    expect(attr("Teléfono de contacto *", "inputmode")).toBe("tel");
    expect(attr("Teléfono de contacto *", "type")).toBe("tel");
  });

  it("el teléfono del perfil se ofrece como contacto (prefijo + número con máscara)", async () => {
    const user = userEvent.setup();
    renderPage(asCustomer({ profile: { ...customerProfile, phone_e164: "+59171234567" } }));
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("Teléfono de contacto *")).toHaveValue("7123 4567");
    expect(screen.getByLabelText("Prefijo")).toHaveValue("BO");
  });

  it("el departamento de Bolivia es una lista con los 9 departamentos", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    const select = (await screen.findByLabelText("Departamento *")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Elige un departamento",
      "La Paz",
      "Cochabamba",
      "Santa Cruz",
      "Oruro",
      "Potosí",
      "Chuquisaca",
      "Tarija",
      "Beni",
      "Pando",
    ]);
  });

  it("guarda: valida, normaliza (teléfono E.164) y envía lo escrito con el id del cliente; avisa y cierra", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    expect(screen.getByLabelText("Teléfono de contacto *")).toHaveValue("7123 4567"); // máscara en vivo
    await user.click(saveButton());
    await waitFor(() => expect(api.createAddress).toHaveBeenCalledTimes(1));
    expect(api.createAddress).toHaveBeenCalledWith(PROFILE, {
      label: "Casa",
      recipient: "Ana Cliente",
      phoneE164: "+59171234567",
      line1: "Calle 21 #123",
      line2: null,
      city: "La Paz",
      department: "La Paz",
      country: "BO",
      referenceText: null,
      lat: null,
      lng: null,
      forShipping: true,
      forBilling: false,
      isDefault: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Dirección agregada");
  });

  it("incluye el pin escrito en los campos de coordenadas (coma o punto) y los opcionales", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.type(screen.getByLabelText("Edificio, piso o departamento"), "Piso 2");
    await user.type(screen.getByLabelText("Referencia"), "Puerta verde");
    await user.type(screen.getByLabelText("Latitud"), "-16,5");
    await user.type(screen.getByLabelText("Longitud"), "-68.15");
    await user.click(screen.getByRole("checkbox", { name: "Facturación" }));
    await user.click(saveButton());
    await waitFor(() => expect(api.createAddress).toHaveBeenCalledTimes(1));
    expect(api.createAddress.mock.calls[0]?.[1]).toMatchObject({
      line2: "Piso 2",
      referenceText: "Puerta verde",
      lat: -16.5,
      lng: -68.15,
      forShipping: true,
      forBilling: true,
    });
  });

  it("el pin es OPCIONAL: sin él se guarda con lat y lng nulos", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.click(saveButton());
    await waitFor(() => expect(api.createAddress).toHaveBeenCalledTimes(1));
    expect(api.createAddress.mock.calls[0]?.[1]).toMatchObject({ lat: null, lng: null });
  });

  it("la primera dirección: sin casilla de predeterminada, explica que lo será; con otras activas aparece la casilla", async () => {
    api.listActiveAddresses.mockResolvedValue([]);
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Será tu dirección predeterminada.")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("checkbox", { name: /predeterminada/ }),
    ).not.toBeInTheDocument();
    unmount();

    api.listActiveAddresses.mockResolvedValue([CASA]);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    const second = await screen.findByRole("dialog");
    expect(
      within(second).getByRole("checkbox", { name: "Usar como mi dirección predeterminada" }),
    ).not.toBeChecked();
  });

  it("al marcar «predeterminada» se envía isDefault: true", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.click(
      screen.getByRole("checkbox", { name: "Usar como mi dirección predeterminada" }),
    );
    await user.click(saveButton());
    await waitFor(() => expect(api.createAddress).toHaveBeenCalledTimes(1));
    expect(api.createAddress.mock.calls[0]?.[1]).toMatchObject({ isDefault: true });
  });

  it("con varios países habilitados, uno distinto de Bolivia pide el departamento como texto libre (opcional)", async () => {
    api.listDeliveryCountries.mockResolvedValue([
      { code: "AR", name: "Argentina" },
      { code: "BO", name: "Bolivia" },
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    // Bolivia sigue siendo el país por defecto aunque no sea el primero de la lista.
    await waitFor(() => expect(screen.getByLabelText("País *")).toHaveValue("BO"));
    await user.selectOptions(screen.getByLabelText("País *"), "AR");
    expect(screen.queryByLabelText("Departamento *")).not.toBeInTheDocument();
    const free = screen.getByLabelText("Departamento, estado o provincia") as HTMLInputElement;
    expect(free.tagName).toBe("INPUT");
    await user.type(screen.getByLabelText("Etiqueta *"), "Casa BA");
    await user.type(screen.getByLabelText("Teléfono de contacto *"), "71234567");
    await user.type(screen.getByLabelText("Ciudad *"), "Buenos Aires");
    await user.type(screen.getByLabelText("Calle y número *"), "Corrientes 100");
    await user.type(free, "Buenos Aires");
    await user.click(saveButton());
    await waitFor(() => expect(api.createAddress).toHaveBeenCalledTimes(1));
    expect(api.createAddress.mock.calls[0]?.[1]).toMatchObject({
      country: "AR",
      department: "Buenos Aires",
    });
    // Volver a Bolivia restituye la lista y vacía el departamento anterior.
  });

  it("cambiar de país vacía el departamento (la lista de otro país ya no vale)", async () => {
    api.listDeliveryCountries.mockResolvedValue([
      { code: "AR", name: "Argentina" },
      { code: "BO", name: "Bolivia" },
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByLabelText("País *")).toHaveValue("BO"));
    await user.selectOptions(screen.getByLabelText("Departamento *"), "Oruro");
    await user.selectOptions(screen.getByLabelText("País *"), "AR");
    expect(screen.getByLabelText("Departamento, estado o provincia")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("País *"), "BO");
    expect(screen.getByLabelText("Departamento *")).toHaveValue("");
  });
});

describe("AddressesPage · formulario: validación", () => {
  it("al enviar vacío muestra el error junto a cada campo, NO llama a la API y enfoca el primero inválido", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    const dialog = await screen.findByRole("dialog");
    await user.click(saveButton());
    expect(api.createAddress).not.toHaveBeenCalled();
    const label = within(dialog).getByLabelText("Etiqueta *");
    await waitFor(() => expect(label).toHaveAttribute("aria-invalid", "true"));
    expect(label).toHaveAccessibleDescription("Escribe un nombre para reconocer la dirección.");
    expect(within(dialog).getByText("Ingresa tu teléfono.")).toBeInTheDocument();
    expect(within(dialog).getByText("Elige un departamento.")).toBeInTheDocument();
    expect(within(dialog).getByText("Escribe la ciudad.")).toBeInTheDocument();
    expect(within(dialog).getByText("Escribe la calle y el número.")).toBeInTheDocument();
    await waitFor(() => expect(label).toHaveFocus());
  });

  it("el foco va al PRIMER campo inválido en orden de pantalla, no al primero del formulario", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await user.type(screen.getByLabelText("Etiqueta *"), "Casa");
    await user.type(screen.getByLabelText("Teléfono de contacto *"), "71234567");
    await user.selectOptions(screen.getByLabelText("Departamento *"), "La Paz");
    await user.type(screen.getByLabelText("Calle y número *"), "Calle 1");
    // Falta solo la ciudad.
    await user.click(saveButton());
    await waitFor(() => expect(screen.getByLabelText("Ciudad *")).toHaveFocus());
    expect(api.createAddress).not.toHaveBeenCalled();
  });

  it("pin a medias: el error va en el campo que falta y el foco se va allí", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.type(screen.getByLabelText("Latitud"), "-16.5");
    await user.click(saveButton());
    const longitude = screen.getByLabelText("Longitud");
    await waitFor(() => expect(longitude).toHaveFocus());
    expect(longitude).toHaveAccessibleDescription(
      "Escribe también la longitud, o borra la latitud para no usar pin.",
    );
    expect(api.createAddress).not.toHaveBeenCalled();
    // Corregirlo (completar la longitud) limpia el error y permite guardar.
    await user.type(longitude, "-68.15");
    await waitFor(() => expect(longitude).not.toHaveAttribute("aria-invalid", "true"));
    await user.click(saveButton());
    await waitFor(() => expect(api.createAddress).toHaveBeenCalledTimes(1));
  });

  it("latitud fuera de rango", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.type(screen.getByLabelText("Latitud"), "95");
    await user.type(screen.getByLabelText("Longitud"), "-68");
    await user.click(saveButton());
    expect(await screen.findByText("La latitud debe estar entre -90 y 90.")).toBeInTheDocument();
    expect(api.createAddress).not.toHaveBeenCalled();
  });

  it("sin ningún uso (ni envío ni facturación) no se puede guardar y el error es accesible", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.click(screen.getByRole("checkbox", { name: "Envío" })); // deja ambos sin marcar
    await user.click(saveButton());
    expect(
      await screen.findByText("Elige al menos un uso: envío o facturación."),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Envío" })).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Envío" })).toHaveFocus());
    expect(api.createAddress).not.toHaveBeenCalled();
    // Marcar uno lo resuelve.
    await user.click(screen.getByRole("checkbox", { name: "Facturación" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Elige al menos un uso: envío o facturación."),
      ).not.toBeInTheDocument(),
    );
  });

  it("un teléfono boliviano inválido se explica", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    const phone = screen.getByLabelText("Teléfono de contacto *");
    await user.clear(phone);
    await user.type(phone, "51234567");
    await user.click(saveButton());
    expect(
      await screen.findByText("Ingresa un celular boliviano de 8 dígitos que empiece en 6 o 7."),
    ).toBeInTheDocument();
  });

  it("el prefijo del selector se aplica al número (España)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    const phone = screen.getByLabelText("Teléfono de contacto *");
    await user.clear(phone);
    await user.selectOptions(screen.getByLabelText("Prefijo"), "ES");
    await user.type(phone, "612345678");
    await user.click(saveButton());
    await waitFor(() => expect(api.createAddress).toHaveBeenCalledTimes(1));
    expect(api.createAddress.mock.calls[0]?.[1]).toMatchObject({ phoneE164: "+34612345678" });
  });

  it("los largos máximos de la base se avisan (etiqueta de 41 caracteres)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    const label = screen.getByLabelText("Etiqueta *");
    await user.clear(label);
    await user.click(label);
    await user.paste("a".repeat(41));
    await user.click(saveButton());
    expect(await screen.findByText("La etiqueta admite hasta 40 caracteres.")).toBeInTheDocument();
    expect(api.createAddress).not.toHaveBeenCalled();
  });
});

describe("AddressesPage · formulario: guardado, doble envío y sesión", () => {
  it("doble envío: mientras guarda el botón usa aria-disabled (no disabled), un segundo clic no repite y Esc/Cancelar no cierran", async () => {
    let finish: (value: Address) => void = () => {};
    api.createAddress.mockImplementation(
      () => new Promise<Address>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.click(saveButton());
    const saving = await screen.findByRole("button", { name: "Guardando…" });
    expect(saving).toHaveAttribute("aria-disabled", "true");
    expect(saving).toHaveAttribute("aria-busy", "true");
    expect(saving).not.toBeDisabled();
    await user.click(saving);
    await user.click(saving);
    expect(api.createAddress).toHaveBeenCalledTimes(1);
    // Cancelar y Escape se ignoran mientras guarda (el resultado se perdería).
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).not.toBeDisabled();
    await user.click(cancel);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    finish(address("nueva"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createAddress).toHaveBeenCalledTimes(1);
  });

  it("un envío del formulario por otra vía que el botón (evento submit directo) tampoco se duplica mientras guarda", async () => {
    let finish: (value: Address) => void = () => {};
    api.createAddress.mockImplementation(
      () => new Promise<Address>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    const dialog = await screen.findByRole("dialog");
    await fillRequired(user);
    const form = dialog.querySelector("form") as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
    });
    await waitFor(() => expect(api.createAddress).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(api.createAddress).toHaveBeenCalledTimes(1);
    await act(async () => finish(address("nueva")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Intro dentro de un campo también respeta el bloqueo (no envía dos veces)", async () => {
    let finish: (value: Address) => void = () => {};
    api.createAddress.mockImplementation(
      () => new Promise<Address>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.type(screen.getByLabelText("Ciudad *"), "{Enter}");
    await screen.findByRole("button", { name: "Guardando…" });
    await user.type(screen.getByLabelText("Ciudad *"), "{Enter}{Enter}");
    expect(api.createAddress).toHaveBeenCalledTimes(1);
    finish(address("nueva"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([
    ["unauthorized", "Tu sesión venció. Inicia sesión de nuevo."],
    [
      "forbidden",
      "No tienes permiso para guardar esta dirección. Tu sesión pudo haber vencido: inicia sesión de nuevo.",
    ],
  ] as const)(
    "sesión vencida (%s): CONSERVA lo escrito, avisa con un enlace para iniciar sesión en otra pestaña y permite reintentar",
    async (code, message) => {
      api.createAddress.mockRejectedValueOnce(new AppError(code, message));
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("article", { name: "Casa" });
      await user.click(addButton());
      await screen.findByRole("dialog");
      await fillRequired(user);
      await user.type(screen.getByLabelText("Referencia"), "Puerta verde");
      await user.click(saveButton());
      const alert = await screen.findByRole("alert", {}, { timeout: 4000 });
      expect(alert).toHaveTextContent("No pudimos guardar porque tu sesión venció");
      expect(alert).toHaveTextContent("lo que escribiste sigue aquí");
      const link = within(alert).getByRole("link", { name: "Iniciar sesión en otra pestaña" });
      expect(link).toHaveAttribute("href", "/login");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      // El formulario sigue abierto con TODO lo escrito.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByLabelText("Etiqueta *")).toHaveValue("Casa");
      expect(screen.getByLabelText("Teléfono de contacto *")).toHaveValue("7123 4567");
      expect(screen.getByLabelText("Ciudad *")).toHaveValue("La Paz");
      expect(screen.getByLabelText("Referencia")).toHaveValue("Puerta verde");
      expect(toast.success).not.toHaveBeenCalled();
      // Tras volver a iniciar sesión, reintentar funciona.
      await user.click(saveButton());
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(api.createAddress).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenCalledWith("Dirección agregada");
    },
  );

  it("un rechazo de la base (p. ej. el tope, por una carrera entre pestañas) se muestra en el formulario sin cerrarlo", async () => {
    api.createAddress.mockRejectedValueOnce(
      new AppError(
        "validation",
        "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar o restaurar otra.",
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Alcanzaste el máximo de 20 direcciones activas. Archiva alguna para poder agregar o restaurar otra.",
    );
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument(); // no es un problema de sesión
    expect(screen.getByLabelText("Etiqueta *")).toHaveValue("Casa");
  });

  it("Escape (sin guardar) cierra el cajón y devuelve el foco al botón que lo abrió", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(addButton()).toHaveFocus());
    expect(api.createAddress).not.toHaveBeenCalled();
  });

  it("crear la PRIMERA dirección desde el estado vacío: el botón que abrió el cajón desaparece y el foco va al título (no a <body>)", async () => {
    api.listActiveAddresses.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    await screen.findByRole("dialog");
    await fillRequired(user);
    api.listActiveAddresses.mockResolvedValue([CASA]); // tras guardar, la lista ya tiene la dirección y el estado vacío desaparece
    await user.click(saveButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await screen.findByRole("article", { name: "Casa" });
    expect(screen.queryByText("Aún no tienes direcciones")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Direcciones" })).toHaveFocus(),
    );
  });

  it("«Cancelar» cierra sin guardar", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(addButton());
    await screen.findByRole("dialog");
    await user.type(screen.getByLabelText("Etiqueta *"), "Algo");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createAddress).not.toHaveBeenCalled();
    // Al reabrir no queda nada de la vez anterior.
    await user.click(addButton());
    expect(await screen.findByLabelText("Etiqueta *")).toHaveValue("");
  });
});

describe("AddressesPage · formulario: editar", () => {
  it("se abre con los datos de la dirección: teléfono separado en prefijo + número, departamento, pin y usos", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Oficina" });
    await user.click(screen.getByRole("button", { name: "Editar dirección Oficina" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar dirección" });
    expect(within(dialog).getByLabelText("Etiqueta *")).toHaveValue("Oficina");
    expect(within(dialog).getByLabelText("Quién recibe *")).toHaveValue("Luis Pérez");
    expect(within(dialog).getByLabelText("Prefijo")).toHaveValue("ES");
    expect(within(dialog).getByLabelText("Teléfono de contacto *")).toHaveValue("6123 4567 8");
    expect(within(dialog).getByLabelText("Departamento *")).toHaveValue("Santa Cruz");
    expect(within(dialog).getByLabelText("Ciudad *")).toHaveValue("Santa Cruz");
    expect(within(dialog).getByLabelText("Calle y número *")).toHaveValue("Av. Arce 2345");
    expect(within(dialog).getByLabelText("Latitud")).toHaveValue("");
  });

  it("guarda los cambios SIN tocar la predeterminada y llama a updateAddress con el id", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Oficina" });
    await user.click(screen.getByRole("button", { name: "Editar dirección Oficina" }));
    await screen.findByRole("dialog");
    const city = screen.getByLabelText("Ciudad *");
    await user.clear(city);
    await user.type(city, "Cochabamba");
    await user.selectOptions(screen.getByLabelText("Departamento *"), "Cochabamba");
    await user.click(saveButton());
    await waitFor(() => expect(api.updateAddress).toHaveBeenCalledTimes(1));
    expect(api.updateAddress).toHaveBeenCalledWith(PROFILE, "oficina", {
      label: "Oficina",
      recipient: "Luis Pérez",
      phoneE164: "+34612345678",
      line1: "Av. Arce 2345",
      line2: null,
      city: "Cochabamba",
      department: "Cochabamba",
      country: "BO",
      referenceText: null,
      lat: null,
      lng: null,
      forShipping: true,
      forBilling: false,
      isDefault: false,
    });
    expect(api.createAddress).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dirección actualizada"));
  });

  it("editar la predeterminada: no hay casilla, hay una nota que explica cómo cambiarla", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(screen.getByRole("button", { name: "Editar dirección Casa" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Es tu dirección predeterminada. Para cambiarla, marca otra como predeterminada.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("checkbox", { name: /predeterminada/ }),
    ).not.toBeInTheDocument();
    // Y los campos de la dirección, incluido el pin, vienen cargados.
    expect(within(dialog).getByLabelText("Latitud")).toHaveValue("-16.5");
    expect(within(dialog).getByLabelText("Longitud")).toHaveValue("-68.15");
    expect(within(dialog).getByRole("checkbox", { name: "Facturación" })).toBeChecked();
    await user.click(saveButton());
    await waitFor(() => expect(api.updateAddress).toHaveBeenCalledTimes(1));
    expect(api.updateAddress.mock.calls[0]?.[2]).toMatchObject({
      isDefault: false,
      lat: -16.5,
      lng: -68.15,
      line2: "Piso 2",
      referenceText: "Puerta verde, frente a la farmacia",
    });
  });

  it("editar una no predeterminada y marcar la casilla envía isDefault: true", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Oficina" });
    await user.click(screen.getByRole("button", { name: "Editar dirección Oficina" }));
    await screen.findByRole("dialog");
    await user.click(
      screen.getByRole("checkbox", { name: "Usar como mi dirección predeterminada" }),
    );
    await user.click(saveButton());
    await waitFor(() => expect(api.updateAddress).toHaveBeenCalledTimes(1));
    expect(api.updateAddress.mock.calls[0]?.[2]).toMatchObject({ isDefault: true });
  });

  it("quitar el pin y guardar envía lat y lng en null (la dirección queda sin ubicación)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(screen.getByRole("button", { name: "Editar dirección Casa" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Quitar pin" }));
    await user.click(saveButton());
    await waitFor(() => expect(api.updateAddress).toHaveBeenCalledTimes(1));
    expect(api.updateAddress.mock.calls[0]?.[2]).toMatchObject({ lat: null, lng: null });
  });

  it("editar otra dirección no arrastra los datos de la anterior", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Casa" });
    await user.click(screen.getByRole("button", { name: "Editar dirección Casa" }));
    expect(await screen.findByLabelText("Etiqueta *")).toHaveValue("Casa");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Editar dirección Oficina" }));
    expect(await screen.findByLabelText("Etiqueta *")).toHaveValue("Oficina");
  });

  it("una dirección con departamento que no está en la lista obliga a elegir uno (no se guarda en silencio)", async () => {
    api.listActiveAddresses.mockResolvedValue([
      address("rara", { label: "Rara", department: "Lima" }),
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Rara" });
    await user.click(screen.getByRole("button", { name: "Editar dirección Rara" }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("Departamento *")).toHaveValue("");
    await user.click(saveButton());
    expect(await screen.findByText("Elige un departamento.")).toBeInTheDocument();
    expect(api.updateAddress).not.toHaveBeenCalled();
  });

  it("una dirección guardada en un país que ya no está habilitado conserva su país al editarla", async () => {
    api.listActiveAddresses.mockResolvedValue([
      address("arg", { label: "Argentina", country: "AR", department: "Córdoba" }),
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Argentina" });
    await user.click(screen.getByRole("button", { name: "Editar dirección Argentina" }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("País *")).toHaveValue("AR");
    expect(screen.getByLabelText("Departamento, estado o provincia")).toHaveValue("Córdoba");
    await user.click(saveButton());
    await waitFor(() => expect(api.updateAddress).toHaveBeenCalledTimes(1));
    expect(api.updateAddress.mock.calls[0]?.[2]).toMatchObject({
      country: "AR",
      department: "Córdoba",
    });
  });
});

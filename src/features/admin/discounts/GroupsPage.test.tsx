import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError } from "../lib/versioned";
import { GroupsPage } from "./GroupsPage";
import type { CustomerGroup, Discount, GroupMember, ProfileHit } from "./types";

const api = vi.hoisted(() => ({
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  setGroupArchived: vi.fn(),
  listMembers: vi.fn(),
  addMember: vi.fn(),
  setMemberArchived: vi.fn(),
  searchProfiles: vi.fn(),
  listDiscounts: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const VERSION = "2026-11-05T10:00:00.123456+00:00";
const NEW_VERSION = "2026-11-05T12:00:00.000001+00:00";

const group = (over: Partial<CustomerGroup> = {}): CustomerGroup => ({
  id: "g1",
  name: "Mayoristas",
  description: "Compran por docena",
  archived: false,
  updatedAt: VERSION,
  ...over,
});
const member = (over: Partial<GroupMember> = {}): GroupMember => ({
  id: "m1",
  groupId: "g1",
  profileId: "p1",
  fullName: "Luis Rojas",
  email: "luis@correo.com",
  archived: false,
  updatedAt: VERSION,
  ...over,
});
const hit = (over: Partial<ProfileHit> = {}): ProfileHit => ({
  id: "p9",
  fullName: "Ana Pérez",
  email: "ana@correo.com",
  phone: "+59171234567",
  ...over,
});
const discount = (over: Partial<Discount> = {}): Discount => ({
  id: "d1",
  name: "Mayoristas 20",
  kind: "group_price",
  params: { kind: "group_price", percent: 20, maxAmount: null },
  scope: "order",
  currency: "BOB",
  minOrderAmount: null,
  customerGroupId: "g1",
  requiresCoupon: false,
  stackableWithAutomatic: false,
  excludeSaleItems: false,
  usageLimitTotal: null,
  usageLimitPerCustomer: null,
  priority: 100,
  startsAt: null,
  endsAt: null,
  isActive: true,
  archived: false,
  updatedAt: VERSION,
  ...over,
});

let membersByGroup: Record<string, GroupMember[]>;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupsPage />
    </QueryClientProvider>,
  );
}
const dialogs = () => screen.getAllByRole("dialog", { hidden: true });
const top = () => within(dialogs().at(-1) as HTMLElement);
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const click = async (name: string) => await userEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  membersByGroup = {
    g1: [
      member(),
      member({ id: "m2", profileId: "p2", fullName: "Rosa Mamani", email: "rosa@correo.com" }),
    ],
  };
  api.listGroups.mockResolvedValue([group()]);
  api.listMembers.mockImplementation((id: string) => Promise.resolve(membersByGroup[id] ?? []));
  api.listDiscounts.mockResolvedValue([]);
  api.searchProfiles.mockResolvedValue([]);
  api.createGroup.mockResolvedValue(group({ id: "nuevo" }));
  api.updateGroup.mockResolvedValue(NEW_VERSION);
  api.setGroupArchived.mockResolvedValue(NEW_VERSION);
  api.addMember.mockResolvedValue(undefined);
  api.setMemberArchived.mockResolvedValue(NEW_VERSION);
});

describe("Grupos: lista y estados", () => {
  it("un h2 «Grupos de clientes» (el h1 es del marco) y UNA frase de para qué sirven", async () => {
    renderPage();
    await screen.findByText("Mayoristas");
    expect(
      screen.getByRole("heading", { level: 2, name: "Grupos de clientes" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Los grupos sirven para dar un precio especial a un tipo de clienta (por ejemplo, mayoristas): en un descuento de «precio por tipo de cliente» eliges el grupo y solo sus miembros reciben ese precio.",
      ),
    ).toBeInTheDocument();
  });

  it("«Cargando…» mientras llegan los grupos", () => {
    api.listGroups.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("si falla la carga lo dice y «Reintentar» vuelve a pedirlo", async () => {
    api.listGroups.mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    expect(await screen.findByText("No pudimos cargar los datos")).toBeInTheDocument();
    api.listGroups.mockResolvedValueOnce([group({ name: "Tras reintentar" })]);
    await click("Reintentar");
    expect(await screen.findByText("Tras reintentar")).toBeInTheDocument();
    expect(api.listGroups).toHaveBeenCalledTimes(2);
  });

  it("vacío: explica y ofrece crear el primer grupo (abre el diálogo)", async () => {
    api.listGroups.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Todavía no hay grupos/)).toBeInTheDocument();
    await click("Crear el primer grupo");
    expect(top().getByRole("heading", { name: "Nuevo grupo" })).toBeInTheDocument();
  });

  it("cada grupo con nombre, descripción, nº de miembros y estado; los archivados al final", async () => {
    api.listGroups.mockResolvedValue([
      group({ id: "g0", name: "Vieja", description: null, archived: true }),
      group(),
      group({ id: "g2", name: "Solo uno", description: null }),
      group({ id: "g3", name: "Vacío" }),
    ]);
    membersByGroup = {
      g1: [member(), member({ id: "m2", profileId: "p2" })],
      g2: [member({ id: "m3", groupId: "g2" })],
    };
    renderPage();
    await screen.findByText("Mayoristas");
    await waitFor(() =>
      expect(within(rowOf("Mayoristas")).getByText("2 miembros")).toBeInTheDocument(),
    );
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0]?.querySelector("p")?.textContent);
    expect(names).toEqual(["Mayoristas", "Solo uno", "Vacío", "Vieja"]);
    expect(within(rowOf("Mayoristas")).getByText("Compran por docena")).toBeInTheDocument();
    expect(within(rowOf("Mayoristas")).getByText("Activo")).toBeInTheDocument();
    expect(within(rowOf("Solo uno")).getByText("Sin descripción")).toBeInTheDocument();
    expect(await within(rowOf("Solo uno")).findByText("1 miembro")).toBeInTheDocument();
    const vacio = within(rowOf("Vacío"));
    expect(await vacio.findByText("Sin miembros")).toBeInTheDocument();
    expect(
      vacio.getByText("Sin miembros: nadie recibe todavía el precio de este grupo."),
    ).toBeInTheDocument();
    const vieja = within(rowOf("Vieja"));
    expect(vieja.getByText("Archivado")).toBeInTheDocument();
    expect(await vieja.findByText("Sin miembros")).toBeInTheDocument();
    // Un grupo archivado sin miembros no necesita la advertencia larga.
    expect(vieja.queryByText(/nadie recibe todavía/)).not.toBeInTheDocument();
    expect(vieja.getByRole("button", { name: "Restaurar el grupo «Vieja»" })).toBeInTheDocument();
    expect(vieja.queryByRole("button", { name: /Archivar/ })).not.toBeInTheDocument();
  });

  it("los botones miden al menos 44 px de alto", async () => {
    renderPage();
    await screen.findByText("Mayoristas");
    for (const name of [
      "Nuevo grupo",
      "Ver los miembros del grupo «Mayoristas»",
      "Editar el grupo «Mayoristas»",
      "Archivar el grupo «Mayoristas»",
    ]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
  });
});

describe("Grupos: crear", () => {
  const openCreate = async () => {
    await screen.findByText("Mayoristas");
    await click("Nuevo grupo");
    return top();
  };

  it("envía exactamente GroupInput (nombre y descripción recortados), avisa, cierra y refresca", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "  VIP  ");
    await userEvent.type(d.getByLabelText("Descripción (opcional)"), "  Clientas frecuentes ");
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    await waitFor(() =>
      expect(api.createGroup).toHaveBeenCalledWith({
        name: "VIP",
        description: "Clientas frecuentes",
      }),
    );
    expect(api.updateGroup).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Grupo creado.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listGroups.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("sin descripción envía null", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "VIP");
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    await waitFor(() =>
      expect(api.createGroup).toHaveBeenCalledWith({ name: "VIP", description: null }),
    );
  });

  it("nombre vacío: mensaje junto al campo, foco ahí y no se envía", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    expect(d.getByLabelText("Nombre")).toHaveAccessibleDescription(
      "Escribe un nombre para el grupo.",
    );
    expect(d.getByLabelText("Nombre")).toHaveFocus();
    expect(api.createGroup).not.toHaveBeenCalled();
    // Al corregirlo, el aviso se va.
    await userEvent.type(d.getByLabelText("Nombre"), "VIP");
    expect(screen.queryByText("Escribe un nombre para el grupo.")).not.toBeInTheDocument();
  });

  it("nombre de más de 80 caracteres y descripción de más de 300 se dicen y no se envían", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "a".repeat(81));
    await userEvent.click(d.getByLabelText("Descripción (opcional)"));
    await userEvent.paste("d".repeat(301));
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    expect(d.getByLabelText("Nombre")).toHaveAccessibleDescription(
      "El nombre admite hasta 80 caracteres.",
    );
    expect(d.getByLabelText("Descripción (opcional)")).toHaveAccessibleDescription(
      "La descripción admite hasta 300 caracteres.",
    );
    expect(d.getByLabelText("Nombre")).toHaveFocus();
    expect(api.createGroup).not.toHaveBeenCalled();
  });

  it("un nombre repetido (sin importar mayúsculas) avisa antes de enviar", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "mayoristas");
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    expect(d.getByLabelText("Nombre")).toHaveAccessibleDescription(
      "Ya hay un grupo con ese nombre.",
    );
    expect(api.createGroup).not.toHaveBeenCalled();
  });

  it("el nombre de un grupo ARCHIVADO se puede volver a usar", async () => {
    api.listGroups.mockResolvedValue([group({ archived: true })]);
    renderPage();
    await screen.findByText("Mayoristas");
    await click("Nuevo grupo");
    await userEvent.type(top().getByLabelText("Nombre"), "Mayoristas");
    await userEvent.click(top().getByRole("button", { name: "Guardar grupo" }));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledTimes(1));
  });

  it("un nombre repetido que solo conoce la base se muestra junto al campo con su mensaje", async () => {
    api.createGroup.mockRejectedValue(new AppError("conflict", "Ya hay un grupo con ese nombre."));
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "Nuevo");
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    await waitFor(() =>
      expect(d.getByLabelText("Nombre")).toHaveAccessibleDescription(
        "Ya hay un grupo con ese nombre.",
      ),
    );
    expect(d.getByLabelText("Nombre")).toHaveFocus();
    expect(d.getByLabelText("Nombre")).toHaveValue("Nuevo");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("otro error de la base se muestra en el diálogo, que sigue abierto", async () => {
    api.createGroup.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "Nuevo");
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    expect(await d.findByRole("alert")).toHaveTextContent(
      "No tienes permiso para realizar esta acción.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("un doble clic en Guardar envía una sola vez", async () => {
    let resolve: (g: CustomerGroup) => void = () => undefined;
    api.createGroup.mockReturnValue(new Promise<CustomerGroup>((r) => (resolve = r)));
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "Uno");
    await userEvent.dblClick(d.getByRole("button", { name: "Guardar grupo" }));
    expect(api.createGroup).toHaveBeenCalledTimes(1);
    resolve(group({ id: "n" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Cancelar cierra sin enviar y al reabrir el formulario parte de cero; el foco vuelve al botón", async () => {
    renderPage();
    const d = await openCreate();
    await userEvent.type(d.getByLabelText("Nombre"), "Borrador");
    await userEvent.click(d.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createGroup).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Nuevo grupo" })).toHaveFocus());
    await click("Nuevo grupo");
    expect(top().getByLabelText("Nombre")).toHaveValue("");
  });
});

describe("Grupos: renombrar y editar", () => {
  const openEdit = async () => {
    await screen.findByText("Mayoristas");
    await click("Editar el grupo «Mayoristas»");
    return top();
  };

  it("trae los datos y envía nombre y descripción con la versión leída", async () => {
    renderPage();
    const d = await openEdit();
    expect(d.getByRole("heading", { name: "Editar grupo" })).toBeInTheDocument();
    expect(d.getByLabelText("Nombre")).toHaveValue("Mayoristas");
    expect(d.getByLabelText("Descripción (opcional)")).toHaveValue("Compran por docena");
    await userEvent.clear(d.getByLabelText("Nombre"));
    await userEvent.type(d.getByLabelText("Nombre"), "Mayoristas VIP");
    await userEvent.clear(d.getByLabelText("Descripción (opcional)"));
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    await waitFor(() =>
      expect(api.updateGroup).toHaveBeenCalledWith("g1", VERSION, {
        name: "Mayoristas VIP",
        description: null,
      }),
    );
    expect(api.createGroup).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Grupo actualizado.");
  });

  it("guardar con el mismo nombre no cuenta como duplicado de sí mismo", async () => {
    renderPage();
    const d = await openEdit();
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    await waitFor(() => expect(api.updateGroup).toHaveBeenCalledTimes(1));
  });

  it("renombrar al nombre de OTRO grupo avisa", async () => {
    api.listGroups.mockResolvedValue([group(), group({ id: "g2", name: "VIP" })]);
    renderPage();
    const d = await openEdit();
    await userEvent.clear(d.getByLabelText("Nombre"));
    await userEvent.type(d.getByLabelText("Nombre"), "vip");
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    expect(d.getByLabelText("Nombre")).toHaveAccessibleDescription(
      "Ya hay un grupo con ese nombre.",
    );
    expect(api.updateGroup).not.toHaveBeenCalled();
  });

  it("conflicto de edición: banner, Guardar bloqueado, y «Recargar» cierra y trae la versión nueva", async () => {
    api.updateGroup.mockRejectedValue(new StaleVersionError());
    renderPage();
    const d = await openEdit();
    const before = api.listGroups.mock.calls.length;
    await userEvent.type(d.getByLabelText("Nombre"), " editado");
    await userEvent.click(d.getByRole("button", { name: "Guardar grupo" }));
    const banner = await d.findByText("Alguien más modificó esto");
    expect(banner.closest('[role="alert"]')).toHaveTextContent(/no se guardó nada tuyo/);
    expect(d.getByRole("button", { name: "Guardar grupo" })).toBeDisabled();
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listGroups.mock.calls.length).toBeGreaterThan(before));
    api.listGroups.mockResolvedValue([group({ name: "Mayoristas (de la otra persona)" })]);
    await userEvent.click(d.getByRole("button", { name: "Recargar la versión actual" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Mayoristas (de la otra persona)")).toBeInTheDocument();
  });
});

describe("Grupos: archivar y restaurar", () => {
  it("archivar pide confirmación y envía la versión leída", async () => {
    renderPage();
    await screen.findByText("Mayoristas");
    await click("Archivar el grupo «Mayoristas»");
    const d = top();
    expect(
      d.getByRole("heading", { name: "¿Archivar el grupo «Mayoristas»?" }),
    ).toBeInTheDocument();
    expect(api.setGroupArchived).not.toHaveBeenCalled();
    await userEvent.click(d.getByRole("button", { name: "Archivar grupo" }));
    await waitFor(() => expect(api.setGroupArchived).toHaveBeenCalledWith("g1", VERSION, true));
    expect(toast.success).toHaveBeenCalledWith("Grupo archivado.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("advierte qué descuentos vigentes dejarán de aplicarse a sus miembros", async () => {
    api.listDiscounts.mockResolvedValue([
      discount({ id: "1", name: "Mayoristas 20" }),
      discount({ id: "2", name: "Mayoristas 30" }),
      discount({ id: "3", name: "Archivado", archived: true }),
      discount({ id: "4", name: "Otro grupo", customerGroupId: "g2" }),
    ]);
    renderPage();
    await screen.findByText("Mayoristas");
    await waitFor(() => expect(api.listDiscounts).toHaveBeenCalled());
    // Se espera a que lleguen los descuentos antes de abrir la confirmación.
    await new Promise((r) => setTimeout(r, 50));
    await click("Archivar el grupo «Mayoristas»");
    expect(
      top().getByText(/Sus miembros dejarán de recibir el precio de este grupo/),
    ).toBeInTheDocument();
    expect(
      top().getByText(
        /2 descuentos usan este grupo y dejarán de aplicarse a sus miembros: Mayoristas 20, Mayoristas 30\./,
      ),
    ).toBeInTheDocument();
    expect(top().queryByText(/Archivado/)).not.toBeInTheDocument();
  });

  it("sin descuentos que lo usen no agrega advertencias", async () => {
    renderPage();
    await screen.findByText("Mayoristas");
    await click("Archivar el grupo «Mayoristas»");
    expect(top().queryByText(/descuento usa|descuentos usan/)).not.toBeInTheDocument();
  });

  it("cancelar no archiva nada", async () => {
    renderPage();
    await screen.findByText("Mayoristas");
    await click("Archivar el grupo «Mayoristas»");
    await userEvent.click(top().getByRole("button", { name: "Cancelar" }));
    expect(api.setGroupArchived).not.toHaveBeenCalled();
  });

  it("restaurar es directo (sin confirmación) y envía archived=false", async () => {
    api.listGroups.mockResolvedValue([group({ archived: true })]);
    renderPage();
    await screen.findByText("Mayoristas");
    await click("Restaurar el grupo «Mayoristas»");
    await waitFor(() => expect(api.setGroupArchived).toHaveBeenCalledWith("g1", VERSION, false));
    expect(toast.success).toHaveBeenCalledWith("Grupo restaurado.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("si alguien cambió el grupo antes: avisa del conflicto, no archiva y refresca; la confirmación sigue abierta", async () => {
    api.setGroupArchived.mockRejectedValue(new StaleVersionError());
    renderPage();
    await screen.findByText("Mayoristas");
    const before = api.listGroups.mock.calls.length;
    await click("Archivar el grupo «Mayoristas»");
    await userEvent.click(top().getByRole("button", { name: "Archivar grupo" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Otra persona guardó cambios"),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listGroups.mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("un error de la base al archivar se muestra con su mensaje", async () => {
    api.setGroupArchived.mockRejectedValue(
      new AppError("forbidden", "No tienes permiso para realizar esta acción."),
    );
    renderPage();
    await screen.findByText("Mayoristas");
    await click("Archivar el grupo «Mayoristas»");
    await userEvent.click(top().getByRole("button", { name: "Archivar grupo" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
    );
  });

  it("restaurar un grupo cuyo nombre ya usa otro muestra el mensaje de la base", async () => {
    api.listGroups.mockResolvedValue([group({ archived: true })]);
    api.setGroupArchived.mockRejectedValue(
      new AppError("conflict", "Ya hay un grupo con ese nombre."),
    );
    renderPage();
    await screen.findByText("Mayoristas");
    await click("Restaurar el grupo «Mayoristas»");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Ya hay un grupo con ese nombre."),
    );
  });
});

describe("Grupos: miembros", () => {
  const openMembers = async (name = "Mayoristas") => {
    await screen.findByText(name);
    await click(`Ver los miembros del grupo «${name}»`);
    return top();
  };

  it("lista a quienes están (nombre y correo) y cuántos son", async () => {
    renderPage();
    const d = await openMembers();
    expect(d.getByRole("heading", { name: "Miembros de «Mayoristas»" })).toBeInTheDocument();
    expect(await d.findByRole("heading", { name: "Miembros (2)" })).toBeInTheDocument();
    const list = d.getByRole("list", { name: "Miembros del grupo" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Luis Rojasluis@correo.comSacar", "Rosa Mamanirosa@correo.comSacar"]);
  });

  it("un miembro sin nombre ni correo no deja un hueco", async () => {
    membersByGroup = { g1: [member({ fullName: null, email: null })] };
    renderPage();
    const d = await openMembers();
    expect(await d.findByText("Sin nombre")).toBeInTheDocument();
    expect(d.getByText("Sin correo")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Sacar a Sin nombre del grupo" })).toBeInTheDocument();
  });

  it("avisa cuando el grupo no tiene miembros", async () => {
    membersByGroup = { g1: [] };
    renderPage();
    const d = await openMembers();
    expect(
      await d.findByText(/Este grupo todavía no tiene miembros: nadie recibirá su precio especial/),
    ).toBeInTheDocument();
  });

  it("carga y error de miembros, con «Reintentar»", async () => {
    api.listMembers.mockReturnValue(new Promise(() => undefined));
    renderPage();
    const d = await openMembers();
    expect(d.getByText("Cargando…")).toBeInTheDocument();
  });
  it("si falla la carga de miembros lo dice y reintenta", async () => {
    renderPage();
    await screen.findByText("Mayoristas");
    api.listMembers.mockRejectedValue(new Error("sin red"));
    await click("Ver los miembros del grupo «Mayoristas»");
    expect(await top().findByText(/No pudimos cargar los miembros/)).toBeInTheDocument();
    api.listMembers.mockResolvedValue([member()]);
    await userEvent.click(top().getByRole("button", { name: "Reintentar" }));
    expect(await top().findByText("Luis Rojas")).toBeInTheDocument();
  });

  it("un grupo archivado es de solo lectura: ni buscar, ni agregar, ni sacar", async () => {
    api.listGroups.mockResolvedValue([group({ archived: true })]);
    renderPage();
    const d = await openMembers();
    expect(await d.findByText("Luis Rojas")).toBeInTheDocument();
    expect(
      d.getByText(/Este grupo está archivado: restáuralo para agregar o sacar miembros/),
    ).toBeInTheDocument();
    expect(d.queryByLabelText("Buscar clientas")).not.toBeInTheDocument();
    expect(d.queryByRole("button", { name: /Sacar/ })).not.toBeInTheDocument();
  });

  describe("buscar clientas", () => {
    it("pide al menos 2 letras: con 1 no busca y lo explica", async () => {
      renderPage();
      const d = await openMembers();
      expect(d.getByLabelText("Buscar clientas")).toHaveAccessibleDescription(
        "Escribe al menos 2 letras del nombre o del correo.",
      );
      await userEvent.type(d.getByLabelText("Buscar clientas"), " a ");
      // Con una sola letra tampoco se promete una búsqueda («Buscando…») que nunca llegará.
      expect(d.queryByText("Buscando…")).not.toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(api.searchProfiles).not.toHaveBeenCalled();
    });

    it("espera a que dejes de escribir: «ana» hace UNA sola consulta, con el texto recortado", async () => {
      api.searchProfiles.mockResolvedValue([hit()]);
      renderPage();
      const d = await openMembers();
      await userEvent.type(d.getByLabelText("Buscar clientas"), "  ana ");
      // Mientras espera dice «Buscando…».
      expect(d.getByText("Buscando…")).toBeInTheDocument();
      expect(await d.findByText("Ana Pérez")).toBeInTheDocument();
      expect(api.searchProfiles).toHaveBeenCalledTimes(1);
      expect(api.searchProfiles).toHaveBeenCalledWith("ana");
    });

    it("cada resultado con nombre, correo y teléfono, y cuántas encontró", async () => {
      api.searchProfiles.mockResolvedValue([
        hit(),
        hit({ id: "p10", fullName: "Anabel Cruz", email: null, phone: null }),
      ]);
      renderPage();
      const d = await openMembers();
      await userEvent.type(d.getByLabelText("Buscar clientas"), "ana");
      await d.findByText("Ana Pérez");
      const results = d.getByRole("list", { name: "Clientas encontradas" });
      const first = within(within(results).getAllByRole("listitem")[0] as HTMLElement);
      expect(first.getByText("ana@correo.com")).toBeInTheDocument();
      expect(first.getByText("Teléfono: +59171234567")).toBeInTheDocument();
      const second = within(within(results).getAllByRole("listitem")[1] as HTMLElement);
      expect(second.getByText("Anabel Cruz")).toBeInTheDocument();
      expect(second.queryByText(/Teléfono/)).not.toBeInTheDocument();
      expect(d.getByText("Encontramos 2 clientas.")).toBeInTheDocument();
    });

    it("sin resultados lo dice con lo buscado", async () => {
      renderPage();
      const d = await openMembers();
      await userEvent.type(d.getByLabelText("Buscar clientas"), "zzz");
      expect(await d.findByText("No encontramos clientas con «zzz».")).toBeInTheDocument();
    });

    it("si la búsqueda falla lo dice y «Reintentar» vuelve a buscar", async () => {
      api.searchProfiles.mockRejectedValueOnce(new Error("falla"));
      renderPage();
      const d = await openMembers();
      await userEvent.type(d.getByLabelText("Buscar clientas"), "ana");
      expect(await d.findByText("No pudimos buscar. Inténtalo de nuevo.")).toBeInTheDocument();
      api.searchProfiles.mockResolvedValue([hit()]);
      await userEvent.click(d.getByRole("button", { name: "Reintentar" }));
      expect(await d.findByText("Ana Pérez")).toBeInTheDocument();
    });

    it("la búsqueda ni los datos de las clientas quedan en el almacenamiento ni en la dirección", async () => {
      api.searchProfiles.mockResolvedValue([hit()]);
      renderPage();
      const d = await openMembers();
      await userEvent.type(d.getByLabelText("Buscar clientas"), "ana");
      await d.findByText("Ana Pérez");
      expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/ana/i);
      expect(window.location.href).not.toMatch(/ana@|Ana/);
    });

    it("quien ya está en el grupo aparece como «Ya está en el grupo», sin botón de agregar", async () => {
      api.searchProfiles.mockResolvedValue([hit({ id: "p1", fullName: "Luis Rojas" })]);
      renderPage();
      const d = await openMembers();
      await userEvent.type(d.getByLabelText("Buscar clientas"), "luis");
      const results = await d.findByRole("list", { name: "Clientas encontradas" });
      expect(within(results).getByText("Ya está en el grupo")).toBeInTheDocument();
      expect(within(results).queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("agregar y sacar", () => {
    it("agregar envía grupo y clienta, avisa, refresca la lista y devuelve el foco al buscador", async () => {
      api.searchProfiles.mockResolvedValue([hit()]);
      renderPage();
      const d = await openMembers();
      await d.findByText("Rosa Mamani");
      await userEvent.type(d.getByLabelText("Buscar clientas"), "ana");
      await d.findByText("Ana Pérez");
      membersByGroup.g1 = [
        ...(membersByGroup.g1 ?? []),
        member({ id: "m9", profileId: "p9", fullName: "Ana Pérez", email: "ana@correo.com" }),
      ];
      await userEvent.click(d.getByRole("button", { name: "Agregar a Ana Pérez al grupo" }));
      await waitFor(() => expect(api.addMember).toHaveBeenCalledWith("g1", "p9"));
      expect(toast.success).toHaveBeenCalledWith("Ana Pérez se agregó al grupo.");
      expect(await d.findByRole("heading", { name: "Miembros (3)" })).toBeInTheDocument();
      expect(d.getByText("Ana Pérez se agregó al grupo.", { selector: "p" })).toBeInTheDocument();
      await waitFor(() => expect(d.getByLabelText("Buscar clientas")).toHaveFocus());
      expect(
        within(d.getByRole("list", { name: "Clientas encontradas" })).getByText(
          "Ya está en el grupo",
        ),
      ).toBeInTheDocument();
    });

    it("un error al agregar se muestra con el mensaje de la base", async () => {
      api.searchProfiles.mockResolvedValue([hit()]);
      api.addMember.mockRejectedValue(new AppError("conflict", "Esa clienta ya está en el grupo."));
      renderPage();
      const d = await openMembers();
      await userEvent.type(d.getByLabelText("Buscar clientas"), "ana");
      await d.findByText("Ana Pérez");
      await userEvent.click(d.getByRole("button", { name: "Agregar a Ana Pérez al grupo" }));
      expect(await d.findByRole("alert")).toHaveTextContent("Esa clienta ya está en el grupo.");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("sacar pide confirmación y envía la versión leída del miembro", async () => {
      renderPage();
      const d = await openMembers();
      await d.findByText("Luis Rojas");
      await userEvent.click(d.getByRole("button", { name: "Sacar a Luis Rojas del grupo" }));
      const confirm = top();
      expect(
        confirm.getByRole("heading", { name: "¿Sacar a Luis Rojas del grupo?" }),
      ).toBeInTheDocument();
      expect(api.setMemberArchived).not.toHaveBeenCalled();
      await userEvent.click(confirm.getByRole("button", { name: "Sacar del grupo" }));
      await waitFor(() => expect(api.setMemberArchived).toHaveBeenCalledWith("m1", VERSION, true));
      expect(toast.success).toHaveBeenCalledWith("Luis Rojas salió del grupo.");
    });

    it("cancelar no saca a nadie", async () => {
      renderPage();
      const d = await openMembers();
      await d.findByText("Luis Rojas");
      await userEvent.click(d.getByRole("button", { name: "Sacar a Luis Rojas del grupo" }));
      await userEvent.click(top().getByRole("button", { name: "Cancelar" }));
      expect(api.setMemberArchived).not.toHaveBeenCalled();
    });

    it("conflicto al sacar: banner en el diálogo de miembros y se cierra la confirmación", async () => {
      api.setMemberArchived.mockRejectedValue(new StaleVersionError());
      renderPage();
      const d = await openMembers();
      await d.findByText("Luis Rojas");
      await userEvent.click(d.getByRole("button", { name: "Sacar a Luis Rojas del grupo" }));
      await userEvent.click(top().getByRole("button", { name: "Sacar del grupo" }));
      expect(await screen.findByText("Alguien más modificó esto")).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("un error al sacar deja la confirmación abierta y muestra el mensaje", async () => {
      api.setMemberArchived.mockRejectedValue(
        new AppError("forbidden", "No tienes permiso para realizar esta acción."),
      );
      renderPage();
      const d = await openMembers();
      await d.findByText("Luis Rojas");
      await userEvent.click(d.getByRole("button", { name: "Sacar a Luis Rojas del grupo" }));
      await userEvent.click(top().getByRole("button", { name: "Sacar del grupo" }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("No tienes permiso para realizar esta acción."),
      );
      expect(
        top().getByRole("heading", { name: "¿Sacar a Luis Rojas del grupo?" }),
      ).toBeInTheDocument();
    });

    it("los botones y el buscador miden al menos 44 px de alto", async () => {
      api.searchProfiles.mockResolvedValue([hit()]);
      renderPage();
      const d = await openMembers();
      await d.findByText("Luis Rojas");
      expect(d.getByLabelText("Buscar clientas").className).toContain("min-h-11");
      expect(d.getByRole("button", { name: "Sacar a Luis Rojas del grupo" }).className).toContain(
        "min-h-11",
      );
      await userEvent.type(d.getByLabelText("Buscar clientas"), "ana");
      await d.findByText("Ana Pérez");
      expect(d.getByRole("button", { name: "Agregar a Ana Pérez al grupo" }).className).toContain(
        "min-h-11",
      );
    });
  });
});

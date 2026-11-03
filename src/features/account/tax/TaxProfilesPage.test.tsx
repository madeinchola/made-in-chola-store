import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/components/layout/layout-test-utils";
import { AppError } from "@/lib/errors";
import { asCustomer, customerProfile } from "@/test/auth-test-utils";
import { fromTaxDbError } from "./errors";
import type { TaxProfile } from "./types";

const api = vi.hoisted(() => ({
  listTaxProfiles: vi.fn(),
  createTaxProfile: vi.fn(),
  updateTaxProfile: vi.fn(),
  archiveTaxProfile: vi.fn(),
  restoreTaxProfile: vi.fn(),
  setDefaultTaxProfile: vi.fn(),
}));
vi.mock("./api", () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const settings = vi.hoisted(() => ({ data: undefined as Record<string, unknown> | undefined }));
vi.mock("@/features/catalog/hooks", () => ({ useStoreSettings: () => ({ data: settings.data }) }));

import { TaxProfilesPage } from "./TaxProfilesPage";

// Pantallas con diálogos y muchos formularios: en una máquina cargada 5 s se quedan cortos.
vi.setConfig({ testTimeout: 20_000 });

let seq = 0;
const tp = (over: Partial<TaxProfile> = {}): TaxProfile => {
  seq += 1;
  return {
    id: `t-${seq}`,
    docType: "ci",
    docNumber: `100000${seq}`,
    legalName: `Razón ${seq}`,
    isDefault: false,
    archived: false,
    createdAt: `2026-11-01T10:00:${String(seq).padStart(2, "0")}Z`,
    updatedAt: `2026-11-01T10:00:${String(seq).padStart(2, "0")}Z`,
    ...over,
  };
};

/** «Servidor» mínimo en memoria: cada acción cambia la lista que se relee. Las reglas finas de la base se prueban en SQL. */
let db: TaxProfile[];
const fakeServer = () => {
  api.listTaxProfiles.mockImplementation(async () => db.map((p) => ({ ...p })));
  api.createTaxProfile.mockImplementation(async (_id: string, input: Record<string, string>) => {
    const row = tp({ ...input, isDefault: db.every((p) => p.archived) });
    db = [row, ...db];
    return row;
  });
  api.updateTaxProfile.mockImplementation(async (id: string, input: Record<string, string>) => {
    db = db.map((p) => (p.id === id ? { ...p, ...input } : p));
    return db.find((p) => p.id === id);
  });
  api.archiveTaxProfile.mockImplementation(async (id: string) => {
    db = db.map((p) => (p.id === id ? { ...p, archived: true, isDefault: false } : p));
  });
  api.restoreTaxProfile.mockImplementation(async (id: string) => {
    db = db.map((p) => (p.id === id ? { ...p, archived: false } : p));
  });
  api.setDefaultTaxProfile.mockImplementation(async (id: string) => {
    db = db.map((p) => ({ ...p, isDefault: p.id === id }));
  });
};

const setup = (rows: TaxProfile[]) => {
  db = rows;
  fakeServer();
  return { user: userEvent.setup(), ...renderWithApp(<TaxProfilesPage />, { auth: asCustomer() }) };
};
type User = ReturnType<typeof userEvent.setup>;

const heading = () => screen.getByRole("heading", { level: 2, name: "Datos fiscales" });
const activeList = () => screen.getByRole("list", { name: "Datos fiscales activos" });
const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  settings.data = undefined;
});

describe("TaxProfilesPage · estados", () => {
  it("cargando: se anuncia, aria-busy y sin lista", () => {
    api.listTaxProfiles.mockReturnValue(new Promise(() => {}));
    renderWithApp(<TaxProfilesPage />, { auth: asCustomer() });
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus datos fiscales…");
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lee SOLO los datos de la persona en sesión (por su id)", async () => {
    setup([]);
    await screen.findByText("Aún no tienes datos fiscales");
    expect(api.listTaxProfiles).toHaveBeenCalledWith(customerProfile.id);
  });

  it("vacío: mensaje amable, contador 0 de 10 y un único botón para agregar", async () => {
    setup([]);
    expect(await screen.findByText("Aún no tienes datos fiscales")).toBeInTheDocument();
    expect(screen.getByText("0 de 10 activos")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Agregar datos fiscales" })).toHaveLength(1);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("error de carga: aviso con «Reintentar» que vuelve a pedir la lista", async () => {
    api.listTaxProfiles.mockRejectedValueOnce(new AppError("network", "x"));
    const { user } = setup([tp()]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar tus datos fiscales");
    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("list", { name: "Datos fiscales activos" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("título, introducción con el tope y contador", async () => {
    setup([tp(), tp(), tp()]);
    await screen.findByRole("list", { name: "Datos fiscales activos" });
    expect(heading()).toBeInTheDocument();
    expect(screen.getByText(/hasta 10 y elegir uno como predeterminado/)).toBeInTheDocument();
    expect(screen.getByText("3 de 10 activos")).toBeInTheDocument();
  });
});

describe("TaxProfilesPage · lista", () => {
  it("cada fila: tipo, documento, razón social; «Predeterminado» solo en el predeterminado", async () => {
    setup([
      tp({ docType: "nit", docNumber: "1020304021", legalName: "Empresa SRL", isDefault: true }),
      tp({ docType: "ci", docNumber: "1234567-1A", legalName: "Ana Cliente" }),
    ]);
    const list = await screen.findByRole("list", { name: "Datos fiscales activos" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const nit = rowOf("1020304021");
    expect(nit).toHaveTextContent("NIT");
    expect(nit).toHaveTextContent("Empresa SRL");
    expect(within(nit).getByText("Predeterminado")).toBeInTheDocument();
    const ci = rowOf("1234567-1A");
    expect(ci).toHaveTextContent("CI");
    expect(within(ci).queryByText("Predeterminado")).not.toBeInTheDocument();
    expect(screen.getAllByText("Predeterminado")).toHaveLength(1);
  });

  it("acciones con nombre accesible propio; el predeterminado no ofrece «Hacer predeterminado»", async () => {
    setup([tp({ docNumber: "1111111", isDefault: true }), tp({ docNumber: "2222222" })]);
    await screen.findByRole("list", { name: "Datos fiscales activos" });
    const first = rowOf("1111111");
    expect(
      within(first).getByRole("button", { name: "Editar datos fiscales de CI 1111111" }),
    ).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: "Archivar datos fiscales de CI 1111111" }),
    ).toBeInTheDocument();
    expect(
      within(first).queryByRole("button", { name: /Hacer predeterminados/ }),
    ).not.toBeInTheDocument();
    const second = rowOf("2222222");
    expect(
      within(second).getByRole("button", {
        name: "Hacer predeterminados los datos fiscales de CI 2222222",
      }),
    ).toBeInTheDocument();
  });

  it("los textos del cliente se muestran como TEXTO (sin HTML)", async () => {
    setup([tp({ legalName: "<img src=x onerror=alert(1)>", isDefault: true })]);
    await screen.findByText("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
  });

  it("archivados ocultos por defecto; el botón los muestra con «Restaurar» y sin editar/archivar", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222", archived: true }),
      tp({ docNumber: "3333333", archived: true }),
    ]);
    await screen.findByRole("list", { name: "Datos fiscales activos" });
    expect(screen.queryByText("2222222")).not.toBeInTheDocument();
    expect(screen.getByText("1 de 10 activos")).toBeInTheDocument(); // los archivados no cuentan
    const toggle = screen.getByRole("button", { name: "Mostrar archivados (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Ocultar archivados (2)");
    const archived = screen.getByRole("list", { name: "Datos fiscales archivados" });
    expect(toggle).toHaveAttribute("aria-controls", archived.id);
    expect(
      within(archived).getAllByRole("button", { name: /^Restaurar datos fiscales de/ }),
    ).toHaveLength(2);
    expect(
      within(archived).queryByRole("button", { name: /Editar|Archivar|Hacer/ }),
    ).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByText("2222222")).not.toBeInTheDocument();
  });

  it("sin archivados no hay botón de archivados", async () => {
    setup([tp({ isDefault: true })]);
    await screen.findByRole("list", { name: "Datos fiscales activos" });
    expect(screen.queryByRole("button", { name: /archivados/ })).not.toBeInTheDocument();
  });

  it("solo archivados: se ve el estado vacío de activos y el botón para verlos", async () => {
    setup([tp({ archived: true })]);
    expect(await screen.findByText("Aún no tienes datos fiscales")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar archivados (1)" })).toBeInTheDocument();
  });
});

describe("TaxProfilesPage · tope de 10", () => {
  const ten = () =>
    Array.from({ length: 10 }, (_, i) =>
      tp({ docNumber: `20000${String(i).padStart(2, "0")}`, isDefault: i === 0 }),
    );

  it("con 9 activos todavía se puede agregar y no hay aviso", async () => {
    const { user } = setup(ten().slice(0, 9));
    const add = await screen.findByRole("button", { name: "Agregar datos fiscales" });
    expect(add).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/Llegaste al máximo/)).not.toBeInTheDocument();
    await user.click(add);
    expect(
      await screen.findByRole("dialog", { name: "Agregar datos fiscales" }),
    ).toBeInTheDocument();
  });

  it("con 10 activos: aviso claro, «Agregar» con aria-disabled (sigue enfocable) y sin diálogo", async () => {
    const { user } = setup(ten());
    const add = await screen.findByRole("button", { name: "Agregar datos fiscales" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Llegaste al máximo de 10 datos fiscales activos.",
    );
    expect(screen.getByText("10 de 10 activos")).toBeInTheDocument();
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).not.toBeDisabled();
    expect(add).toHaveAccessibleDescription(/Llegaste al máximo de 10/);
    await user.click(add);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("con 10 activos, restaurar un archivado tampoco se ofrece (aria-disabled) y no llama al servidor", async () => {
    const { user } = setup([...ten(), tp({ docNumber: "9999999", archived: true })]);
    await user.click(await screen.findByRole("button", { name: "Mostrar archivados (1)" }));
    const restore = screen.getByRole("button", { name: "Restaurar datos fiscales de CI 9999999" });
    expect(restore).toHaveAttribute("aria-disabled", "true");
    expect(restore).toHaveAccessibleDescription(/Llegaste al máximo/);
    await user.click(restore);
    expect(api.restoreTaxProfile).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────  Crear y editar  ───────────────────────────── */

const openCreate = async (user: User) => {
  await user.click(await screen.findByRole("button", { name: "Agregar datos fiscales" }));
  return screen.findByRole("dialog", { name: "Agregar datos fiscales" });
};
const fillForm = async (user: User, d: HTMLElement, number: string, name = "Ana Cliente") => {
  if (number) await user.type(within(d).getByLabelText("Número de documento"), number);
  if (name) await user.type(within(d).getByLabelText("Razón social o nombre"), name);
};
const save = (user: User, d: HTMLElement, name = "Guardar") =>
  user.click(within(d).getByRole("button", { name }));

describe("TaxProfilesPage · agregar", () => {
  it("el diálogo trae tipo, número y razón social con las ayudas del tipo elegido", async () => {
    const { user } = setup([]);
    const d = await openCreate(user);
    const type = within(d).getByLabelText("Tipo de documento") as HTMLSelectElement;
    expect(
      within(type)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Cédula de identidad (CI)",
      "NIT",
      "Carnet de extranjería (CE)",
      "Pasaporte",
      "Otro documento",
    ]);
    expect(type.value).toBe("ci");
    const number = within(d).getByLabelText("Número de documento");
    await waitFor(() => expect(number).toHaveFocus());
    expect(number).toHaveAccessibleDescription(
      "4 a 10 dígitos, con complemento opcional (por ejemplo 1234567-1A).",
    );
    await user.selectOptions(type, "nit");
    expect(number).toHaveAccessibleDescription("7 a 13 dígitos, solo números.");
    await user.selectOptions(type, "pas");
    expect(number).toHaveAccessibleDescription("5 a 20 letras o números.");
    expect(within(d).getByLabelText("Razón social o nombre")).toHaveAccessibleDescription(
      "Tal como debe salir en la factura.",
    );
  });

  it("el campo del documento no corrige ni capitaliza solo (se escribe en mayúsculas) y no autocompleta", async () => {
    const { user } = setup([]);
    const d = await openCreate(user);
    const number = within(d).getByLabelText("Número de documento");
    expect(number).toHaveAttribute("autocomplete", "off");
    expect(number).toHaveAttribute("autocapitalize", "characters");
    expect(number).toHaveAttribute("spellcheck", "false");
  });

  it("guarda con el valor CANÓNICO (CI en mayúsculas y con guion), el id de la persona, avisa y la lista se actualiza", async () => {
    const { user } = setup([]);
    const d = await openCreate(user);
    await fillForm(user, d, " 1234567 1a ", "  Ana Cliente  ");
    await save(user, d);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Datos fiscales guardados."));
    expect(api.createTaxProfile).toHaveBeenCalledTimes(1);
    expect(api.createTaxProfile).toHaveBeenCalledWith(customerProfile.id, {
      docType: "ci",
      docNumber: "1234567-1A",
      legalName: "Ana Cliente",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const row = await screen.findByText("1234567-1A");
    expect(row.closest("li")).toHaveTextContent("Ana Cliente");
    expect(
      within(row.closest("li") as HTMLElement).getByText("Predeterminado"),
    ).toBeInTheDocument(); // el primero
    expect(screen.getByText("1 de 10 activos")).toBeInTheDocument();
  });

  it("el foco no se pierde: si el botón que abrió el diálogo desaparece (estado vacío), va al título", async () => {
    const { user } = setup([]);
    const d = await openCreate(user);
    await fillForm(user, d, "1234567");
    await save(user, d);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("si el botón que abrió el diálogo sigue ahí (lista con datos), el foco vuelve a él", async () => {
    const { user } = setup([tp({ isDefault: true })]);
    const opener = await screen.findByRole("button", { name: "Agregar datos fiscales" });
    const d = await openCreate(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(d).not.toBeInTheDocument();
  });

  it("cambiar el tipo revalida lo ya escrito, pero no grita «ingresa el número» si todavía no se escribió nada", async () => {
    const { user } = setup([]);
    const d = await openCreate(user);
    const type = within(d).getByLabelText("Tipo de documento");
    await user.selectOptions(type, "nit");
    expect(within(d).queryByText("Ingresa el número de documento.")).not.toBeInTheDocument();
    await user.selectOptions(type, "ci");
    await user.type(within(d).getByLabelText("Número de documento"), "1234"); // válido como CI (4 dígitos)
    expect(within(d).queryByRole("alert")).not.toBeInTheDocument();
    await user.selectOptions(type, "nit"); // …pero no como NIT (mínimo 7)
    expect(await within(d).findByText("El NIT debe tener al menos 7 dígitos.")).toBeInTheDocument();
    expect(within(d).getByLabelText("Número de documento")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["ci", "", "Ingresa el número de documento."],
    ["ci", "123", "El CI debe tener al menos 4 dígitos."],
    ["ci", "12345678901", "El CI debe tener como máximo 10 dígitos."],
    [
      "ci",
      "1234567-1",
      "El CI lleva solo números y, si corresponde, un complemento separado por guion o espacio (por ejemplo 1234567-1A).",
    ],
    ["nit", "123456", "El NIT debe tener al menos 7 dígitos."],
    ["nit", "12345678901234", "El NIT debe tener como máximo 13 dígitos."],
    ["nit", "1234567A", "El NIT lleva solo números."],
    ["ce", "ABCD", "El carnet de extranjería debe tener al menos 5 caracteres."],
    ["pas", "AB-1234", "El pasaporte lleva solo letras y números, sin espacios ni símbolos."],
    ["otro", "AB", "El documento debe tener al menos 3 caracteres."],
  ])("estricto · %s «%s» → %s (sin llamar al servidor)", async (type, number, message) => {
    const { user } = setup([]);
    const d = await openCreate(user);
    await user.selectOptions(within(d).getByLabelText("Tipo de documento"), type);
    await fillForm(user, d, number);
    await save(user, d);
    expect(await within(d).findByText(message)).toBeInTheDocument();
    expect(api.createTaxProfile).not.toHaveBeenCalled();
  });

  it.each([
    ["ci", "123456789012345678901234", true], // 24 caracteres: el máximo
    ["nit", "AB-123", true],
    ["otro", "AB", false], // 2: corto
    ["otro", "A".repeat(25), false], // 25: largo
  ])("ajuste lenient · %s «%s» → %s", async (type, number, accepted) => {
    settings.data = { tax_id_validation: "lenient" };
    const { user } = setup([]);
    const d = await openCreate(user);
    await user.selectOptions(within(d).getByLabelText("Tipo de documento"), type);
    expect(within(d).getByLabelText("Número de documento")).toHaveAccessibleDescription(
      "Letras, números, espacios, puntos, barras o guiones (3 a 24 caracteres).",
    );
    await fillForm(user, d, number);
    await save(user, d);
    if (accepted) await waitFor(() => expect(api.createTaxProfile).toHaveBeenCalledTimes(1));
    else {
      expect(await within(d).findByRole("alert")).toBeInTheDocument();
      expect(api.createTaxProfile).not.toHaveBeenCalled();
    }
  });

  it("si el ajuste no cargó (o trae un valor raro) se usa el nivel estricto", async () => {
    settings.data = { tax_id_validation: "quizás" };
    const { user } = setup([]);
    const d = await openCreate(user);
    await user.selectOptions(within(d).getByLabelText("Tipo de documento"), "nit");
    await fillForm(user, d, "AB-123");
    await save(user, d);
    expect(await within(d).findByText("El NIT lleva solo números.")).toBeInTheDocument();
  });

  it("razón social: obligatoria y máximo 160 (160 vale, 161 no)", async () => {
    const { user } = setup([]);
    const d = await openCreate(user);
    await fillForm(user, d, "1234567", "   ");
    await save(user, d);
    expect(await within(d).findByText("Ingresa la razón social o tu nombre.")).toBeInTheDocument();
    const name = within(d).getByLabelText("Razón social o nombre");
    await user.clear(name);
    await user.click(name);
    await user.paste("x".repeat(161));
    await save(user, d);
    expect(await within(d).findByText("Máximo 160 caracteres.")).toBeInTheDocument();
    expect(api.createTaxProfile).not.toHaveBeenCalled();
    await user.clear(name);
    await user.click(name);
    await user.paste("x".repeat(160));
    await save(user, d);
    await waitFor(() => expect(api.createTaxProfile).toHaveBeenCalledTimes(1));
  });

  it("la razón social cuenta caracteres, no unidades UTF-16: 160 emojis caben y 161 no", async () => {
    const { user } = setup([]);
    const d = await openCreate(user);
    await fillForm(user, d, "1234567", "");
    const name = within(d).getByLabelText("Razón social o nombre");
    await user.click(name);
    await user.paste("😀".repeat(161));
    await save(user, d);
    expect(await within(d).findByText("Máximo 160 caracteres.")).toBeInTheDocument();
    await user.clear(name);
    await user.click(name);
    await user.paste("😀".repeat(160));
    await save(user, d);
    await waitFor(() => expect(api.createTaxProfile).toHaveBeenCalledTimes(1));
  });

  it("errores de la base: el documento repetido se marca en SU campo y recibe el foco", async () => {
    const { user } = setup([]);
    api.createTaxProfile.mockRejectedValue(
      fromTaxDbError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "tax_profiles_no_dup_idx"',
      }),
    );

    const d = await openCreate(user);
    await fillForm(user, d, "1234567");
    await save(user, d);
    expect(
      await within(d).findByText("Ya tienes datos fiscales activos con ese documento."),
    ).toBeInTheDocument();
    const number = within(d).getByLabelText("Número de documento");
    expect(number).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(number).toHaveFocus());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("errores de la base: formato del documento → en el campo; razón social → en su campo", async () => {
    api.createTaxProfile.mockRejectedValueOnce(
      fromTaxDbError({
        code: "23514",
        message:
          'new row for relation "tax_profiles" violates check constraint "tax_profiles_doc_number"',
      }),
    );
    const { user } = setup([]);
    const d = await openCreate(user);
    await fillForm(user, d, "1234567");
    await save(user, d);
    expect(
      await within(d).findByText("El documento no tiene un formato válido."),
    ).toBeInTheDocument();
    // …y está ligado al CAMPO del documento (no es un aviso suelto del formulario): inválido, descrito por el error y con foco
    const number = within(d).getByLabelText("Número de documento");
    expect(number).toHaveAttribute("aria-invalid", "true");
    expect(number).toHaveAccessibleDescription(/El documento no tiene un formato válido\./);
    await waitFor(() => expect(number).toHaveFocus());
    api.createTaxProfile.mockRejectedValueOnce(
      fromTaxDbError({
        code: "23514",
        message:
          'new row for relation "tax_profiles" violates check constraint "tax_profiles_legal_name"',
      }),
    );
    await save(user, d);
    const name = within(d).getByLabelText("Razón social o nombre");
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(
      within(d).getByText("La razón social debe tener entre 1 y 160 caracteres."),
    ).toBeInTheDocument();
  });

  it("tope de 10 desde la base: aviso del formulario (no de un campo) y el diálogo sigue abierto", async () => {
    const { user } = setup([]);
    api.createTaxProfile.mockRejectedValue(
      fromTaxDbError({
        code: "23514",
        message: "Alcanzaste el máximo de 10 registros activos; archiva alguno para agregar otro",
      }),
    );

    const d = await openCreate(user);
    await fillForm(user, d, "1234567");
    await save(user, d);
    expect(await within(d).findByRole("alert")).toHaveTextContent(
      "Llegaste al máximo de 10 datos fiscales activos. Archiva alguno para agregar otro.",
    );
    expect(within(d).getByLabelText("Número de documento")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("un error desconocido se muestra como aviso sin texto técnico", async () => {
    const { user } = setup([]);
    api.createTaxProfile.mockRejectedValue(
      fromTaxDbError({ code: "XX000", message: "detalle interno" }),
    );

    const d = await openCreate(user);
    await fillForm(user, d, "1234567");
    await save(user, d);
    const alert = await within(d).findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo completar la operación. Inténtalo de nuevo.");
    expect(alert).not.toHaveTextContent("detalle interno");
  });

  it("doble envío: una sola petición; con ella en vuelo no se cierra (Escape/Cancelar) y el botón conserva el foco", async () => {
    const { user } = setup([]);
    let resolve: (value: unknown) => void = () => {};
    api.createTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));

    const d = await openCreate(user);
    await fillForm(user, d, "1234567");
    const button = within(d).getByRole("button", { name: "Guardar" });
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    await user.click(button);
    await user.keyboard("{Escape}");
    await user.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(api.createTaxProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Cancelar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(button).not.toBeDisabled();
    await act(async () => resolve({}));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("reabrir empieza limpio (no arrastra lo escrito)", async () => {
    const { user } = setup([tp({ isDefault: true })]);
    let d = await openCreate(user);
    await fillForm(user, d, "99999", "Borrador");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    d = await openCreate(user);
    expect(within(d).getByLabelText("Número de documento")).toHaveValue("");
    expect(within(d).getByLabelText("Razón social o nombre")).toHaveValue("");
    expect(within(d).getByLabelText("Tipo de documento")).toHaveValue("ci");
  });
});

describe("TaxProfilesPage · editar", () => {
  it("el diálogo trae los datos de ESA fila; solo se envían tipo, documento y razón social; el foco vuelve a «Editar»", async () => {
    const { user } = setup([
      tp({ docType: "nit", docNumber: "1020304021", legalName: "Empresa SRL", isDefault: true }),
      tp({ docNumber: "7654321", legalName: "Otra persona" }),
    ]);
    const editButton = await screen.findByRole("button", {
      name: "Editar datos fiscales de NIT 1020304021",
    });
    await user.click(editButton);
    const d = await screen.findByRole("dialog", { name: "Editar datos fiscales" });
    expect(within(d).getByLabelText("Tipo de documento")).toHaveValue("nit");
    expect(within(d).getByLabelText("Número de documento")).toHaveValue("1020304021");
    expect(within(d).getByLabelText("Razón social o nombre")).toHaveValue("Empresa SRL");
    const name = within(d).getByLabelText("Razón social o nombre");
    await user.clear(name);
    await user.type(name, "Empresa Nueva SRL");
    await user.click(within(d).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Datos fiscales actualizados."));
    expect(api.updateTaxProfile).toHaveBeenCalledTimes(1);
    expect(api.updateTaxProfile).toHaveBeenCalledWith(expect.stringMatching(/^t-/), {
      docType: "nit",
      docNumber: "1020304021",
      legalName: "Empresa Nueva SRL",
    });
    expect(api.createTaxProfile).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Empresa Nueva SRL")).toBeInTheDocument();
    expect(editButton).toHaveFocus();
  });

  it("editar otra fila no arrastra los datos de la anterior", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", legalName: "Uno", isDefault: true }),
      tp({ docNumber: "2222222", legalName: "Dos" }),
    ]);
    await user.click(
      await screen.findByRole("button", { name: "Editar datos fiscales de CI 1111111" }),
    );
    await screen.findByRole("dialog", { name: "Editar datos fiscales" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Editar datos fiscales de CI 2222222" }));
    const d = await screen.findByRole("dialog", { name: "Editar datos fiscales" });
    expect(within(d).getByLabelText("Número de documento")).toHaveValue("2222222");
    expect(within(d).getByLabelText("Razón social o nombre")).toHaveValue("Dos");
  });

  it("editar al documento de otro dato activo: el error de duplicado se marca en el campo", async () => {
    const { user } = setup([tp({ docNumber: "1111111", isDefault: true })]);
    api.updateTaxProfile.mockRejectedValue(
      fromTaxDbError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "tax_profiles_no_dup_idx"',
      }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Editar datos fiscales de CI 1111111" }),
    );
    const d = await screen.findByRole("dialog", { name: "Editar datos fiscales" });
    await user.click(within(d).getByRole("button", { name: "Guardar cambios" }));
    expect(
      await within(d).findByText("Ya tienes datos fiscales activos con ese documento."),
    ).toBeInTheDocument();
  });

  it("un documento antiguo que no cumple el nivel estricto obliga a corregirlo al editar", async () => {
    const { user } = setup([tp({ docType: "nit", docNumber: "AB-123", isDefault: true })]);
    await user.click(
      await screen.findByRole("button", { name: "Editar datos fiscales de NIT AB-123" }),
    );
    const d = await screen.findByRole("dialog", { name: "Editar datos fiscales" });
    await user.click(within(d).getByRole("button", { name: "Guardar cambios" }));
    expect(await within(d).findByText("El NIT lleva solo números.")).toBeInTheDocument();
    expect(api.updateTaxProfile).not.toHaveBeenCalled();
  });
});

/* ───────────────────────  Predeterminado, archivar, restaurar  ─────────────────────── */

describe("TaxProfilesPage · predeterminado", () => {
  it("marca otro como predeterminado: llama con su id, avisa, mueve la insignia y el foco va al título", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222" }),
    ]);
    const target = (await screen.findByText("2222222")).closest("li") as HTMLElement;
    await user.click(within(target).getByRole("button", { name: /Hacer predeterminados/ }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Datos fiscales predeterminados actualizados."),
    );
    expect(api.setDefaultTaxProfile).toHaveBeenCalledTimes(1);
    const second = db.find((p) => p.docNumber === "2222222")!;
    expect(api.setDefaultTaxProfile).toHaveBeenCalledWith(second.id);
    await waitFor(() =>
      expect(within(rowOf("2222222")).getByText("Predeterminado")).toBeInTheDocument(),
    );
    expect(within(rowOf("1111111")).queryByText("Predeterminado")).not.toBeInTheDocument();
    expect(screen.getAllByText("Predeterminado")).toHaveLength(1);
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("doble clic: una sola petición y el botón muestra que está ocupado", async () => {
    let resolve: (value: unknown) => void = () => {};
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222" }),
    ]);
    api.setDefaultTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    const button = await screen.findByRole("button", {
      name: "Hacer predeterminados los datos fiscales de CI 2222222",
    });
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    await user.click(button);
    await user.dblClick(button);
    expect(api.setDefaultTaxProfile).toHaveBeenCalledTimes(1);
    expect(button).not.toBeDisabled();
    await act(async () => resolve(undefined));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("mientras una acción está en vuelo las demás filas ignoran los clics", async () => {
    let resolve: (value: unknown) => void = () => {};
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222" }),
      tp({ docNumber: "3333333" }),
    ]);
    api.setDefaultTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = await screen.findByRole("button", {
      name: "Hacer predeterminados los datos fiscales de CI 2222222",
    });
    const b = screen.getByRole("button", {
      name: "Hacer predeterminados los datos fiscales de CI 3333333",
    });
    await user.click(a);
    await waitFor(() => expect(a).toHaveAttribute("aria-busy", "true"));
    expect(b).toHaveAttribute("aria-disabled", "true");
    expect(b).not.toHaveAttribute("aria-busy"); // solo la fila en curso muestra el indicador
    await user.click(b);
    expect(api.setDefaultTaxProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve(undefined));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("un fallo se avisa con el mensaje en español y el botón queda libre para reintentar", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222" }),
    ]);
    api.setDefaultTaxProfile.mockRejectedValueOnce(
      fromTaxDbError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "tax_profiles_one_default_idx"',
      }),
    );
    const button = await screen.findByRole("button", {
      name: "Hacer predeterminados los datos fiscales de CI 2222222",
    });
    await user.click(button);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Los datos cambiaron mientras los editabas. Inténtalo de nuevo.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });
});

describe("TaxProfilesPage · archivar (con confirmación)", () => {
  const archiveButton = (number: string) =>
    screen.findByRole("button", { name: `Archivar datos fiscales de CI ${number}` });

  it("pide confirmación: no archiva hasta confirmar; Cancelar y Escape no cambian nada y devuelven el foco", async () => {
    const { user } = setup([tp({ docNumber: "1111111", isDefault: true })]);
    const opener = await archiveButton("1111111");
    await user.click(opener);
    let d = await screen.findByRole("dialog", { name: "¿Archivar estos datos fiscales?" });
    expect(d).toHaveTextContent("Podrás restaurarlos cuando quieras");
    expect(api.archiveTaxProfile).not.toHaveBeenCalled();
    await user.click(within(d).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    await user.click(opener);
    d = await screen.findByRole("dialog", { name: "¿Archivar estos datos fiscales?" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(api.archiveTaxProfile).not.toHaveBeenCalled();
    expect(screen.getByText("1111111")).toBeInTheDocument();
  });

  it("confirmar archiva SOLO esa fila, avisa, la saca de la lista, aparece «Mostrar archivados» y el foco va al título", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222" }),
    ]);
    await user.click(await archiveButton("2222222"));
    const d = await screen.findByRole("dialog", { name: "¿Archivar estos datos fiscales?" });
    await user.click(within(d).getByRole("button", { name: "Sí, archivar" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Datos fiscales archivados."));
    expect(api.archiveTaxProfile).toHaveBeenCalledTimes(1);
    expect(api.archiveTaxProfile).toHaveBeenCalledWith(
      db.find((p) => p.docNumber === "2222222")!.id,
    );
    await waitFor(() => expect(screen.queryByText("2222222")).not.toBeInTheDocument());
    expect(screen.getByText("1111111")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Mostrar archivados (1)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("al archivar el predeterminado con más activos, avisa de quién lo hereda; en los demás casos no", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222" }),
    ]);
    await user.click(await archiveButton("1111111"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Son tus datos predeterminados");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(await archiveButton("2222222")); // no es el predeterminado
    expect(await screen.findByRole("dialog")).not.toHaveTextContent(
      "Son tus datos predeterminados",
    );
  });

  it("archivar el único dato (predeterminado) no promete un heredero", async () => {
    const { user } = setup([tp({ docNumber: "1111111", isDefault: true })]);
    await user.click(await archiveButton("1111111"));
    expect(await screen.findByRole("dialog")).not.toHaveTextContent(
      "Son tus datos predeterminados",
    );
  });

  it("si falla, el diálogo sigue abierto con el motivo y se puede reintentar", async () => {
    const { user } = setup([tp({ docNumber: "1111111", isDefault: true })]);
    api.archiveTaxProfile.mockRejectedValueOnce(
      new AppError("network", "No pudimos conectar con el servidor. Revisa tu conexión."),
    );
    await user.click(await archiveButton("1111111"));
    const d = await screen.findByRole("dialog", { name: "¿Archivar estos datos fiscales?" });
    await user.click(within(d).getByRole("button", { name: "Sí, archivar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(
      "No pudimos conectar con el servidor.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    await user.click(within(d).getByRole("button", { name: "Sí, archivar" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("el aviso de un intento fallido no reaparece al abrir otro archivado", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222" }),
    ]);
    api.archiveTaxProfile.mockRejectedValueOnce(new AppError("unknown", "Falló algo"));
    await user.click(await archiveButton("1111111"));
    let d = await screen.findByRole("dialog");
    await user.click(within(d).getByRole("button", { name: "Sí, archivar" }));
    await within(d).findByText("Falló algo");
    await user.click(within(d).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(await archiveButton("2222222"));
    d = await screen.findByRole("dialog");
    expect(within(d).queryByText("Falló algo")).not.toBeInTheDocument();
  });

  it("doble clic en confirmar: una sola petición; con ella en vuelo el diálogo no se cierra", async () => {
    let resolve: (value: unknown) => void = () => {};
    const { user } = setup([tp({ docNumber: "1111111", isDefault: true })]);
    api.archiveTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    await user.click(await archiveButton("1111111"));
    const d = await screen.findByRole("dialog");
    const confirm = within(d).getByRole("button", { name: "Sí, archivar" });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    await user.click(confirm);
    await user.dblClick(confirm);
    await user.keyboard("{Escape}");
    await user.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(api.archiveTaxProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(confirm).not.toBeDisabled();
    await act(async () => resolve(undefined));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("TaxProfilesPage · restaurar", () => {
  it("restaura un archivado: llama con su id, avisa y pasa a la lista de activos", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222", archived: true }),
    ]);
    await user.click(await screen.findByRole("button", { name: "Mostrar archivados (1)" }));
    await user.click(
      screen.getByRole("button", { name: "Restaurar datos fiscales de CI 2222222" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Datos fiscales restaurados."));
    expect(api.restoreTaxProfile).toHaveBeenCalledWith(
      db.find((p) => p.docNumber === "2222222")!.id,
    );
    await waitFor(() => expect(within(activeList()).getByText("2222222")).toBeInTheDocument());
    expect(screen.getByText("2 de 10 activos")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /archivados/ })).not.toBeInTheDocument();
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("si la base lo rechaza (tope o documento repetido) se avisa con el mensaje en español", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222", archived: true }),
    ]);
    api.restoreTaxProfile.mockRejectedValueOnce(
      fromTaxDbError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "tax_profiles_no_dup_idx"',
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Mostrar archivados (1)" }));
    const restore = screen.getByRole("button", { name: "Restaurar datos fiscales de CI 2222222" });
    await user.click(restore);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Ya tienes datos fiscales activos con ese documento.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(restore).not.toHaveAttribute("aria-busy");
  });

  it("doble clic: una sola petición", async () => {
    let resolve: (value: unknown) => void = () => {};
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222", archived: true }),
    ]);
    api.restoreTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    await user.click(await screen.findByRole("button", { name: "Mostrar archivados (1)" }));
    const restore = screen.getByRole("button", { name: "Restaurar datos fiscales de CI 2222222" });
    await user.click(restore);
    await waitFor(() => expect(restore).toHaveAttribute("aria-busy", "true"));
    await user.click(restore);
    await user.dblClick(restore);
    expect(api.restoreTaxProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve(undefined));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });
});

describe("envío simultáneo (dos eventos en el MISMO instante, antes de que React vuelva a pintar)", () => {
  it("agregar: dos envíos a la vez → una sola petición", async () => {
    const { user } = setup([]);
    let resolve: (value: unknown) => void = () => {};
    api.createTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    const d = await openCreate(user);
    await fillForm(user, d, "1234567");
    const form = within(d)
      .getByRole("button", { name: "Guardar" })
      .closest("form") as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(api.createTaxProfile).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.createTaxProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve({}));
  });

  it("hacer predeterminado: dos clics a la vez (aunque sea en filas distintas) → una sola petición", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222" }),
      tp({ docNumber: "3333333" }),
    ]);
    let resolve: (value: unknown) => void = () => {};
    api.setDefaultTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = await screen.findByRole("button", {
      name: "Hacer predeterminados los datos fiscales de CI 2222222",
    });
    const b = screen.getByRole("button", {
      name: "Hacer predeterminados los datos fiscales de CI 3333333",
    });
    void user;
    act(() => {
      fireEvent.click(a);
      fireEvent.click(b);
    });
    await waitFor(() => expect(api.setDefaultTaxProfile).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.setDefaultTaxProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve(undefined));
  });

  it("restaurar: dos clics a la vez → una sola petición", async () => {
    const { user } = setup([
      tp({ docNumber: "1111111", isDefault: true }),
      tp({ docNumber: "2222222", archived: true }),
    ]);
    let resolve: (value: unknown) => void = () => {};
    api.restoreTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    await user.click(await screen.findByRole("button", { name: "Mostrar archivados (1)" }));
    const restore = screen.getByRole("button", { name: "Restaurar datos fiscales de CI 2222222" });
    act(() => {
      fireEvent.click(restore);
      fireEvent.click(restore);
    });
    await waitFor(() => expect(api.restoreTaxProfile).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.restoreTaxProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve(undefined));
  });

  it("archivar: dos clics a la vez en «Sí, archivar» → una sola petición", async () => {
    const { user } = setup([tp({ docNumber: "1111111", isDefault: true })]);
    let resolve: (value: unknown) => void = () => {};
    api.archiveTaxProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    await user.click(
      await screen.findByRole("button", { name: "Archivar datos fiscales de CI 1111111" }),
    );
    const d = await screen.findByRole("dialog", { name: "¿Archivar estos datos fiscales?" });
    const confirm = within(d).getByRole("button", { name: "Sí, archivar" });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(api.archiveTaxProfile).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.archiveTaxProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve(undefined));
  });
});

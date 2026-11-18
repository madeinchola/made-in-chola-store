import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { DRAFT_MARKER, STARTER_TEXTS } from "@/features/legal/starterTexts";
import { LegalEditorPage } from "./LegalEditorPage";
import { LegalListPage } from "./LegalListPage";
import { laPazToIso } from "./logic";
import type { AcceptanceStat, OverviewRow, VersionDetail } from "./types";

const api = vi.hoisted(() => ({
  fetchOverview: vi.fn(),
  fetchVersion: vi.fn(),
  saveDraft: vi.fn(),
  discardDraft: vi.fn(),
  publishVersion: vi.fn(),
  fetchAcceptanceStats: vi.fn(),
}));
vi.mock("./api", () => api);
const catalog = vi.hoisted(() => ({ getStoreSettings: vi.fn() }));
vi.mock("@/features/catalog/catalogService", async (original) => ({
  ...(await original<typeof import("@/features/catalog/catalogService")>()),
  ...catalog,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const FULL_BUSINESS = {
  business_name: "Chola SRL",
  legal_tax_id: "1020304050",
  legal_address: "Av. Ejemplo 123, La Paz",
  contact_email: "hola@chola.test",
  contact_phone: "+59171234567",
};
const CLEAN_BODY = "# 1. Quiénes somos\n\nSomos {{razon_social}}, NIT {{nit}}, en {{direccion}}.";

const version = (over: Partial<VersionDetail> = {}): VersionDetail => ({
  id: "id-1",
  kind: "terms",
  version: 1,
  status: "published",
  body: CLEAN_BODY,
  changeNote: null,
  effectiveAt: "2026-10-01T04:00:00Z",
  publishedAt: "2026-10-01T04:00:00Z",
  updatedAt: "2026-10-01T04:00:00Z",
  ...over,
});

const row = (over: Partial<OverviewRow> = {}): OverviewRow => ({
  kind: "terms",
  title: "Términos y condiciones",
  requiresAcceptance: true,
  currentVersion: null,
  currentEffectiveAt: null,
  hasDraft: false,
  versions: [],
  ...over,
});

const OVERVIEW: OverviewRow[] = [
  row({
    currentVersion: 1,
    currentEffectiveAt: "2026-10-01T04:00:00Z",
    hasDraft: true,
    versions: [
      {
        version: 2,
        status: "draft",
        effectiveAt: null,
        publishedAt: null,
        changeNote: "Cambió el plazo",
      },
      {
        version: 1,
        status: "published",
        effectiveAt: "2026-10-01T04:00:00Z",
        publishedAt: "2026-10-01T04:00:00Z",
        changeNote: null,
      },
    ],
  }),
  row({ kind: "privacy", title: "Política de privacidad" }),
  row({ kind: "cookies", title: "Política de cookies", requiresAcceptance: false }),
  row({ kind: "shipping", title: "Envíos", requiresAcceptance: false }),
  row({ kind: "returns", title: "Devoluciones y cambios", requiresAcceptance: false }),
];

const STATS: AcceptanceStat[] = [{ kind: "terms", version: 1, accounts: 12, orders: 30 }];

function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: "/admin/legal", element: <LegalListPage /> },
      { path: "/admin/legal/:kind", element: <LegalEditorPage /> },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  catalog.getStoreSettings.mockResolvedValue(FULL_BUSINESS);
  api.fetchOverview.mockResolvedValue(OVERVIEW);
  api.fetchAcceptanceStats.mockResolvedValue(STATS);
  // por omisión el documento tiene un borrador limpio (v2) sobre una versión publicada (v1)
  api.fetchVersion.mockImplementation(async (_kind: string, v?: number) =>
    v === 1
      ? version()
      : version({
          version: 2,
          status: "draft",
          body: CLEAN_BODY,
          changeNote: "Cambió el plazo",
          effectiveAt: null,
        }),
  );
});

const bodyBox = () => screen.getByLabelText("Texto del documento");

describe("lista de documentos", () => {
  it("muestra los cinco documentos con su versión vigente, el borrador y la entrada al editor", async () => {
    mount("/admin/legal");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Textos legales" }),
    ).toBeInTheDocument();
    const table = await screen.findByRole("table");
    for (const title of [
      "Términos y condiciones",
      "Política de privacidad",
      "Política de cookies",
      "Envíos",
      "Devoluciones y cambios",
    ]) {
      expect(within(table).getByText(title)).toBeInTheDocument();
    }
    expect(within(table).getByText("Versión 1 desde el 1 de octubre de 2026")).toBeInTheDocument();
    expect(within(table).getAllByText("Sin publicar")).toHaveLength(4);
    expect(within(table).getByText("Hay un borrador")).toBeInTheDocument();
    // términos y privacidad se aceptan al registrarse y pagar; cookies, envíos y devoluciones son informativos
    expect(within(table).getAllByText("Se acepta al registrarse y pagar")).toHaveLength(2);
    expect(within(table).getAllByText("Informativo")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Editar Términos y condiciones" })).toHaveAttribute(
      "href",
      "/admin/legal/terms",
    );
  });

  it("advierte que los textos no pasaron por un abogado y avisa qué datos del negocio faltan", async () => {
    catalog.getStoreSettings.mockResolvedValue({
      business_name: "Chola SRL",
      legal_tax_id: "",
      contact_email: "a@b.c",
    });
    mount("/admin/legal");
    expect(
      await screen.findByText(/los redactó el equipo de desarrollo, no un abogado/),
    ).toBeInTheDocument();
    const notice = await screen.findByText(/todavía no están definidos/);
    expect(notice).toHaveTextContent("NIT, dirección, teléfono de contacto");
    expect(screen.getByRole("link", { name: "Ir a Ajustes" })).toHaveAttribute(
      "href",
      "/admin/ajustes",
    );
  });

  it("con los datos completos lo dice y no pide nada", async () => {
    mount("/admin/legal");
    expect(await screen.findByText("Los datos del negocio están completos.")).toBeInTheDocument();
  });

  it("un error de carga se puede reintentar", async () => {
    api.fetchOverview.mockRejectedValueOnce(new Error("boom"));
    mount("/admin/legal");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Política de cookies")).toBeInTheDocument();
  });
});

describe("editor · sin versiones (texto de partida)", () => {
  beforeEach(() => {
    api.fetchOverview.mockResolvedValue([row()]);
    api.fetchVersion.mockResolvedValue(null);
  });

  it("parte del texto de partida, avisa que no hay versiones y no deja publicar hasta guardar", async () => {
    mount("/admin/legal/terms");
    await screen.findByText(/Todavía no hay ninguna versión/);
    expect(bodyBox()).toHaveValue(STARTER_TEXTS.terms);
    expect((bodyBox() as HTMLTextAreaElement).value).toContain(DRAFT_MARKER);
    expect(screen.getByRole("button", { name: "Publicar…" })).toBeDisabled();
    expect(screen.getByText("Guarda el borrador para poder publicarlo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeEnabled();
  });

  it("guardar manda el texto y la nota (vacía = sin nota) a la función del servidor", async () => {
    api.saveDraft.mockResolvedValue({ version: 1 });
    mount("/admin/legal/terms");
    await screen.findByText(/Todavía no hay ninguna versión/);
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() =>
      expect(api.saveDraft).toHaveBeenCalledWith("terms", STARTER_TEXTS.terms, null),
    );
  });

  it("un texto de partida NO se puede publicar aunque se guarde: la marca de borrador lo bloquea y lo explica", async () => {
    api.fetchOverview.mockResolvedValue([
      row({
        hasDraft: true,
        versions: [
          { version: 1, status: "draft", effectiveAt: null, publishedAt: null, changeNote: null },
        ],
      }),
    ]);
    api.fetchVersion.mockResolvedValue(
      version({ version: 1, status: "draft", body: STARTER_TEXTS.terms, effectiveAt: null }),
    );
    mount("/admin/legal/terms");
    await screen.findByText(/Estás editando el borrador de la versión 1/);
    await userEvent.click(screen.getByRole("button", { name: "Publicar…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("No se puede publicar todavía")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(DRAFT_MARKER);
    expect(dialog).toHaveTextContent("[COMPLETAR");
    expect(within(dialog).queryByRole("button", { name: "Publicar" })).not.toBeInTheDocument();
    expect(api.publishVersion).not.toHaveBeenCalled();
  });
});

describe("editor · borrador sobre una versión publicada", () => {
  it("muestra el borrador, la vigente y habilita publicar solo si no hay cambios sin guardar", async () => {
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    expect(
      screen.getByText("Vigente: versión 1 desde el 1 de octubre de 2026."),
    ).toBeInTheDocument();
    expect(bodyBox()).toHaveValue(CLEAN_BODY);
    expect(screen.getByRole("button", { name: "Publicar…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
    await userEvent.type(bodyBox(), " más texto");
    expect(screen.getByText("Hay cambios sin guardar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeEnabled();
  });

  it("no guarda un texto con HTML ni uno demasiado corto: lo dice sin llamar al servidor", async () => {
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    await userEvent.clear(bodyBox());
    await userEvent.type(bodyBox(), "corto");
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(
      await screen.findByText("El texto debe tener entre 20 y 60 000 caracteres."),
    ).toBeInTheDocument();
    await userEvent.clear(bodyBox());
    await userEvent.type(bodyBox(), "Un texto largo con <script>alert(1)</script> adentro");
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText(/no admite etiquetas HTML/)).toBeInTheDocument();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("la vista previa muestra el texto con los datos del negocio de Ajustes", async () => {
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    await userEvent.click(screen.getByRole("button", { name: "Vista previa" }));
    const preview = await screen.findByTestId("preview-body");
    expect(preview).toHaveTextContent(
      "Somos Chola SRL, NIT 1020304050, en Av. Ejemplo 123, La Paz.",
    );
    expect(
      within(preview).getByRole("heading", { level: 2, name: "1. Quiénes somos" }),
    ).toBeInTheDocument();
  });

  it("avisa de variables con error de tipeo y de datos del negocio sin definir (y no deja publicar con ellos)", async () => {
    catalog.getStoreSettings.mockResolvedValue({ ...FULL_BUSINESS, legal_tax_id: "" });
    api.fetchVersion.mockImplementation(async (_k: string, v?: number) =>
      v === 1
        ? version()
        : version({
            version: 2,
            status: "draft",
            body: "Somos {{razon}} con NIT {{nit}} y mucho más texto.",
            effectiveAt: null,
          }),
    );
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    expect(await screen.findByText("Variables que no existen: razon.")).toBeInTheDocument();
    expect(screen.getByText("Datos del negocio sin definir en Ajustes: nit.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publicar…" }));
    expect(await screen.findByText("No se puede publicar todavía")).toBeInTheDocument();
  });

  it("publicar desde la segunda versión exige decir qué cambió; con la nota publica «desde ahora»", async () => {
    api.fetchVersion.mockImplementation(async (_k: string, v?: number) =>
      v === 1
        ? version()
        : version({ version: 2, status: "draft", changeNote: null, effectiveAt: null }),
    );
    api.publishVersion.mockResolvedValue({ version: 2, effectiveAt: "2026-11-17T15:00:00Z" });
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    await userEvent.click(screen.getByRole("button", { name: "Publicar…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Desde ahora" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Publicar" }));
    expect(
      await within(dialog).findByText("Cuenta qué cambió respecto de la versión anterior."),
    ).toBeInTheDocument();
    expect(api.publishVersion).not.toHaveBeenCalled();
    await userEvent.type(
      within(dialog).getByLabelText("¿Qué cambió?"),
      "  Ahora el plazo es de 10 días  ",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Publicar" }));
    await waitFor(() =>
      expect(api.publishVersion).toHaveBeenCalledWith(
        "terms",
        null,
        "Ahora el plazo es de 10 días",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("publicar «en una fecha» manda el instante correcto de la hora de La Paz", async () => {
    api.publishVersion.mockResolvedValue({ version: 2, effectiveAt: null });
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    await userEvent.click(screen.getByRole("button", { name: "Publicar…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "En una fecha" }));
    const date = within(dialog).getByLabelText(/Fecha y hora/);
    const future = new Date(Date.now() + 5 * 86_400_000);
    const local = new Date(future.getTime() - 4 * 3_600_000).toISOString().slice(0, 16);
    await userEvent.clear(date);
    await userEvent.type(date, local);
    await userEvent.click(within(dialog).getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(api.publishVersion).toHaveBeenCalledTimes(1));
    const [, effectiveAt, note] = api.publishVersion.mock.calls[0]!;
    expect(effectiveAt).toBe(laPazToIso(local));
    expect(note).toBe("Cambió el plazo");
  });

  it.each([
    ["effective_in_past", "La fecha de vigencia no puede estar en el pasado."],
    ["no_draft", "No hay un borrador para publicar. Guárdalo primero."],
    ["select * from secretos", "No se pudo completar la operación. Inténtalo de nuevo."],
  ])(
    "si la base rechaza (%s) lo explica en español y no filtra su mensaje",
    async (message, shown) => {
      api.publishVersion.mockRejectedValue(new AppError("validation", message));
      mount("/admin/legal/terms");
      await screen.findByText("Estás editando el borrador de la versión 2.");
      await userEvent.click(screen.getByRole("button", { name: "Publicar…" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Publicar" }));
      expect(await within(dialog).findByText(shown)).toBeInTheDocument();
      expect(dialog).not.toHaveTextContent("secretos");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
  );

  it("descartar el borrador pide confirmación y llama a la función", async () => {
    api.discardDraft.mockResolvedValue(undefined);
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    await userEvent.click(screen.getByRole("button", { name: "Descartar borrador" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Se borra el borrador de la versión 2");
    expect(api.discardDraft).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Descartar borrador" }));
    await waitFor(() => expect(api.discardDraft).toHaveBeenCalledWith("terms"));
  });
});

describe("historial de versiones", () => {
  it("muestra el estado de cada versión, qué cambió y cuántas cuentas y pedidos la aceptaron", async () => {
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    const table = await screen.findByRole("table", { name: "Historial de versiones" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("v2");
    expect(rows[1]).toHaveTextContent("Borrador");
    expect(rows[1]).toHaveTextContent("Cambió el plazo");
    expect(rows[2]).toHaveTextContent("v1");
    expect(rows[2]).toHaveTextContent("Vigente");
    expect(await within(table).findByText("12 cuentas · 30 pedidos")).toBeInTheDocument();
    // el borrador no tiene botón «Ver»; las publicadas sí
    expect(
      within(table).queryByRole("button", { name: "Ver la versión 2" }),
    ).not.toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Ver la versión 1" })).toBeInTheDocument();
  });

  it("«Usar como base» copia esa versión al editor como cambio sin guardar", async () => {
    api.fetchVersion.mockImplementation(async (_k: string, v?: number) =>
      v === 1
        ? version({
            body: "# 1. Texto antiguo\n\nEsto decía la versión uno del documento.",
            changeNote: "Primera",
          })
        : version({ version: 2, status: "draft", effectiveAt: null }),
    );
    mount("/admin/legal/terms");
    await screen.findByText("Estás editando el borrador de la versión 2.");
    await userEvent.click(await screen.findByRole("button", { name: "Ver la versión 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByTestId("version-body")).toHaveTextContent(
      "Esto decía la versión uno",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Usar como base" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bodyBox()).toHaveValue("# 1. Texto antiguo\n\nEsto decía la versión uno del documento.");
    expect(screen.getByText("Hay cambios sin guardar.")).toBeInTheDocument();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });
});

describe("editor · rutas", () => {
  it("un documento que no existe lo dice y no consulta nada", async () => {
    mount("/admin/legal/otro");
    expect(await screen.findByText("Ese documento no existe.")).toBeInTheDocument();
    expect(api.fetchVersion).not.toHaveBeenCalled();
  });
});

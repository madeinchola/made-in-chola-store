import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/features/auth/auth-context";
import { AppError } from "@/lib/errors";
import { asCustomer, customerProfile, WithAuth } from "@/test/auth-test-utils";

const api = vi.hoisted(() => ({
  getProfilePreferences: vi.fn(),
  updateProfile: vi.fn(),
  listPublicCurrencies: vi.fn(),
  changeContact: vi.fn(),
}));
vi.mock("./api", () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ProfilePage } from "./ProfilePage";

// Pantallas con diálogos y muchos formularios: en una máquina cargada 5 s se quedan cortos.
vi.setConfig({ testTimeout: 20_000 });

const BOTH: Profile = { ...customerProfile, email: "ana@test.com", phone_e164: "+59171234567" };
const EMAIL_ONLY: Profile = { ...customerProfile, email: "ana@test.com", phone_e164: null };
const PHONE_ONLY: Profile = { ...customerProfile, email: null, phone_e164: "+59171234567" };

const PREFS = { fullName: "Ana Cliente", locale: "es", currency: null as string | null };
const CURRENCIES = [
  { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2 },
  { code: "USD", name: "Dólar estadounidense", symbol: "$", decimals: 2 },
];
const CONTACT_OK = { ok: true, data: { ok: true, changed: true } };
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  ok: false,
  status,
  code,
  message: code,
  ...extra,
});

interface Options {
  profile?: Profile;
  /** Perfil que devuelve `refreshProfile` (simula que el servidor ya aplicó el cambio). */
  afterRefresh?: Profile;
  refreshProfile?: () => void;
}

function renderPage({ profile = BOTH, afterRefresh, refreshProfile }: Options = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Harness() {
    const [current, setCurrent] = useState(profile);
    const auth = asCustomer({
      profile: current,
      session: { access_token: "tok-1" } as Session,
      refreshProfile: async () => {
        refreshProfile?.();
        if (afterRefresh) setCurrent(afterRefresh);
      },
    });
    return (
      <QueryClientProvider client={queryClient}>
        <WithAuth value={auth}>
          <MemoryRouter>
            <ProfilePage />
          </MemoryRouter>
        </WithAuth>
      </QueryClientProvider>
    );
  }
  render(<Harness />);
  return { user: userEvent.setup(), queryClient };
}

const personal = () => screen.getByRole("region", { name: "Datos personales" });
const prefsSection = () => screen.getByRole("region", { name: "Preferencias" });
const dialog = (name: string) => screen.findByRole("dialog", { name });

beforeEach(() => {
  vi.clearAllMocks();
  api.getProfilePreferences.mockResolvedValue(PREFS);
  api.listPublicCurrencies.mockResolvedValue(CURRENCIES);
  api.updateProfile.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
    ...PREFS,
    ...(patch.fullName ? { fullName: patch.fullName } : {}),
    ...("locale" in patch ? { locale: patch.locale } : {}),
    ...("currency" in patch ? { currency: patch.currency } : {}),
  }));
  api.changeContact.mockResolvedValue(CONTACT_OK);
});
afterEach(() => vi.restoreAllMocks());

describe("ProfilePage · datos actuales", () => {
  it("el nombre va en data-testid=account-name con EXACTAMENTE el nombre (lo usan el E2E y router.test)", () => {
    renderPage();
    expect(screen.getByTestId("account-name")).toHaveTextContent(/^Ana Cliente$/);
  });

  it("muestra email y teléfono (celular boliviano con formato)", () => {
    renderPage();
    const section = personal();
    expect(within(section).getByText("ana@test.com")).toBeInTheDocument();
    expect(within(section).getByText("+591 7123 4567")).toBeInTheDocument();
  });

  it("mientras el perfil de la sesión no está, el nombre y los datos muestran «—» (sin romper)", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <WithAuth value={asCustomer({ profile: null })}>
          <MemoryRouter>
            <ProfilePage />
          </MemoryRouter>
        </WithAuth>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("account-name")).toHaveTextContent(/^—$/);
    expect(within(personal()).getAllByText("—")).toHaveLength(3);
  });

  it("sin email o sin teléfono muestra «—» y ofrece «Agregar», no «Cambiar»", () => {
    renderPage({ profile: EMAIL_ONLY });
    const section = personal();
    expect(within(section).getByText("—")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Agregar teléfono" })).toBeInTheDocument();
    expect(
      within(section).queryByRole("button", { name: "Cambiar teléfono" }),
    ).not.toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Cambiar email" })).toBeInTheDocument();
  });

  it("un teléfono que no es celular boliviano se muestra tal cual", () => {
    renderPage({ profile: { ...BOTH, phone_e164: "+34612345678" } });
    expect(within(personal()).getByText("+34612345678")).toBeInTheDocument();
  });

  it("estructura: título «Perfil» y secciones con encabezado", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Datos personales" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Preferencias" })).toBeInTheDocument();
  });
});

/* ───────────────────────────────  Nombre  ─────────────────────────────── */

describe("ProfilePage · editar el nombre", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Editar nombre" }));
    return dialog("Editar nombre");
  };
  const nameInput = (d: HTMLElement) => within(d).getByLabelText("Nombre completo");

  it("el diálogo trae el nombre actual, con autocompletado name y el foco en el campo", async () => {
    const { user } = renderPage();
    const d = await open(user);
    expect(nameInput(d)).toHaveValue("Ana Cliente");
    expect(nameInput(d)).toHaveAttribute("autocomplete", "name");
    await waitFor(() => expect(nameInput(d)).toHaveFocus());
  });

  it("el nombre se autocompleta como «name»", async () => {
    const { user } = renderPage();
    const d = await open(user);
    expect(nameInput(d)).toHaveAttribute("autocomplete", "name");
  });

  it("guarda el nombre recortado, avisa, refresca el perfil y devuelve el foco al botón", async () => {
    const refreshProfile = vi.fn();
    const { user } = renderPage({ refreshProfile });
    const opener = screen.getByRole("button", { name: "Editar nombre" });
    const d = await open(user);
    await user.clear(nameInput(d));
    await user.type(nameInput(d), "  Ana María  ");
    await user.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Nombre actualizado."));
    expect(api.updateProfile).toHaveBeenCalledWith(customerProfile.id, { fullName: "Ana María" });
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("el nombre en pantalla sigue al perfil refrescado", async () => {
    const { user } = renderPage({ afterRefresh: { ...BOTH, full_name: "Ana María" } });
    const d = await open(user);
    await user.clear(nameInput(d));
    await user.type(nameInput(d), "Ana María");
    await user.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getByTestId("account-name")).toHaveTextContent(/^Ana María$/),
    );
  });

  it.each([
    ["", "Ingresa tu nombre."],
    ["     ", "Ingresa tu nombre."],
  ])("vacío o solo espacios (%j): error y no llama al servidor", async (text, message) => {
    const { user } = renderPage();
    const d = await open(user);
    await user.clear(nameInput(d));
    if (text) await user.type(nameInput(d), text);
    await user.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(d).findByText(message)).toBeInTheDocument();
    expect(nameInput(d)).toHaveAttribute("aria-invalid", "true");
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("el mismo nombre (aunque cambien los espacios) no se vuelve a guardar", async () => {
    const { user } = renderPage();
    const d = await open(user);
    await user.clear(nameInput(d));
    await user.type(nameInput(d), "  Ana Cliente ");
    await user.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(d).findByText("Ese ya es tu nombre.")).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("límite de 120 caracteres: 120 se guardan y 121 no", async () => {
    const { user } = renderPage();
    const d = await open(user);
    await user.clear(nameInput(d));
    await user.click(nameInput(d));
    await user.paste("a".repeat(121));
    await user.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(d).findByText("Máximo 120 caracteres.")).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
    await user.clear(nameInput(d));
    await user.click(nameInput(d));
    await user.paste("a".repeat(120));
    await user.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(customerProfile.id, {
        fullName: "a".repeat(120),
      }),
    );
  });

  it("el límite cuenta caracteres, no unidades UTF-16: 120 emojis caben", async () => {
    const { user } = renderPage();
    const d = await open(user);
    await user.clear(nameInput(d));
    await user.click(nameInput(d));
    await user.paste("😀".repeat(120)); // 240 unidades UTF-16, 120 caracteres
    await user.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1));
  });

  it("un error del servidor se muestra en el diálogo, que sigue abierto", async () => {
    api.updateProfile.mockRejectedValue(
      new AppError("unknown", "No se pudo completar la operación. Inténtalo de nuevo."),
    );
    const { user } = renderPage();
    const d = await open(user);
    await user.clear(nameInput(d));
    await user.type(nameInput(d), "Otro Nombre");
    await user.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(
      "No se pudo completar la operación. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Escape y «Cancelar» cierran sin guardar y devuelven el foco", async () => {
    const { user } = renderPage();
    const opener = screen.getByRole("button", { name: "Editar nombre" });
    const d = await open(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    const again = await open(user);
    await user.click(within(again).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(d).not.toBeInTheDocument();
  });

  it("al reabrir no arrastra lo escrito la vez anterior", async () => {
    const { user } = renderPage();
    const d = await open(user);
    await user.clear(nameInput(d));
    await user.type(nameInput(d), "Texto a medias");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const again = await open(user);
    expect(nameInput(again)).toHaveValue("Ana Cliente");
  });

  it("doble envío: una sola petición; con ella en vuelo no se cierra (Escape/Cancelar) y el botón conserva el foco", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.updateProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    const d = await open(user);
    await user.clear(nameInput(d));
    await user.type(nameInput(d), "Ana María");
    const save = within(d).getByRole("button", { name: "Guardar" });
    await user.click(save);
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    await user.click(save);
    await user.keyboard("{Escape}");
    await user.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Cancelar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(save).not.toBeDisabled();
    await act(async () => resolve({ ...PREFS, fullName: "Ana María" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});

/* ───────────────────────────  Email y teléfono  ─────────────────────────── */

const typePassword = async (
  user: ReturnType<typeof userEvent.setup>,
  d: HTMLElement,
  value = "mi-clave-1",
) => {
  await user.type(within(d).getByLabelText("Tu contraseña actual"), value);
};

describe("Contacto · email", () => {
  const openChange = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Cambiar email" }));
    return dialog("Cambiar email");
  };

  it("el diálogo pide el email nuevo y la contraseña actual, con autocompletado correcto", async () => {
    const { user } = renderPage();
    const d = await openChange(user);
    const email = within(d).getByLabelText("Nuevo email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(within(d).getByLabelText("Tu contraseña actual")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await waitFor(() => expect(email).toHaveFocus());
  });

  it("cambia el email: envía el valor normalizado + la contraseña y el token; avisa, refresca y devuelve el foco", async () => {
    const refreshProfile = vi.fn();
    const { user } = renderPage({ refreshProfile });
    const opener = screen.getByRole("button", { name: "Cambiar email" });
    const d = await openChange(user);
    await user.type(within(d).getByLabelText("Nuevo email"), "  Nuevo@Correo.COM ");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Cambiar email" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Email actualizado."));
    expect(api.changeContact).toHaveBeenCalledTimes(1);
    expect(api.changeContact).toHaveBeenCalledWith(
      { password: "mi-clave-1", email: "nuevo@correo.com" },
      "tok-1",
    );
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it.each([
    ["", "Ingresa tu email."],
    ["no-es-email", "El email no es válido."],
    ["a@b", "El email no es válido."],
    ["a@phone.madeinchola.invalid", "Ese dominio de email no es válido."],
    ["ana@test.com", "Ese ya es tu email actual."],
    ["  ANA@Test.Com ", "Ese ya es tu email actual."],
  ])("email %j: «%s» y no llama al servidor", async (value, message) => {
    const { user } = renderPage();
    const d = await openChange(user);
    if (value) await user.type(within(d).getByLabelText("Nuevo email"), value);
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Cambiar email" }));
    expect(await within(d).findByText(message)).toBeInTheDocument();
    expect(within(d).getByLabelText("Nuevo email")).toHaveAttribute("aria-invalid", "true");
    expect(api.changeContact).not.toHaveBeenCalled();
  });

  it("sin contraseña: error en ese campo y no llama al servidor", async () => {
    const { user } = renderPage();
    const d = await openChange(user);
    await user.type(within(d).getByLabelText("Nuevo email"), "nuevo@correo.com");
    await user.click(within(d).getByRole("button", { name: "Cambiar email" }));
    expect(await within(d).findByText("Escribe tu contraseña actual.")).toBeInTheDocument();
    expect(api.changeContact).not.toHaveBeenCalled();
  });

  it("agregar un email (cuenta solo con teléfono): título, etiqueta y aviso propios", async () => {
    const { user } = renderPage({ profile: PHONE_ONLY });
    await user.click(screen.getByRole("button", { name: "Agregar email" }));
    const d = await dialog("Agregar email");
    await user.type(within(d).getByLabelText("Email"), "ana@correo.com");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Agregar email" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Email agregado."));
    expect(api.changeContact).toHaveBeenCalledWith(
      { password: "mi-clave-1", email: "ana@correo.com" },
      "tok-1",
    );
  });
});

describe("Contacto · teléfono", () => {
  const openPhone = async (
    user: ReturnType<typeof userEvent.setup>,
    name = "Cambiar teléfono",
    title = "Cambiar teléfono",
  ) => {
    await user.click(screen.getByRole("button", { name }));
    return dialog(title);
  };

  it("selector de país + campo con autocompletado tel-national, teclado numérico y máscara en vivo", async () => {
    const { user } = renderPage();
    const d = await openPhone(user);
    const phone = within(d).getByLabelText("Nuevo teléfono");
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("autocomplete", "tel-national");
    expect(phone).toHaveAttribute("inputmode", "tel");
    const country = within(d).getByLabelText("País") as HTMLSelectElement;
    expect(country.value).toBe("BO");
    expect(within(country).getAllByRole("option")).toHaveLength(12);
    await user.type(phone, "61234567");
    expect(phone).toHaveValue("6123 4567");
  });

  it("agrega el teléfono: valida con normalizePhone y envía E.164 + país; avisa y refresca", async () => {
    const refreshProfile = vi.fn();
    const { user } = renderPage({ profile: EMAIL_ONLY, refreshProfile });
    const d = await openPhone(user, "Agregar teléfono", "Agregar teléfono");
    await user.type(within(d).getByLabelText("Teléfono"), "71234567");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Agregar teléfono" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Teléfono agregado."));
    expect(api.changeContact).toHaveBeenCalledWith(
      { password: "mi-clave-1", phone: "+59171234567", phoneCountry: "BO" },
      "tok-1",
    );
    expect(refreshProfile).toHaveBeenCalledTimes(1);
  });

  it("otro país: el número nacional se interpreta con ese prefijo (AR +54 · 1123456789 → +541123456789)", async () => {
    const { user } = renderPage();
    const d = await openPhone(user);
    await user.selectOptions(within(d).getByLabelText("País"), "AR");
    await user.type(within(d).getByLabelText("Nuevo teléfono"), "1123456789");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Cambiar teléfono" }));
    await waitFor(() => expect(api.changeContact).toHaveBeenCalledTimes(1));
    expect(api.changeContact).toHaveBeenCalledWith(
      { password: "mi-clave-1", phone: "+541123456789", phoneCountry: "AR" },
      "tok-1",
    );
  });

  it("un número internacional con + se acepta sin importar el país elegido", async () => {
    const { user } = renderPage();
    const d = await openPhone(user);
    await user.type(within(d).getByLabelText("Nuevo teléfono"), "+34 612 345 678");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Cambiar teléfono" }));
    await waitFor(() => expect(api.changeContact).toHaveBeenCalledTimes(1));
    expect(api.changeContact.mock.calls[0]?.[0]).toMatchObject({ phone: "+34612345678" });
  });

  it.each([
    ["", "Ingresa tu teléfono."],
    ["123", "El teléfono es demasiado corto."],
    ["51234567", "Ingresa un celular boliviano de 8 dígitos que empiece en 6 o 7."],
    ["712345678", "El teléfono es demasiado largo."],
    ["71234567", "Ese ya es tu teléfono actual."],
  ])("teléfono %j: «%s» y no llama al servidor", async (value, message) => {
    const { user } = renderPage();
    const d = await openPhone(user);
    if (value) await user.type(within(d).getByLabelText("Nuevo teléfono"), value);
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Cambiar teléfono" }));
    expect(await within(d).findByText(message)).toBeInTheDocument();
    expect(within(d).getByLabelText("Nuevo teléfono")).toHaveAttribute("aria-invalid", "true");
    expect(api.changeContact).not.toHaveBeenCalled();
  });
});

describe("Contacto · quitar", () => {
  it("quitar el email: solo pide la contraseña y envía email=null; el foco va al botón que queda", async () => {
    const { user } = renderPage({ afterRefresh: PHONE_ONLY });
    await user.click(screen.getByRole("button", { name: "Quitar email" }));
    const d = await dialog("Quitar email");
    expect(within(d).queryByLabelText("Nuevo email")).not.toBeInTheDocument();
    expect(d).toHaveTextContent("seguirás ingresando con tu teléfono");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Quitar email" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Email eliminado."));
    expect(api.changeContact).toHaveBeenCalledWith(
      { password: "mi-clave-1", email: null },
      "tok-1",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // el botón «Quitar» ya no existe: el foco no se pierde, va al botón principal de la fila
    expect(screen.queryByRole("button", { name: "Quitar email" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar email" })).toHaveFocus();
  });

  it("quitar el teléfono envía phone=null (sin país)", async () => {
    const { user } = renderPage({ afterRefresh: EMAIL_ONLY });
    await user.click(screen.getByRole("button", { name: "Quitar teléfono" }));
    const d = await dialog("Quitar teléfono");
    expect(within(d).queryByLabelText("País")).not.toBeInTheDocument();
    expect(d).toHaveTextContent("seguirás ingresando con tu email");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Quitar teléfono" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Teléfono eliminado."));
    expect(api.changeContact).toHaveBeenCalledWith(
      { password: "mi-clave-1", phone: null },
      "tok-1",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Agregar teléfono" })).toHaveFocus(),
    );
  });

  it.each([
    ["email", EMAIL_ONLY, "Quitar email", "Agrega un teléfono"],
    ["teléfono", PHONE_ONLY, "Quitar teléfono", "Agrega un email"],
  ])(
    "no se puede quitar el ÚNICO medio de ingreso (%s): botón con aria-disabled y explicación",
    async (_k, profile, name, hint) => {
      const { user } = renderPage({ profile });
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled(); // sigue pudiendo recibir el foco
      expect(button).toHaveAccessibleDescription(
        new RegExp(`Es tu único dato para ingresar\\. ${hint}`, "i"),
      );
      await user.click(button);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      button.focus();
      await user.keyboard("{Enter}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("con email Y teléfono, ambos se pueden quitar (sin aria-disabled ni explicación)", () => {
    renderPage();
    for (const name of ["Quitar email", "Quitar teléfono"]) {
      expect(screen.getByRole("button", { name })).not.toHaveAttribute("aria-disabled");
    }
    expect(screen.queryByText(/Es tu único dato para ingresar/)).not.toBeInTheDocument();
  });
});

describe("Contacto · atributos de los campos y apariencia de las acciones", () => {
  it("el email no se autocorrige ni se capitaliza", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Cambiar email" }));
    const d = await dialog("Cambiar email");
    const email = within(d).getByLabelText("Nuevo email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("spellcheck", "false");
  });

  it("quitar es una acción destructiva (botón de alerta); cambiar no", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Quitar email" }));
    let d = await dialog("Quitar email");
    expect(within(d).getByRole("button", { name: "Quitar email" }).className).toContain(
      "bg-destructive",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Cambiar email" }));
    d = await dialog("Cambiar email");
    expect(within(d).getByRole("button", { name: "Cambiar email" }).className).not.toContain(
      "bg-destructive",
    );
  });

  it("agregar usa la etiqueta «Email»/«Teléfono»; cambiar usa «Nuevo …»", async () => {
    const { user } = renderPage({ profile: { ...BOTH, email: null } });
    await user.click(screen.getByRole("button", { name: "Agregar email" }));
    const d = await dialog("Agregar email");
    expect(within(d).getByLabelText("Email")).toBeInTheDocument();
    expect(within(d).queryByLabelText("Nuevo email")).not.toBeInTheDocument();
  });
});

describe("Contacto · respuestas del servidor (mensajes uniformes)", () => {
  const send = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Cambiar email" }));
    const d = await dialog("Cambiar email");
    await user.type(within(d).getByLabelText("Nuevo email"), "nuevo@correo.com");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Cambiar email" }));
    return d;
  };

  it("contraseña incorrecta: error en el campo de contraseña (vacío y con foco); el email escrito se conserva", async () => {
    api.changeContact.mockResolvedValue(fail(401, "invalid_credentials"));
    const { user } = renderPage();
    const d = await send(user);
    expect(await within(d).findByText("La contraseña actual no es correcta.")).toBeInTheDocument();
    const password = within(d).getByLabelText("Tu contraseña actual");
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(password).toHaveFocus());
    expect(within(d).getByLabelText("Nuevo email")).toHaveValue("nuevo@correo.com");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("el contacto ya es de otra cuenta (409): mensaje ÚNICO que no confirma de quién es", async () => {
    api.changeContact.mockResolvedValue(fail(409, "contact_update_failed"));
    const { user } = renderPage();
    const d = await send(user);
    const alert = await within(d).findByRole("alert");
    expect(alert).toHaveTextContent(
      "No pudimos actualizar ese dato de contacto. Revisa que sea tuyo y que no esté en uso en otra cuenta.",
    );
    expect(alert.textContent).not.toMatch(/ya está registrad|existe una cuenta|pertenece/i);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it.each([
    ["contact_update_conflict", 409, "Tu contacto cambió mientras tanto"],
    ["contact_update_unavailable", 503, "No pudimos actualizar tu contacto en este momento."],
    ["contact_update_inconsistent", 500, "Algo salió mal al actualizar tu contacto."],
  ])(
    "el código %s se explica con su propio mensaje (no con el genérico de «en uso»)",
    async (code, status, text) => {
      api.changeContact.mockResolvedValue(fail(status, code));
      const { user } = renderPage();
      const d = await send(user);
      const alert = await within(d).findByRole("alert");
      expect(alert).toHaveTextContent(text);
      expect(alert.textContent).not.toMatch(/no esté en uso en otra cuenta/);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
  );

  it("el mismo mensaje sale al cambiar el teléfono", async () => {
    api.changeContact.mockResolvedValue(fail(409, "contact_update_failed"));
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Cambiar teléfono" }));
    const d = await dialog("Cambiar teléfono");
    await user.type(within(d).getByLabelText("Nuevo teléfono"), "61234567");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Cambiar teléfono" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(
      "No pudimos actualizar ese dato de contacto.",
    );
  });

  it.each([
    [fail(400, "invalid_email"), "El email no es válido.", "campo"],
    [
      fail(400, "identifier_required"),
      "Tu cuenta necesita al menos un email o un teléfono para ingresar.",
      "aviso",
    ],
    [fail(400, "nothing_to_change"), "No hay nada que cambiar.", "aviso"],
    [
      fail(429, "rate_limited", { retryAfter: 600 }),
      "Demasiados intentos. Vuelve a intentarlo en 10 minutos.",
      "aviso",
    ],
    [fail(0, "network"), "No pudimos conectar con el servidor. Revisa tu conexión.", "aviso"],
    [
      fail(401, "unauthorized"),
      "Tu sesión venció. Inicia sesión de nuevo para continuar.",
      "aviso",
    ],
    [fail(500, "boom"), "Ocurrió un error inesperado. Inténtalo de nuevo.", "aviso"],
  ])("fallo %# → «%s» (%s) y el diálogo sigue abierto", async (failure, message) => {
    api.changeContact.mockResolvedValue(failure);
    const { user } = renderPage();
    const d = await send(user);
    expect(await within(d).findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("invalid_phone del servidor: error en el campo del teléfono (con su mensaje) y foco en él", async () => {
    api.changeContact.mockResolvedValue(fail(400, "invalid_phone"));
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Cambiar teléfono" }));
    const d = await dialog("Cambiar teléfono");
    await user.type(within(d).getByLabelText("Nuevo teléfono"), "61234567");
    await typePassword(user, d);
    await user.click(within(d).getByRole("button", { name: "Cambiar teléfono" }));
    expect(await within(d).findByText("El teléfono no es válido.")).toBeInTheDocument();
    const phone = within(d).getByLabelText("Nuevo teléfono");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(phone).toHaveFocus());
  });

  it("sin cambios en el servidor (changed:false): aviso informativo y se cierra", async () => {
    api.changeContact.mockResolvedValue({ ok: true, data: { ok: true, changed: false } });
    const { user } = renderPage();
    await send(user);
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("No había nada que cambiar."));
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("doble envío: una sola petición; con ella en vuelo no se cierra el diálogo", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.changeContact.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    const d = await send(user);
    const button = within(d).getByRole("button", { name: "Cambiar email" });
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    await user.click(button);
    await user.keyboard("{Escape}");
    await user.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(api.changeContact).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Cancelar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(button).not.toBeDisabled();
    await act(async () => resolve(CONTACT_OK));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("Escape cierra sin enviar y reabrir empieza limpio", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Cambiar email" }));
    let d = await dialog("Cambiar email");
    await user.type(within(d).getByLabelText("Nuevo email"), "a@b.co");
    await typePassword(user, d);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.changeContact).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cambiar email" }));
    d = await dialog("Cambiar email");
    expect(within(d).getByLabelText("Nuevo email")).toHaveValue("");
    expect(within(d).getByLabelText("Tu contraseña actual")).toHaveValue("");
  });

  it("ni la contraseña ni el contacto nuevo se escriben en consola ni en el almacenamiento", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m),
    );
    api.changeContact.mockResolvedValue(fail(409, "contact_update_failed"));
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Cambiar email" }));
    const d = await dialog("Cambiar email");
    await user.type(within(d).getByLabelText("Nuevo email"), "secreto-correo@nuevo.com");
    await typePassword(user, d, "clave-ultra-secreta");
    await user.click(within(d).getByRole("button", { name: "Cambiar email" }));
    await within(d).findByRole("alert");
    const logged = spies
      .flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")))
      .join("\n");
    expect(logged).not.toContain("clave-ultra-secreta");
    expect(logged).not.toContain("secreto-correo");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("secret");
  });
});

/* ───────────────────────────────  Preferencias  ─────────────────────────────── */

describe("Preferencias · idioma y moneda", () => {
  const selects = async () => {
    const section = prefsSection();
    return {
      section,
      locale: (await within(section).findByLabelText("Idioma")) as HTMLSelectElement,
      currency: within(section).getByLabelText("Moneda") as HTMLSelectElement,
      save: within(section).getByRole("button", { name: "Guardar preferencias" }),
    };
  };
  const optionLabels = (select: HTMLSelectElement) =>
    within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);

  it("mientras carga se anuncia y se reserva el sitio (aria-busy)", () => {
    api.getProfilePreferences.mockReturnValue(new Promise(() => {}));
    renderPage();
    const section = prefsSection();
    expect(section).toHaveAttribute("aria-busy", "true");
    expect(within(section).getByRole("status")).toHaveTextContent("Cargando tus preferencias…");
  });

  it("idioma: solo «Español»; moneda: «La de la tienda» + las habilitadas; lo guardado viene seleccionado", async () => {
    api.getProfilePreferences.mockResolvedValue({ ...PREFS, currency: "USD" });
    renderPage();
    const { locale, currency } = await selects();
    expect(optionLabels(locale)).toEqual(["Español"]);
    expect(locale.value).toBe("es");
    expect(optionLabels(currency)).toEqual([
      "La de la tienda",
      "BOB — Boliviano (Bs)",
      "USD — Dólar estadounidense ($)",
    ]);
    expect(currency.value).toBe("USD");
  });

  it("moneda NULL = «La de la tienda» seleccionada", async () => {
    renderPage();
    const { currency } = await selects();
    expect(currency.value).toBe("");
  });

  it("«Guardar» no hace nada mientras no haya cambios (aria-disabled, sin perder el foco)", async () => {
    const { user } = renderPage();
    const { save } = await selects();
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toBeDisabled();
    await user.click(save);
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("cambiar la moneda y guardar: envía idioma y moneda, avisa y vuelve a quedar sin cambios", async () => {
    const refreshProfile = vi.fn();
    const { user } = renderPage({ refreshProfile });
    const { currency, save } = await selects();
    await user.selectOptions(currency, "USD");
    expect(save).not.toHaveAttribute("aria-disabled");
    await user.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Preferencias guardadas."));
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(api.updateProfile).toHaveBeenCalledWith(customerProfile.id, {
      locale: "es",
      currency: "USD",
    });
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(save).toHaveAttribute("aria-disabled", "true"));
    expect(currency.value).toBe("USD"); // sin parpadeo del valor viejo
    expect(save).toHaveFocus(); // el botón no se deshabilita: no pierde el foco
  });

  it("volver a «La de la tienda» guarda NULL (no el texto vacío)", async () => {
    api.getProfilePreferences.mockResolvedValue({ ...PREFS, currency: "USD" });
    const { user } = renderPage();
    const { currency, save } = await selects();
    await user.selectOptions(currency, "");
    await user.click(save);
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(customerProfile.id, {
        locale: "es",
        currency: null,
      }),
    );
  });

  it("cambiar y volver al valor original deja el botón sin cambios", async () => {
    const { user } = renderPage();
    const { currency, save } = await selects();
    await user.selectOptions(currency, "USD");
    expect(save).not.toHaveAttribute("aria-disabled");
    await user.selectOptions(currency, "");
    expect(save).toHaveAttribute("aria-disabled", "true");
  });

  it("una moneda guardada que ya no está habilitada se muestra «no disponible» (no se cambia en silencio)", async () => {
    api.getProfilePreferences.mockResolvedValue({ ...PREFS, currency: "JPY" });
    renderPage();
    const { currency } = await selects();
    expect(optionLabels(currency)).toContain("JPY (no disponible)");
    expect(currency.value).toBe("JPY");
  });

  it("un idioma guardado que no existe se muestra «no disponible»", async () => {
    api.getProfilePreferences.mockResolvedValue({ ...PREFS, locale: "en" });
    renderPage();
    const { locale } = await selects();
    expect(optionLabels(locale)).toEqual(["Español", "en (no disponible)"]);
    expect(locale.value).toBe("en");
  });

  it("un idioma guardado que no existe se puede cambiar a «Español» y se guarda en preferred_locale", async () => {
    api.getProfilePreferences.mockResolvedValue({ ...PREFS, locale: "en" });
    const { user } = renderPage();
    const { locale, save } = await selects();
    await user.selectOptions(locale, "es");
    expect(save).not.toHaveAttribute("aria-disabled");
    await user.click(save);
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(customerProfile.id, {
        locale: "es",
        currency: null,
      }),
    );
  });

  it("un error al guardar (p. ej. moneda deshabilitada) se muestra y se conserva lo elegido", async () => {
    api.updateProfile.mockRejectedValue(
      new AppError("validation", "La moneda preferida no está habilitada"),
    );
    const { user } = renderPage();
    const { section, currency, save } = await selects();
    await user.selectOptions(currency, "USD");
    await user.click(save);
    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "La moneda preferida no está habilitada",
    );
    expect(currency.value).toBe("USD");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("doble clic en guardar: una sola petición", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.updateProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    const { currency, save } = await selects();
    await user.selectOptions(currency, "USD");
    await user.click(save);
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    await user.click(save);
    await user.dblClick(save);
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ...PREFS, currency: "USD" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it.each([
    [
      "las preferencias",
      () => api.getProfilePreferences.mockRejectedValueOnce(new AppError("unknown", "x")),
    ],
    [
      "las monedas",
      () => api.listPublicCurrencies.mockRejectedValueOnce(new AppError("unknown", "x")),
    ],
  ])("si fallan %s: aviso con «Reintentar» que vuelve a cargar", async (_what, arrange) => {
    arrange();
    const { user } = renderPage();
    const section = prefsSection();
    const alert = await within(section).findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar tus preferencias");
    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await within(section).findByLabelText("Moneda")).toBeInTheDocument();
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("el error de preferencias no tapa el resto de la pantalla (nombre y contacto siguen)", async () => {
    api.getProfilePreferences.mockRejectedValue(new AppError("unknown", "x"));
    renderPage();
    await within(prefsSection()).findByRole("alert");
    expect(screen.getByTestId("account-name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambiar email" })).toBeInTheDocument();
  });
});

describe("envío simultáneo (dos eventos en el MISMO instante, antes de que React vuelva a pintar)", () => {
  it("nombre: dos envíos a la vez → una sola petición", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.updateProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Editar nombre" }));
    const d = await dialog("Editar nombre");
    await user.clear(within(d).getByLabelText("Nombre completo"));
    await user.type(within(d).getByLabelText("Nombre completo"), "Ana María");
    const form = within(d)
      .getByRole("button", { name: "Guardar" })
      .closest("form") as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ...PREFS, fullName: "Ana María" }));
  });

  it("contacto: dos envíos a la vez → una sola petición", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.changeContact.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Cambiar email" }));
    const d = await dialog("Cambiar email");
    await user.type(within(d).getByLabelText("Nuevo email"), "nuevo@correo.com");
    await user.type(within(d).getByLabelText("Tu contraseña actual"), "mi-clave-1");
    const form = within(d)
      .getByRole("button", { name: "Cambiar email" })
      .closest("form") as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(api.changeContact).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.changeContact).toHaveBeenCalledTimes(1);
    await act(async () => resolve(CONTACT_OK));
  });

  it("preferencias: dos envíos a la vez → una sola petición", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.updateProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    const section = prefsSection();
    await user.selectOptions(await within(section).findByLabelText("Moneda"), "USD");
    const form = within(section)
      .getByRole("button", { name: "Guardar preferencias" })
      .closest("form") as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ...PREFS, currency: "USD" }));
  });
});

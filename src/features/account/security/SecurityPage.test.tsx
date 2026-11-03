import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { LocationProbe } from "@/components/layout/layout-test-utils";
import { asCustomer, customerProfile, WithAuth } from "@/test/auth-test-utils";

const api = vi.hoisted(() => ({ changePassword: vi.fn(), deactivateAccount: vi.fn() }));
vi.mock("./api", () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { SecurityPage } from "./SecurityPage";

// Pantallas con diálogos y muchos formularios: en una máquina cargada 5 s se quedan cortos.
vi.setConfig({ testTimeout: 20_000 });

const OK = { ok: true, data: { ok: true } };
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  ok: false,
  status,
  code,
  message: code,
  ...extra,
});

const authWith = (over: Partial<AuthContextValue> = {}) =>
  asCustomer({ session: { access_token: "tok-1" } as Session, ...over });

function renderPage(auth: AuthContextValue = authWith()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WithAuth value={auth}>
        <MemoryRouter initialEntries={["/cuenta/seguridad"]}>
          <Routes>
            <Route path="/cuenta/seguridad" element={<SecurityPage />} />
            <Route path="*" element={<p>otra pantalla</p>} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
  return { queryClient, user: userEvent.setup() };
}

const changeSection = () => screen.getByRole("region", { name: "Cambiar contraseña" });
const deactivateSection = () => screen.getByRole("region", { name: "Desactivar mi cuenta" });
const field = (label: string, section: HTMLElement) => within(section).getByLabelText(label);

async function fillChange(
  user: ReturnType<typeof userEvent.setup>,
  values: { current?: string; next?: string; confirm?: string } = {},
) {
  const current = values.current ?? "vieja-clave-1";
  const next = values.next ?? "MiGatitoBlanco27";
  const confirm = values.confirm ?? next; // por defecto, la confirmación repite la nueva
  const section = changeSection();
  if (current) await user.type(field("Contraseña actual", section), current);
  if (next) await user.type(field("Nueva contraseña", section), next);
  if (confirm) await user.type(field("Repite la nueva contraseña", section), confirm);
}
const submitChange = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(changeSection()).getByRole("button", { name: "Cambiar contraseña" }));

beforeEach(() => {
  vi.clearAllMocks();
  api.changePassword.mockResolvedValue(OK);
  api.deactivateAccount.mockResolvedValue(OK);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("SecurityPage · estructura", () => {
  it("título de la sección y dos bloques con su propio encabezado", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Seguridad" })).toBeInTheDocument();
    expect(
      within(changeSection()).getByRole("heading", { level: 3, name: "Cambiar contraseña" }),
    ).toBeInTheDocument();
    expect(
      within(deactivateSection()).getByRole("heading", { level: 3, name: "Desactivar mi cuenta" }),
    ).toBeInTheDocument();
  });
});

describe("Cambiar contraseña · formulario", () => {
  it("campos etiquetados con el autocompletado correcto y contraseñas ocultas por defecto", () => {
    renderPage();
    const section = changeSection();
    const current = field("Contraseña actual", section);
    const next = field("Nueva contraseña", section);
    const confirm = field("Repite la nueva contraseña", section);
    expect(current).toHaveAttribute("autocomplete", "current-password");
    expect(next).toHaveAttribute("autocomplete", "new-password");
    expect(confirm).toHaveAttribute("autocomplete", "new-password");
    for (const input of [current, next, confirm]) expect(input).toHaveAttribute("type", "password");
  });

  it("el indicador de fortaleza (role=status) sigue a la nueva contraseña", async () => {
    const { user } = renderPage();
    const status = within(changeSection()).getByRole("status");
    expect(status).toBeEmptyDOMElement();
    const next = field("Nueva contraseña", changeSection());
    await user.type(next, "abc");
    expect(status).toHaveTextContent("Seguridad de la contraseña: Débil");
    await user.clear(next);
    await user.type(next, "Perro123");
    expect(status).toHaveTextContent("Aceptable");
    await user.clear(next);
    await user.type(next, "MiGatitoBlanco27");
    expect(status).toHaveTextContent("Buena");
  });

  it("el campo de la nueva contraseña queda enlazado al indicador (aria-describedby)", () => {
    renderPage();
    const next = field("Nueva contraseña", changeSection());
    const describedBy = next.getAttribute("aria-describedby") ?? "";
    expect(describedBy).not.toBe("");
    const target = document.getElementById(describedBy.split(" ")[0] ?? "");
    expect(target).toContainElement(within(changeSection()).getByRole("status"));
  });

  it("la política conoce el email y el teléfono de la sesión: contenerlos la deja débil y se explica al enviar", async () => {
    const profile = {
      ...customerProfile,
      email: "zorrovelcan@correo.com",
      phone_e164: "+59171234567",
    };
    const { user } = renderPage(authWith({ profile }));
    const next = field("Nueva contraseña", changeSection());
    await user.type(next, "Zorrovelcan7"); // contiene la parte local del email
    expect(within(changeSection()).getByRole("status")).toHaveTextContent("Débil");
    await user.clear(next);
    await user.type(next, "Zorro71234567x"); // contiene los últimos 8 dígitos del teléfono
    expect(within(changeSection()).getByRole("status")).toHaveTextContent("Débil");
    await user.clear(next);
    await user.type(next, "MiGatitoBlanco27");
    expect(within(changeSection()).getByRole("status")).toHaveTextContent("Buena");
    await user.clear(next);
    await user.type(next, "Zorrovelcan7");
    await user.type(field("Contraseña actual", changeSection()), "vieja-clave-1");
    await user.type(field("Repite la nueva contraseña", changeSection()), "Zorrovelcan7");
    await submitChange(user);
    expect(
      await within(changeSection()).findByText("No incluyas tu email o teléfono."),
    ).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });
});

describe("Cambiar contraseña · validación en el cliente (no llama al servidor)", () => {
  it("nueva contraseña débil: lista de reglas incumplidas, campo marcado inválido", async () => {
    const { user } = renderPage();
    await fillChange(user, { next: "abc" });
    await submitChange(user);
    const alert = await within(changeSection()).findByRole("alert");
    const items = within(alert)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual(["Mínimo 8 caracteres.", "Es una contraseña demasiado común."]);
    const next = field("Nueva contraseña", changeSection());
    expect(next).toHaveAttribute("aria-invalid", "true");
    expect(next.getAttribute("aria-describedby")).toContain(alert.id);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("una sola regla incumplida se muestra como párrafo (no como lista de un elemento)", async () => {
    const { user } = renderPage();
    await fillChange(user, { next: "zorro12" }); // 7 caracteres
    await submitChange(user);
    const alert = await within(changeSection()).findByRole("alert");
    expect(alert).toHaveTextContent("Mínimo 8 caracteres.");
    expect(within(alert).queryByRole("list")).not.toBeInTheDocument();
  });

  it("las contraseñas nuevas no coinciden", async () => {
    const { user } = renderPage();
    await fillChange(user, { next: "MiGatitoBlanco27", confirm: "MiGatitoBlanco28" });
    await submitChange(user);
    expect(
      await within(changeSection()).findByText("Las contraseñas no coinciden."),
    ).toBeInTheDocument();
    expect(field("Repite la nueva contraseña", changeSection())).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("la nueva es igual a la actual", async () => {
    const { user } = renderPage();
    await fillChange(user, { current: "MiGatitoBlanco27", next: "MiGatitoBlanco27" });
    await submitChange(user);
    expect(
      await within(changeSection()).findByText(
        "La contraseña nueva debe ser distinta de la actual.",
      ),
    ).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("falta la contraseña actual", async () => {
    const { user } = renderPage();
    await fillChange(user, { current: "" });
    await submitChange(user);
    expect(
      await within(changeSection()).findByText("Escribe tu contraseña actual para continuar."),
    ).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("formulario vacío: marca los tres campos y no llama al servidor", async () => {
    const { user } = renderPage();
    await submitChange(user);
    await waitFor(() =>
      expect(within(changeSection()).getAllByRole("alert").length).toBeGreaterThanOrEqual(2),
    );
    expect(api.changePassword).not.toHaveBeenCalled();
  });
});

describe("Cambiar contraseña · envío", () => {
  it("éxito: envía actual y nueva con el token, avisa con un toast y limpia el formulario", async () => {
    const { user } = renderPage();
    await fillChange(user);
    await submitChange(user);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Contraseña actualizada. Cerramos tus otras sesiones por seguridad.",
      ),
    );
    expect(api.changePassword).toHaveBeenCalledTimes(1);
    expect(api.changePassword).toHaveBeenCalledWith(
      { currentPassword: "vieja-clave-1", newPassword: "MiGatitoBlanco27" },
      "tok-1",
    );
    const section = changeSection();
    await waitFor(() => expect(field("Contraseña actual", section)).toHaveValue(""));
    expect(field("Nueva contraseña", section)).toHaveValue("");
    expect(field("Repite la nueva contraseña", section)).toHaveValue("");
    expect(within(section).getByRole("status")).toBeEmptyDOMElement(); // el indicador también se vacía
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si el servidor no pudo entregar una sesión nueva (relogin), el aviso pide iniciar sesión de nuevo", async () => {
    api.changePassword.mockResolvedValue({ ok: true, data: { ok: true, relogin: true } });
    const { user } = renderPage();
    await fillChange(user);
    await submitChange(user);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Contraseña actualizada. Inicia sesión de nuevo con la contraseña nueva.",
      ),
    );
  });

  it("contraseña actual incorrecta: error en ESE campo, se vacía y recibe el foco; lo demás se conserva", async () => {
    api.changePassword.mockResolvedValue(fail(401, "invalid_credentials"));
    const { user } = renderPage();
    await fillChange(user);
    await submitChange(user);
    const section = changeSection();
    expect(
      await within(section).findByText("La contraseña actual no es correcta."),
    ).toBeInTheDocument();
    const current = field("Contraseña actual", section);
    expect(current).toHaveValue("");
    expect(current).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(current).toHaveFocus());
    expect(field("Nueva contraseña", section)).toHaveValue("MiGatitoBlanco27");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("weak_password del servidor: lista las reglas que informa (en español) junto al campo nuevo", async () => {
    api.changePassword.mockResolvedValue(
      fail(400, "weak_password", { failures: ["too_short", "contains_identifier"] }),
    );
    const { user } = renderPage();
    await fillChange(user);
    await submitChange(user);
    const alert = await within(changeSection()).findByRole("alert");
    expect(
      within(alert)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Mínimo 8 caracteres.", "No incluyas tu email o teléfono."]);
    await waitFor(() => expect(field("Nueva contraseña", changeSection())).toHaveFocus());
  });

  it("weak_password sin reglas conocidas cae en el mensaje general", async () => {
    api.changePassword.mockResolvedValue(fail(400, "weak_password", { failures: ["regla_nueva"] }));
    const { user } = renderPage();
    await fillChange(user);
    await submitChange(user);
    expect(
      await within(changeSection()).findByText("La contraseña no cumple los requisitos."),
    ).toBeInTheDocument();
  });

  it.each([
    ["pwned_password", 400, "Esa contraseña apareció en filtraciones públicas. Elige otra."],
    ["same_password", 400, "La contraseña nueva debe ser distinta de la actual."],
  ])(
    "%s del servidor: mensaje en el campo de la nueva contraseña",
    async (code, status, message) => {
      api.changePassword.mockResolvedValue(fail(status, code));
      const { user } = renderPage();
      await fillChange(user);
      await submitChange(user);
      expect(await within(changeSection()).findByText(message)).toBeInTheDocument();
      expect(field("Nueva contraseña", changeSection())).toHaveAttribute("aria-invalid", "true");
    },
  );

  it.each([
    [
      fail(429, "rate_limited", { retryAfter: 120 }),
      "Demasiados intentos. Vuelve a intentarlo en 2 minutos.",
    ],
    [
      fail(429, "rate_limited", { retryAfter: 30 }),
      "Demasiados intentos. Vuelve a intentarlo en 30 segundos.",
    ],
    [fail(0, "network"), "No pudimos conectar con el servidor. Revisa tu conexión."],
    [fail(401, "unauthorized"), "Tu sesión venció. Inicia sesión de nuevo para continuar."],
    [fail(500, "boom"), "Ocurrió un error inesperado. Inténtalo de nuevo."],
  ])(
    "fallo general %# → aviso del formulario y se conserva lo escrito",
    async (failure, message) => {
      api.changePassword.mockResolvedValue(failure);
      const { user } = renderPage();
      await fillChange(user);
      await submitChange(user);
      expect(await within(changeSection()).findByText(message)).toBeInTheDocument();
      expect(field("Contraseña actual", changeSection())).toHaveValue("vieja-clave-1");
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("tras un fallo, reintentar con éxito quita el aviso", async () => {
    api.changePassword.mockResolvedValueOnce(fail(500, "boom")).mockResolvedValueOnce(OK);
    const { user } = renderPage();
    await fillChange(user);
    await submitChange(user);
    await within(changeSection()).findByText("Ocurrió un error inesperado. Inténtalo de nuevo.");
    await submitChange(user);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(
      within(changeSection()).queryByText("Ocurrió un error inesperado. Inténtalo de nuevo."),
    ).not.toBeInTheDocument();
  });

  it("doble envío (dos clics seguidos): UNA sola petición; el botón avisa que está ocupado y NO pierde el foco", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.changePassword.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    await fillChange(user);
    const button = within(changeSection()).getByRole("button", { name: "Cambiar contraseña" });
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    await user.click(button);
    await user.click(button);
    expect(api.changePassword).toHaveBeenCalledTimes(1);
    expect(button).not.toBeDisabled(); // aria-disabled, no disabled: conserva el foco
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    await act(async () => resolve(OK));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("Intro dentro de un campo envía, pero una sola vez", async () => {
    const { user } = renderPage();
    await fillChange(user, { confirm: "" });
    await user.type(
      field("Repite la nueva contraseña", changeSection()),
      "MiGatitoBlanco27{Enter}{Enter}",
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(api.changePassword).toHaveBeenCalledTimes(1);
  });
});

describe("Cambiar contraseña · privacidad", () => {
  it("las contraseñas no se escriben en consola ni en el almacenamiento del navegador", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m),
    );
    api.changePassword
      .mockResolvedValueOnce(fail(401, "invalid_credentials"))
      .mockResolvedValueOnce(OK);
    const { user } = renderPage();
    await fillChange(user, { current: "vieja-secreta-77", next: "NuevaSecreta-2026" });
    await submitChange(user);
    await within(changeSection()).findByText("La contraseña actual no es correcta.");
    await user.type(field("Contraseña actual", changeSection()), "vieja-secreta-77");
    await submitChange(user);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const logged = spies
      .flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")))
      .join("\n");
    expect(logged).not.toContain("vieja-secreta-77");
    expect(logged).not.toContain("NuevaSecreta-2026");
    expect(JSON.stringify({ ...localStorage })).not.toContain("secreta");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("secreta");
  });

  it("el botón de ojo muestra y oculta cada contraseña por separado", async () => {
    const { user } = renderPage();
    const section = changeSection();
    const current = field("Contraseña actual", section);
    await user.click(within(section).getAllByRole("button", { name: "Mostrar contraseña" })[0]!);
    expect(current).toHaveAttribute("type", "text");
    expect(field("Nueva contraseña", section)).toHaveAttribute("type", "password");
  });
});

/* ─────────────────────────────  Desactivar cuenta  ───────────────────────────── */

const fillDeactivate = async (
  user: ReturnType<typeof userEvent.setup>,
  password = "mi-clave-actual",
) => {
  await user.type(field("Contraseña actual", deactivateSection()), password);
};
const openConfirm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    within(deactivateSection()).getByRole("button", { name: "Desactivar mi cuenta…" }),
  );
  return screen.findByRole("dialog", { name: "¿Desactivar tu cuenta?" });
};

describe("Desactivar cuenta · explicación y formulario", () => {
  it("explica qué se conserva y qué cambia, antes de pedir nada", () => {
    renderPage();
    const section = deactivateSection();
    expect(within(section).getByText("Qué se conserva")).toBeInTheDocument();
    expect(section).toHaveTextContent("Tus pedidos y sus datos contables");
    expect(within(section).getByText("Qué cambia")).toBeInTheDocument();
    expect(section).toHaveTextContent("ya no podrás verlos ni usarlos");
  });

  it("la casilla «Anonimizar…» viene DESMARCADA, está etiquetada y explica que no se puede deshacer", () => {
    renderPage();
    const checkbox = within(deactivateSection()).getByRole("checkbox", {
      name: "Anonimizar también mis datos personales",
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAccessibleDescription(/No se puede deshacer/);
  });

  it("la contraseña usa current-password", () => {
    renderPage();
    expect(field("Contraseña actual", deactivateSection())).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });
});

describe("Desactivar cuenta · NUNCA sin confirmar", () => {
  it("sin contraseña: error en el campo, foco en él, sin diálogo ni petición", async () => {
    const { user } = renderPage();
    await user.click(
      within(deactivateSection()).getByRole("button", { name: "Desactivar mi cuenta…" }),
    );
    expect(
      await within(deactivateSection()).findByText("Escribe tu contraseña actual para continuar."),
    ).toBeInTheDocument();
    expect(field("Contraseña actual", deactivateSection())).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.deactivateAccount).not.toHaveBeenCalled();
  });

  it("con contraseña solo se ABRE el diálogo de confirmación: la petición no sale hasta confirmar", async () => {
    const { user } = renderPage();
    await fillDeactivate(user);
    const dialog = await openConfirm(user);
    expect(dialog).toHaveTextContent("Tus pedidos se conservan");
    expect(dialog).not.toHaveTextContent("reemplazarán");
    expect(api.deactivateAccount).not.toHaveBeenCalled();
  });

  it("Intro en el campo de contraseña también pasa por la confirmación", async () => {
    const { user } = renderPage();
    await user.type(field("Contraseña actual", deactivateSection()), "mi-clave-actual{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "¿Desactivar tu cuenta?" }),
    ).toBeInTheDocument();
    expect(api.deactivateAccount).not.toHaveBeenCalled();
  });

  it("Cancelar cierra, no envía nada y devuelve el foco al botón que lo abrió", async () => {
    const { user } = renderPage();
    await fillDeactivate(user);
    const opener = within(deactivateSection()).getByRole("button", {
      name: "Desactivar mi cuenta…",
    });
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.deactivateAccount).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it("Escape cierra el diálogo, no envía nada y devuelve el foco", async () => {
    const { user } = renderPage();
    await fillDeactivate(user);
    const opener = within(deactivateSection()).getByRole("button", {
      name: "Desactivar mi cuenta…",
    });
    await openConfirm(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.deactivateAccount).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });
});

describe("Desactivar cuenta · confirmación", () => {
  it("sin anonimizar: envía anonymize=false con el token; luego cierra sesión, va a la portada y avisa", async () => {
    const signOut = vi.fn(async () => {});
    const { user, queryClient } = renderPage(authWith({ signOut }));
    queryClient.setQueryData(["account", "tax", "list", "u"], [{ id: "t-1" }]); // datos de la cuenta en memoria
    queryClient.setQueryData(["catalog", "algo"], "se queda");
    await fillDeactivate(user);
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(api.deactivateAccount).toHaveBeenCalledTimes(1);
    expect(api.deactivateAccount).toHaveBeenCalledWith(
      { password: "mi-clave-actual", anonymize: false },
      "tok-1",
    );
    expect(await screen.findByText("otra pantalla")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(toast.success).toHaveBeenCalledWith("Tu cuenta fue desactivada.");
    // la caché de la cuenta se borra (privacidad); lo que no es de la cuenta se conserva
    expect(queryClient.getQueryData(["account", "tax", "list", "u"])).toBeUndefined();
    expect(queryClient.getQueryData(["catalog", "algo"])).toBe("se queda");
  });

  it("anonimizando: el diálogo avisa que es irreversible y se envía anonymize=true", async () => {
    const { user } = renderPage();
    await fillDeactivate(user);
    await user.click(
      within(deactivateSection()).getByRole("checkbox", {
        name: "Anonimizar también mis datos personales",
      }),
    );
    const dialog = await openConfirm(user);
    expect(dialog).toHaveTextContent("se reemplazarán por valores anónimos");
    expect(dialog).toHaveTextContent("no se puede deshacer");
    await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" }));
    await waitFor(() =>
      expect(api.deactivateAccount).toHaveBeenCalledWith(
        { password: "mi-clave-actual", anonymize: true },
        "tok-1",
      ),
    );
  });

  it("aunque el cierre de sesión falle, la cuenta ya está desactivada: igual va a la portada y avisa", async () => {
    const signOut = vi.fn(async () => {
      throw new Error("sin red");
    });
    const { user } = renderPage(authWith({ signOut }));
    await fillDeactivate(user);
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" }));
    expect(await screen.findByText("otra pantalla")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Tu cuenta fue desactivada.");
    expect(signOut).toHaveBeenCalled();
  });

  it("contraseña incorrecta: el diálogo se cierra y el error queda en el campo (vacío y con foco); NO se cierra sesión", async () => {
    api.deactivateAccount.mockResolvedValue(fail(401, "invalid_credentials"));
    const signOut = vi.fn(async () => {});
    const { user } = renderPage(authWith({ signOut }));
    await fillDeactivate(user, "mal-escrita");
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const password = field("Contraseña actual", deactivateSection());
    expect(
      await within(deactivateSection()).findByText("La contraseña actual no es correcta."),
    ).toBeInTheDocument();
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(password).toHaveFocus());
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("/cuenta/seguridad");
  });

  it("escribir de nuevo quita el error del campo", async () => {
    api.deactivateAccount.mockResolvedValue(fail(401, "invalid_credentials"));
    const { user } = renderPage();
    await fillDeactivate(user, "mal");
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" }));
    await within(deactivateSection()).findByText("La contraseña actual no es correcta.");
    await user.type(field("Contraseña actual", deactivateSection()), "b");
    expect(
      within(deactivateSection()).queryByText("La contraseña actual no es correcta."),
    ).not.toBeInTheDocument();
  });

  it("último administrador (409 last_admin): el diálogo sigue abierto con el motivo y NO se cierra sesión", async () => {
    api.deactivateAccount.mockResolvedValue(fail(409, "last_admin"));
    const signOut = vi.fn(async () => {});
    const { user } = renderPage(authWith({ signOut }));
    await fillDeactivate(user);
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" }));
    expect(
      await within(dialog).findByText(
        "Eres la única persona administradora de la tienda: nombra a otra antes de desactivar tu cuenta.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("/cuenta/seguridad");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([
    [
      fail(429, "rate_limited", { retryAfter: 900 }),
      "Demasiados intentos. Vuelve a intentarlo en 15 minutos.",
    ],
    [fail(0, "network"), "No pudimos conectar con el servidor. Revisa tu conexión."],
    [fail(500, "boom"), "Ocurrió un error inesperado. Inténtalo de nuevo."],
  ])(
    "fallo general %# → aviso dentro del diálogo, que sigue abierto para reintentar",
    async (failure, message) => {
      api.deactivateAccount.mockResolvedValue(failure);
      const { user } = renderPage();
      await fillDeactivate(user);
      const dialog = await openConfirm(user);
      await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // al cerrar y volver a abrir, el aviso viejo ya no está
      await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      const again = await openConfirm(user);
      expect(within(again).queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("doble clic en confirmar: UNA sola petición; mientras dura no se puede cerrar (ni con Escape ni con Cancelar)", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.deactivateAccount.mockReturnValue(new Promise((r) => (resolve = r)));
    const signOut = vi.fn(async () => {});
    const { user } = renderPage(authWith({ signOut }));
    await fillDeactivate(user);
    const dialog = await openConfirm(user);
    const confirm = within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    await user.click(confirm);
    await user.dblClick(confirm);
    expect(api.deactivateAccount).toHaveBeenCalledTimes(1);
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveFocus();
    await user.keyboard("{Escape}");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await act(async () => resolve(OK));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("las contraseñas no se escriben en consola", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m),
    );
    api.deactivateAccount.mockResolvedValue(fail(409, "last_admin"));
    const { user } = renderPage();
    await fillDeactivate(user, "clave-ultra-secreta");
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" }));
    await within(dialog).findByRole("alert");
    const logged = spies
      .flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")))
      .join("\n");
    expect(logged).not.toContain("clave-ultra-secreta");
  });
});

describe("envío simultáneo (dos eventos en el MISMO instante, antes de que React vuelva a pintar)", () => {
  it("cambiar contraseña: dos envíos a la vez → una sola petición", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.changePassword.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    await fillChange(user);
    const form = within(changeSection())
      .getByRole("button", { name: "Cambiar contraseña" })
      .closest("form") as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.changePassword).toHaveBeenCalledTimes(1);
    await act(async () => resolve(OK));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("desactivar cuenta: dos clics a la vez en «Sí, desactivar» → una sola petición", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.deactivateAccount.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderPage();
    await fillDeactivate(user);
    const dialog = await openConfirm(user);
    const confirm = within(dialog).getByRole("button", { name: "Sí, desactivar mi cuenta" });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(api.deactivateAccount).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.deactivateAccount).toHaveBeenCalledTimes(1);
    await act(async () => resolve(OK));
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { AuthResult } from "@/features/auth/auth-context";
import { asCustomer, fakeAuth, WithAuth } from "@/test/auth-test-utils";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

function renderPage(
  ui: React.ReactElement,
  auth = fakeAuth(),
  entry: string | { pathname: string; state: unknown } = "/login",
) {
  return render(
    <WithAuth value={auth}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={ui} />
          <Route path="/registro" element={ui} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </WithAuth>,
  );
}

describe("LoginPage", () => {
  it("campo único «Email o teléfono» con autocompletado correcto", () => {
    renderPage(<LoginPage />);
    const id = screen.getByLabelText("Email o teléfono");
    expect(id).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("autocomplete", "current-password");
  });

  it("envía EXACTAMENTE lo escrito (la normalización la hace el servidor) y vuelve a la ruta original", async () => {
    const signIn = vi.fn(async (): Promise<AuthResult> => ({ ok: true }));
    const user = userEvent.setup();
    renderPage(<LoginPage />, fakeAuth({ signIn }), {
      pathname: "/login",
      state: { from: "/cuenta" },
    });
    await user.type(screen.getByLabelText("Email o teléfono"), " 7123 4567 ");
    await user.type(screen.getByLabelText("Contraseña"), "mi-clave");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith(" 7123 4567 ", "mi-clave"));
    expect(await screen.findByTestId("where")).toHaveTextContent("/cuenta");
  });

  it("un `from` malicioso en el estado NO produce redirección externa", async () => {
    const user = userEvent.setup();
    renderPage(<LoginPage />, fakeAuth(), { pathname: "/login", state: { from: "//evil.com" } });
    await user.type(screen.getByLabelText("Email o teléfono"), "ana@test.com");
    await user.type(screen.getByLabelText("Contraseña"), "x");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/$/);
  });

  it("formato inválido: error en el campo y NO llama al servidor", async () => {
    const signIn = vi.fn();
    const user = userEvent.setup();
    renderPage(<LoginPage />, fakeAuth({ signIn }));
    await user.type(screen.getByLabelText("Email o teléfono"), "12");
    await user.type(screen.getByLabelText("Contraseña"), "x");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText(/demasiado corto/i)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email o teléfono")).toHaveAttribute("aria-invalid", "true");
  });

  it("credenciales inválidas: mensaje genérico en un alert, sin revelar qué falló", async () => {
    const user = userEvent.setup();
    renderPage(
      <LoginPage />,
      fakeAuth({ signIn: async () => ({ ok: false, code: "invalid_credentials" }) }),
    );
    await user.type(screen.getByLabelText("Email o teléfono"), "ana@test.com");
    await user.type(screen.getByLabelText("Contraseña"), "mala");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email, teléfono o contraseña incorrectos.");
    expect(alert.textContent).not.toMatch(/no existe|no encontrado/i);
  });

  it("rate limit: muestra cuántos segundos esperar", async () => {
    const user = userEvent.setup();
    renderPage(
      <LoginPage />,
      fakeAuth({ signIn: async () => ({ ok: false, code: "rate_limited", retryAfter: 840 }) }),
    );
    await user.type(screen.getByLabelText("Email o teléfono"), "ana@test.com");
    await user.type(screen.getByLabelText("Contraseña"), "x");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Espera 840 segundos");
  });

  it("campos vacíos: pide completar y no llama al servidor", async () => {
    const signIn = vi.fn();
    const user = userEvent.setup();
    renderPage(<LoginPage />, fakeAuth({ signIn }));
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect((await screen.findAllByText("Este campo es obligatorio.")).length).toBe(2);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("un usuario ya autenticado que visita /login es redirigido", () => {
    renderPage(<LoginPage />, asCustomer());
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });

  it("deshabilita el botón mientras envía (evita doble envío)", async () => {
    let resolve!: (r: AuthResult) => void;
    const signIn = vi.fn(() => new Promise<AuthResult>((r) => (resolve = r)));
    const user = userEvent.setup();
    renderPage(<LoginPage />, fakeAuth({ signIn }));
    await user.type(screen.getByLabelText("Email o teléfono"), "ana@test.com");
    await user.type(screen.getByLabelText("Contraseña"), "x");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByRole("button", { name: "Ingresando…" })).toBeDisabled();
    resolve({ ok: false, code: "invalid_credentials" });
  });

  it("el botón mostrar/ocultar contraseña alterna el tipo del input", async () => {
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    const input = screen.getByLabelText("Contraseña");
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("RegisterPage", () => {
  const fill = async (
    user: ReturnType<typeof userEvent.setup>,
    password: string,
    confirm = password,
  ) => {
    await user.type(screen.getByLabelText("Nombre completo"), "Ana Pérez");
    await user.type(screen.getByLabelText("Contraseña"), password);
    await user.type(screen.getByLabelText("Repite la contraseña"), confirm);
  };

  it("registro por email envía el email y NO el teléfono", async () => {
    const signUp = vi.fn(async (): Promise<AuthResult> => ({ ok: true }));
    const user = userEvent.setup();
    renderPage(<RegisterPage />, fakeAuth({ signUp }), "/registro");
    await user.type(screen.getByLabelText("Email"), "Ana@Test.com");
    await fill(user, "Chola-Cielo-2026!");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp).toHaveBeenCalledWith({
      fullName: "Ana Pérez",
      email: "Ana@Test.com",
      password: "Chola-Cielo-2026!",
    });
  });

  it("registro por teléfono envía teléfono y país, sin email", async () => {
    const signUp = vi.fn(async (): Promise<AuthResult> => ({ ok: true }));
    const user = userEvent.setup();
    renderPage(<RegisterPage />, fakeAuth({ signUp }), "/registro");
    await user.click(screen.getByRole("button", { name: "Con teléfono" }));
    await user.type(screen.getByLabelText("Teléfono"), "7123 4567");
    await fill(user, "Chola-Cielo-2026!");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp).toHaveBeenCalledWith({
      fullName: "Ana Pérez",
      phone: "7123 4567",
      phoneCountry: "BO",
      password: "Chola-Cielo-2026!",
    });
  });

  it("muestra los requisitos incumplidos de la contraseña y NO envía", async () => {
    const signUp = vi.fn();
    const user = userEvent.setup();
    renderPage(<RegisterPage />, fakeAuth({ signUp }), "/registro");
    await user.type(screen.getByLabelText("Email"), "ana@test.com");
    await fill(user, "password1");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText(/demasiado común/i)).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rechaza una contraseña que contiene el email escrito en el formulario", async () => {
    const user = userEvent.setup();
    renderPage(<RegisterPage />, fakeAuth(), "/registro");
    await user.type(screen.getByLabelText("Email"), "marcelo.quispe@test.com");
    await fill(user, "MarceloQuispe-77");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText(/no incluyas tu email/i)).toBeInTheDocument();
  });

  it("la confirmación debe coincidir", async () => {
    const signUp = vi.fn();
    const user = userEvent.setup();
    renderPage(<RegisterPage />, fakeAuth({ signUp }), "/registro");
    await user.type(screen.getByLabelText("Email"), "ana@test.com");
    await fill(user, "Chola-Cielo-2026!", "Chola-Cielo-2027!");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText("Las contraseñas no coinciden.")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("teléfono boliviano inválido y email inválido muestran su error", async () => {
    const user = userEvent.setup();
    renderPage(<RegisterPage />, fakeAuth(), "/registro");
    await user.type(screen.getByLabelText("Email"), "no-es-email");
    await fill(user, "Chola-Cielo-2026!");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText("El email no es válido.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Con teléfono" }));
    await user.type(screen.getByLabelText("Teléfono"), "22123456");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText(/celular boliviano/i)).toBeInTheDocument();
  });

  it("cambiar de pestaña NO arrastra la validación del campo oculto (email vacío no bloquea el registro por teléfono)", async () => {
    const signUp = vi.fn(async (): Promise<AuthResult> => ({ ok: true }));
    const user = userEvent.setup();
    renderPage(<RegisterPage />, fakeAuth({ signUp }), "/registro");
    await user.click(screen.getByRole("button", { name: "Con teléfono" }));
    await user.type(screen.getByLabelText("Teléfono"), "71234567");
    await fill(user, "Chola-Cielo-2026!");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(signUp).toHaveBeenCalled());
  });

  it("error uniforme del servidor ante duplicados, y rate limit con espera", async () => {
    const user = userEvent.setup();
    renderPage(
      <RegisterPage />,
      fakeAuth({ signUp: async () => ({ ok: false, code: "register_failed" }) }),
      "/registro",
    );
    await user.type(screen.getByLabelText("Email"), "ana@test.com");
    await fill(user, "Chola-Cielo-2026!");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/si ya tienes una, inicia sesión/i);
  });

  it("weak_password del servidor se traduce a los requisitos concretos", async () => {
    const user = userEvent.setup();
    renderPage(
      <RegisterPage />,
      fakeAuth({
        signUp: async () => ({
          ok: false,
          code: "weak_password",
          failures: ["common", "sequential"],
        }),
      }),
      "/registro",
    );
    await user.type(screen.getByLabelText("Email"), "ana@test.com");
    await fill(user, "Chola-Cielo-2026!");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("demasiado común");
    expect(alert).toHaveTextContent("secuencias");
  });
});

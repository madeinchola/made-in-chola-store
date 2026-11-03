import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asCustomer, WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";

const callFunction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/functions", () => ({ callFunction }));
const adoptSession = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/adoptSession", () => ({ adoptSession }));
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ auth: { signOut } }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ResetPasswordPage } from "./ResetPasswordPage";

const recoverySession = {
  access_token: "tok-rec",
  user: { id: "u1" },
} as AuthContextValue["session"];
const SESSION = { access_token: "acc-nuevo", refresh_token: "ref-nuevo" };

function renderPage(auth: AuthContextValue = asCustomer({ session: recoverySession })) {
  return render(
    <WithAuth value={auth}>
      <MemoryRouter initialEntries={["/restablecer"]}>
        <Routes>
          <Route path="/restablecer" element={<ResetPasswordPage />} />
          <Route path="/" element={<p>inicio</p>} />
          <Route path="/login" element={<p>pantalla de ingreso</p>} />
        </Routes>
      </MemoryRouter>
    </WithAuth>,
  );
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  password = "MiGatitoBlanco27",
) {
  await user.type(screen.getByLabelText("Nueva contraseña"), password);
  await user.type(screen.getByLabelText("Repite la nueva contraseña"), password);
  await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
}

beforeEach(() => {
  callFunction.mockReset();
  adoptSession.mockReset();
  signOut.mockClear();
  toast.success.mockClear();
});

describe("ResetPasswordPage", () => {
  it("envía la contraseña con el token de la sesión de recuperación", async () => {
    callFunction.mockResolvedValue({ ok: true, data: { ok: true, session: SESSION } });
    adoptSession.mockResolvedValue(true);
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);
    await waitFor(() => expect(callFunction).toHaveBeenCalledTimes(1));
    expect(callFunction).toHaveBeenCalledWith(
      "set-password",
      { password: "MiGatitoBlanco27" },
      { token: "tok-rec" },
    );
  });

  it("éxito: adopta la sesión NUEVA (la de recuperación ya no sirve), avisa y va al inicio", async () => {
    callFunction.mockResolvedValue({ ok: true, data: { ok: true, session: SESSION } });
    adoptSession.mockResolvedValue(true);
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);
    expect(await screen.findByText("inicio")).toBeInTheDocument();
    expect(adoptSession).toHaveBeenCalledWith(SESSION);
    expect(toast.success).toHaveBeenCalledWith("Contraseña actualizada.");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("si no llegó o no se pudo adoptar la sesión nueva: cierra la local, avisa que entre con la nueva y va a /login", async () => {
    callFunction.mockResolvedValue({ ok: true, data: { ok: true, session: null } });
    adoptSession.mockResolvedValue(false);
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);
    expect(await screen.findByText("pantalla de ingreso")).toBeInTheDocument();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(toast.success).toHaveBeenCalledWith(
      "Contraseña actualizada. Inicia sesión con la nueva.",
    );
  });

  it("un fallo del servidor (recovery_required) se muestra y no navega ni adopta nada", async () => {
    callFunction.mockResolvedValue({
      ok: false,
      status: 403,
      code: "recovery_required",
      message: "x",
    });
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(adoptSession).not.toHaveBeenCalled();
    expect(screen.queryByText("inicio")).not.toBeInTheDocument();
  });

  it("muestra el indicador de fortaleza mientras se escribe", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Nueva contraseña"), "abc");
    expect(screen.getByText("Seguridad de la contraseña: Débil")).toBeInTheDocument();
  });

  it("sin sesión de recuperación no hay formulario: espera el enlace", () => {
    renderPage(asCustomer({ session: null }));
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Verificando enlace…");
  });
});

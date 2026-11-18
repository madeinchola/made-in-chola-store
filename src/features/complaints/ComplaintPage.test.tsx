import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asCustomer, fakeAuth, WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { ComplaintPage } from "./ComplaintPage";

const functions = vi.hoisted(() => ({ callFunction: vi.fn() }));
vi.mock("@/lib/functions", () => functions);
const catalog = vi.hoisted(() => ({ getStoreSettings: vi.fn() }));
vi.mock("@/features/catalog/catalogService", async (original) => ({
  ...(await original<typeof import("@/features/catalog/catalogService")>()),
  ...catalog,
}));

function mount(auth: AuthContextValue = fakeAuth()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WithAuth value={auth}>
        <MemoryRouter>
          <ComplaintPage />
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
}

const DETAIL = "La prenda llegó con una costura abierta y no es lo que pedí.";
async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Tu nombre"), "Ana Pérez");
  await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await user.selectOptions(screen.getByLabelText("¿Sobre qué es tu reclamo?"), "product");
  await user.type(screen.getByLabelText("Cuéntanos qué pasó"), DETAIL);
}
const submit = () => screen.getByRole("button", { name: "Enviar reclamo" });

beforeEach(() => {
  vi.resetAllMocks();
  catalog.getStoreSettings.mockResolvedValue({ complaints_response_days: 7 });
});

describe("ComplaintPage", () => {
  it("explica el plazo que fija la tienda (el ajuste), con el título como único h1", async () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Reclamos" })).toBeInTheDocument();
    expect(await screen.findByText(/en un plazo de hasta 7 días/)).toBeInTheDocument();
  });

  it("sin el ajuste usa el plazo por omisión (10 días)", async () => {
    catalog.getStoreSettings.mockResolvedValue({});
    mount();
    expect(await screen.findByText(/en un plazo de hasta 10 días/)).toBeInTheDocument();
  });

  it("vacío NO envía nada: explica cada campo y lleva el foco al primero", async () => {
    mount();
    await userEvent.click(submit());
    expect(functions.callFunction).not.toHaveBeenCalled();
    expect(await screen.findByText("Escribe tu nombre.")).toBeInTheDocument();
    expect(
      screen.getByText("Escribe un correo o un teléfono para poder responderte."),
    ).toBeInTheDocument();
    expect(screen.getByText("Elige sobre qué es tu reclamo.")).toBeInTheDocument();
    expect(screen.getByText("Cuéntanos un poco más: mínimo 20 caracteres.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tu nombre")).toHaveFocus();
  });

  it("envía el reclamo a la función `complaint` y muestra el número y la fecha límite, con el foco en el título", async () => {
    functions.callFunction.mockResolvedValue({
      ok: true,
      data: { number: "REC-000123", due_at: "2026-11-27T12:00:00Z" },
    });
    const user = userEvent.setup();
    mount();
    await fillValid(user);
    await user.click(submit());
    await waitFor(() => expect(functions.callFunction).toHaveBeenCalledTimes(1));
    const [name, body, options] = functions.callFunction.mock.calls[0]!;
    expect(name).toBe("complaint");
    expect(body).toEqual({
      contact_name: "Ana Pérez",
      contact_email: "ana@example.com",
      kind: "product",
      detail: DETAIL,
    });
    expect(options).toEqual({});
    const title = await screen.findByRole("heading", { level: 1, name: "Recibimos tu reclamo" });
    expect(title).toHaveFocus();
    expect(
      screen.getByText("Tu número de reclamo es REC-000123. Guárdalo para cualquier consulta."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Te responderemos antes del 27 de noviembre de 2026."),
    ).toBeInTheDocument();
  });

  it("quien tiene sesión ve su nombre y correo ya escritos, y su sesión viaja con el reclamo (queda ligado a su cuenta)", async () => {
    functions.callFunction.mockResolvedValue({
      ok: true,
      data: { number: "REC-000124", due_at: null },
    });
    const user = userEvent.setup();
    const auth = asCustomer({ session: { access_token: "tok-1", user: { id: "u1" } } as never });
    mount(auth);
    await waitFor(() => expect(screen.getByLabelText("Tu nombre")).toHaveValue("Ana Cliente"));
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("ana@test.com");
    await user.selectOptions(screen.getByLabelText("¿Sobre qué es tu reclamo?"), "delivery");
    await user.type(screen.getByLabelText("Cuéntanos qué pasó"), DETAIL);
    await user.click(submit());
    await waitFor(() => expect(functions.callFunction).toHaveBeenCalledTimes(1));
    expect(functions.callFunction.mock.calls[0]![2]).toEqual({ token: "tok-1" });
  });

  it("el campo trampa no se ve ni se puede enfocar con el teclado, y si se llena viaja para que el servidor descarte el reclamo", async () => {
    functions.callFunction.mockResolvedValue({ ok: true, data: { number: null, due_at: null } });
    const user = userEvent.setup();
    const { container } = mount();
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
    expect(trap).toHaveAttribute("tabindex", "-1");
    await fillValid(user);
    await user.type(trap, "http://spam.example");
    await user.click(submit());
    await waitFor(() => expect(functions.callFunction).toHaveBeenCalled());
    expect(functions.callFunction.mock.calls[0]![1]).toMatchObject({
      website: "http://spam.example",
    });
    // la respuesta del servidor para un robot no trae número: la pantalla no inventa uno
    expect(await screen.findByText(/Lo recibimos/)).toBeInTheDocument();
    expect(screen.queryByText(/REC-/)).not.toBeInTheDocument();
  });

  it.each([
    [429, "rate_limited", "Hay muchos intentos ahora mismo"],
    [400, "invalid_complaint", "Revisa los datos del reclamo"],
    [0, "network", "No pudimos enviar tu reclamo"],
    [500, "internal", "No pudimos registrar tu reclamo"],
  ])("un error %s (%s) se explica y NO borra lo escrito", async (status, code, text) => {
    functions.callFunction.mockResolvedValue({ ok: false, status, code, message: code });
    const user = userEvent.setup();
    mount();
    await fillValid(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(new RegExp(text));
    expect(screen.getByLabelText("Tu nombre")).toHaveValue("Ana Pérez");
    expect(screen.getByLabelText("Cuéntanos qué pasó")).toHaveValue(DETAIL);
  });

  it("anti doble envío: mientras se envía el botón se bloquea y un segundo clic no manda otro reclamo", async () => {
    let finish: (value: unknown) => void = () => undefined;
    functions.callFunction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    mount();
    await fillValid(user);
    await user.click(submit());
    expect(await screen.findByRole("button", { name: "Enviando…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Enviando…" }));
    expect(functions.callFunction).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: { number: "REC-000125", due_at: null } });
    await screen.findByText(/REC-000125/);
  });

  it("DOS envíos en el mismo instante (dos Enter seguidos, antes de que la pantalla se repinte) mandan UN solo reclamo", async () => {
    let finish: (value: unknown) => void = () => undefined;
    functions.callFunction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    const { container } = mount();
    await fillValid(user);
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(functions.callFunction).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: { number: "REC-000127", due_at: null } });
    await screen.findByText(/REC-000127/);
  });

  it("después de enviar se puede presentar otro reclamo con el formulario limpio", async () => {
    functions.callFunction.mockResolvedValue({
      ok: true,
      data: { number: "REC-000126", due_at: null },
    });
    const user = userEvent.setup();
    mount();
    await fillValid(user);
    await user.click(submit());
    await user.click(await screen.findByRole("button", { name: "Enviar otro reclamo" }));
    expect(screen.getByLabelText("Tu nombre")).toHaveValue("");
    expect(screen.getByLabelText("Cuéntanos qué pasó")).toHaveValue("");
  });

  it("enlaza a la política de privacidad y cuenta los caracteres del detalle", async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole("link", { name: "política de privacidad" })).toHaveAttribute(
      "href",
      "/legal/privacidad",
    );
    await user.type(screen.getByLabelText("Cuéntanos qué pasó"), "hola");
    expect(screen.getByText("4 de 2000")).toBeInTheDocument();
  });
});

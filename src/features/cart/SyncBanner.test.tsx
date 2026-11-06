import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NoticeRegion } from "./NoticeRegion";
import { SyncBanner } from "./SyncBanner";
import {
  FakeCartServer,
  failure,
  flush,
  makeLine,
  makeSnapshot,
  renderWithCart,
} from "./cart-test-utils";

async function setup() {
  const snapshot = makeSnapshot([makeLine("a", 1)]);
  const server = new FakeCartServer(snapshot);
  // Como en la página y el cajón: el aviso entra en la región viva persistente, y hay un título al que rescatar el foco.
  const view = renderWithCart(
    <>
      <h1 tabIndex={-1} data-cart-heading="">
        Tu bolsa
      </h1>
      <NoticeRegion>
        <SyncBanner />
      </NoticeRegion>
    </>,
    { snapshot, server, path: "/carrito" },
  );
  await flush();
  return { ...view, server };
}

/** Provoca un fallo del servidor al cambiar la cantidad (como lo vería la persona al pulsar «+»). */
async function failChange(
  view: Awaited<ReturnType<typeof setup>>,
  result: ReturnType<typeof failure>,
) {
  view.server.forced = result;
  act(() => view.cart().store.setQty("a", 2));
  await flush();
}

describe("SyncBanner", () => {
  it("sin problemas no pinta nada: la región viva está, vacía, esperando", async () => {
    await setup();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("el aviso ENTRA en la región viva que ya existía (el mismo nodo) y no lleva un role propio", async () => {
    const view = await setup();
    const region = screen.getByRole("status");
    await failChange(view, failure(0, "network"));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Sin conexión.");
    expect(region.querySelectorAll("[role]")).toHaveLength(0);
  });

  it("sin conexión: avisa que se guardará al volver, como estado, con «Reintentar»", async () => {
    const view = await setup();
    await failChange(view, failure(0, "network"));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "Sin conexión. Enviaremos tus cambios cuando vuelva la conexión.",
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("«Reintentar» llama a retryNow: reenvía lo pendiente y, si ya hay red, el aviso desaparece", async () => {
    const user = userEvent.setup();
    const view = await setup();
    await failChange(view, failure(0, "network"));
    view.server.forced = null;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await flush();
    expect(view.server.callsOf("set_item").at(-1)).toMatchObject({ variant_id: "a", qty: 2 });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(view.cart().state.sync.state).toBe("idle");
  });

  it("al pulsar «Reintentar» con éxito el botón desaparece y el foco pasa al título, no al <body>", async () => {
    const user = userEvent.setup();
    const view = await setup();
    await failChange(view, failure(0, "network"));
    view.server.forced = null;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await flush();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("heading", { name: "Tu bolsa" })).toHaveFocus();
  });

  it("si «Reintentar» no arregla nada, el aviso vuelve (entra otra vez en la región) y el foco quedó en el título, no en el <body>", async () => {
    const user = userEvent.setup();
    const view = await setup();
    await failChange(view, failure(0, "network"));
    const region = screen.getByRole("status");
    // mientras reenvía, el aviso se retira (ya no está «sin conexión» sino «sincronizando») y con él el botón enfocado
    await user.click(screen.getByRole("button", { name: "Reintentar" })); // sigue sin red
    await flush();
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Sin conexión.");
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("heading", { name: "Tu bolsa" })).toHaveFocus();
  });

  it("demasiadas peticiones: dice cuándo se reintenta", async () => {
    const view = await setup();
    await failChange(view, failure(429, "rate_limited", 12));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Hiciste muchos cambios seguidos. Reintentaremos en 12 segundos.",
    );
  });

  it("demasiadas peticiones sin tiempo indicado", async () => {
    const view = await setup();
    await failChange(view, failure(429, "rate_limited"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Hiciste muchos cambios seguidos. Reintentaremos en unos segundos.",
    );
  });

  it("sesión vencida: enlace a iniciar sesión (volviendo a esta página) y «Reintentar»", async () => {
    const user = userEvent.setup();
    const view = await setup();
    await failChange(view, failure(401, "unauthorized"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Tu sesión terminó. Inicia sesión para seguir guardando tu bolsa.",
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Iniciar sesión" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
    expect(JSON.parse(screen.getByTestId("location").getAttribute("data-state")!)).toEqual({
      from: "/carrito",
    });
  });

  it("cualquier otro error: mensaje general y «Reintentar»", async () => {
    const view = await setup();
    await failChange(view, failure(500, "server_error"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "No pudimos guardar tus cambios. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});

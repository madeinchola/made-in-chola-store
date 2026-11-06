import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeCartServer,
  NOW,
  flush,
  makeLine,
  makeSnapshot,
  renderWithCart,
} from "./cart-test-utils";
import { ReservationCountdown } from "./ReservationCountdown";
import type { CartSnapshot } from "./types";

// Solo el reloj y los intervalos son falsos: las promesas y `setTimeout` (que usa `flush`) siguen siendo reales.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Una bolsa cuya retención vence `seconds` segundos después de la hora del servidor (= NOW). */
const heldFor = (seconds: number, extra: Partial<CartSnapshot> = {}) =>
  makeSnapshot([makeLine("a", 1)], {
    reservation: { state: "held", expires_at: new Date(NOW + seconds * 1000).toISOString() },
    ...extra,
  });

const tickSeconds = async (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
  await flush();
};

const time = () => screen.getByText(/Reservamos tus productos durante/).textContent;
/** Región viva de los avisos de la cuenta regresiva (la única que un lector de pantalla oye): persistente. */
const live = () => screen.getByRole("status");

/**
 * Registra TODO nodo (o texto) que entra al DOM y que dice `needle`, aunque se quite en el mismo instante: un
 * `MutationObserver` entrega cada registro, así que un fotograma intermedio de «Ya no reservamos…» no se le escapa (mirar
 * solo el estado final no vería un parpadeo).
 */
function watchAdded(needle: RegExp) {
  const seen: string[] = [];
  const handle = (records: MutationRecord[]) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (needle.test(node.textContent ?? "")) seen.push(node.textContent ?? "");
      });
      if (record.type === "characterData" && needle.test(record.target.textContent ?? "")) {
        seen.push(record.target.textContent ?? "");
      }
    }
  };
  const observer = new MutationObserver(handle);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return {
    seen,
    stop() {
      handle(observer.takeRecords());
      observer.disconnect();
    },
  };
}

/** Termina la espera de una petición pausada (el servidor de mentira contesta) y deja correr las promesas. */
const settle = (resume: () => void) =>
  act(async () => {
    resume();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

describe("ReservationCountdown", () => {
  it("muestra «Reservamos tus productos durante mm:ss» y baja de segundo en segundo", async () => {
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(90) });
    await flush();
    expect(time()).toBe("Reservamos tus productos durante 01:30");
    await tickSeconds(1);
    expect(time()).toBe("Reservamos tus productos durante 01:29");
    await tickSeconds(29); // 30 s transcurridos: quedan exactamente 60
    expect(time()).toBe("Reservamos tus productos durante 01:00");
  });

  it("NO anuncia cada segundo: la región viva está vacía hasta llegar a 1 minuto, y entonces dice una sola cosa", async () => {
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(90) });
    await flush();
    expect(live()).toHaveTextContent("");
    await tickSeconds(29); // quedan 61 s
    expect(time()).toBe("Reservamos tus productos durante 01:01");
    expect(live()).toHaveTextContent("");
    await tickSeconds(1); // quedan 60 s
    expect(live()).toHaveTextContent("Queda menos de un minuto de reserva.");
    await tickSeconds(20); // quedan 40 s: el aviso es el mismo, no se renueva cada segundo
    expect(live()).toHaveTextContent("Queda menos de un minuto de reserva.");
    // el número que cambia cada segundo no está en una región viva
    expect(screen.getByText(/Reservamos tus productos durante/).closest("[aria-live]")).toBeNull();
  });

  it("al llegar a 0 pide reintentar UNA sola vez y pasa al mensaje de «ya no reservamos»", async () => {
    const server = new FakeCartServer(heldFor(3));
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(3), server });
    await flush();
    expect(time()).toBe("Reservamos tus productos durante 00:03");
    await tickSeconds(2);
    expect(time()).toBe("Reservamos tus productos durante 00:01");
    expect(server.callsOf("refresh")).toHaveLength(0);
    await tickSeconds(1); // 0
    expect(
      screen.getByText("Ya no reservamos tus productos, pero aún puedes comprarlos si hay stock"),
    ).toBeInTheDocument();
    expect(server.callsOf("refresh")).toHaveLength(1);
    await tickSeconds(5);
    expect(server.callsOf("refresh")).toHaveLength(1);
  });

  it("si el servidor renueva la retención, la cuenta regresiva vuelve a empezar desde la nueva hora", async () => {
    const server = new FakeCartServer(heldFor(2));
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(2), server });
    await flush();
    // lo que contestará a «refresh»: una retención nueva de 10 minutos desde el momento del vencimiento
    server.snapshot = makeSnapshot([makeLine("a", 1)], {
      reservation: { state: "held", expires_at: new Date(NOW + 2000 + 600_000).toISOString() },
    });
    await tickSeconds(2);
    expect(server.callsOf("refresh")).toHaveLength(1);
    expect(time()).toBe("Reservamos tus productos durante 10:00");
    await tickSeconds(1);
    expect(time()).toBe("Reservamos tus productos durante 09:59");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("usa la hora del SERVIDOR: un dispositivo con el reloj atrasado dos minutos no ve de más", async () => {
    // el servidor va 2 minutos por DELANTE del dispositivo; la retención vence 90 s después de la hora del servidor
    const snapshot = heldFor(120 + 90);
    const server = new FakeCartServer(snapshot);
    server.clockOffsetMs = 120_000;
    renderWithCart(<ReservationCountdown />, { snapshot, server });
    await flush();
    // con la hora del dispositivo saldría 03:30
    expect(time()).toBe("Reservamos tus productos durante 01:30");
    await tickSeconds(30);
    expect(time()).toBe("Reservamos tus productos durante 01:00");
  });

  it("un reloj adelantado tampoco la recorta ni la da por vencida", async () => {
    // el servidor va 1 minuto por DETRÁS del dispositivo; vence 30 s después de la hora del servidor, o sea 30 s ANTES de
    // «ahora» según el dispositivo: con la hora del dispositivo parecería ya vencida
    const snapshot = heldFor(-60 + 30);
    const server = new FakeCartServer(snapshot);
    server.clockOffsetMs = -60_000;
    renderWithCart(<ReservationCountdown />, { snapshot, server });
    await flush();
    // (antes de la primera respuesta el desfase es desconocido; en cuanto llega, manda la hora del servidor)
    expect(time()).toBe("Reservamos tus productos durante 00:30");
    await tickSeconds(10);
    expect(time()).toBe("Reservamos tus productos durante 00:20");
  });

  it("usa UN solo intervalo y lo limpia al desmontar", async () => {
    const view = renderWithCart(<ReservationCountdown />, { snapshot: heldFor(90) });
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    await tickSeconds(5);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("al vencer, el intervalo se detiene", async () => {
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(2) });
    await flush();
    await tickSeconds(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retención vencida según el servidor: mensaje y «Reintentar reserva» (que pide refrescar)", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const expired = makeSnapshot([makeLine("a", 1)], {
      reservation: { state: "expired", expires_at: null },
    });
    const server = new FakeCartServer(expired);
    renderWithCart(<ReservationCountdown />, { snapshot: expired, server });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ya no reservamos tus productos, pero aún puedes comprarlos si hay stock",
    );
    expect(vi.getTimerCount()).toBe(0);
    await user.click(screen.getByRole("button", { name: "Reintentar reserva" }));
    await flush();
    expect(server.callsOf("refresh")).toHaveLength(1);
  });

  it("sin retención (bolsa vacía o reserve_on_add desactivado) no se muestra nada", async () => {
    const none = makeSnapshot([makeLine("a", 1)], {
      reserve_on_add: false,
      reservation: { state: "none", expires_at: null },
    });
    const { container } = renderWithCart(<ReservationCountdown />, { snapshot: none });
    await flush();
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(screen.queryByText(/Reservamos|reservamos/)).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reserve_on_add desactivado manda aunque la foto diga otra cosa", async () => {
    renderWithCart(<ReservationCountdown />, {
      snapshot: heldFor(90, { reserve_on_add: false }),
    });
    await flush();
    expect(screen.queryByText(/Reservamos/)).not.toBeInTheDocument();
  });
});

describe("ReservationCountdown · región viva persistente", () => {
  it("la región existe desde el primer pintado, VACÍA, y sigue siendo el MISMO nodo mientras entra cada mensaje", async () => {
    const server = new FakeCartServer(heldFor(65));
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(65), server });
    await flush();
    const region = live();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "false");
    expect(region).toBeEmptyDOMElement(); // 65 s: todavía no hay nada que anunciar

    await tickSeconds(5); // quedan 60 s
    expect(live()).toBe(region);
    expect(region).toHaveTextContent("Queda menos de un minuto de reserva.");

    // al vencer, sin stock: «reservando» y luego «ya no reservamos», siempre dentro de la MISMA región
    server.snapshot = makeSnapshot([makeLine("a", 1)], {
      reservation: { state: "expired", expires_at: null },
    });
    await tickSeconds(60);
    expect(live()).toBe(region);
    expect(region).toHaveTextContent(
      "Ya no reservamos tus productos, pero aún puedes comprarlos si hay stock",
    );
    expect(region).toContainElement(screen.getByRole("button", { name: "Reintentar reserva" }));
  });

  it("la cuenta que cambia cada segundo NO está dentro de la región viva", async () => {
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(90) });
    await flush();
    expect(live().contains(screen.getByText(/Reservamos tus productos durante/))).toBe(false);
  });
});

describe("ReservationCountdown · sin parpadeo al vencer", () => {
  it("al llegar a 0 se ve «Reservando de nuevo…» (sin botón) mientras vuela la petición, y NUNCA «Ya no reservamos» si había stock", async () => {
    const server = new FakeCartServer(heldFor(2));
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(2), server });
    await flush();
    const watch = watchAdded(/Ya no reservamos/);
    const resume = server.pause(); // la petición de reservar de nuevo queda en vuelo
    // lo que contestará: una retención nueva de 10 min desde el vencimiento (NOW + 2 s + 600 s)
    server.snapshot = makeSnapshot([makeLine("a", 1)], {
      reservation: { state: "held", expires_at: new Date(NOW + 2000 + 600_000).toISOString() },
    });
    await tickSeconds(2);
    expect(server.callsOf("refresh")).toHaveLength(1);
    expect(screen.getByText("Reservando de nuevo…")).toBeInTheDocument();
    expect(screen.queryByText(/Ya no reservamos/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar reserva" })).not.toBeInTheDocument();

    await settle(resume);
    expect(time()).toBe("Reservamos tus productos durante 10:00");
    expect(screen.queryByText("Reservando de nuevo…")).not.toBeInTheDocument();
    watch.stop();
    expect(watch.seen).toEqual([]); // ni un fotograma de «Ya no reservamos…» en todo el recorrido
  });

  it("sin stock: tras la respuesta aparece «Ya no reservamos…» con «Reintentar reserva» (control: el observador SÍ ve ese texto)", async () => {
    const server = new FakeCartServer(heldFor(2));
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(2), server });
    await flush();
    const watch = watchAdded(/Ya no reservamos/);
    const resume = server.pause();
    server.snapshot = makeSnapshot([makeLine("a", 1)], {
      reservation: { state: "expired", expires_at: null },
    });
    await tickSeconds(2);
    expect(screen.getByText("Reservando de nuevo…")).toBeInTheDocument();
    expect(screen.queryByText(/Ya no reservamos/)).not.toBeInTheDocument();

    await settle(resume);
    expect(
      screen.getByText("Ya no reservamos tus productos, pero aún puedes comprarlos si hay stock"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar reserva" })).toBeInTheDocument();
    expect(screen.queryByText("Reservando de nuevo…")).not.toBeInTheDocument();
    watch.stop();
    expect(watch.seen.length).toBeGreaterThan(0); // el observador funciona: el texto apareció, pero solo DESPUÉS
  });

  it("el servidor contesta lo mismo (retención «vigente» con hora ya pasada): tras el intento se dice «ya no reservamos» y no se queda «reservando» para siempre", async () => {
    // `FakeCartServer` devuelve la misma foto vencida: el almacén no la renueva
    const server = new FakeCartServer(heldFor(2));
    renderWithCart(<ReservationCountdown />, { snapshot: heldFor(2), server });
    await flush();
    await tickSeconds(2);
    await tickSeconds(1);
    expect(server.callsOf("refresh")).toHaveLength(1);
    expect(screen.queryByText("Reservando de nuevo…")).not.toBeInTheDocument();
    expect(screen.getByText(/Ya no reservamos/)).toBeInTheDocument();
  });

  it("«Reintentar reserva»: el botón se va (reservando…), el foco pasa al título y, sin stock, el botón vuelve", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const expired = makeSnapshot([makeLine("a", 1)], {
      reservation: { state: "expired", expires_at: null },
    });
    const server = new FakeCartServer(expired);
    renderWithCart(
      <>
        <h1 tabIndex={-1} data-cart-heading="">
          Tu bolsa
        </h1>
        <ReservationCountdown />
      </>,
      { snapshot: expired, server },
    );
    await flush();
    const resume = server.pause();
    await user.click(screen.getByRole("button", { name: "Reintentar reserva" }));
    expect(screen.getByText("Reservando de nuevo…")).toBeInTheDocument();
    expect(screen.queryByText(/Ya no reservamos/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar reserva" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("heading", { name: "Tu bolsa" })).toHaveFocus();

    await settle(resume); // sigue sin stock
    expect(screen.getByRole("button", { name: "Reintentar reserva" })).toBeInTheDocument();
    expect(server.callsOf("refresh")).toHaveLength(1);
  });

  it("con stock, «Reintentar reserva» vuelve a la cuenta regresiva sin pasar por «ya no reservamos» de nuevo", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const expired = makeSnapshot([makeLine("a", 1)], {
      reservation: { state: "expired", expires_at: null },
    });
    const server = new FakeCartServer(expired);
    renderWithCart(<ReservationCountdown />, { snapshot: expired, server });
    await flush();
    const resume = server.pause();
    server.snapshot = heldFor(600);
    await user.click(screen.getByRole("button", { name: "Reintentar reserva" }));
    const watch = watchAdded(/Ya no reservamos/);
    await settle(resume);
    expect(time()).toBe("Reservamos tus productos durante 10:00");
    watch.stop();
    expect(watch.seen).toEqual([]);
  });
});

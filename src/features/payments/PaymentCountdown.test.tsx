import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentCountdown } from "./PaymentCountdown";

const SERVER_NOW = "2026-11-10T12:00:00Z";
const SERVER_MS = Date.parse(SERVER_NOW);
const plus = (seconds: number) => new Date(SERVER_MS + seconds * 1000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SERVER_MS);
});
afterEach(() => vi.useRealTimers());

const live = () => screen.getByRole("status");
const tick = (seconds: number) => act(() => void vi.advanceTimersByTime(seconds * 1000));

describe("PaymentCountdown", () => {
  it("muestra lo que queda con la hora del servidor y baja cada segundo", () => {
    render(
      <PaymentCountdown expiresAt={plus(125)} serverNow={SERVER_NOW} fetchedAtMs={Date.now()} />,
    );
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent("02:05");
    tick(5);
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent("02:00");
  });

  it("24 horas se ven como 24:00:00", () => {
    render(
      <PaymentCountdown expiresAt={plus(86_400)} serverNow={SERVER_NOW} fetchedAtMs={Date.now()} />,
    );
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent("24:00:00");
  });

  it("un aparato con el reloj atrasado una hora ve la MISMA cuenta", () => {
    vi.setSystemTime(SERVER_MS - 3_600_000);
    render(
      <PaymentCountdown expiresAt={plus(125)} serverNow={SERVER_NOW} fetchedAtMs={Date.now()} />,
    );
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent("02:05");
    tick(65);
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent("01:00");
  });

  it("el número visible NO es una región viva; una región viva persistente anuncia solo los cortes", () => {
    render(
      <PaymentCountdown expiresAt={plus(3_700)} serverNow={SERVER_NOW} fetchedAtMs={Date.now()} />,
    );
    expect(
      screen.getByTestId("payment-countdown").closest("[aria-live], [role=status]"),
    ).toBeNull();
    expect(live()).toHaveTextContent(""); // más de una hora: nada que anunciar
    tick(100); // quedan 3 600 s: «queda una hora»
    expect(live()).toHaveTextContent("Queda una hora para pagar.");
    tick(3_000); // quedan 600 s
    expect(live()).toHaveTextContent("Quedan diez minutos para pagar.");
    tick(541); // quedan 59 s
    expect(live()).toHaveTextContent("Queda menos de un minuto para pagar.");
  });

  it("al llegar a 0 avisa UNA sola vez y dice que se está verificando", () => {
    const onElapsed = vi.fn();
    render(
      <PaymentCountdown
        expiresAt={plus(3)}
        serverNow={SERVER_NOW}
        fetchedAtMs={Date.now()}
        onElapsed={onElapsed}
      />,
    );
    tick(2);
    expect(onElapsed).not.toHaveBeenCalled();
    tick(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Verificando el estado de tu pedido…")).toBeInTheDocument();
    expect(live()).toHaveTextContent("El tiempo para pagar terminó.");
    tick(30);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("ya vencido al abrir: avisa una vez y no deja ningún intervalo vivo", () => {
    const onElapsed = vi.fn();
    render(
      <PaymentCountdown
        expiresAt={plus(-10)}
        serverNow={SERVER_NOW}
        fetchedAtMs={Date.now()}
        onElapsed={onElapsed}
      />,
    );
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("repintar la pantalla con OTRA función de aviso no repite el aviso del mismo vencimiento; un vencimiento nuevo sí avisa", () => {
    const first = vi.fn();
    const second = vi.fn();
    const props = { expiresAt: plus(-10), serverNow: SERVER_NOW, fetchedAtMs: Date.now() };
    const view = render(<PaymentCountdown {...props} onElapsed={first} />);
    expect(first).toHaveBeenCalledTimes(1);
    view.rerender(<PaymentCountdown {...props} onElapsed={second} />);
    expect(second).not.toHaveBeenCalled();
    // un reintento da otro vencimiento (que también ya pasó): ese es otro aviso
    view.rerender(<PaymentCountdown {...props} expiresAt={plus(-5)} onElapsed={second} />);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("al desmontar se limpia el intervalo", () => {
    const view = render(
      <PaymentCountdown expiresAt={plus(500)} serverNow={SERVER_NOW} fetchedAtMs={Date.now()} />,
    );
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sin vencimiento no pinta nada", () => {
    const { container } = render(
      <PaymentCountdown expiresAt={null} serverNow={SERVER_NOW} fetchedAtMs={Date.now()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

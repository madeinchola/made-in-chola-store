import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSingleFlight } from "./useSingleFlight";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("useSingleFlight", () => {
  it("devuelve lo que devuelve la operación", async () => {
    const { result } = renderHook(() => useSingleFlight());
    await expect(result.current(async () => 42)).resolves.toBe(42);
  });

  it("mientras una operación está en vuelo, las demás se IGNORAN (devuelven undefined y no se ejecutan)", async () => {
    const { result } = renderHook(() => useSingleFlight());
    const first = deferred<string>();
    const op = vi.fn(() => first.promise);
    const other = vi.fn(async () => "otra");
    let started!: Promise<string | undefined>;
    act(() => {
      started = result.current(op);
    });
    // dos llamadas en el MISMO instante (sin que React pinte entre medias)
    const second = await result.current(other);
    const third = await result.current(other);
    expect(second).toBeUndefined();
    expect(third).toBeUndefined();
    expect(other).not.toHaveBeenCalled();
    expect(op).toHaveBeenCalledTimes(1);
    first.resolve("primera");
    await expect(started).resolves.toBe("primera");
  });

  it("al terminar, deja pasar la siguiente", async () => {
    const { result } = renderHook(() => useSingleFlight());
    const op = vi.fn(async () => "ok");
    await result.current(op);
    await result.current(op);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("si la operación falla, el error llega a quien llamó y la puerta se vuelve a abrir", async () => {
    const { result } = renderHook(() => useSingleFlight());
    await expect(
      result.current(async () => {
        throw new Error("falló");
      }),
    ).rejects.toThrow("falló");
    await expect(result.current(async () => "de nuevo")).resolves.toBe("de nuevo");
  });

  it("es una función estable entre renders (no provoca efectos en cadena)", () => {
    const { result, rerender } = renderHook(() => useSingleFlight());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });
});

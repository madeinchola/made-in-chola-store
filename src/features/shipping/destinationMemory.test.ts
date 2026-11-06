import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Destination } from "./destination";
import {
  forgetDestination,
  GUEST_OWNER,
  recalled,
  rememberDestination,
  rememberSchedule,
  useRemembered,
} from "./destinationMemory";

const home: Destination = {
  lat: -16.5,
  lng: -68.15,
  city: "La Paz",
  label: "Casa",
  addressId: "a",
};
const schedule = { date: "2026-11-09", slotId: "slot-1" };

beforeEach(() => act(() => forgetDestination()));
// con `act`: al terminar, el gancho de la prueba sigue montado y su suscripción se entera del borrado
afterEach(() => act(() => forgetDestination()));

describe("destinationMemory · solo en memoria y con dueño", () => {
  it("recuerda el destino y la franja de su dueño", () => {
    rememberDestination("user-1", home);
    rememberSchedule("user-1", schedule);
    expect(recalled("user-1")).toEqual({ owner: "user-1", destination: home, schedule });
  });

  it("lo de una persona NUNCA lo ve otra (otro usuario, invitada, o dueño aún desconocido)", () => {
    rememberDestination("user-1", home);
    expect(recalled("user-2").destination).toBeNull();
    expect(recalled(GUEST_OWNER).destination).toBeNull();
    expect(recalled(null).destination).toBeNull();
  });

  it("guardar la franja conserva el destino, y al revés", () => {
    rememberDestination(GUEST_OWNER, home);
    rememberSchedule(GUEST_OWNER, schedule);
    rememberDestination(GUEST_OWNER, { ...home, city: "El Alto" });
    expect(recalled(GUEST_OWNER)).toMatchObject({
      destination: { city: "El Alto" },
      schedule,
    });
    rememberSchedule(GUEST_OWNER, null);
    expect(recalled(GUEST_OWNER)).toMatchObject({
      destination: { city: "El Alto" },
      schedule: null,
    });
  });

  it("al guardar para otro dueño, lo del anterior desaparece (no se mezcla)", () => {
    rememberDestination("user-1", home);
    rememberSchedule("user-1", schedule);
    rememberDestination("user-2", { ...home, city: "Sucre" });
    expect(recalled("user-1").destination).toBeNull();
    expect(recalled("user-2")).toMatchObject({ destination: { city: "Sucre" }, schedule: null });
  });

  it("forgetDestination borra todo", () => {
    rememberDestination("user-1", home);
    forgetDestination();
    expect(recalled("user-1")).toEqual({ owner: null, destination: null, schedule: null });
  });

  it("no escribe NADA en el almacenamiento del navegador (es un dato personal)", () => {
    localStorage.clear();
    sessionStorage.clear();
    rememberDestination("user-1", home);
    rememberSchedule("user-1", schedule);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("useRemembered", () => {
  it("devuelve lo del dueño y se actualiza cuando se recuerda algo nuevo", () => {
    const { result } = renderHook(() => useRemembered("user-1"));
    expect(result.current.destination).toBeNull();
    act(() => rememberDestination("user-1", home));
    expect(result.current.destination).toEqual(home);
    act(() => rememberSchedule("user-1", schedule));
    expect(result.current.schedule).toEqual(schedule);
  });

  it("con el dueño aún desconocido (sesión cargando) no devuelve nada", () => {
    rememberDestination("user-1", home);
    const { result } = renderHook(() => useRemembered(null));
    expect(result.current.destination).toBeNull();
    // y no borra lo guardado: todavía no se sabe de quién es la sesión
    expect(recalled("user-1").destination).toEqual(home);
  });

  it("al cambiar de dueño (cerrar sesión, otra cuenta) lo anterior se descarta de la memoria", () => {
    rememberDestination("user-1", home);
    const { result, rerender } = renderHook(({ owner }) => useRemembered(owner), {
      initialProps: { owner: "user-1" as string | null },
    });
    expect(result.current.destination).toEqual(home);
    rerender({ owner: GUEST_OWNER });
    expect(result.current.destination).toBeNull();
    expect(recalled("user-1").destination).toBeNull(); // se borró, no solo se ocultó
    rerender({ owner: "user-1" });
    expect(result.current.destination).toBeNull(); // volver no lo resucita
  });
});

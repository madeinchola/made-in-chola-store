import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { subscribeToTracking, type TrackEvent } from "@/features/storefront/analytics/track";
import { product } from "./home-test-utils";
import { useTrackItemList } from "./useTrackItemList";

function setup(initial: { listId: string; products: ReturnType<typeof product>[] }) {
  const events: TrackEvent[] = [];
  const off = subscribeToTracking((e) => events.push(e));
  const view = renderHook((props) => useTrackItemList(props.listId, "Mi lista", props.products), {
    initialProps: initial,
  });
  return { events, off, ...view };
}

describe("useTrackItemList", () => {
  it("emite view_item_list con posiciones desde 1 y el precio en unidades mayores (Bs 80,00 → 80)", () => {
    const { events, off } = setup({ listId: "a", products: [product(1), product(2)] });
    off();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "view_item_list",
      listId: "a",
      listName: "Mi lista",
      items: [
        { id: "p1", name: "Chakra 1", price: 80, currency: "BOB", position: 1 },
        { id: "p2", name: "Chakra 2", price: 80, currency: "BOB", position: 2 },
      ],
    });
  });

  it("repintar con una lista NUEVA pero los mismos ids no vuelve a emitir", () => {
    const { events, off, rerender } = setup({ listId: "a", products: [product(1), product(2)] });
    rerender({ listId: "a", products: [product(1), product(2)] });
    rerender({ listId: "a", products: [product(1), product(2)] });
    off();
    expect(events).toHaveLength(1);
  });

  it("si cambian los ids (otra tanda de productos) emite de nuevo, con la lista nueva", () => {
    const { events, off, rerender } = setup({ listId: "a", products: [product(1)] });
    rerender({ listId: "a", products: [product(1), product(3)] });
    off();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ items: [{ id: "p1" }, { id: "p3" }] });
  });

  it("el MISMO orden importa: [1,2] → [2,1] es otra lista", () => {
    const { events, off, rerender } = setup({ listId: "a", products: [product(1), product(2)] });
    rerender({ listId: "a", products: [product(2), product(1)] });
    off();
    expect(events).toHaveLength(2);
  });

  it("los mismos productos en OTRA fila de la portada cuentan como otra lista", () => {
    const { events, off, rerender } = setup({ listId: "a", products: [product(1)] });
    rerender({ listId: "b", products: [product(1)] });
    off();
    expect(events.map((e) => (e.name === "view_item_list" ? e.listId : null))).toEqual(["a", "b"]);
  });

  it("una lista vacía (aún cargando o sin productos) no emite nada", () => {
    const { events, off, rerender } = setup({ listId: "a", products: [] });
    rerender({ listId: "a", products: [] });
    off();
    expect(events).toHaveLength(0);
  });
});

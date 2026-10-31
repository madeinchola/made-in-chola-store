import { describe, expect, it } from "vitest";
import { cartBadge, normalizeCount } from "./cartCount";

describe("cartBadge", () => {
  it.each([
    [0, false, "0", 0],
    [1, true, "1", 1],
    [5, true, "5", 5],
    [99, true, "99", 99],
    [100, true, "99+", 100],
    [124, true, "99+", 124],
    [5.9, true, "5", 5],
    [0.4, false, "0", 0],
  ])("cantidad %s → visible %s, texto %s, exacta %s", (value, visible, text, count) => {
    expect(cartBadge(value)).toEqual({ visible, text, count });
  });

  it.each([[-3], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    "valor no válido %s cuenta como 0 (nunca muestra NaN ni negativos)",
    (value) => {
      expect(normalizeCount(value)).toBe(0);
      expect(cartBadge(value).visible).toBe(false);
    },
  );
});

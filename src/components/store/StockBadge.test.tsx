import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicStockStatus } from "@/features/catalog/types";
import { StockBadge } from "./StockBadge";

describe("StockBadge", () => {
  it.each<[PublicStockStatus, string, string]>([
    ["in_stock", "Disponible", "text-success"],
    ["low", "Pocas unidades", "text-warning"],
    ["out", "Agotado", "text-destructive"],
  ])("%s → texto visible «%s» con el tono %s", (status, text, toneClass) => {
    render(<StockBadge status={status} />);
    const badge = screen.getByText(text);
    expect(badge).toBeVisible();
    expect(badge).toHaveClass(toneClass);
  });

  it("acepta clases extra", () => {
    render(<StockBadge status="low" className="ml-2" />);
    expect(screen.getByText("Pocas unidades")).toHaveClass("ml-2");
  });
});

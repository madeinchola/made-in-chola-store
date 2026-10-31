import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn()", () => {
  it("combina clases y descarta valores falsos", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
  it("la última clase de la misma familia gana (comportamiento estándar de twMerge)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", "text-xs")).toBe("text-xs");
  });
  it("tamaño de título propio y color NO se pisan entre sí (son familias distintas)", () => {
    expect(cn("text-display-lg", "text-primary")).toBe("text-display-lg text-primary");
    expect(cn("text-primary", "text-display-lg")).toBe("text-primary text-display-lg");
  });
  it("dos tamaños de título propios sí se pisan: gana el último", () => {
    expect(cn("text-display-xl", "text-display-md")).toBe("text-display-md");
  });
  it("un tamaño de título propio pisa a uno estándar de Tailwind", () => {
    expect(cn("text-sm", "text-display-sm")).toBe("text-display-sm");
  });
  it("radios propios se pisan con los estándar (si no, mandaría el orden del CSS)", () => {
    expect(cn("rounded-md", "rounded-card")).toBe("rounded-card");
    expect(cn("rounded-pill", "rounded-lg")).toBe("rounded-lg");
  });
  it("espaciado de sección y tracking propios se pisan con los estándar", () => {
    expect(cn("py-4", "py-section")).toBe("py-section");
    expect(cn("tracking-wide", "tracking-eyebrow")).toBe("tracking-eyebrow");
  });
  it("los colores de estado propios se pisan entre sí (text-success vs text-info)", () => {
    expect(cn("text-success", "text-info")).toBe("text-info");
  });
});

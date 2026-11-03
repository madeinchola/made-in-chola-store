import { describe, expect, it } from "vitest";
import { formatPhoneDisplay } from "./phoneFormat";

describe("formatPhoneDisplay", () => {
  it("celular boliviano: prefijo y 8 dígitos agrupados de 4 en 4", () => {
    expect(formatPhoneDisplay("+59171234567")).toBe("+591 7123 4567");
    expect(formatPhoneDisplay("+59161234567")).toBe("+591 6123 4567");
  });

  it("cualquier otro número se muestra tal cual (no se agrupa a ciegas)", () => {
    expect(formatPhoneDisplay("+34612345678")).toBe("+34612345678");
    expect(formatPhoneDisplay("+59151234567")).toBe("+59151234567"); // no empieza en 6 o 7
    expect(formatPhoneDisplay("+5917123456")).toBe("+5917123456"); // 7 dígitos
    expect(formatPhoneDisplay("+591712345678")).toBe("+591712345678"); // 9 dígitos
    expect(formatPhoneDisplay("71234567")).toBe("71234567"); // sin prefijo
    expect(formatPhoneDisplay("")).toBe("");
  });
});

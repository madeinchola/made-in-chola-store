import { describe, expect, it } from "vitest";
import { applyPhoneMask, caretAfterDigits, maskPhone } from "./phoneMask";
import { normalizePhone } from "@shared/identity";

describe("maskPhone", () => {
  const cases: [string, string, string][] = [
    ["vacío", "", ""],
    ["1 dígito", "7", "7"],
    ["4 dígitos: sin espacio colgante", "7123", "7123"],
    ["5 dígitos", "71234", "7123 4"],
    ["celular boliviano de 8 dígitos", "71234567", "7123 4567"],
    ["ya con formato: no se duplica el espacio", "7123 4567", "7123 4567"],
    ["espacio mal puesto: se reordena", "71 234567", "7123 4567"],
    ["guiones y paréntesis se quitan", "(7123)-4567", "7123 4567"],
    ["letras se descartan", "7a1b2c3d4e5f6g7", "7123 4567"],
    ["9 dígitos con 0 delante", "071234567", "0712 3456 7"],
    ["tope de 15 dígitos", "1234567890123456789", "1234 5678 9012 345"],
    ["solo basura", "abc", ""],
  ];
  it.each(cases)("%s", (_n, input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });

  it("no toca el formato internacional (+ o 00): solo quita caracteres imposibles", () => {
    expect(maskPhone("+591 7123 4567")).toBe("+591 7123 4567");
    expect(maskPhone("+591-7123-4567")).toBe("+591-7123-4567");
    expect(maskPhone("00591 71234567")).toBe("00591 71234567");
    expect(maskPhone("+591 71a23")).toBe("+591 7123");
    expect(maskPhone("  +34 600")).toBe("  +34 600");
  });

  it("es idempotente", () => {
    for (const s of ["71234567", "0712345678", "+591 7123", "1234567890123456", ""]) {
      expect(maskPhone(maskPhone(s))).toBe(maskPhone(s));
    }
  });

  it("el número enmascarado se normaliza igual que el crudo (la máscara no cambia el significado)", () => {
    for (const raw of ["71234567", "61234567", "071234567"]) {
      const a = normalizePhone(raw, "BO");
      const b = normalizePhone(maskPhone(raw), "BO");
      expect(b).toEqual(a);
    }
    expect(normalizePhone(maskPhone("+591 71234567"), "BO")).toEqual(
      normalizePhone("+591 71234567", "BO"),
    );
  });
});

describe("caretAfterDigits", () => {
  it("cuenta dígitos, no caracteres", () => {
    expect(caretAfterDigits("7123 4567", 0)).toBe(0);
    expect(caretAfterDigits("7123 4567", 4)).toBe(4);
    expect(caretAfterDigits("7123 4567", 5)).toBe(6); // salta el espacio y queda tras el 5.º dígito
    expect(caretAfterDigits("7123 4567", 8)).toBe(9);
    expect(caretAfterDigits("7123 4567", 20)).toBe(9);
  });
});

describe("applyPhoneMask (con campo real)", () => {
  function field(value: string, caret: number) {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.value = value;
    input.setSelectionRange(caret, caret);
    return input;
  }
  it("formatea y deja el cursor al final cuando se escribe al final", () => {
    const input = field("71234", 5);
    expect(applyPhoneMask(input)).toBe("7123 4");
    expect(input.value).toBe("7123 4");
    expect(input.selectionStart).toBe(6);
  });
  it("editar EN MEDIO no manda el cursor al final: tras insertar un dígito sigue pegado a él", () => {
    // «7123 4567» con un «9» escrito tras el 2.º dígito → «7913 4567» se reordena en bloques de 4
    const input = field("7923 4567", 2); // cursor justo después del 9
    applyPhoneMask(input);
    expect(input.value).toBe("7923 4567");
    expect(input.selectionStart).toBe(2);
  });
  it("al insertar un dígito en medio que desplaza los bloques, el cursor sigue tras ese dígito", () => {
    // El usuario tenía «7123 4567» y escribe un «0» tras el primer dígito: «70123 4567», cursor en 2.
    const input = field("70123 4567", 2);
    applyPhoneMask(input);
    expect(input.value).toBe("7012 3456 7");
    expect(input.selectionStart).toBe(2);
  });
  it("sin cambios no toca el campo ni el cursor", () => {
    const input = field("7123 4567", 3);
    applyPhoneMask(input);
    expect(input.selectionStart).toBe(3);
  });
  it("formato internacional: no reformatea y respeta el cursor", () => {
    const input = field("+591 7123", 4);
    expect(applyPhoneMask(input)).toBe("+591 7123");
    expect(input.selectionStart).toBe(4);
  });

  describe("borrar con Supr / Retroceso a través del espacio del formato", () => {
    /** Simula lo que hace el navegador: el campo ya tenía `before`; se borra con la tecla y llega el evento `input`. */
    function edit(before: string, caretBefore: number, key: "forward" | "backward") {
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.value = before;
      input.setSelectionRange(caretBefore, caretBefore);
      applyPhoneMask(input); // registra el valor previo
      // el navegador quita UN carácter
      if (key === "forward") {
        input.value = before.slice(0, caretBefore) + before.slice(caretBefore + 1);
        input.setSelectionRange(caretBefore, caretBefore);
      } else {
        input.value = before.slice(0, caretBefore - 1) + before.slice(caretBefore);
        input.setSelectionRange(caretBefore - 1, caretBefore - 1);
      }
      applyPhoneMask(input, key === "forward" ? "deleteContentForward" : "deleteContentBackward");
      return input;
    }

    it("Supr justo antes del espacio borra también el dígito siguiente (antes se quedaba atascado)", () => {
      const input = edit("7123 4567", 4, "forward"); // Supr borra el espacio → debe borrar el «4»
      expect(input.value).toBe("7123 567");
      expect(input.selectionStart).toBe(4);
    });
    it("Supr repetido avanza dígito a dígito sin atascarse", () => {
      let input = edit("7123 4567", 4, "forward");
      expect(input.value).toBe("7123 567");
      input = edit(input.value, 4, "forward"); // ahora Supr cae sobre el espacio otra vez
      expect(input.value).toBe("7123 67");
    });
    it("Retroceso justo después del espacio borra el dígito anterior", () => {
      const input = edit("7123 4567", 5, "backward"); // Retroceso borra el espacio → debe borrar el «3»
      expect(input.value).toBe("7124 567");
      expect(input.selectionStart).toBe(3);
    });
    it("borrar un dígito normal no toca nada más", () => {
      expect(edit("7123 4567", 2, "forward").value).toBe("7134 567");
      expect(edit("7123 4567", 8, "backward").value).toBe("7123 457");
    });
    it("sin tipo de evento de borrado (escribir, pegar…) no se aplica la corrección", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.value = "7123 4567";
      applyPhoneMask(input);
      input.value = "71234567"; // un espacio menos pero NO por borrado
      input.setSelectionRange(4, 4);
      expect(applyPhoneMask(input, "insertFromPaste")).toBe("7123 4567");
    });
  });
});

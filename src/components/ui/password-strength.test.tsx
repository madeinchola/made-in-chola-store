import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordStrength } from "./password-strength";
import {
  assessPassword,
  effectiveLength,
  MIN_EFFECTIVE,
  type StrengthLevel,
} from "./password-strength-score";

// Puntuación calculada a mano (ver `assessPassword`): puntos = longitud + variedad.
//   longitud: 8–11 → 1 · 12–15 → 2 · 16–19 → 3 · 20+ → 4     variedad: 1 clase → 0 · 2 → 1 · 3 o más → 2
//   nivel: 1–3 → fair · 4–5 → good · 6 → strong      (cualquier regla de la política incumplida → weak)
const cases: [string, string, number, StrengthLevel][] = [
  ["8 car. 3 clases (Perro123)", "Perro123", 3, "fair"], // 1 + 2
  ["8 car. 1 clase", "zorrovel", 1, "fair"], // 1 + 0
  ["8 car. 2 clases", "zorro123", 2, "fair"], // 1 + 1
  ["11 car. 3 clases", "Zorrovelca7", 3, "fair"], // 1 + 2: último en «aceptable» por longitud
  ["12 car. 3 clases", "Zorrovelcan7", 4, "good"], // 2 + 2: primer «buena»
  ["14 car. 1 clase", "zorrovelcanuyo", 2, "fair"], // 2 + 0
  ["15 car. 2 clases", "zorrovelcanuyo7", 3, "fair"], // 2 + 1: borde, aún no llega a 16
  ["16 car. 2 clases", "zorrovelcanuyop7", 4, "good"], // 16 car.: 3 + 1
  ["12 car.: mayúscula + minúscula + símbolo", "Zorrovelcan-", 4, "good"], // 2 + 2: el símbolo cuenta como clase
  ["12 car.: solo minúsculas + símbolo", "zorrovelcan-", 3, "fair"], // 2 + 1
  ["16 car. 3 clases", "MiGatitoBlanco27", 5, "good"], // 3 + 2
  ["19 car. 1 clase", "correcaballobateria", 3, "fair"], // 3 + 0
  ["19 car. 3 clases", "Zorrovelcanuyopasa7", 5, "good"], // 3 + 2: no llega a «fuerte» por 1 carácter
  ["20 car. 1 clase", "zorrovelcanuyopasaje", 4, "good"], // 4 + 0
  ["20 car. 3 clases", "Zorrovelcanuyopasaj7", 6, "strong"], // 4 + 2: primer «fuerte»
  ["24 car. 4 clases", "Mi-Gatito-Blanco-Rojo-27", 6, "strong"], // 4 + 2
  ["12 caracteres sin mayúscula ni minúscula (CJK)", "日本語の勉強は楽しいです", 2, "fair"], // 2 + 0: una sola clase («otro»)
];

describe("assessPassword · puntuación", () => {
  it.each(cases)("%s → %i puntos → %s", (_name, password, points, level) => {
    const result = assessPassword(password);
    expect(result.points).toBe(points);
    expect(result.level).toBe(level);
    expect(result.failures).toEqual([]);
  });

  it("los segmentos del medidor siguen al nivel: vacío 0 · débil 1 · aceptable 2 · buena 3 · fuerte 4", () => {
    expect(assessPassword("").segments).toBe(0);
    expect(assessPassword("abc").segments).toBe(1);
    expect(assessPassword("Perro123").segments).toBe(2);
    expect(assessPassword("MiGatitoBlanco27").segments).toBe(3);
    expect(assessPassword("Zorrovelcanuyopasaj7").segments).toBe(4);
  });

  it("7 caracteres no cumplen la política (weak) y 8 sí: borde exacto de la longitud mínima", () => {
    expect(assessPassword("Perro12")).toMatchObject({ level: "weak", failures: ["too_short"] });
    expect(assessPassword("Perro123").level).toBe("fair");
  });

  it("vacía → empty, sin fallos ni puntos", () => {
    expect(assessPassword("")).toEqual({
      level: "empty",
      segments: 0,
      failures: [],
      points: 0,
      predictable: false,
    });
  });

  it("incumplir CUALQUIER regla de la política la deja en weak, aunque sea larga y variada", () => {
    expect(assessPassword("abc")).toMatchObject({ level: "weak", points: 0 });
    expect(assessPassword("abc").failures).toContain("too_short");
    expect(assessPassword("Password1").failures).toEqual(["common"]); // base «password»
    expect(assessPassword("aaaaaaaaaaaaaaaaaaaaaaaa").failures).toEqual(["repetitive"]); // 24 «a»: larga pero repetida
    expect(assessPassword("12345678").failures).toEqual(["common", "sequential"]);
    // 73 bytes → demasiado larga para bcrypt (72)
    const tooLong = assessPassword("aZ3".repeat(24) + "k");
    expect(tooLong.level).toBe("weak");
    expect(tooLong.failures).toEqual(["too_long"]);
  });

  it("contener el email o el teléfono la deja en weak (la misma política del servidor)", () => {
    // sin contexto es válida y buena…
    expect(assessPassword("Zorrovelcan7").level).toBe("good");
    // …pero con el email «zorrovelcan@…» contiene su parte local
    const withEmail = assessPassword("Zorrovelcan7", { email: "zorrovelcan@correo.com" });
    expect(withEmail.level).toBe("weak");
    expect(withEmail.failures).toEqual(["contains_identifier"]);
    // el teléfono: sus últimos 8 dígitos dentro de la contraseña
    const withPhone = assessPassword("Zorro71234567x", { phone: "+59171234567" });
    expect(withPhone.failures).toEqual(["contains_identifier"]);
  });
});

describe("PasswordStrength · componente", () => {
  it("el texto va en una región role=status (educada) y dice el nivel con palabras", () => {
    render(<PasswordStrength password="MiGatitoBlanco27" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Seguridad de la contraseña: Buena");
    expect(status).toHaveAttribute("data-level", "good");
  });

  it.each([
    ["abc", "Débil"],
    ["Perro123", "Aceptable"],
    ["MiGatitoBlanco27", "Buena"],
    ["Zorrovelcanuyopasaj7", "Fuerte"],
  ])("«%s» se anuncia como %s", (password, label) => {
    render(<PasswordStrength password={password} />);
    expect(screen.getByRole("status")).toHaveTextContent(`Seguridad de la contraseña: ${label}`);
  });

  it("vacía: la región existe (para poder anunciar después) pero no dice nada", () => {
    render(<PasswordStrength password="" />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveAttribute("data-level", "empty");
  });

  it("el medidor de colores es decorativo (aria-hidden) y pinta tantos segmentos como el nivel", () => {
    const { container } = render(<PasswordStrength password="MiGatitoBlanco27" />);
    const meter = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(meter).toBeInTheDocument();
    const segments = Array.from(meter.children);
    expect(segments).toHaveLength(4);
    expect(segments.map((s) => s.getAttribute("data-filled"))).toEqual([
      "true",
      "true",
      "true",
      "false",
    ]);
  });

  it("el medidor usa tokens de color (nada de colores crudos) y cambia con el nivel", () => {
    const { container, rerender } = render(<PasswordStrength password="abc" />);
    const fill = () =>
      Array.from(container.querySelectorAll("[data-filled=true]")).map((e) => e.className);
    expect(fill()).toHaveLength(1);
    expect(fill()[0]).toContain("bg-destructive");
    rerender(<PasswordStrength password="Perro123" />);
    expect(fill()).toHaveLength(2);
    expect(fill()[0]).toContain("bg-warning");
    rerender(<PasswordStrength password="Zorrovelcanuyopasaj7" />);
    expect(fill()).toHaveLength(4);
    expect(fill()[0]).toContain("bg-success");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}|\b(?:red|amber|green|gray)-\d{2,3}\b/i);
  });

  it("vacía no pinta ningún segmento", () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container.querySelectorAll("[data-filled=true]")).toHaveLength(0);
  });

  it("el texto anunciado solo depende del NIVEL: seguir escribiendo en el mismo nivel no lo cambia", () => {
    const { rerender } = render(<PasswordStrength password="Perro123" />);
    const before = screen.getByRole("status").textContent;
    rerender(<PasswordStrength password="Perro1234" />); // 9 car.: sigue «aceptable»
    expect(screen.getByRole("status").textContent).toBe(before);
    rerender(<PasswordStrength password="MiGatitoBlanco27" />);
    expect(screen.getByRole("status").textContent).not.toBe(before);
  });

  it("showHints lista las reglas incumplidas con texto; por defecto no se muestran", () => {
    const { rerender } = render(<PasswordStrength password="abc" />);
    expect(screen.queryByText("Para que sea válida:")).not.toBeInTheDocument();
    rerender(<PasswordStrength password="abc" showHints />);
    expect(screen.getByText("Para que sea válida:")).toBeInTheDocument();
    expect(screen.getByText("Mínimo 8 caracteres.")).toBeInTheDocument();
    expect(screen.getByText("Es una contraseña demasiado común.")).toBeInTheDocument();
    // una contraseña válida no muestra lista
    rerender(<PasswordStrength password="MiGatitoBlanco27" showHints />);
    expect(screen.queryByText("Para que sea válida:")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("el contexto (email/teléfono) llega a la política", () => {
    render(
      <PasswordStrength
        password="Zorrovelcan7"
        context={{ email: "zorrovelcan@x.com" }}
        showHints
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Débil");
    expect(screen.getByText("No incluyas tu email o teléfono.")).toBeInTheDocument();
  });

  it("acepta id (para aria-describedby) y className", () => {
    const { container } = render(<PasswordStrength password="" id="fuerza" className="mt-2" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("id", "fuerza");
    expect(root).toHaveClass("mt-2");
  });
});

describe("effectiveLength (cuánto de la contraseña NO es predecible)", () => {
  it.each([
    ["una secuencia ascendente cuenta solo sus 2 primeros", "abcdef", 2], // 6 − 4 (c, d, e, f)
    ["una secuencia descendente igual", "zyxwvu", 2],
    ["una sola letra repetida", "aaaaaa", 1], // 6 − 5
    ["un bloque de 2 repetido", "abab", 2], // 4 − 2
    ["un bloque de 8 repetido 3 veces", "Passw0rdPassw0rdPassw0rd", 8], // 24 − 16
    ["bloque de 3 repetido: pesa más la repetición (3) que la secuencia (2)", "abcabc", 3],
    ["secuencia larga con un dígito suelto al final", "Abcdefghijklmnopqrst1", 3], // 21 − 18
    ["de 2 caracteres o menos no se descuenta nada", "ab", 2],
    ["una contraseña sin patrones conserva toda su longitud", "MiGatitoBlanco27", 16],
    [
      "un bloque que solo se repite a medias (4 de 8) no cuenta como repetición",
      "Zq7wZq7wKt3!",
      12,
    ],
    [
      "las mayúsculas no esconden la secuencia y una letra con acento solo rompe su inicio",
      "ÁbCdEfGh",
      3,
    ], // en minúsculas «ábcdefgh»: á no encadena con b, pero d…h sí (5): 8 − 5
  ])("%s: «%s» → %i", (_name, password, expected) => {
    expect(effectiveLength(password)).toBe(expected);
  });
});

describe("contraseñas que cumplen la política pero son predecibles (la política sola las dejaba «Fuertes»)", () => {
  it.each([
    "Abcdefghijklmnopqrst1", // secuencia de 20 letras
    "AbAbAbAbAbAbAbAbAbAb1", // bloque de 2 repetido
    "Aaaaaaaaaaaaaaaaaaaa1", // una letra repetida
  ])("«%s» → Débil, marcada como predecible y sin fallos de la política", (password) => {
    const result = assessPassword(password);
    expect(result.level).toBe("weak");
    expect(result.segments).toBe(1);
    expect(result.predictable).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("un bloque de 8 que se repite 3 veces ya NO es «Fuerte»: 8 caracteres efectivos + 3 clases = 3 puntos → Aceptable", () => {
    const result = assessPassword("Passw0rdPassw0rdPassw0rd");
    expect(result).toMatchObject({ level: "fair", points: 3, predictable: true });
  });

  it("el borde de MIN_EFFECTIVE: 5 caracteres efectivos quedan por debajo y 6 no", () => {
    expect(MIN_EFFECTIVE).toBe(6);
    // «abcdefgh» son 8 letras con 6 de secuencia (c…h): se suman 3 sueltas («K», «4», «t») → 11 − 6 = 5; con una más → 6
    expect(effectiveLength("abcdefghK4t")).toBe(5);
    expect(effectiveLength("abcdefghK4tZ")).toBe(6);
    expect(effectiveLength("abcdefghK4t")).toBeLessThan(MIN_EFFECTIVE);
    expect(effectiveLength("abcdefghK4tZ")).not.toBeLessThan(MIN_EFFECTIVE);
  });

  it("una contraseña normal no queda marcada como predecible", () => {
    expect(assessPassword("MiGatitoBlanco27").predictable).toBe(false);
    expect(assessPassword("Mi-Gatito-Blanco-Rojo-27").predictable).toBe(false);
  });
});

describe("PasswordStrength · aviso de patrones", () => {
  it("con las pistas activadas explica que las secuencias y repeticiones suman poco (texto, no solo color)", () => {
    render(<PasswordStrength password="Abcdefghijklmnopqrst1" showHints />);
    expect(screen.getByRole("status")).toHaveTextContent("Seguridad de la contraseña: Débil");
    expect(screen.getByText(/Evita secuencias/)).toBeInTheDocument();
  });

  it("una contraseña con patrón pero no débil también avisa", () => {
    render(<PasswordStrength password="Passw0rdPassw0rdPassw0rd" showHints />);
    expect(screen.getByRole("status")).toHaveTextContent("Aceptable");
    expect(screen.getByText(/Evita secuencias/)).toBeInTheDocument();
  });

  it("sin patrones no hay aviso", () => {
    render(<PasswordStrength password="MiGatitoBlanco27" showHints />);
    expect(screen.queryByText(/Evita secuencias/)).not.toBeInTheDocument();
  });

  it("sin showHints no se pinta el aviso (como el resto de pistas)", () => {
    render(<PasswordStrength password="Abcdefghijklmnopqrst1" />);
    expect(screen.queryByText(/Evita secuencias/)).not.toBeInTheDocument();
  });
});

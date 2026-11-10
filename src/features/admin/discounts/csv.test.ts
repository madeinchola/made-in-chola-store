import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REVOKE_DELAY_MS,
  csvCell,
  csvFileName,
  downloadCsv,
  neutralizeFormula,
  toCsv,
} from "./csv";

const BOM = "﻿";

describe("neutralizeFormula: lo que una hoja de cálculo tomaría por fórmula", () => {
  it.each([
    ["=SUMA(1)", "'=SUMA(1)"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@x", "'@x"],
    ["\tx", "'\tx"],
    ["\rx", "'\rx"],
    ["-", "'-"],
    ["=", "'="],
    ['=HYPERLINK("http://x")', `'=HYPERLINK("http://x")`],
  ])("%j pasa a %j", (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it.each([
    ["a=b"],
    ["1+1"],
    ["x-y"],
    ["ana@correo.com"],
    ["VERANO-10"],
    ["'=ya con comilla"],
    [" =1"], // un espacio delante ya la vuelve texto
    [""],
    ["Ñandú"],
  ])("%j no se toca (el símbolo no está al principio)", (input) => {
    expect(neutralizeFormula(input)).toBe(input);
  });
});

describe("csvCell: RFC 4180", () => {
  it("una celda simple va tal cual", () => {
    expect(csvCell("VERANO-10")).toBe("VERANO-10");
  });
  it("las comillas dobles se duplican y la celda va entre comillas", () => {
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
  });
  it("una coma obliga a poner comillas", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
  });
  it("un salto de línea (LF, CR o CRLF) obliga a poner comillas y se conserva", () => {
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(csvCell("l1\r\nl2")).toBe('"l1\r\nl2"');
    expect(csvCell("l1\rl2")).toBe('"l1\rl2"');
  });
  it("los acentos, la eñe y los emojis pasan intactos", () => {
    expect(csvCell("Ñandú café 🙂")).toBe("Ñandú café 🙂");
    expect(csvCell("Ñandú, café")).toBe('"Ñandú, café"');
  });
  it("una celda vacía queda vacía", () => {
    expect(csvCell("")).toBe("");
  });
  it("una fórmula se neutraliza ANTES de poner comillas (y la comilla simple queda dentro)", () => {
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
    expect(csvCell('=1,"2"')).toBe(`"'=1,""2"""`);
  });
  it("un retorno de carro inicial se neutraliza y además exige comillas", () => {
    expect(csvCell("\rx")).toBe('"\'\rx"');
  });
  it("un tabulador inicial se neutraliza y NO exige comillas", () => {
    expect(csvCell("\tx")).toBe("'\tx");
  });
  it("un punto y coma o un apóstrofo en medio no obligan a nada", () => {
    expect(csvCell("a;b")).toBe("a;b");
    expect(csvCell("o'brien")).toBe("o'brien");
  });
});

describe("toCsv", () => {
  it("empieza con el BOM UTF-8 (U+FEFF), una sola vez", () => {
    const csv = toCsv([["a"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.indexOf(BOM, 1)).toBe(-1);
  });

  it("separa celdas con coma y registros con CRLF, y TODO registro (el último también) termina en CRLF", () => {
    expect(
      toCsv([
        ["Código", "Tope", "Empieza"],
        ["VERANO-10", "1", "2026-11-05 14:30"],
      ]),
    ).toBe(`${BOM}Código,Tope,Empieza\r\nVERANO-10,1,2026-11-05 14:30\r\n`);
  });

  it("no hay saltos de línea sueltos (LF sin CR) fuera de las celdas entre comillas", () => {
    const csv = toCsv([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(csv.split("\r\n")).toEqual([`${BOM}a,b`, "c,d", "e,f", ""]);
  });

  it("sin registros devuelve solo el BOM", () => {
    expect(toCsv([])).toBe(BOM);
  });

  it('un registro cuya única celda está vacía va como «""» (no se confunde con una línea en blanco)', () => {
    expect(toCsv([[""]])).toBe(`${BOM}""\r\n`);
    expect(toCsv([["a"], [""], ["b"]])).toBe(`${BOM}a\r\n""\r\nb\r\n`);
  });

  it("celdas vacías entre otras conservan su lugar", () => {
    expect(toCsv([["a", "", "c"]])).toBe(`${BOM}a,,c\r\n`);
    expect(toCsv([["", ""]])).toBe(`${BOM},\r\n`);
  });

  it("combina comillas, comas, saltos y acentos en una misma fila", () => {
    expect(toCsv([['María "la Chola"', "Calle 1, piso 2\nLa Paz", "ok"]])).toBe(
      `${BOM}"María ""la Chola""","Calle 1, piso 2\nLa Paz",ok\r\n`,
    );
  });

  it("cada celda de la fila pasa por la neutralización de fórmulas", () => {
    expect(toCsv([["=SUMA(1)", "+1", "-1", "@x", "\tx", "\rx", "normal"]])).toBe(
      `${BOM}'=SUMA(1),'+1,'-1,'@x,'\tx,"'\rx",normal\r\n`,
    );
  });

  it("los datos de una clienta con un nombre malicioso salen como texto", () => {
    expect(
      toCsv([
        ["=cmd|' /C calc'!A0", "ana@correo.com"],
        ["@SUM(1+1)", "-2+3@x.com"],
      ]),
    ).toBe(`${BOM}'=cmd|' /C calc'!A0,ana@correo.com\r\n'@SUM(1+1),'-2+3@x.com\r\n`);
  });

  it("no modifica las filas que recibe", () => {
    const rows = [["=1", "a,b"]];
    toCsv(rows);
    expect(rows).toEqual([["=1", "a,b"]]);
  });
});

describe("csvFileName", () => {
  // 2026-11-06 03:00 UTC = 2026-11-05 23:00 en La Paz (UTC−4): la fecha es la de La Paz, no la de UTC.
  const now = new Date("2026-11-06T03:00:00Z");

  it("quita tildes y símbolos, pasa a minúsculas y lleva la fecha de La Paz", () => {
    expect(csvFileName("Verano 2026 — ¡Mega!", now)).toBe("verano-2026-mega-2026-11-05.csv");
    expect(csvFileName("Ñandú", now)).toBe("nandu-2026-11-05.csv");
  });
  it("no deja pasar rutas ni extensiones escritas por una persona", () => {
    expect(csvFileName("../../etc/passwd", now)).toBe("etc-passwd-2026-11-05.csv");
    expect(csvFileName("a\\b:c*?.exe", now)).toBe("a-b-c-exe-2026-11-05.csv");
  });
  it("sin nada aprovechable usa «datos»", () => {
    expect(csvFileName("¡¡¡", now)).toBe("datos-2026-11-05.csv");
    expect(csvFileName("", now)).toBe("datos-2026-11-05.csv");
  });
  it("recorta a 40 caracteres sin dejar un guion al final", () => {
    const name = csvFileName(`${"a".repeat(39)} bbbb`, now);
    expect(name).toBe(`${"a".repeat(39)}-2026-11-05.csv`);
    expect(csvFileName("a".repeat(60), now)).toBe(`${"a".repeat(40)}-2026-11-05.csv`);
  });
});

describe("downloadCsv", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let blobs: Blob[];

  beforeEach(() => {
    vi.useFakeTimers();
    blobs = [];
    createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:http://localhost/abc";
    });
    revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const readBytes = (blob: Blob) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });

  it("pulsa un enlace temporal con la URL del archivo y su nombre, y luego lo quita", () => {
    let seen: { href: string; download: string; connected: boolean; hidden: boolean } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen = {
        href: this.getAttribute("href") ?? "",
        download: this.download,
        connected: this.isConnected,
        hidden: this.hidden,
      };
    });
    downloadCsv("codigos-2026-11-05.csv", `${BOM}a\r\n`);
    expect(seen).toEqual({
      href: "blob:http://localhost/abc",
      download: "codigos-2026-11-05.csv",
      connected: true,
      hidden: true,
    });
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("el archivo es un Blob text/csv en UTF-8 cuyos bytes empiezan por EF BB BF y conservan los acentos", async () => {
    // FileReader necesita el reloj real (con el reloj simulado no termina nunca).
    vi.useRealTimers();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const csv = toCsv([["Código", "Ñandú"]]);
    downloadCsv("x.csv", csv);
    expect(blobs).toHaveLength(1);
    const blob = blobs[0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = await readBytes(blob);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(csv);
    // «ó» en UTF-8 son dos bytes (C3 B3): no se guardó en Latin-1.
    expect([...bytes].slice(3, 6)).toEqual([0x43, 0xc3, 0xb3]);
  });

  it("libera la URL, pero no en el mismo instante (algunos navegadores cancelarían la descarga)", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    downloadCsv("x.csv", "a");
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/abc");
  });

  it("si el clic falla igual quita el enlace y libera la URL, y el error sube", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(() => downloadCsv("x.csv", "a")).toThrow("bloqueado");
    expect(document.querySelector("a[download]")).toBeNull();
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/abc");
  });

  it("no manda nada a la red ni deja datos en el almacenamiento del navegador", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(""));
    localStorage.clear();
    downloadCsv("x.csv", toCsv([["SECRETO-123"]]));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

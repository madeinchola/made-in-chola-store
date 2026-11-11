import { describe, expect, it } from "vitest";
import { checkProofFile, detectMime, PROOF_MAX_BYTES, proofPath } from "./proofFile";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff, 0xe0];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const blob = (head: number[], size = head.length) => {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return new Blob([bytes]);
};

describe("detectMime (por los bytes, no por el nombre)", () => {
  it("reconoce jpeg, png, webp y pdf", () => {
    expect(detectMime(new Uint8Array(JPG))).toBe("image/jpeg");
    expect(detectMime(new Uint8Array(PNG))).toBe("image/png");
    expect(detectMime(new Uint8Array(WEBP))).toBe("image/webp");
    expect(detectMime(new Uint8Array(PDF))).toBe("application/pdf");
  });
  it("un svg con script, un html o un ejecutable no son comprobantes", () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect(detectMime(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(detectMime(text("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(detectMime(new Uint8Array())).toBeNull();
  });
  it("un RIFF que no es WebP (un WAV) no pasa", () => {
    expect(
      detectMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])),
    ).toBeNull();
  });
});

describe("checkProofFile", () => {
  it("acepta cada tipo con su extensión", async () => {
    expect(await checkProofFile(blob(JPG, 100))).toEqual({
      ok: true,
      mime: "image/jpeg",
      ext: "jpg",
      size: 100,
    });
    expect(await checkProofFile(blob(PNG, 100))).toEqual({
      ok: true,
      mime: "image/png",
      ext: "png",
      size: 100,
    });
    expect(await checkProofFile(blob(WEBP, 100))).toEqual({
      ok: true,
      mime: "image/webp",
      ext: "webp",
      size: 100,
    });
    expect(await checkProofFile(blob(PDF, 100))).toEqual({
      ok: true,
      mime: "application/pdf",
      ext: "pdf",
      size: 100,
    });
  });
  it("rechaza vacío, enorme y de tipo desconocido; justo 5 MiB entra", async () => {
    expect(await checkProofFile(new Blob([]))).toEqual({ ok: false, problem: "empty" });
    expect(await checkProofFile(blob(JPG, PROOF_MAX_BYTES + 1))).toEqual({
      ok: false,
      problem: "too_large",
    });
    expect(await checkProofFile(new Blob(["hola"]))).toEqual({
      ok: false,
      problem: "unknown_type",
    });
    expect((await checkProofFile(blob(JPG, PROOF_MAX_BYTES))).ok).toBe(true);
  });
  it("lo que declara el nombre o el tipo del aparato no cuenta: manda el contenido", async () => {
    const fake = new File([new TextEncoder().encode("<svg><script/></svg>")], "comprobante.jpg", {
      type: "image/jpeg",
    });
    expect(await checkProofFile(fake)).toEqual({ ok: false, problem: "unknown_type" });
  });
});

describe("proofPath", () => {
  it("tiene la forma que exige la política de Storage", () => {
    const path = proofPath(
      "a1000000-0000-4000-8000-000000000001",
      "c1000000-0000-4000-8000-000000000001",
      "f0000000-0000-4000-8000-000000000001",
      "png",
    );
    expect(path).toBe(
      "a1000000-0000-4000-8000-000000000001/c1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000001.png",
    );
  });
});

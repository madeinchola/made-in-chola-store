import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  SKIP_COMPRESS_BYTES,
  checkImageFile,
  extensionFor,
  fitWithin,
  prepareImage,
  productImagePath,
  shouldCompress,
} from "./imageProcessing";

// Misma expresión que public.storage_path_ok('product-images', …) en la base: si divergen, la subida fallaría en producción.
const DB_PATH_RULE =
  /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$/;

describe("fitWithin", () => {
  it("reduce el lado mayor a 2000 conservando la proporción", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });
  it("no agranda: lo que ya cabe queda igual", () => {
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 });
    expect(fitWithin(2000, 2000)).toEqual({ width: 2000, height: 2000 });
  });
  it("una imagen extremadamente alargada nunca llega a 0 píxeles", () => {
    expect(fitWithin(5000, 1)).toEqual({ width: 2000, height: 1 });
  });
  it("redondea dimensiones no enteras", () => {
    expect(fitWithin(1500.4, 900)).toEqual({ width: 1500, height: 900 });
  });
  it("acepta un máximo propio", () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });
  it("dimensiones inválidas lanzan RangeError", () => {
    expect(() => fitWithin(0, 100)).toThrow(RangeError);
    expect(() => fitWithin(100, -1)).toThrow(RangeError);
    expect(() => fitWithin(Number.NaN, 100)).toThrow(RangeError);
  });
});

describe("shouldCompress (límites exactos)", () => {
  it("2000 px y exactamente 1.5 MiB: no se recomprime", () => {
    expect(shouldCompress({ width: 2000, height: 1500, bytes: SKIP_COMPRESS_BYTES })).toBe(false);
  });
  it("1 byte más del umbral: sí", () => {
    expect(shouldCompress({ width: 2000, height: 1500, bytes: SKIP_COMPRESS_BYTES + 1 })).toBe(
      true,
    );
  });
  it("2001 px en el lado mayor: sí, aunque pese poco", () => {
    expect(shouldCompress({ width: 2001, height: 10, bytes: 1000 })).toBe(true);
    expect(shouldCompress({ width: 10, height: 2001, bytes: 1000 })).toBe(true);
  });
});

describe("checkImageFile / extensionFor", () => {
  it("acepta jpeg, png, webp y avif", () => {
    for (const type of ALLOWED_IMAGE_TYPES) expect(checkImageFile({ type, size: 10 })).toBeNull();
    expect(ALLOWED_IMAGE_TYPES.sort()).toEqual([
      "image/avif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
  it("rechaza gif, svg, pdf y tipos vacíos", () => {
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", ""]) {
      expect(checkImageFile({ type, size: 10 })).toBe("type");
    }
  });
  it("rechaza archivos vacíos", () => {
    expect(checkImageFile({ type: "image/png", size: 0 })).toBe("empty");
  });
  it("un archivo grande NO se rechaza aquí: aún se puede reducir", () => {
    expect(checkImageFile({ type: "image/jpeg", size: 20 * 1024 * 1024 })).toBeNull();
  });
  it("extensiones", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("image/avif")).toBe("avif");
    expect(extensionFor("image/gif")).toBeNull();
  });
});

describe("productImagePath", () => {
  const product = "b3000000-0000-4000-8000-000000000001";
  const file = "11111111-2222-4333-8444-555555555555";
  it.each(["jpg", "png", "webp", "avif"])("la ruta .%s cumple la regla de la base", (ext) => {
    expect(DB_PATH_RULE.test(productImagePath(product, file, ext))).toBe(true);
  });
  it("tiene la forma products/{producto}/{archivo}.{ext}", () => {
    expect(productImagePath(product, file, "webp")).toBe(`products/${product}/${file}.webp`);
  });
  it("una extensión no permitida NO cumple la regla (la base la rechazaría)", () => {
    expect(DB_PATH_RULE.test(productImagePath(product, file, "gif"))).toBe(false);
  });
});

describe("prepareImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const file = (type: string, size: number, name = "foto") =>
    new File([new Uint8Array(size)], name, { type });

  it("rechaza archivos vacíos y tipos no permitidos con un código claro", async () => {
    await expect(prepareImage(file("image/png", 0))).rejects.toThrow("empty");
    await expect(prepareImage(file("image/gif", 10))).rejects.toThrow("type");
  });

  it("sin canvas ni createImageBitmap (jsdom): sube el original si cabe en 5 MiB", async () => {
    const f = file("image/png", 1000);
    const out = await prepareImage(f);
    expect(out.blob).toBe(f);
    expect(out.contentType).toBe("image/png");
    expect(out.ext).toBe("png");
  });

  it("sin forma de reducirla, una imagen de más de 5 MiB falla con too_large", async () => {
    await expect(prepareImage(file("image/jpeg", MAX_IMAGE_BYTES + 1))).rejects.toThrow(
      "too_large",
    );
  });

  it("una foto de 4000×3000 se reduce a 2000×1500 y se recodifica en WebP al 85 %", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }),
    );
    const drawImage = vi.fn();
    const toBlob = vi.fn((cb: (b: Blob | null) => void) =>
      cb(new Blob(["x".repeat(500)], { type: "image/webp" })),
    );
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag),
    );

    const out = await prepareImage(file("image/jpeg", 3 * 1024 * 1024));

    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1500);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.85);
    expect(out.contentType).toBe("image/webp");
    expect(out.ext).toBe("webp");
    expect(out.blob.size).toBe(500);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("una imagen pequeña y liviana se sube sin tocar (no se crea ningún canvas)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() }),
    );
    const spy = vi.spyOn(document, "createElement");
    const f = file("image/png", 100 * 1024);
    const out = await prepareImage(f);
    expect(out.blob).toBe(f);
    expect(spy).not.toHaveBeenCalledWith("canvas");
  });

  it("si el navegador no soporta WebP (devuelve PNG) y el original cabe, sube el original", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }),
    );
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"], { type: "image/png" })),
    };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag),
    );
    const f = file("image/jpeg", 2 * 1024 * 1024);
    const out = await prepareImage(f);
    expect(out.blob).toBe(f);
    expect(out.contentType).toBe("image/jpeg");
  });

  it("si incluso reducida pesa más de 5 MiB, falla con too_large", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }),
    );
    const big = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/webp" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(big),
    };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag),
    );
    await expect(prepareImage(file("image/jpeg", 4 * 1024 * 1024))).rejects.toThrow("too_large");
  });

  it("libera el bitmap aunque falle la recodificación", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }),
    );
    const canvas = { width: 0, height: 0, getContext: () => null, toBlob: vi.fn() };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag),
    );
    await prepareImage(file("image/jpeg", 2 * 1024 * 1024));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

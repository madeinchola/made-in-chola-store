import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, productImagePath, PRODUCTS_WITH_IMAGES, solidPng } from "./dev-seed-images.mjs";

// Lee un PNG chunk a chunk verificando firma, CRC y estructura (sin depender de ninguna librería de imágenes).
function parsePng(buf) {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const chunks = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    const crc = buf.readUInt32BE(offset + 8 + length);
    expect(crc32(buf.subarray(offset + 4, offset + 8 + length)), `CRC de ${type}`).toBe(crc);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

describe("crc32", () => {
  it("coincide con el valor de referencia conocido de '123456789' (0xCBF43926)", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it("el CRC de una cadena vacía es 0", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe("solidPng", () => {
  const png = solidPng(6, 4, [226, 222, 222]);
  const chunks = parsePng(png);

  it("es un PNG válido: IHDR, IDAT, IEND, en ese orden, con CRC correctos", () => {
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("el IHDR declara las dimensiones, 8 bits y RGB", () => {
    const ihdr = chunks[0].data;
    expect(ihdr.readUInt32BE(0)).toBe(6);
    expect(ihdr.readUInt32BE(4)).toBe(4);
    expect([ihdr[8], ihdr[9]]).toEqual([8, 2]);
  });

  it("los píxeles descomprimidos son exactamente el color pedido, fila por fila", () => {
    const raw = inflateSync(chunks[1].data);
    expect(raw.length).toBe(4 * (1 + 6 * 3)); // alto × (filtro + ancho × 3)
    for (let y = 0; y < 4; y++) {
      const row = raw.subarray(y * 19, (y + 1) * 19);
      expect(row[0]).toBe(0); // sin filtro
      for (let x = 0; x < 6; x++)
        expect([...row.subarray(1 + x * 3, 4 + x * 3)]).toEqual([226, 222, 222]);
    }
  });

  it("colores distintos dan imágenes distintas", () => {
    expect(solidPng(6, 4, [0, 0, 0]).equals(png)).toBe(false);
  });

  it("la imagen de seed (600×750) pesa muy por debajo del límite de 5 MiB del bucket", () => {
    expect(solidPng(600, 750, [226, 222, 222]).length).toBeLessThan(20_000);
  });
});

describe("productImagePath", () => {
  // Misma expresión que public.storage_path_ok('product-images', …) y product_images_path_format
  const rx = (id) =>
    new RegExp(
      `^products/${id}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|jpeg|png|webp|avif)$`,
    );
  it("respeta la convención products/{id}/{uuid}.png que exige la BD", () => {
    const id = "b2000000-0000-0000-0000-000000000001";
    expect(productImagePath(id)).toMatch(rx(id));
  });
  it("cada llamada produce una ruta distinta", () => {
    const id = "b2000000-0000-0000-0000-000000000001";
    expect(productImagePath(id)).not.toBe(productImagePath(id));
  });
});

describe("PRODUCTS_WITH_IMAGES", () => {
  it("son códigos del seed, sin repetidos", () => {
    expect(new Set(PRODUCTS_WITH_IMAGES).size).toBe(PRODUCTS_WITH_IMAGES.length);
    for (const code of PRODUCTS_WITH_IMAGES) expect(code).toMatch(/^[A-Z]{3}-\d{3}$/);
  });
});

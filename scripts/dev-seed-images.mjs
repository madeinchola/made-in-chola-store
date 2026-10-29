// Imágenes de EJEMPLO para el catálogo de desarrollo (Supabase LOCAL). Son PNG lisos generados aquí mismo:
// se ven claramente provisionales y no dependen de ningún archivo real. Las oficiales las sube el admin desde el panel.
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG RGB de 8 bits, de un solo color. */
export function solidPng(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits por canal
  header[9] = 2; // color verdadero (RGB)
  const row = Buffer.alloc(1 + width * 3); // byte de filtro 0 + píxeles
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Ruta de Storage según la convención del bucket: products/{product_id}/{uuid}.png */
export const productImagePath = (productId) => `products/${productId}/${randomUUID()}.png`;

/** Productos del seed que reciben imágenes de ejemplo (el resto queda sin imagen para probar el placeholder). */
export const PRODUCTS_WITH_IMAGES = [
  "CHQ-001",
  "CHQ-002",
  "CMS-001",
  "VST-001",
  "SMB-001",
  "SMB-002",
  "SMB-004",
  "CRT-003",
];
const SHADES = [
  [226, 222, 222],
  [214, 209, 203],
];

/** Sube 2 imágenes de ejemplo por producto y registra sus filas. Idempotente (salta productos que ya tienen). */
export async function seedImages(url, serviceKey, log = () => {}) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const json = { ...headers, "Content-Type": "application/json", Prefer: "return=representation" };
  let created = 0;
  for (const code of PRODUCTS_WITH_IMAGES) {
    const found = await fetch(`${url}/rest/v1/products?code=eq.${code}&select=id`, { headers });
    const [product] = found.ok ? await found.json() : [];
    if (!product) continue;
    const existing = await fetch(
      `${url}/rest/v1/product_images?product_id=eq.${product.id}&select=id&limit=1`,
      { headers },
    );
    if (existing.ok && (await existing.json()).length > 0) continue;
    for (const [i, shade] of SHADES.entries()) {
      const path = productImagePath(product.id);
      const up = await fetch(`${url}/storage/v1/object/product-images/${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/png" },
        body: solidPng(600, 750, shade),
      });
      if (!up.ok)
        throw new Error(`no se pudo subir la imagen de ${code}: ${up.status} ${await up.text()}`);
      const row = await fetch(`${url}/rest/v1/product_images`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          product_id: product.id,
          path,
          alt: "Imagen de ejemplo (provisional)",
          sort_order: i + 1,
        }),
      });
      if (!row.ok)
        throw new Error(
          `no se pudo registrar la imagen de ${code}: ${row.status} ${await row.text()}`,
        );
      created++;
    }
    log(`  ${code}: 2 imágenes de ejemplo`);
  }
  return created;
}

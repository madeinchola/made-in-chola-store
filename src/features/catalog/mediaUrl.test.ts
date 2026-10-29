import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./testing/fakeSupabase";

const state = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.client }));

import { homeMediaUrl, productImageUrl, publicMediaUrl } from "./mediaUrl";

state.client = createFakeSupabase({ tables: {} }).client;
const base = "http://fake.local/storage/v1/object/public";

describe("mediaUrl", () => {
  it("arma la URL pública con el bucket y la ruta", () => {
    expect(publicMediaUrl("site-media", "home/a.jpg")).toBe(`${base}/site-media/home/a.jpg`);
  });

  it("las imágenes de producto van al bucket product-images", () => {
    expect(productImageUrl("products/p1/a.jpg")).toBe(`${base}/product-images/products/p1/a.jpg`);
  });

  it("imagen del home → site-media; video del home → site-videos", () => {
    expect(homeMediaUrl("image", "home/a.jpg")).toBe(`${base}/site-media/home/a.jpg`);
    expect(homeMediaUrl("video", "home/v.mp4")).toBe(`${base}/site-videos/home/v.mp4`);
  });

  it("sin medio o sin ruta → null (la UI muestra el placeholder)", () => {
    expect(homeMediaUrl("none", "home/a.jpg")).toBeNull();
    expect(homeMediaUrl("image", null)).toBeNull();
    expect(homeMediaUrl("video", "")).toBeNull();
  });
});

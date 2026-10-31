import { describe, expect, it } from "vitest";
import type { AdminColor, AdminImage } from "../types";
import { coverImage, isImageVisible } from "./coverImage";

const color = (id: string, archived = false): AdminColor => ({
  id,
  name: id,
  hex: null,
  sortOrder: 1,
  archived,
  updatedAt: "",
});
const image = (id: string, colorId: string | null = null): AdminImage => ({
  id,
  path: `p/${id}.webp`,
  alt: null,
  colorId,
  sortOrder: 1,
  updatedAt: "",
});

describe("isImageVisible", () => {
  it("una imagen general (sin color) siempre se ve", () => {
    expect(isImageVisible(image("a"), [color("rojo", true)])).toBe(true);
  });
  it("una imagen de un color ACTIVO se ve", () => {
    expect(isImageVisible(image("a", "rojo"), [color("rojo")])).toBe(true);
  });
  it("una imagen de un color ARCHIVADO NO se ve", () => {
    expect(isImageVisible(image("a", "rojo"), [color("rojo", true)])).toBe(false);
  });
  it("un color que no está en la lista se trata como visible (igual que la vista pública con su left join)", () => {
    expect(isImageVisible(image("a", "fantasma"), [color("rojo")])).toBe(true);
  });
});

describe("coverImage", () => {
  it("sin imágenes no hay portada", () => {
    expect(coverImage([], [])).toBeUndefined();
  });
  it("la portada es la primera imagen", () => {
    expect(coverImage([image("a"), image("b")], [])?.id).toBe("a");
  });
  it("si la primera es de un color archivado, la portada es la siguiente VISIBLE (como en la tienda)", () => {
    const images = [image("a", "rojo"), image("b"), image("c")];
    expect(coverImage(images, [color("rojo", true)])?.id).toBe("b");
  });
  it("si TODAS están ocultas no hay portada", () => {
    expect(coverImage([image("a", "rojo")], [color("rojo", true)])).toBeUndefined();
  });
  it("restaurar el color devuelve la portada a la primera", () => {
    const images = [image("a", "rojo"), image("b")];
    expect(coverImage(images, [color("rojo", true)])?.id).toBe("b");
    expect(coverImage(images, [color("rojo", false)])?.id).toBe("a");
  });
});

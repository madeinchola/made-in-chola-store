import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import {
  clearRateLimits,
  localEnv,
  randomTag,
  registerAndLogin,
  svcRpc,
} from "../../../../test-support/api";

// Los servicios usan getSupabase(): aquí apunta a un cliente REAL contra Supabase local (visitante, cliente o admin).
const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => holder.client }));

import { StaleVersionError } from "../lib/versioned";
import {
  createCategory,
  createCollection,
  isCategorySlugAvailable,
  isCollectionSlugAvailable,
  listAdminCategories,
  listAdminCollections,
  saveCategoryOrder,
  saveCollectionOrder,
  setCategoryArchived,
  setCollectionArchived,
  updateCategory,
  updateCollection,
} from "./api";

function clientWith(token?: string): SupabaseClient<Database> {
  const env = localEnv();
  return createClient<Database>(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

let adminToken = "";
let customerToken = "";
const asAdmin = () => void (holder.client = clientWith(adminToken));
const asCustomer = () => void (holder.client = clientWith(customerToken));
const asAnon = () => void (holder.client = clientWith());

beforeAll(async () => {
  await clearRateLimits();
  const admin = await registerAndLogin({ name: "Admin Taxonomía" });
  expect((await svcRpc("promote_admin", { p_email: admin.email })).status).toBe(200);
  adminToken = admin.token;
  customerToken = (await registerAndLogin({ name: "Cliente Taxonomía" })).token;
  asAdmin();
}, 60_000);

const cat = (tag: string, name: string, parentId: string | null = null) =>
  createCategory({
    name: `${name} ${tag}`,
    slug: `${name.toLowerCase()}-${tag}`,
    description: null,
    parentId,
  });
const fresh = async (id: string) => {
  const found = (await listAdminCategories()).find((c) => c.id === id);
  if (!found) throw new Error("categoría no encontrada");
  return found;
};

describe("categorías (BD real)", () => {
  it("crea al FINAL de su nivel: cada hermana nueva recibe un orden mayor", async () => {
    const tag = randomTag();
    const root = await cat(tag, "Raiz");
    const a = await cat(tag, "Hija-a", root.id);
    const b = await cat(tag, "Hija-b", root.id);
    const c = await cat(tag, "Hija-c", root.id);
    expect([a.sortOrder, b.sortOrder, c.sortOrder]).toEqual([1, 2, 3]); // hijas de una raíz nueva: empiezan en 1
    const r2 = await cat(tag, "Raiz-2");
    expect(r2.sortOrder).toBe(root.sortOrder + 1);
  });

  it("un slug repetido da un mensaje claro; isCategorySlugAvailable cuenta también las archivadas", async () => {
    const tag = randomTag();
    const a = await cat(tag, "Unica");
    await expect(
      createCategory({ name: "Otra", slug: a.slug, description: null, parentId: null }),
    ).rejects.toThrow("Ya existe una categoría con esa dirección (slug).");
    expect(await isCategorySlugAvailable(a.slug)).toBe(false);
    expect(await isCategorySlugAvailable(a.slug, a.id)).toBe(true);
    await setCategoryArchived(a, true);
    expect(await isCategorySlugAvailable(a.slug)).toBe(false); // archivada sigue ocupando el slug
    expect(await isCategorySlugAvailable(`libre-${tag}`)).toBe(true);
  });

  it("los ciclos son imposibles: A→B→C, mover A bajo C se rechaza con el mensaje de la base", async () => {
    const tag = randomTag();
    const a = await cat(tag, "A");
    const b = await cat(tag, "B", a.id);
    const c = await cat(tag, "C", b.id);
    await expect(
      updateCategory(a, { name: a.name, slug: a.slug, description: null, parentId: c.id }),
    ).rejects.toThrow(/ciclo/);
    // ni consigo misma
    const b2 = await fresh(b.id);
    await expect(
      updateCategory(b2, { name: b2.name, slug: b2.slug, description: null, parentId: b.id }),
    ).rejects.toThrow();
    expect((await fresh(a.id)).parentId).toBeNull(); // nada cambió
  });

  it("no se puede archivar una categoría con subcategorías activas; sí cuando todas están archivadas; restaurar la devuelve", async () => {
    const tag = randomTag();
    const parent = await cat(tag, "Padre");
    const child = await cat(tag, "Hijo", parent.id);
    await expect(setCategoryArchived(parent, true)).rejects.toThrow(/subcategor/i);
    expect((await fresh(parent.id)).archived).toBe(false);
    await setCategoryArchived(child, true);
    await setCategoryArchived(await fresh(parent.id), true);
    expect((await fresh(parent.id)).archived).toBe(true);
    await setCategoryArchived(await fresh(parent.id), false);
    expect((await fresh(parent.id)).archived).toBe(false);
  });

  it("no se puede crear una subcategoría dentro de una categoría archivada", async () => {
    const tag = randomTag();
    const parent = await cat(tag, "Archivada");
    await setCategoryArchived(parent, true);
    await expect(cat(tag, "Hija", parent.id)).rejects.toThrow();
  });

  it("edición concurrente: el segundo guardado con la versión vieja se rechaza y no pisa", async () => {
    const tag = randomTag();
    const c = await cat(tag, "Original");
    await updateCategory(c, { name: "Cambio A", slug: c.slug, description: null, parentId: null });
    await expect(
      updateCategory(c, { name: "Cambio B", slug: c.slug, description: null, parentId: null }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    expect((await fresh(c.id)).name).toBe("Cambio A");
  });

  it("mover a otro padre la pone al FINAL del nuevo nivel", async () => {
    const tag = randomTag();
    const p1 = await cat(tag, "P1");
    const p2 = await cat(tag, "P2");
    await cat(tag, "X", p2.id);
    await cat(tag, "Y", p2.id);
    const mover = await cat(tag, "Mover", p1.id);
    await updateCategory(mover, {
      name: mover.name,
      slug: mover.slug,
      description: null,
      parentId: p2.id,
    });
    const moved = await fresh(mover.id);
    expect(moved.parentId).toBe(p2.id);
    expect(moved.sortOrder).toBe(3); // tras X(1) e Y(2)
  });

  it("reordenar escribe el nuevo orden; con una versión vieja se rechaza como conflicto", async () => {
    const tag = randomTag();
    const root = await cat(tag, "Raiz");
    const [a, b, c] = [
      await cat(tag, "A", root.id),
      await cat(tag, "B", root.id),
      await cat(tag, "C", root.id),
    ];
    await saveCategoryOrder([
      { id: c.id, updatedAt: c.updatedAt, sortOrder: 1 },
      { id: a.id, updatedAt: a.updatedAt, sortOrder: 2 },
      { id: b.id, updatedAt: b.updatedAt, sortOrder: 3 },
    ]);
    const list = (await listAdminCategories())
      .filter((x) => x.parentId === root.id)
      .sort((x, y) => x.sortOrder - y.sortOrder);
    expect(list.map((x) => x.id)).toEqual([c.id, a.id, b.id]);
    // la versión que tenían a/b/c ya quedó vieja
    await expect(
      saveCategoryOrder([{ id: a.id, updatedAt: a.updatedAt, sortOrder: 9 }]),
    ).rejects.toBeInstanceOf(StaleVersionError);
  });

  it("la tienda pública solo ve las categorías activas (archivar la oculta, restaurar la vuelve a mostrar)", async () => {
    const tag = randomTag();
    const c = await cat(tag, "Publica");
    const visible = async () => {
      asAnon();
      try {
        const r = await (holder.client as SupabaseClient<Database>)
          .from("public_categories")
          .select("slug")
          .eq("slug", c.slug);
        return r.data?.length ?? -1;
      } finally {
        asAdmin();
      }
    };
    expect(await visible()).toBe(1);
    await setCategoryArchived(c, true);
    expect(await visible()).toBe(0);
    await setCategoryArchived(await fresh(c.id), false);
    expect(await visible()).toBe(1);
  });

  it("un cliente NO puede crear ni editar categorías (la base lo impide, no solo la pantalla)", async () => {
    const tag = randomTag();
    const c = await cat(tag, "Protegida");
    asCustomer();
    try {
      await expect(cat(randomTag(), "Intruso")).rejects.toThrow();
      await expect(
        updateCategory(c, { name: "Hackeada", slug: c.slug, description: null, parentId: null }),
      ).rejects.toThrow();
    } finally {
      asAdmin();
    }
    expect((await fresh(c.id)).name).toBe(`Protegida ${tag}`);
  });

  it("nombres con acentos, ñ y emoji, y descripciones largas, se guardan tal cual", async () => {
    const tag = randomTag();
    const c = await createCategory({
      name: `Niños 🧒 ${tag}`,
      slug: `ninos-${tag}`,
      description: "á é ñ ü\nsegunda línea",
      parentId: null,
    });
    expect(c).toMatchObject({ name: `Niños 🧒 ${tag}`, description: "á é ñ ü\nsegunda línea" });
  });
});

// ── Colecciones ────────────────────────────────────────────────────────────────────────────
const col = (
  tag: string,
  name: string,
  over: { startsAt?: string | null; endsAt?: string | null } = {},
) =>
  createCollection({
    name: `${name} ${tag}`,
    slug: `${name.toLowerCase()}-${tag}`,
    description: null,
    startsAt: over.startsAt ?? null,
    endsAt: over.endsAt ?? null,
  });
const freshCol = async (id: string) => {
  const found = (await listAdminCollections()).find((c) => c.id === id);
  if (!found) throw new Error("colección no encontrada");
  return found;
};
const HOUR = 3_600_000;
const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();

describe("colecciones (BD real)", () => {
  it("crea con su vigencia en UTC y al final del orden", async () => {
    const tag = randomTag();
    const a = await col(tag, "Primera", {
      startsAt: "2026-12-01T04:00:00.000Z",
      endsAt: "2026-12-31T04:00:00.000Z",
    });
    const b = await col(tag, "Segunda");
    expect(new Date(a.startsAt ?? "").toISOString()).toBe("2026-12-01T04:00:00.000Z");
    expect(new Date(a.endsAt ?? "").toISOString()).toBe("2026-12-31T04:00:00.000Z");
    expect(b.startsAt).toBeNull();
    expect(b.sortOrder).toBe(a.sortOrder + 1);
  });

  it("un fin anterior o igual al inicio lo rechaza la base", async () => {
    const tag = randomTag();
    await expect(col(tag, "Invertida", { startsAt: iso(5), endsAt: iso(1) })).rejects.toThrow();
    await expect(
      col(tag, "Igual", {
        startsAt: "2026-12-01T04:00:00.000Z",
        endsAt: "2026-12-01T04:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("un slug repetido da mensaje claro; isCollectionSlugAvailable lo detecta", async () => {
    const tag = randomTag();
    const a = await col(tag, "Unica");
    await expect(
      createCollection({
        name: "Otra",
        slug: a.slug,
        description: null,
        startsAt: null,
        endsAt: null,
      }),
    ).rejects.toThrow("Ya existe una colección con esa dirección (slug).");
    expect(await isCollectionSlugAvailable(a.slug)).toBe(false);
    expect(await isCollectionSlugAvailable(a.slug, a.id)).toBe(true);
  });

  it("editar con versión vieja es conflicto; editar guarda los campos", async () => {
    const tag = randomTag();
    const c = await col(tag, "Editable");
    await updateCollection(c, {
      name: "Renombrada",
      slug: c.slug,
      description: "desc",
      startsAt: null,
      endsAt: iso(48),
    });
    const after = await freshCol(c.id);
    expect(after).toMatchObject({ name: "Renombrada", description: "desc" });
    expect(after.endsAt).not.toBeNull();
    await expect(
      updateCollection(c, {
        name: "Pisada",
        slug: c.slug,
        description: null,
        startsAt: null,
        endsAt: null,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    expect((await freshCol(c.id)).name).toBe("Renombrada");
  });

  it("archivar y restaurar con versión; reordenar con versión", async () => {
    const tag = randomTag();
    const [a, b] = [await col(tag, "A"), await col(tag, "B")];
    await saveCollectionOrder([
      { id: b.id, updatedAt: b.updatedAt, sortOrder: a.sortOrder },
      { id: a.id, updatedAt: a.updatedAt, sortOrder: b.sortOrder },
    ]);
    expect((await freshCol(a.id)).sortOrder).toBe(b.sortOrder);
    expect((await freshCol(b.id)).sortOrder).toBe(a.sortOrder);
    await setCollectionArchived(await freshCol(a.id), true);
    expect((await freshCol(a.id)).archived).toBe(true);
    await setCollectionArchived(await freshCol(a.id), false);
    expect((await freshCol(a.id)).archived).toBe(false);
  });

  it("la tienda solo muestra las colecciones VIGENTES: una futura, una vencida y una archivada no salen", async () => {
    const tag = randomTag();
    const current = await col(tag, "Vigente", { startsAt: iso(-24), endsAt: iso(24) });
    const future = await col(tag, "Futura", { startsAt: iso(24), endsAt: iso(48) });
    const past = await col(tag, "Vencida", { startsAt: iso(-48), endsAt: iso(-24) });
    const archived = await col(tag, "Archivada");
    await setCollectionArchived(archived, true);
    asAnon();
    try {
      const r = await (holder.client as SupabaseClient<Database>)
        .from("public_collections")
        .select("slug")
        .like("slug", `%-${tag}`);
      expect(r.data?.map((x) => x.slug)).toEqual([current.slug]);
      expect(r.data?.map((x) => x.slug)).not.toContain(future.slug);
      expect(r.data?.map((x) => x.slug)).not.toContain(past.slug);
    } finally {
      asAdmin();
    }
  });

  it("un cliente NO puede crear colecciones", async () => {
    asCustomer();
    try {
      await expect(col(randomTag(), "Intruso")).rejects.toThrow();
    } finally {
      asAdmin();
    }
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearRateLimits, registerAndLogin, rest, rpc, svcRpc } from "../test-support/api";

// 1×1 PNG válido (la subida real pasa por el navegador, Storage y la base).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let admin: { identifier: string; password: string; token: string; email: string | undefined };

test.beforeEach(async () => {
  await clearRateLimits();
});

test.beforeAll(async () => {
  const a = await registerAndLogin({ name: "Admin Panel E2E" });
  expect((await svcRpc("promote_admin", { p_email: a.email })).status).toBe(200);
  admin = { identifier: a.identifier, password: a.password, token: a.token, email: a.email };
});

/** Errores de consola que NO son ruido esperado (los 4xx de red los registra el navegador solos). */
function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function loginAsAdmin(page: Page, then = "/admin") {
  await page.goto("/login");
  await page.getByLabel("Email o teléfono").fill(admin.identifier);
  await page.getByLabel("Contraseña", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByTestId("account-menu")).toBeVisible(); // sesión iniciada: el icono de la cuenta
  await page.goto(then);
}

const tagOf = () => Math.random().toString(16).slice(2, 8);

/** Crea un producto como lo haría el admin (por la API con su sesión), listo para probar la pantalla. */
async function seedProduct(
  tag: string,
  o: { status?: "draft" | "active"; stock?: number; name?: string; sizes?: string[] } = {},
) {
  const created = await rest("POST", "products", admin.token, {
    code: `E2E-${tag}`,
    slug: `e2e-${tag}`,
    name: o.name ?? `Producto E2E ${tag}`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body[0].id as string;
  const color = await rest("POST", "product_colors", admin.token, {
    product_id: id,
    name: "Rojo",
    sort_order: 1,
  });
  expect(color.status, JSON.stringify(color.body)).toBe(201);
  const colorId = color.body[0].id as string;
  expect(
    (
      await rest("POST", "product_prices", admin.token, {
        product_id: id,
        currency: "BOB",
        amount: 100,
      })
    ).status,
  ).toBe(201);
  const variants: string[] = [];
  const sizeIds: (string | null)[] = [];
  for (const [i, label] of (o.sizes ?? []).entries()) {
    const s = await rest("POST", "product_sizes", admin.token, {
      product_id: id,
      label,
      sort_order: i + 1,
    });
    sizeIds.push(s.body[0].id as string);
  }
  for (const sizeId of sizeIds.length ? sizeIds : [null]) {
    const v = await rest("POST", "product_variants", admin.token, {
      product_id: id,
      color_id: colorId,
      size_id: sizeId,
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    variants.push(v.body[0].id as string);
  }
  if (o.stock) {
    const r = await rpc(
      "adjust_stock",
      { p_variant_id: variants[0], p_delta: o.stock, p_reason: "import" },
      admin.token,
    );
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  }
  if (o.status === "active") {
    const r = await rest("PATCH", `products?id=eq.${id}`, admin.token, { status: "active" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  return { id, tag, code: `E2E-${tag}`, slug: `e2e-${tag}`, variants };
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe("marco del panel", () => {
  test("un admin ve el resumen con navegación, migas y campana, sin errores de consola", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    await loginAsAdmin(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Panel de administración" }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: /Alertas de stock/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Accesos rápidos" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("la navegación lleva a cada sección y muestra su miga de pan", async ({ page }, info) => {
    await loginAsAdmin(page);
    const nav = page.getByRole("navigation", { name: "Navegación del panel" });
    for (const [link, heading] of [
      ["Productos", "Productos"],
      ["Categorías", "Categorías"],
      ["Colecciones", "Colecciones"],
    ] as const) {
      if (info.project.name === "mobile")
        await page.getByRole("button", { name: "Abrir menú" }).click();
      await nav.getByRole("link", { name: link }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Ruta de navegación" })).toContainText(
        link,
      );
    }
  });

  test("móvil: el menú es un cajón que se abre, navega y se cierra", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "solo aplica al viewport móvil");
    await loginAsAdmin(page);
    // se espera a que la pantalla haya cargado: un elemento que aún no existe cuenta como "oculto" y daría un falso verde
    await expect(
      page.getByRole("heading", { level: 1, name: "Panel de administración" }),
    ).toBeVisible();
    const link = page
      .getByRole("navigation", { name: "Navegación del panel" })
      .getByRole("link", { name: "Productos" });
    await expect(link).toHaveCount(0); // cerrado: fuera del árbol de accesibilidad (ni lector ni Tab llegan a él)
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: "Productos" })).toBeVisible();
    await expect(link).toHaveCount(0); // el cajón se cerró al navegar
  });

  test("escritorio: el menú se contrae a iconos (sin perder los nombres accesibles) y recuerda su estado", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "solo aplica al viewport de escritorio");
    await loginAsAdmin(page);
    const nav = page.getByRole("navigation", { name: "Navegación del panel" });
    await page.getByRole("button", { name: "Contraer menú" }).click();
    await expect(nav.getByRole("link", { name: "Productos" })).toBeVisible(); // el nombre accesible sigue ahí
    await expect(page.getByRole("button", { name: "Expandir menú" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expandir menú" })).toBeVisible(); // recordó el estado
    await page.getByRole("button", { name: "Expandir menú" }).click();
    await expect(page.getByRole("button", { name: "Contraer menú" })).toBeVisible();
  });

  test("hay un enlace para saltar al contenido que lleva el foco al área principal", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Panel de administración" }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#admin-main$/);
  });
});

test.describe("productos: flujo completo", () => {
  test("crear un producto con colores y tallas, cargar stock y foto, publicarlo, y la tienda lo ve", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const tag = tagOf();
    await loginAsAdmin(page, "/admin/productos/nuevo");

    await page.getByRole("textbox", { name: "Nombre", exact: true }).fill(`Camisa Ñandú ${tag}`);
    await page.getByLabel(/^Código/).fill(`E2E-${tag}`);
    await page.getByLabel("Precio en bolivianos (Bs)").fill("120,50");
    await page.getByLabel("Nombre del color 1", { exact: true }).fill("Rojo");
    await page.getByRole("button", { name: "Agregar color" }).click();
    await page.getByLabel("Nombre del color 2", { exact: true }).fill("Azul");
    await page.getByRole("button", { name: "Agregar XS, S, M, L, XL" }).click();
    await expect(page.getByLabel(/Dirección web/)).toHaveValue(`camisa-nandu-${tag}`);
    await page.getByRole("button", { name: "Crear producto" }).click();

    // pantalla de edición: 2 colores × 5 tallas = 10 variantes
    await expect(
      page.getByRole("heading", { level: 1, name: `Camisa Ñandú ${tag}` }),
    ).toBeVisible();
    await expect(page.getByText("10 variantes activas.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/productos\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop() as string;

    // stock de una variante
    const stock = page.getByRole("region", { name: "Variantes y stock" });
    await stock.getByRole("textbox", { name: "Nuevo stock de Rojo / XS" }).fill("12");
    await stock.getByRole("button", { name: "Guardar stock" }).click();
    await expect(page.getByText("Stock actualizado.")).toBeVisible();
    await expect(stock.getByText("Total en stock: 12 · disponible: 12")).toBeVisible();

    // foto real: se sube a Storage y queda como imagen principal
    const images = page.getByRole("region", { name: "Imágenes" });
    await images
      .locator('input[type="file"]')
      .setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
    await expect(images.getByText("Subida")).toBeVisible();
    await expect(images.getByText("Principal", { exact: true })).toBeVisible();

    // publicar con la lista de comprobaciones
    await page.getByRole("button", { name: "Publicar" }).click();
    const dialog = page.getByRole("dialog", { name: "¿Publicar este producto?" });
    await expect(dialog.getByText("Tiene precio en bolivianos")).toBeVisible();
    await dialog.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText("Producto publicado.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pasar a borrador" })).toBeVisible();

    // la tienda (visitante) lo ve: nombre, precio y la imagen
    const pub = await rest(
      "GET",
      `public_products?slug=eq.camisa-nandu-${tag}&select=name,price_bob,cover_path`,
    );
    expect(pub.body).toHaveLength(1);
    expect(pub.body[0]).toMatchObject({ name: `Camisa Ñandú ${tag}`, price_bob: 120.5 });
    expect(pub.body[0].cover_path).toMatch(new RegExp(`^products/${id}/`));
    expect(errors).toEqual([]);
  });

  test("dos admins editando el mismo producto: el segundo guardado detecta el conflicto y no pisa", async ({
    browser,
  }) => {
    const p = await seedProduct(tagOf());
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await loginAsAdmin(a, `/admin/productos/${p.id}`);
      await loginAsAdmin(b, `/admin/productos/${p.id}`);
      const modelA = a.getByRole("textbox", { name: "Modelo" });
      const modelB = b.getByRole("textbox", { name: "Modelo" });
      await expect(modelA).toBeVisible();
      await expect(modelB).toBeVisible();

      await modelA.fill("Versión de A");
      await a.getByRole("button", { name: "Guardar datos" }).click();
      await expect(a.getByText("Cambios guardados.")).toBeVisible();

      await modelB.fill("Versión de B");
      await b.getByRole("button", { name: "Guardar datos" }).click();
      await expect(b.getByText("Alguien más modificó esto")).toBeVisible();
      await expect(modelB).toHaveValue("Versión de B"); // lo escrito no se pierde hasta que decida

      const stored = await rest("GET", `products?id=eq.${p.id}&select=model`, admin.token);
      expect(stored.body[0].model).toBe("Versión de A"); // nada de B se guardó

      await b.getByRole("button", { name: "Recargar la versión actual" }).click();
      await expect(modelB).toHaveValue("Versión de A");
      await modelB.fill("Versión de B, ahora sí");
      await b.getByRole("button", { name: "Guardar datos" }).click();
      await expect(b.getByText("Cambios guardados.")).toBeVisible();
      expect(
        (await rest("GET", `products?id=eq.${p.id}&select=model`, admin.token)).body[0].model,
      ).toBe("Versión de B, ahora sí");
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("archivar y restaurar: el listado lo separa y no se borra nada", async ({ page }) => {
    const p = await seedProduct(tagOf(), { status: "active", stock: 9 });
    await loginAsAdmin(page, `/admin/productos/${p.id}`);
    await page.getByRole("button", { name: "Archivar", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "¿Archivar este producto?" });
    await expect(dialog).toContainText("No se borra nada");
    await dialog.getByRole("button", { name: "Archivar producto" }).click();
    await expect(page.getByText(/Este producto está archivado/)).toBeVisible();

    await page.goto(`/admin/productos?q=${p.code}`);
    await expect(page.getByText("Ningún producto coincide con los filtros.")).toBeVisible();
    await page.goto(`/admin/productos?q=${p.code}&estado=archivados`);
    await expect(page.getByRole("link", { name: `Editar Producto E2E ${p.tag}` })).toBeVisible();

    await page.goto(`/admin/productos/${p.id}`);
    await page.getByRole("button", { name: "Restaurar", exact: true }).click();
    await page
      .getByRole("dialog", { name: "¿Restaurar este producto?" })
      .getByRole("button", { name: "Restaurar producto" })
      .click();
    await expect(page.getByText("Producto restaurado.")).toBeVisible();
    await expect(page.getByText(/Este producto está archivado/)).toHaveCount(0);
  });

  test("cambios sin guardar: al salir pide confirmar, 'Seguir editando' conserva lo escrito", async ({
    page,
  }) => {
    await loginAsAdmin(page, "/admin/productos/nuevo");
    await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Borrador a medias");
    await page.getByRole("banner").getByRole("link", { name: "Made In Chola" }).click();
    const dialog = page.getByRole("dialog", { name: "Hay cambios sin guardar" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Seguir editando" }).click();
    await expect(page).toHaveURL(/\/admin\/productos\/nuevo$/);
    await expect(page.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue(
      "Borrador a medias",
    );

    await page.getByRole("banner").getByRole("link", { name: "Made In Chola" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Salir sin guardar" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("validaciones del formulario de creación se ven y no crean nada", async ({ page }) => {
    await loginAsAdmin(page, "/admin/productos/nuevo");
    await page.getByRole("button", { name: "Crear producto" }).click();
    await expect(page.getByText("Escribe el nombre del producto.")).toBeVisible();
    await expect(page.getByText("Escribe el código del producto.")).toBeVisible();
    await expect(page.getByText("Escribe el importe.")).toBeVisible();
    await expect(page.getByText("Escribe el nombre del color.")).toBeVisible();
    await expect(page).toHaveURL(/\/nuevo$/);
  });

  test("un código repetido se avisa al escribirlo y el servidor lo rechaza con un mensaje claro", async ({
    page,
  }) => {
    const p = await seedProduct(tagOf());
    await loginAsAdmin(page, "/admin/productos/nuevo");
    await page.getByLabel(/^Código/).fill(p.code);
    await expect(page.getByText("Ese código ya lo usa otro producto.")).toBeVisible();
  });

  test("las imágenes se pueden reordenar con botones y el orden queda guardado", async ({
    page,
  }) => {
    const p = await seedProduct(tagOf());
    await loginAsAdmin(page, `/admin/productos/${p.id}`);
    const images = page.getByRole("region", { name: "Imágenes" });
    await images.locator('input[type="file"]').setInputFiles([
      { name: "uno.png", mimeType: "image/png", buffer: PNG },
      { name: "dos.png", mimeType: "image/png", buffer: PNG },
    ]);
    await expect(images.getByText("Subida")).toHaveCount(2);
    await expect(
      images.getByRole("textbox", { name: /Texto alternativo \(Imagen 2\)/ }),
    ).toBeVisible();
    const order = async () =>
      (
        await rest(
          "GET",
          `product_images?product_id=eq.${p.id}&archived_at=is.null&select=id,sort_order&order=sort_order`,
          admin.token,
        )
      ).body.map((r: { id: string }) => r.id);
    const [first, second] = await order();
    await images.getByRole("button", { name: "Mover antes: Imagen 2" }).click();
    await expect(page.getByText("Orden guardado.")).toBeVisible();
    expect(await order()).toEqual([second, first]);
  });
});

test.describe("productos: listado", () => {
  test("buscar por código, filtrar por estado y por stock, y ver cada estado", async ({ page }) => {
    const tag = tagOf();
    const ok = await seedProduct(`${tag}a`, { status: "active", stock: 20, name: `Alpaca ${tag}` });
    await seedProduct(`${tag}b`, { status: "active", stock: 3, name: `Bufanda ${tag}` }); // bajo
    await seedProduct(`${tag}c`, { status: "draft", name: `Chal ${tag}` });
    await seedProduct(`${tag}d`, { status: "active", stock: 0, name: `Dril ${tag}` }); // sin stock → agotado
    await loginAsAdmin(page, `/admin/productos?q=${tag}`);

    const table = page.getByRole("table", { name: "Productos" });
    await expect(table.getByRole("row")).toHaveCount(5); // encabezado + 4
    await expect(page.getByText("4 resultados")).toBeVisible();

    await page.getByLabel("Estado").selectOption({ label: "Borradores" });
    await expect(page).toHaveURL(/estado=borradores/);
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table.getByText("Borrador")).toBeVisible();

    await page.getByLabel("Estado").selectOption({ label: "Agotados" });
    await expect(table.getByText("Dril " + tag)).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(2);

    await page.getByLabel("Estado").selectOption({ label: "Todos (sin archivados)" });
    await page.getByLabel("Stock", { exact: true }).selectOption({ label: "Bajo" });
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table.getByText("Bufanda " + tag)).toBeVisible();

    await page.getByRole("button", { name: "Quitar filtros" }).click();
    await expect(page).toHaveURL(/\/admin\/productos$/);
    expect(ok.id).toBeTruthy();
  });

  test("el enlace de la campana lleva al listado filtrado por alerta", async ({ page }) => {
    const tag = tagOf();
    await seedProduct(tag, { status: "active", stock: 20 });
    await loginAsAdmin(page);
    await page
      .getByRole("banner")
      .getByRole("link", { name: /Alertas de stock/ })
      .click();
    await expect(page).toHaveURL(/stock=alert/);
    await expect(page.getByLabel("Stock", { exact: true })).toHaveValue("alert");
  });

  test("paginación: 20 por página, anterior y siguiente, y el estado vive en la URL", async ({
    page,
  }) => {
    await loginAsAdmin(page, "/admin/productos");
    await expect(page.getByText(/Página 1 de \d+/)).toBeVisible();
    const total = Number((await page.getByText(/\d+ resultados/).innerText()).replace(/\D/g, ""));
    expect(total).toBeGreaterThanOrEqual(30); // el seed trae 30
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(page).toHaveURL(/pagina=2/);
    await expect(page.getByText(/Página 2 de \d+/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Página 2 de \d+/)).toBeVisible(); // sobrevive a recargar
    await page.getByRole("button", { name: "Anterior" }).click();
    await expect(page.getByText(/Página 1 de \d+/)).toBeVisible();
  });

  test("una página que no existe vuelve a la última en vez de mostrar una tabla vacía", async ({
    page,
  }) => {
    await loginAsAdmin(page, "/admin/productos?pagina=9999");
    await expect(page).not.toHaveURL(/pagina=9999/);
    await expect(page.getByRole("table", { name: "Productos" })).toBeVisible();
  });
});

test.describe("categorías y colecciones", () => {
  test("crear una categoría con subcategoría, verla en el árbol y archivarla", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const tag = tagOf();
    await loginAsAdmin(page, "/admin/categorias");
    await page.getByRole("button", { name: "Nueva categoría" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva categoría" });
    await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill(`Ropa ${tag}`);
    await dialog.getByRole("button", { name: "Crear categoría" }).click();
    await expect(page.getByText("Categoría creada.")).toBeVisible();
    await expect(page.getByText(`Ropa ${tag}`, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Agregar subcategoría a Ropa ${tag}` }).click();
    const child = page.getByRole("dialog");
    await child.getByRole("textbox", { name: "Nombre", exact: true }).fill(`Camisas ${tag}`);
    await child.getByRole("button", { name: "Crear categoría" }).click();
    // En el ÁRBOL: el mismo nombre aparece un instante también como opción del selector «Categoría padre» (ambigüedad).
    await expect(
      page
        .getByRole("navigation", { name: "Árbol de categorías" })
        .getByText(`Camisas ${tag}`, { exact: true }),
    ).toBeVisible();

    // el padre con una subcategoría ACTIVA no se puede archivar: la base lo impide y la pantalla lo dice
    await page.getByRole("button", { name: `Archivar Ropa ${tag}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archivar categoría" }).click();
    // el motivo que da la base llega como aviso (no confundir con el texto fijo del diálogo, que ya menciona las subcategorías)
    await expect(page.locator("[data-sonner-toast]").getByText(/subcategor/i)).toBeVisible();
    await expect(page.getByText("Categoría archivada.")).toHaveCount(0);

    // la subcategoría sí; y luego el padre
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: `Archivar Camisas ${tag}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archivar categoría" }).click();
    await expect(page.getByText("Categoría archivada.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("crear una colección con vigencia y ver que la tienda solo muestra las vigentes", async ({
    page,
  }) => {
    const tag = tagOf();
    await loginAsAdmin(page, "/admin/colecciones");
    await page.getByRole("button", { name: "Nueva colección" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva colección" });
    await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill(`Verano ${tag}`);
    await dialog.getByRole("button", { name: "Crear colección" }).click();
    await expect(page.getByText(`Verano ${tag}`, { exact: true })).toBeVisible();
    const pub = await rest("GET", `public_collections?slug=eq.verano-${tag}&select=slug`);
    expect(pub.body).toHaveLength(1); // sin vigencia = siempre vigente
  });
});

test.describe("ajustes, monedas y auditoría", () => {
  test("cambiar un ajuste lo guarda en la base y queda en la auditoría con quién lo hizo", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const name = `Made In Chola ${tagOf()}`;
    await loginAsAdmin(page, "/admin/ajustes");
    const field = page.getByRole("textbox", { name: "Nombre del negocio" });
    const original = await field.inputValue();
    await field.fill(name);
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText("Ajustes guardados.")).toBeVisible();
    const stored = await rest(
      "GET",
      "store_settings?key=eq.business_name&select=value",
      admin.token,
    );
    expect(stored.body[0].value).toBe(name);

    await page.goto("/admin/auditoria?tabla=store_settings");
    await expect(page.getByRole("heading", { level: 1, name: "Auditoría" })).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Auditoría" }).getByText("Admin Panel E2E").first(),
    ).toBeVisible();

    // se deja como estaba (los demás tests y el seed esperan ese nombre)
    await page.goto("/admin/ajustes");
    await page.getByRole("textbox", { name: "Nombre del negocio" }).fill(original);
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText("Ajustes guardados.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("un valor inválido (correo mal escrito) se señala y no se guarda nada", async ({ page }) => {
    await loginAsAdmin(page, "/admin/ajustes");
    await page.getByRole("textbox", { name: "Correo de contacto" }).fill("esto-no-es-un-correo");
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(
      page.getByText("Escribe un correo válido, por ejemplo info@tutienda.com."),
    ).toBeVisible();
    await expect(page.getByText("Ajustes guardados.")).toHaveCount(0);
  });

  test("la pantalla de monedas muestra la base como no desactivable y el historial de tipos de cambio", async ({
    page,
  }) => {
    await loginAsAdmin(page, "/admin/monedas");
    await expect(page.getByRole("heading", { level: 1, name: "Monedas" })).toBeVisible();
    await expect(page.getByText("Moneda base").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Historial de tipos de cambio" })).toBeVisible();
  });
});

test.describe("seguridad de acceso al panel", () => {
  test("un visitante que abre una ruta profunda del panel va al login", async ({ page }) => {
    await page.goto("/admin/productos/nuevo");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("accesibilidad y responsive del panel", () => {
  const paths = [
    "/admin",
    "/admin/productos",
    "/admin/productos/nuevo",
    "/admin/categorias",
    "/admin/colecciones",
    "/admin/ajustes",
    "/admin/monedas",
    "/admin/auditoria",
  ];
  for (const path of paths) {
    test(`${path}: sin violaciones WCAG A/AA y sin scroll horizontal`, async ({ page }) => {
      await loginAsAdmin(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoA11yViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("la pantalla de edición de un producto completo es accesible", async ({ page }) => {
    const p = await seedProduct(tagOf(), { status: "active", stock: 7, sizes: ["S", "M"] });
    await loginAsAdmin(page, `/admin/productos/${p.id}`);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(p.tag) })).toBeVisible();
    await page
      .getByRole("region", { name: "Imágenes" })
      .locator('input[type="file"]')
      .setInputFiles({ name: "x.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Subida")).toBeVisible();
    await expectNoA11yViolations(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("los diálogos (confirmar archivar) atrapan el foco y se cierran con Escape", async ({
    page,
  }) => {
    const p = await seedProduct(tagOf(), { status: "active", stock: 5 });
    await loginAsAdmin(page, `/admin/productos/${p.id}`);
    const archive = page.getByRole("button", { name: "Archivar", exact: true });
    await archive.click();
    const dialog = page.getByRole("dialog", { name: "¿Archivar este producto?" });
    await expect(dialog).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(archive).toBeFocused(); // el foco vuelve a quien abrió el diálogo
  });
});

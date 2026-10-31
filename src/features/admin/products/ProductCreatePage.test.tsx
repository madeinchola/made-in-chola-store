import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { PartialCreateError } from "./api";
import { ProductCreatePage } from "./ProductCreatePage";

const api = vi.hoisted(() => ({
  createProduct: vi.fn(),
  isSlugAvailable: vi.fn(),
  isCodeAvailable: vi.fn(),
  getDefaultOutOfStockBehavior: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  ...api,
}));
// La guarda usa useBlocker (router de datos); su propio comportamiento se prueba aparte.
vi.mock("../ui/UnsavedChangesGuard", () => ({ UnsavedChangesGuard: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/productos/nuevo"]}>
        <Routes>
          <Route path="/admin/productos/nuevo" element={<ProductCreatePage />} />
          <Route path="/admin/productos/:id" element={<p>editando el producto</p>} />
          <Route path="/admin/productos" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const field = (name: RegExp | string) => screen.getByRole("textbox", { name });

async function fillMinimum(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field("Nombre"), "Camisa Chola");
  await user.type(field(/^Código/), "CMS-010");
  await user.type(screen.getByLabelText("Precio en bolivianos (Bs)"), "120,5");
  await user.type(screen.getByLabelText("Nombre del color 1"), "Rojo");
}

beforeEach(() => {
  vi.clearAllMocks();
  api.isSlugAvailable.mockResolvedValue(true);
  api.isCodeAvailable.mockResolvedValue(true);
  api.createProduct.mockResolvedValue({ id: "nuevo-id" });
  api.getDefaultOutOfStockBehavior.mockResolvedValue("sold_out");
});

describe("ProductCreatePage", () => {
  it("el slug se genera solo a partir del nombre, sin acentos ni signos", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(field("Nombre"), "Camisa Ñandú (Edición 2027)");
    expect(field(/Dirección web/)).toHaveValue("camisa-nandu-edicion-2027");
  });

  it("al escribir el slug a mano deja de generarse; 'Generar del nombre' lo retoma", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(field("Nombre"), "Camisa");
    await user.clear(field(/Dirección web/));
    await user.type(field(/Dirección web/), "mi-slug");
    await user.type(field("Nombre"), " Roja");
    expect(field(/Dirección web/)).toHaveValue("mi-slug");
    await user.click(screen.getByRole("button", { name: "Generar del nombre" }));
    expect(field(/Dirección web/)).toHaveValue("camisa-roja");
  });

  it("enviar vacío muestra los errores de cada campo obligatorio y NO llama al servidor", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    expect(await screen.findByText("Escribe el nombre del producto.")).toBeInTheDocument();
    expect(screen.getByText("Escribe el código del producto.")).toBeInTheDocument();
    expect(screen.getByText("Escribe el importe.")).toBeInTheDocument();
    expect(screen.getByText("Escribe el nombre del color.")).toBeInTheDocument();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("precio con 3 decimales se rechaza (no se redondea)", async () => {
    const user = userEvent.setup();
    renderPage();
    await fillMinimum(user);
    const price = screen.getByLabelText("Precio en bolivianos (Bs)");
    await user.clear(price);
    await user.type(price, "10.999");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    expect(await screen.findByText("Máximo 2 decimales.")).toBeInTheDocument();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("dos colores con el mismo nombre (sin distinguir mayúsculas) se señalan", async () => {
    const user = userEvent.setup();
    renderPage();
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Agregar color" }));
    await user.type(screen.getByLabelText("Nombre del color 2"), "ROJO");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    expect(await screen.findByText("Ya existe un color con ese nombre.")).toBeInTheDocument();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("un tono inválido se señala", async () => {
    const user = userEvent.setup();
    renderPage();
    await fillMinimum(user);
    await user.type(screen.getByRole("textbox", { name: "Tono (opcional) 1" }), "rojo");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    expect(await screen.findByText("El tono debe ser un color como #A1B2C3.")).toBeInTheDocument();
  });

  it("'Agregar XS, S, M, L, XL' crea las 5 tallas, y repetirlo no duplica", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Agregar XS, S, M, L, XL" }));
    expect(
      screen
        .getAllByRole("textbox", { name: /^Talla \d$/ })
        .map((i) => (i as HTMLInputElement).value),
    ).toEqual(["XS", "S", "M", "L", "XL"]);
    await user.click(screen.getByRole("button", { name: "Agregar XS, S, M, L, XL" }));
    expect(screen.getAllByRole("textbox", { name: /^Talla \d$/ })).toHaveLength(5);
  });

  it("quitar un color lo elimina de la lista", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Agregar color" }));
    expect(screen.getAllByRole("textbox", { name: /^Nombre del color/ })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Quitar Nombre del color 2" }));
    expect(screen.getAllByRole("textbox", { name: /^Nombre del color/ })).toHaveLength(1);
  });

  it("un envío válido manda EXACTAMENTE los datos escritos (precio normalizado) y abre la edición", async () => {
    const user = userEvent.setup();
    renderPage();
    await fillMinimum(user);
    await user.type(screen.getByRole("textbox", { name: "Tono (opcional) 1" }), "#ff0000");
    await user.click(screen.getByRole("button", { name: "Agregar XS, S, M, L, XL" }));
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1));
    const input = api.createProduct.mock.calls[0]?.[0];
    expect(input.priceBob).toBe("120.5");
    expect(input.colors).toEqual([{ name: "Rojo", hex: "#ff0000" }]);
    expect(input.sizes).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(input.data).toMatchObject({
      name: "Camisa Chola",
      code: "CMS-010",
      slug: "camisa-chola",
      model: null,
      materials: null,
      washcare: null,
      cost_base: null,
      out_of_stock_behavior: "sold_out",
      is_new: false,
    });
    expect(await screen.findByText("editando el producto")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Producto creado como borrador.");
  });

  it("doble clic en 'Crear producto' crea UN solo producto", async () => {
    const user = userEvent.setup();
    let resolve!: (v: { id: string }) => void;
    api.createProduct.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    await fillMinimum(user);
    const submit = screen.getByRole("button", { name: "Crear producto" });
    await user.dblClick(submit);
    resolve({ id: "x" });
    await screen.findByText("editando el producto");
    expect(api.createProduct).toHaveBeenCalledTimes(1);
  });

  it("si el código ya existe (error de la base) lo muestra y se queda en la pantalla con los datos escritos", async () => {
    const user = userEvent.setup();
    api.createProduct.mockRejectedValue(
      new AppError("conflict", "Ya existe un producto con ese código."),
    );
    renderPage();
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un producto con ese código.",
    );
    expect(field("Nombre")).toHaveValue("Camisa Chola");
    expect(screen.queryByText("editando el producto")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear producto" })).toBeEnabled();
  });

  it("si falla DESPUÉS de crear el producto, lleva a su edición con el aviso para terminarlo", async () => {
    const user = userEvent.setup();
    api.createProduct.mockRejectedValue(
      new PartialCreateError("parcial-id", new AppError("conflict", "color repetido")),
    );
    renderPage();
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    expect(await screen.findByText("editando el producto")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("color repetido"));
  });

  it("el producto nuevo nace con el comportamiento sin stock fijado en Ajustes (aquí: ocultar) y así se envía", async () => {
    api.getDefaultOutOfStockBehavior.mockResolvedValue("hide");
    const user = userEvent.setup();
    renderPage();
    const select = screen.getByLabelText("Cuando no haya stock");
    await waitFor(() => expect(select).toHaveValue("hide"));
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1));
    expect(api.createProduct.mock.calls[0]?.[0].data.out_of_stock_behavior).toBe("hide");
  });

  it("sin ajuste elegido el valor es 'agotado'", async () => {
    const user = userEvent.setup();
    renderPage();
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1));
    expect(api.createProduct.mock.calls[0]?.[0].data.out_of_stock_behavior).toBe("sold_out");
  });

  it("si el admin ya eligió otro valor, el ajuste que llega después NO lo pisa", async () => {
    let resolve!: (v: "sold_out" | "hide") => void;
    api.getDefaultOutOfStockBehavior.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderPage();
    const select = screen.getByLabelText("Cuando no haya stock");
    await user.selectOptions(select, "Ocultar de la tienda"); // elige antes de que llegue el ajuste
    resolve("sold_out"); // el ajuste llega y dice "agotado"
    await waitFor(() => expect(api.getDefaultOutOfStockBehavior).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(select).toHaveValue("hide");
  });

  it("si no se puede leer el ajuste, la pantalla sigue funcionando con 'agotado'", async () => {
    api.getDefaultOutOfStockBehavior.mockRejectedValue(new AppError("network", "x"));
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByLabelText("Cuando no haya stock")).toHaveValue("sold_out");
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1));
  });

  it("Cancelar vuelve al listado", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByText("listado")).toBeInTheDocument();
  });

  it("muestra que el código y el slug están libres o tomados mientras se escribe", async () => {
    const user = userEvent.setup();
    api.isCodeAvailable.mockResolvedValue(false);
    renderPage();
    await user.type(field(/^Código/), "OCUPADO-1");
    expect(
      await screen.findByText("Ese código ya lo usa otro producto.", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    await user.type(field("Nombre"), "Camisa libre");
    expect(
      await within(document.body).findByText("Disponible", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});

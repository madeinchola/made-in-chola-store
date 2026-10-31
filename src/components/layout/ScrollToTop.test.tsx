import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollToTop } from "./ScrollToTop";

function Page({ name }: { name: string }) {
  const navigate = useNavigate();
  return (
    <div>
      <h1>{name}</h1>
      <Link to="/otra">ir a otra</Link>
      <Link to="/inicio?color=azul" replace>
        cambiar color
      </Link>
      <Link to="/otra#seccion">con ancla</Link>
      <button type="button" onClick={() => navigate(-1)}>
        atrás
      </button>
    </div>
  );
}

function App({ start = "/inicio" }: { start?: string }) {
  return (
    <MemoryRouter initialEntries={["/ruta-previa", start]} initialIndex={1}>
      <ScrollToTop />
      <Routes>
        <Route path="/inicio" element={<Page name="inicio" />} />
        <Route path="/otra" element={<Page name="otra" />} />
        <Route path="/ruta-previa" element={<Page name="previa" />} />
      </Routes>
    </MemoryRouter>
  );
}

let scrollTo: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => scrollTo.mockRestore());

describe("ScrollToTop", () => {
  it("la carga inicial (o recargar) NO mueve el scroll: el navegador conserva su posición", () => {
    render(<App />);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("ir a otra página con un enlace vuelve arriba, una sola vez", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<App />);
    await user.click(getByRole("link", { name: "ir a otra" }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });

  it("cambiar solo la búsqueda de la URL (color de la ficha, filtros) no mueve el scroll", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<App />);
    await user.click(getByRole("link", { name: "cambiar color" }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("volver con «atrás» no lo mueve (el navegador restaura la posición)", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<App />);
    await user.click(getByRole("button", { name: "atrás" }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("si la URL lleva un #ancla tampoco sube", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<App />);
    await user.click(getByRole("link", { name: "con ancla" }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("un enlace a la página en la que ya estás no vuelve a subir", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<App />);
    await user.click(getByRole("link", { name: "ir a otra" }));
    await user.click(getByRole("link", { name: "ir a otra" })); // misma ruta: no hay cambio de página
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

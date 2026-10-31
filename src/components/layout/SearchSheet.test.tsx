import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithApp } from "./layout-test-utils";
import { SearchSheet } from "./SearchSheet";

async function open(searchPath?: string | null) {
  const user = userEvent.setup();
  renderWithApp(
    searchPath === undefined ? <SearchSheet /> : <SearchSheet searchPath={searchPath} />,
  );
  await user.click(screen.getByRole("button", { name: "Buscar" }));
  await screen.findByRole("dialog", { name: "Buscar en la tienda" });
  return user;
}

describe("SearchSheet", () => {
  it("hoy no existe página de resultados: campo y botón desactivados con aviso «muy pronto»", async () => {
    await open(); // por defecto usa storeRoutes.search (= null mientras no exista la ruta)
    expect(screen.getByLabelText("¿Qué buscas?")).toBeDisabled();
    // Con el cajón modal abierto el botón de fuera queda oculto: el único «Buscar» accesible es el de enviar.
    expect(screen.getByRole("button", { name: "Buscar" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "La búsqueda estará disponible muy pronto.",
    );
  });

  it("con ruta de resultados: busca navegando a <ruta>?q=… y cierra el cajón", async () => {
    const user = await open("/buscar");
    expect(screen.getByLabelText("¿Qué buscas?")).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("¿Qué buscas?"), "  vestido rojo{Enter}");
    expect(screen.getByTestId("location")).toHaveTextContent("/buscar?q=vestido%20rojo");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("codifica los caracteres especiales del texto en la URL", async () => {
    const user = await open("/buscar");
    await user.type(screen.getByLabelText("¿Qué buscas?"), "a&b=c#d{Enter}");
    expect(screen.getByTestId("location")).toHaveTextContent("/buscar?q=a%26b%3Dc%23d");
  });

  it("menos de 2 letras (o solo espacios): error visible y NO navega", async () => {
    const user = await open("/buscar");
    const input = screen.getByLabelText("¿Qué buscas?");
    await user.type(input, "a{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe al menos 2 letras.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    await user.clear(input);
    await user.type(input, "    {Enter}");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("exactamente 2 letras ya busca", async () => {
    const user = await open("/buscar");
    await user.type(screen.getByLabelText("¿Qué buscas?"), "ab{Enter}");
    expect(screen.getByTestId("location")).toHaveTextContent("/buscar?q=ab");
  });
});

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
  it("por defecto busca en /buscar: campo y botón activos y sin aviso «muy pronto»", async () => {
    await open(); // usa storeRoutes.search
    expect(screen.getByLabelText("¿Qué buscas?")).toBeEnabled();
    // Con el cajón modal abierto el botón de fuera queda oculto: el único «Buscar» accesible es el de enviar.
    expect(screen.getByRole("button", { name: "Buscar" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("si la ruta de resultados no existiera (null): campo y botón desactivados con aviso «muy pronto»", async () => {
    await open(null);
    expect(screen.getByLabelText("¿Qué buscas?")).toBeDisabled();
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

  it("limpia el texto igual que la página de resultados: espacios colapsados y 80 caracteres como máximo", async () => {
    const user = await open("/buscar");
    await user.type(screen.getByLabelText("¿Qué buscas?"), "  vestido     rojo  {Enter}");
    expect(screen.getByTestId("location")).toHaveTextContent("/buscar?q=vestido%20rojo");
  });

  it("un texto de 200 letras se recorta a 80 en la URL", async () => {
    const user = await open("/buscar");
    await user.click(screen.getByLabelText("¿Qué buscas?"));
    await user.paste("a".repeat(200));
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("location")).toHaveTextContent(`/buscar?q=${"a".repeat(80)}`);
    expect(screen.getByTestId("location").textContent).not.toContain("a".repeat(81));
  });

  it("exactamente 2 letras ya busca", async () => {
    const user = await open("/buscar");
    await user.type(screen.getByLabelText("¿Qué buscas?"), "ab{Enter}");
    expect(screen.getByTestId("location")).toHaveTextContent("/buscar?q=ab");
  });
});

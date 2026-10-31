import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundPage } from "./NotFoundPage";
import { PlaceholderPage } from "./PlaceholderPage";

const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute("content");

beforeEach(() => {
  document.head.innerHTML = "<title>x</title>";
});

describe("páginas sin contenido propio: no se indexan (la SPA responde 200 a cualquier ruta)", () => {
  it("404: noindex,nofollow y el título lo dice", () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Página no encontrada" })).toBeInTheDocument();
    expect(robots()).toBe("noindex,nofollow");
    expect(document.title).toBe("Página no encontrada · Made In Chola");
  });

  it("pantalla provisional (nosotros, contacto, legales): noindex,follow", () => {
    render(<PlaceholderPage />);
    expect(screen.getByText(/disponible pronto/i)).toBeInTheDocument();
    expect(robots()).toBe("noindex,follow");
  });

  it("al desmontar se retira la marca (la página siguiente no hereda el noindex)", () => {
    const { unmount } = render(<PlaceholderPage />);
    unmount();
    expect(robots()).toBeUndefined();
  });
});

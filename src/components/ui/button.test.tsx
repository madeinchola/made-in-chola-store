import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";
import { buttonVariants } from "./button-variants";

describe("Button", () => {
  it("por defecto es el botón principal: relleno de marca y sin mayúsculas", () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button).toHaveClass("bg-primary", "text-primary-foreground", "h-10");
    expect(button).not.toHaveClass("eyebrow");
  });

  it("outline usa el borde de marca (como el diseño) y no relleno", () => {
    render(<Button variant="outline">Volver</Button>);
    const button = screen.getByRole("button", { name: "Volver" });
    expect(button).toHaveClass("border-primary", "bg-transparent", "text-primary");
    expect(button).not.toHaveClass("bg-primary");
  });

  it("caps activa el estilo de la tienda (mayúsculas con espaciado)", () => {
    render(<Button caps>Añadir a la bolsa</Button>);
    expect(screen.getByRole("button")).toHaveClass("eyebrow", "text-xs");
  });

  it("la variante link anula el relleno del tamaño (h-auto y px-0 ganan a h-10 px-4)", () => {
    render(<Button variant="link">Ver más</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("h-auto", "px-0", "underline");
    expect(button).not.toHaveClass("h-10");
    expect(button).not.toHaveClass("px-4");
  });

  it("un className externo gana a los estilos base", () => {
    render(<Button className="h-14">Grande</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("h-14");
    expect(button).not.toHaveClass("h-10");
  });

  it("loading: se anuncia ocupado y bloqueado (aria-disabled), muestra el indicador y no dispara onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Enviando
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Enviando" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading NO usa `disabled`: con Intro el foco se queda en el botón en vez de caer al <body>", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Button>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    button.focus();
    rerender(<Button loading>Guardar</Button>);
    expect(button).toBeEnabled();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(button).toHaveFocus();
  });

  it("loading dentro de un formulario no lo envía (ni con clic ni con Intro en un campo)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Nombre" />
        <Button type="submit" loading>
          Enviar
        </Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await user.type(screen.getByLabelText("Nombre"), "Ana{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sin loading un botón de envío SÍ envía el formulario", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Nombre" />
        <Button type="submit">Enviar</Button>
      </form>,
    );
    await user.type(screen.getByLabelText("Nombre"), "Ana{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("loading respeta además un onClick que llega después (se llama cuando deja de cargar)", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Ok</Button>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Ok" }));
    rerender(
      <Button loading={false} onClick={onClick}>
        Ok
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Ok" }));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("sin loading no lleva aria-busy ni indicador", () => {
    render(<Button>Listo</Button>);
    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button.querySelector("svg")).toBeNull();
    expect(button).toBeEnabled();
  });

  it("disabled no dispara onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        No
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("asChild aplica los estilos a un enlace sin envolverlo en otro botón", () => {
    render(
      <Button asChild variant="secondary">
        <a href="/tienda">Ir a la tienda</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Ir a la tienda" });
    expect(link).toHaveClass("bg-secondary");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("buttonVariants() permite dar aspecto de botón a cualquier enlace", () => {
    const classes = buttonVariants({ variant: "outline", size: "lg", caps: true });
    expect(classes).toContain("border-primary");
    expect(classes).toContain("h-12");
    expect(classes).toContain("eyebrow");
  });

  it("el botón de icono es cuadrado (w-10) y el pequeño mide 36 px", () => {
    render(
      <>
        <Button size="icon" aria-label="Cerrar" />
        <Button size="sm">Pequeño</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveClass("h-10", "w-10");
    expect(screen.getByRole("button", { name: "Pequeño" })).toHaveClass("h-9");
  });
});

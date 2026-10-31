import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "./badge";
import { Checkbox } from "./checkbox";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Switch } from "./switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
import { Skeleton } from "./skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb";
import { Pagination } from "./pagination";

describe("Badge", () => {
  it("cada tono usa tokens (no colores crudos)", () => {
    render(
      <>
        <Badge tone="success">Activo</Badge>
        <Badge tone="warning">Pendiente</Badge>
        <Badge tone="danger">Error</Badge>
        <Badge tone="info">Aviso</Badge>
        <Badge tone="solid" caps>
          Nuevo
        </Badge>
      </>,
    );
    expect(screen.getByText("Activo")).toHaveClass("bg-success-soft", "text-success");
    expect(screen.getByText("Pendiente")).toHaveClass("bg-warning-soft", "text-warning");
    expect(screen.getByText("Error")).toHaveClass("bg-destructive-soft", "text-destructive");
    expect(screen.getByText("Aviso")).toHaveClass("bg-info-soft", "text-info");
    expect(screen.getByText("Nuevo")).toHaveClass("bg-primary", "eyebrow");
    for (const el of screen.getAllByText(/Activo|Pendiente|Error|Aviso|Nuevo/)) {
      expect(el.className).not.toMatch(/(emerald|amber|red|sky)-\d/);
    }
  });
  it("por defecto es neutro y píldora", () => {
    render(<Badge>Borrador</Badge>);
    expect(screen.getByText("Borrador")).toHaveClass("bg-muted", "rounded-pill");
  });
});

describe("Checkbox", () => {
  function Controlled({ onChange }: { onChange?: (v: boolean | "indeterminate") => void }) {
    const [checked, setChecked] = useState<boolean | "indeterminate">(false);
    return (
      <>
        <Checkbox
          id="acepto"
          checked={checked}
          onCheckedChange={(v) => {
            setChecked(v);
            onChange?.(v);
          }}
        />
        <label htmlFor="acepto">Acepto</label>
      </>
    );
  }
  it("se marca con clic en la etiqueta y con la barra espaciadora", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Acepto" });
    expect(box).not.toBeChecked();
    await user.click(screen.getByText("Acepto"));
    expect(box).toBeChecked();
    box.focus();
    await user.keyboard(" ");
    expect(box).not.toBeChecked();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });
  it("indeterminado se anuncia como mixto", () => {
    render(<Checkbox checked="indeterminate" aria-label="Todos" />);
    expect(screen.getByRole("checkbox", { name: "Todos" })).toHaveAttribute(
      "aria-checked",
      "mixed",
    );
  });
  it("desactivada no cambia", async () => {
    const onChange = vi.fn();
    render(<Checkbox disabled aria-label="x" onCheckedChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("checkbox"));
    expect(onChange).not.toHaveBeenCalled();
  });
  it("aria-invalid se propaga (el borde de error lo pinta el estilo)", () => {
    render(<Checkbox aria-invalid="true" aria-label="x" />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("RadioGroup", () => {
  it("las flechas mueven la selección y se salta la opción desactivada", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup defaultValue="a" onValueChange={onValueChange} aria-label="Envío">
        <RadioGroupItem value="a" aria-label="A" />
        <RadioGroupItem value="b" aria-label="B" disabled />
        <RadioGroupItem value="c" aria-label="C" />
      </RadioGroup>,
    );
    act(() => screen.getByRole("radio", { name: "A" }).focus());
    // Radix mueve el foco con un setTimeout y selecciona si la flecha sigue PULSADA: user-event suelta la
    // tecla al instante, así que se mantiene pulsada hasta ver el resultado (en un navegador real no hace falta).
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => expect(screen.getByRole("radio", { name: "C" })).toBeChecked());
    await user.keyboard("{/ArrowDown}");
    expect(onValueChange).toHaveBeenLastCalledWith("c");
    expect(screen.getByRole("radio", { name: "B" })).toBeDisabled();
  });
  it("es un solo punto de tabulación: Tab desde fuera cae en la opción seleccionada y el siguiente Tab sale del grupo", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Antes</button>
        <RadioGroup defaultValue="b" aria-label="g">
          <RadioGroupItem value="a" aria-label="A" />
          <RadioGroupItem value="b" aria-label="B" />
        </RadioGroup>
        <button type="button">Después</button>
      </>,
    );
    screen.getByRole("button", { name: "Antes" }).focus();
    await user.tab();
    expect(screen.getByRole("radio", { name: "B" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Después" })).toHaveFocus();
  });
});

describe("Switch", () => {
  it("es un switch que se activa con clic y con espacio", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Visible" onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole("switch", { name: "Visible" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(onCheckedChange.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });
});

describe("Tabs", () => {
  function Example() {
    return (
      <Tabs defaultValue="desc">
        <TabsList aria-label="Detalles">
          <TabsTrigger value="desc">Descripción</TabsTrigger>
          <TabsTrigger value="mat">Materiales</TabsTrigger>
        </TabsList>
        <TabsContent value="desc">Texto de descripción</TabsContent>
        <TabsContent value="mat">Texto de materiales</TabsContent>
      </Tabs>
    );
  }
  it("muestra solo el panel activo y cambia con clic", async () => {
    const user = userEvent.setup();
    render(<Example />);
    expect(screen.getByText("Texto de descripción")).toBeInTheDocument();
    expect(screen.queryByText("Texto de materiales")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Materiales" }));
    expect(screen.getByText("Texto de materiales")).toBeInTheDocument();
    expect(screen.queryByText("Texto de descripción")).toBeNull();
  });
  it("las flechas mueven entre pestañas y la activa lleva aria-selected", async () => {
    const user = userEvent.setup();
    render(<Example />);
    act(() => screen.getByRole("tab", { name: "Descripción" }).focus());
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Materiales" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Descripción" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

describe("Accordion", () => {
  function Example() {
    return (
      <Accordion type="single" collapsible>
        <AccordionItem value="envios">
          <AccordionTrigger>Envíos</AccordionTrigger>
          <AccordionContent>Enviamos a toda Bolivia.</AccordionContent>
        </AccordionItem>
        <AccordionItem value="cambios">
          <AccordionTrigger>Cambios</AccordionTrigger>
          <AccordionContent>Tienes 7 días.</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  }
  it("abre y cierra con clic y con teclado; solo uno abierto a la vez", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const envios = screen.getByRole("button", { name: "Envíos" });
    const cambios = screen.getByRole("button", { name: "Cambios" });
    expect(envios).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Enviamos a toda Bolivia.")).toBeNull();
    await user.click(envios);
    expect(envios).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Enviamos a toda Bolivia.")).toBeVisible();
    cambios.focus();
    await user.keyboard("{Enter}");
    expect(cambios).toHaveAttribute("aria-expanded", "true");
    expect(envios).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(cambios).toHaveAttribute("aria-expanded", "false");
  });
  it("la cabecera es un encabezado (navegable por lectores de pantalla)", () => {
    render(<Example />);
    expect(screen.getAllByRole("heading")).toHaveLength(2);
  });
});

describe("Tooltip", () => {
  it("aparece al enfocar con teclado (no solo con el ratón) y se cierra con Esc", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Guía de tallas</TooltipTrigger>
          <TooltipContent>Mide tu pecho</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Mide tu pecho");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("Sheet", () => {
  function Example({ side }: { side?: "left" | "right" | "top" | "bottom" }) {
    return (
      <Sheet>
        <SheetTrigger>Abrir bolsa</SheetTrigger>
        <SheetContent {...(side ? { side } : {})}>
          <SheetHeader>
            <SheetTitle>Tu bolsa</SheetTitle>
            <SheetDescription>Productos agregados</SheetDescription>
          </SheetHeader>
          <button type="button">Pagar</button>
        </SheetContent>
      </Sheet>
    );
  }
  it("es un diálogo modal con nombre, se cierra con Esc y devuelve el foco al botón", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Abrir bolsa" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
    expect(within(dialog).getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
  it("la X de cierre queda FUERA del cuerpo con scroll (si se desplazara con el contenido, en un móvil bajito no habría cómo cerrar)", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Abrir bolsa" }));
    const dialog = await screen.findByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Cerrar" });
    const scrollers = Array.from(dialog.querySelectorAll("div")).filter((el) =>
      el.className.includes("overflow-y-auto"),
    );
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]!.contains(close)).toBe(false);
    expect(scrollers[0]!.contains(within(dialog).getByRole("button", { name: "Pagar" }))).toBe(
      true,
    );
    expect(dialog.className).not.toContain("overflow-y-auto");
  });
  it("el foco queda atrapado dentro mientras está abierto", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Abrir bolsa" }));
    const dialog = await screen.findByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
  it("cada lado usa su posición y respeta las zonas seguras del móvil", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Example side="left" />);
    await user.click(screen.getByRole("button", { name: "Abrir bolsa" }));
    const left = await screen.findByRole("dialog");
    expect(left).toHaveClass("left-0", "inset-y-0", "pb-[env(safe-area-inset-bottom)]");
    unmount();
    render(<Example side="bottom" />);
    await user.click(screen.getByRole("button", { name: "Abrir bolsa" }));
    expect(await screen.findByRole("dialog")).toHaveClass("bottom-0", "rounded-t-card");
  });
});

describe("Skeleton", () => {
  it("es decorativo: oculto a lectores de pantalla", () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const el = container.firstElementChild!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveClass("animate-pulse", "h-4", "w-20");
  });
});

describe("Breadcrumb", () => {
  function Example() {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Inicio</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Camisetas</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }
  it("es una navegación con nombre y la página actual lleva aria-current", () => {
    render(<Example />);
    const nav = screen.getByRole("navigation", { name: "Ruta de navegación" });
    expect(within(nav).getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/");
    expect(within(nav).getByText("Camisetas")).toHaveAttribute("aria-current", "page");
  });
  it("el separador es decorativo (no se lee ni cuenta como elemento de la lista)", () => {
    render(<Example />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("acepta un nombre accesible propio", () => {
    render(
      <Breadcrumb label="Migas">
        <BreadcrumbList />
      </Breadcrumb>,
    );
    expect(screen.getByRole("navigation", { name: "Migas" })).toBeInTheDocument();
  });
});

describe("Pagination", () => {
  it("con una sola página (o ninguna) no renderiza nada", () => {
    const { container, rerender } = render(
      <Pagination page={1} totalPages={1} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<Pagination page={1} totalPages={0} onPageChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("marca la página actual, desactiva «Anterior» en la primera y navega al hacer clic", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={5} onPageChange={onPageChange} />);
    const nav = screen.getByRole("navigation", { name: "Paginación" });
    expect(within(nav).getByRole("button", { name: "Página 1, página actual" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("button", { name: "Anterior" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(within(nav).getByRole("button", { name: "Página 3" }));
    await user.click(within(nav).getByRole("button", { name: "Siguiente" }));
    expect(onPageChange.mock.calls.map((c) => c[0])).toEqual([3, 2]);
  });
  it("en la última página «Siguiente» está desactivado y «Anterior» va a la anterior", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={5} totalPages={5} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Siguiente" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
  it("con muchas páginas muestra solo 7 números/huecos y los suspensivos no se leen", () => {
    render(<Pagination page={5} totalPages={20} onPageChange={vi.fn()} />);
    // anterior + (1, …, 4, 5, 6, …, 20) + siguiente = 9 en el DOM, 7 para un lector de pantalla (los 2 huecos son decorativos)
    expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(9);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    const gaps = screen.getAllByText("…");
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Página 20" })).toBeInTheDocument();
  });
  it("con getHref cada página es un enlace real; clic normal navega por callback, con Ctrl se deja al navegador", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={2}
        totalPages={4}
        onPageChange={onPageChange}
        getHref={(p) => `/tienda?pagina=${p}`}
      />,
    );
    // jsdom intenta navegar de verdad con un clic en <a>: se frena fuera del componente para no ensuciar la salida.
    const stopNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", stopNavigation);
    const link = screen.getByRole("link", { name: "Página 3" });
    expect(link).toHaveAttribute("href", "/tienda?pagina=3");
    await user.click(link);
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    await user.keyboard("{Control>}");
    await user.click(link);
    await user.keyboard("{/Control}");
    expect(onPageChange).toHaveBeenCalledTimes(1);
    document.removeEventListener("click", stopNavigation);
  });
  it("un extremo desactivado (aria-disabled) no navega y conserva el foco al activarlo con el teclado", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={3} onPageChange={onPageChange} />);
    const prev = screen.getByRole("button", { name: "Anterior" });
    act(() => prev.focus());
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onPageChange).not.toHaveBeenCalled();
    expect(prev).toHaveFocus();
  });
  it("totalPages NaN (cálculo con datos aún sin cargar) no pinta nada ni «NaN»", () => {
    const { container } = render(
      <Pagination page={1} totalPages={Number.NaN} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("acota una página fuera de rango", () => {
    render(<Pagination page={99} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Página 3, página actual" })).toBeInTheDocument();
  });
});

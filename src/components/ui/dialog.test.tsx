import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";

function Harness({ removeOpener = false }: { removeOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [showButton, setShowButton] = useState(true);
  return (
    <>
      {showButton && (
        <button type="button" onClick={() => setOpen(true)}>
          Abrir
        </button>
      )}
      <button type="button">Otro</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>Descripción</DialogDescription>
          <button type="button" onClick={() => (removeOpener ? setShowButton(false) : undefined)}>
            Dentro
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("Dialog: foco", () => {
  it("al abrirse mueve el foco DENTRO del diálogo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    const dialog = await screen.findByRole("dialog", { name: "Título" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("si el clic NO enfocó el botón (Safari/Firefox en macOS: activeElement = <body>) no se «devuelve» el foco a <body>: se respeta el DialogTrigger de Radix", async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>Abrir con trigger</DialogTrigger>
          <DialogContent>
            <DialogTitle>Título</DialogTitle>
            <DialogDescription>Descripción</DialogDescription>
          </DialogContent>
        </Dialog>
      );
    }
    render(<Controlled />);
    const trigger = screen.getByRole("button", { name: "Abrir con trigger" });
    expect(document.body).toHaveFocus();
    // `fireEvent.click` no mueve el foco, como un clic en Safari: el elemento activo sigue siendo <body>
    act(() => {
      fireEvent.click(trigger);
    });
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("al cerrarse con Escape DEVUELVE el foco al botón que lo abrió (aunque no haya DialogTrigger)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("devuelve el foco a quien lo tenía, no a un botón cualquiera (abre el segundo, vuelve al segundo)", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
      </>,
    );
    const first = screen.getByRole("button", { name: "Abrir" });
    await user.click(first);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(first).toHaveFocus());
    expect(screen.getByRole("button", { name: "Otro" })).not.toHaveFocus();
  });

  it("puede abrirse y cerrarse varias veces: el foco vuelve siempre", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    for (let i = 0; i < 3; i++) {
      await user.click(opener);
      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(opener).toHaveFocus());
    }
  });

  it("si quien lo abrió ya no existe al cerrarse, no falla (el foco no se pierde en un error)", async () => {
    const user = userEvent.setup();
    render(<Harness removeOpener />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(await screen.findByRole("button", { name: "Dentro" })); // quita el botón que lo abrió
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Abrir" })).not.toBeInTheDocument();
  });
});

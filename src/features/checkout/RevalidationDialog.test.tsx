import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RevalidationDialog } from "./RevalidationDialog";
import type { Revalidation } from "./revalidation";

const changed: Revalidation = {
  outcome: "changed",
  reason: "total",
  expected_total: 215,
  actual_total: 230,
};

function renderDialog(props: Partial<React.ComponentProps<typeof RevalidationDialog>> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <RevalidationDialog
        result={changed}
        currency="BOB"
        pending={false}
        onConfirm={onConfirm}
        onClose={onClose}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onConfirm, onClose };
}

describe("RevalidationDialog", () => {
  it("M4: mientras la vista previa se recalcula, «Confirmar» espera: un clic ahora no se pierde en silencio", async () => {
    const { onConfirm } = renderDialog({ waiting: true });
    const confirm = screen.getByRole("button", { name: "Confirmar con el nuevo total" });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("con la vista previa al día, «Confirmar» envía el total nuevo que dio el servidor", async () => {
    const { onConfirm } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar con el nuevo total" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(230);
  });

  it("mientras se envía, «Confirmar» está bloqueado y el aviso no se puede cerrar con Escape", async () => {
    const { onClose } = renderDialog({ pending: true });
    expect(screen.getByRole("button", { name: "Enviando tu pedido…" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("B4: por descuento no hay total que confirmar: solo «Ver el nuevo total» (cierra) y «Revisar mi bolsa»", async () => {
    const { onClose, onConfirm } = renderDialog({
      result: { outcome: "changed", reason: "discount", failed: [{ reason: "coupon_exhausted" }] },
    });
    expect(
      screen.queryByRole("button", { name: "Confirmar con el nuevo total" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar mi bolsa" })).toHaveAttribute(
      "href",
      "/carrito",
    );
    await userEvent.click(screen.getByRole("button", { name: "Ver el nuevo total" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("por precio no se ofrece confirmar NI aunque llegue un total: aceptar el precio se hace en la bolsa", () => {
    renderDialog({
      result: {
        outcome: "changed",
        reason: "price",
        expected_total: 215,
        actual_total: 230,
        lines: [],
      },
    });
    expect(
      screen.queryByRole("button", { name: "Confirmar con el nuevo total" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar mi bolsa" })).toBeInTheDocument();
  });

  it("por precio o sin stock solo se ofrece volver a la bolsa", () => {
    renderDialog({ result: { outcome: "changed", reason: "price", lines: [] } });
    expect(
      screen.queryByRole("button", { name: /Confirmar|Ver el nuevo total/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar mi bolsa" })).toBeInTheDocument();
  });
});

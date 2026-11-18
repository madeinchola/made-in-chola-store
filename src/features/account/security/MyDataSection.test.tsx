import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyDataSection } from "./MyDataSection";

const data = vi.hoisted(() => ({ downloadMyData: vi.fn() }));
vi.mock("./myData", () => data);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.resetAllMocks());

describe("MyDataSection", () => {
  it("explica qué incluye y qué no, y ofrece descargar", () => {
    render(<MyDataSection />);
    expect(screen.getByRole("heading", { name: "Descargar mis datos" })).toBeInTheDocument();
    expect(
      screen.getByText(/No incluye datos internos del negocio ni de otras personas/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar mis datos" })).toBeEnabled();
  });

  it("al pulsar pide el archivo UNA vez; mientras prepara el botón se bloquea y un segundo clic no repite", async () => {
    let finish: () => void = () => undefined;
    data.downloadMyData.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(<MyDataSection />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar mis datos" }));
    const busy = await screen.findByRole("button", { name: "Preparando tu archivo…" });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    expect(data.downloadMyData).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Descargar mis datos" })).toBeEnabled(),
    );
  });

  it("si falla lo dice en palabras (sin detalles técnicos) y se puede reintentar", async () => {
    data.downloadMyData
      .mockRejectedValueOnce(new Error("rpc 500 secreto"))
      .mockResolvedValue(undefined);
    render(<MyDataSection />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar mis datos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos preparar tu archivo");
    expect(screen.getByRole("alert")).not.toHaveTextContent("secreto");
    await userEvent.click(screen.getByRole("button", { name: "Descargar mis datos" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(data.downloadMyData).toHaveBeenCalledTimes(2);
  });
});

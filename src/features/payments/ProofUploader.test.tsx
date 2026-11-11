import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProofUploader } from "./ProofUploader";

const api = vi.hoisted(() => ({ uploadProof: vi.fn() }));
vi.mock("./paymentsApi", () => api);

const JPG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
const file = (name: string, head: number[] | string, type = "image/jpeg", size?: number) => {
  const bytes =
    typeof head === "string"
      ? new TextEncoder().encode(head)
      : (() => {
          const out = new Uint8Array(size ?? head.length);
          out.set(head);
          return out;
        })();
  return new File([bytes], name, { type });
};

function renderUploader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProofUploader userId="u-1" orderId="o-1" paymentId="p-1" />
    </QueryClientProvider>,
  );
}
// `accept` filtraría los archivos de prueba que NO son imágenes: se desactiva para simular a quien lo ignora.
const user = () => userEvent.setup({ applyAccept: false });
const input = () => screen.getByLabelText("Comprobante de pago") as HTMLInputElement;
const send = () => screen.getByRole("button", { name: /Enviar comprobante|Enviando/ });

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("ProofUploader", () => {
  it("sin archivo no se puede enviar", () => {
    renderUploader();
    expect(send()).toBeDisabled();
  });

  it("un jpeg válido muestra su vista previa y habilita el envío", async () => {
    renderUploader();
    await user().upload(input(), file("pago.jpg", JPG));
    expect(await screen.findByText("Archivo elegido: pago.jpg")).toBeInTheDocument();
    expect(screen.getByAltText("Vista previa del comprobante")).toHaveAttribute(
      "src",
      "blob:preview",
    );
    expect(send()).toBeEnabled();
  });

  it("un PDF no tiene imagen: muestra un icono de documento", async () => {
    renderUploader();
    await user().upload(
      input(),
      file("pago.pdf", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31], "application/pdf"),
    );
    expect(await screen.findByText("Documento PDF")).toBeInTheDocument();
    expect(screen.queryByAltText("Vista previa del comprobante")).not.toBeInTheDocument();
  });

  it("un archivo que no es un comprobante se explica y NO se puede enviar (aunque se llame .jpg)", async () => {
    renderUploader();
    await user().upload(input(), file("pago.jpg", "<svg><script>alert(1)</script></svg>"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo aceptamos fotos (JPG, PNG o WebP) y PDF.",
    );
    expect(send()).toBeDisabled();
    expect(api.uploadProof).not.toHaveBeenCalled();
  });

  it("uno de más de 5 MB se explica antes de subir", async () => {
    renderUploader();
    await user().upload(input(), file("grande.jpg", JPG, "image/jpeg", 5 * 1024 * 1024 + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("El archivo pesa más de 5 MB.");
    expect(send()).toBeDisabled();
  });

  it("uno vacío se explica", async () => {
    renderUploader();
    await user().upload(input(), file("vacio.jpg", []));
    expect(await screen.findByRole("alert")).toHaveTextContent("El archivo está vacío.");
  });

  it("envía con la clienta, el pedido y el cobro; al terminar avisa y limpia la selección", async () => {
    api.uploadProof.mockResolvedValue({ ok: true, proofId: "pr-1" });
    renderUploader();
    const picked = file("pago.jpg", JPG);
    await user().upload(input(), picked);
    await user().click(await screen.findByRole("button", { name: "Enviar comprobante" }));
    await waitFor(() => expect(api.uploadProof).toHaveBeenCalledTimes(1));
    expect(api.uploadProof.mock.calls[0]![0]).toMatchObject({
      userId: "u-1",
      orderId: "o-1",
      paymentId: "p-1",
      file: picked,
    });
    expect(
      await screen.findByText("Recibimos tu comprobante. Lo estamos revisando."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Archivo elegido/)).not.toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it("mientras sube, bloquea el botón y el selector (anti doble envío)", async () => {
    let finish: (value: unknown) => void = () => {};
    api.uploadProof.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderUploader();
    await user().upload(input(), file("pago.jpg", JPG));
    await user().click(await screen.findByRole("button", { name: "Enviar comprobante" }));
    expect(await screen.findByRole("button", { name: "Enviando tu comprobante…" })).toBeDisabled();
    expect(input()).toBeDisabled();
    await user().click(screen.getByRole("button", { name: "Enviando tu comprobante…" }));
    expect(api.uploadProof).toHaveBeenCalledTimes(1);
    finish({ ok: true, proofId: null });
    await screen.findByText("Recibimos tu comprobante. Lo estamos revisando.");
  });

  it("reintentar el MISMO archivo tras un fallo usa el mismo identificador; elegir otro, uno nuevo", async () => {
    api.uploadProof.mockResolvedValue({ ok: false, problem: "network" });
    renderUploader();
    await user().upload(input(), file("pago.jpg", JPG));
    await user().click(await screen.findByRole("button", { name: "Enviar comprobante" }));
    await screen.findByRole("alert");
    await user().click(screen.getByRole("button", { name: "Enviar comprobante" }));
    await waitFor(() => expect(api.uploadProof).toHaveBeenCalledTimes(2));
    const [first, second] = api.uploadProof.mock.calls.map((c) => c[0].fileId);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
    await user().upload(input(), file("otro.jpg", [0xff, 0xd8, 0xff, 0xe0, 9, 9]));
    await screen.findByText("Archivo elegido: otro.jpg");
    await user().click(screen.getByRole("button", { name: "Enviar comprobante" }));
    await waitFor(() => expect(api.uploadProof).toHaveBeenCalledTimes(3));
    expect(api.uploadProof.mock.calls[2]![0].fileId).not.toBe(first);
  });

  it.each([
    ["payment_closed", /ya no admite comprobantes/],
    ["proof_pending", /Ya tienes un comprobante en revisión/],
    ["too_many_proofs", /máximo de comprobantes/],
    ["invalid_file", /No pudimos leer ese archivo/],
    ["rate_limited", /demasiados intentos/],
    ["login", /sesión venció/],
    ["network", /No pudimos conectarnos/],
    ["unknown", /No pudimos enviar tu comprobante/],
  ])(
    "el rechazo «%s» se explica y deja reintentar con el mismo archivo",
    async (problem, message) => {
      api.uploadProof.mockResolvedValue({ ok: false, problem });
      renderUploader();
      await user().upload(input(), file("pago.jpg", JPG));
      await user().click(await screen.findByRole("button", { name: "Enviar comprobante" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(send()).toBeEnabled();
      expect(screen.getByText("Archivo elegido: pago.jpg")).toBeInTheDocument();
    },
  );
});

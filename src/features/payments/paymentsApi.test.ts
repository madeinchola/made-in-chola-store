import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadProof } from "./paymentsApi";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  rpc: vi.fn(),
  callFunction: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({ upload: mocks.upload, getPublicUrl: () => ({ data: { publicUrl: "x" } }) }),
    },
    rpc: mocks.rpc,
    auth: { getSession: mocks.getSession },
  }),
}));
vi.mock("@/lib/functions", () => ({ callFunction: mocks.callFunction }));

const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])]);
const FILE_ID = "f0000000-0000-4000-8000-000000000001";
const input = { userId: "u-1", orderId: "o-1", paymentId: "p-1", file: PNG, fileId: FILE_ID };
const PATH = `u-1/o-1/${FILE_ID}.png`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.callFunction.mockResolvedValue({
    ok: true,
    data: { ok: true, outcome: "registered", proof_id: "pr-1" },
  });
});

describe("uploadProof", () => {
  it("sube a la carpeta de la clienta con el tipo REAL y registra el archivo con su ruta", async () => {
    const result = await uploadProof(input);
    expect(result).toEqual({ ok: true, proofId: "pr-1" });
    expect(mocks.upload).toHaveBeenCalledWith(PATH, PNG, {
      contentType: "image/png",
      upsert: false,
    });
    expect(mocks.callFunction).toHaveBeenCalledWith(
      "payments",
      { action: "proof_submit", payment_id: "p-1", path: PATH },
      { token: "tok" },
    );
  });

  it("un archivo que no es un comprobante NO sale: ni se sube ni se registra", async () => {
    const result = await uploadProof({ ...input, file: new Blob(["<svg><script/></svg>"]) });
    expect(result).toEqual({ ok: false, problem: "unknown_type" });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.callFunction).not.toHaveBeenCalled();
  });

  it("si ya estaba subido (reintento tras un corte, misma ruta) sigue con el registro en vez de fallar", async () => {
    mocks.upload.mockResolvedValue({
      error: { message: "The resource already exists", statusCode: "409" },
    });
    expect(await uploadProof(input)).toEqual({ ok: true, proofId: "pr-1" });
    expect(mocks.callFunction).toHaveBeenCalledTimes(1);
  });

  it("reintentar con el mismo identificador usa la MISMA ruta (no sube otro archivo)", async () => {
    await uploadProof(input);
    await uploadProof(input);
    expect(mocks.upload.mock.calls.map((c) => c[0])).toEqual([PATH, PATH]);
  });

  it("sin identificador se genera uno distinto cada vez", async () => {
    const { fileId: _drop, ...bare } = input;
    void _drop;
    await uploadProof(bare);
    await uploadProof(bare);
    const [a, b] = mocks.upload.mock.calls.map((c) => c[0]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^u-1\/o-1\/[0-9a-f-]{36}\.png$/);
  });

  it.each([
    [
      { message: "new row violates row-level security policy", statusCode: "403" },
      "payment_closed",
    ],
    [{ message: "denied", statusCode: "403" }, "payment_closed"],
    [{ message: "fetch failed" }, "network"],
  ])("un rechazo del almacenamiento %j es «%s»", async (error, problem) => {
    mocks.upload.mockResolvedValue({ error });
    expect(await uploadProof(input)).toEqual({ ok: false, problem });
    expect(mocks.callFunction).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, status: 401, code: "invalid_session", message: "x" }, "login"],
    [{ ok: false, status: 429, code: "rate_limited", message: "x" }, "rate_limited"],
    [{ ok: false, status: 0, code: "network", message: "x" }, "network"],
    [{ ok: false, status: 500, code: "internal", message: "x" }, "unknown"],
  ])("la función responde %j → «%s»", async (response, problem) => {
    mocks.callFunction.mockResolvedValue(response);
    expect(await uploadProof(input)).toEqual({ ok: false, problem });
  });

  it.each([
    "payment_closed",
    "proof_pending",
    "too_many_proofs",
    "invalid_file",
    "file_missing",
    "not_found",
  ])("el resultado «%s» de la función se conserva", async (outcome) => {
    mocks.callFunction.mockResolvedValue({ ok: true, data: { ok: false, outcome } });
    expect(await uploadProof(input)).toEqual({ ok: false, problem: outcome });
  });

  it("un resultado que no se conoce es «unknown» (no se inventa una explicación)", async () => {
    mocks.callFunction.mockResolvedValue({ ok: true, data: { ok: false, outcome: "algo_raro" } });
    expect(await uploadProof(input)).toEqual({ ok: false, problem: "unknown" });
  });

  it("el archivo existente (outcome existing) cuenta como enviado", async () => {
    mocks.callFunction.mockResolvedValue({
      ok: true,
      data: { ok: true, outcome: "existing", proof_id: "pr-9" },
    });
    expect(await uploadProof(input)).toEqual({ ok: true, proofId: "pr-9" });
  });
});

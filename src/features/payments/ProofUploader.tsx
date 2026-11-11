import { useEffect, useId, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { useUploadProof } from "./hooks";
import { type UploadProblem } from "./paymentsApi";
import { checkProofFile, PROOF_ACCEPT, type ProofMime } from "./proofFile";

/**
 * Subida del comprobante: elegir archivo, ver una vista previa, comprobarlo (tipo y tamaño) ANTES de subir y enviarlo.
 * El archivo va al bucket privado y el servidor lo vuelve a revisar; si algo falla, el mensaje dice qué pasó y se puede
 * reintentar (si el archivo ya había subido, no se duplica: es la misma huella).
 */
export function ProofUploader({
  userId,
  orderId,
  paymentId,
}: {
  userId: string;
  orderId: string;
  paymentId: string;
}) {
  const inputId = useId();
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mime, setMime] = useState<ProofMime | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [sent, setSent] = useState(false);
  // Cada archivo ELEGIDO tiene su propio identificador: reintentar el mismo tras un corte reutiliza su ruta en el bucket.
  const fileId = useRef(crypto.randomUUID());
  const upload = useUploadProof(orderId);

  // La vista previa de una imagen es una URL local que se libera al cambiar de archivo o al desmontar.
  useEffect(() => {
    if (!file || !mime || mime === "application/pdf" || typeof URL.createObjectURL !== "function") {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, mime]);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setProblem(null);
    setSent(false);
    if (!picked) {
      setFile(null);
      setMime(null);
      return;
    }
    const check = await checkProofFile(picked);
    if (!check.ok) {
      setFile(null);
      setMime(null);
      setProblem(check.problem);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    fileId.current = crypto.randomUUID();
    setFile(picked);
    setMime(check.mime);
  }

  async function onSend() {
    if (!file || upload.isPending) return;
    setProblem(null);
    const result = await upload.mutateAsync({
      userId,
      orderId,
      paymentId,
      file,
      fileId: fileId.current,
    });
    if (result.ok) {
      setSent(true);
      setFile(null);
      setMime(null);
      if (inputRef.current) inputRef.current.value = "";
    } else {
      setProblem(result.problem);
    }
  }

  return (
    <div className="space-y-3 rounded-card border border-border p-4">
      <h3 className="font-medium">{t("pay.upload.title")}</h3>
      <p id={helpId} className="text-sm text-muted-foreground">
        {t("pay.upload.help")}
      </p>
      <div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={PROOF_ACCEPT}
          aria-label={t("pay.upload.fileLabel")}
          aria-describedby={helpId}
          aria-invalid={problem !== null && file === null ? true : undefined}
          disabled={upload.isPending}
          onChange={(event) => void onPick(event)}
          className="block min-h-11 w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-background file:px-4 file:text-sm file:font-medium"
        />
      </div>

      {file && (
        <div className="flex items-center gap-3">
          {preview ? (
            <img
              src={preview}
              alt={t("pay.upload.previewAlt")}
              className="h-24 w-24 rounded-md border border-border object-cover"
            />
          ) : (
            <span className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-border text-xs text-muted-foreground">
              <FileText aria-hidden="true" className="h-6 w-6" />
              {t("pay.upload.pdfPreview")}
            </span>
          )}
          <p className="min-w-0 break-words text-sm">
            {t("pay.upload.selected", { name: file.name })}
          </p>
        </div>
      )}

      <div aria-live="polite" className="min-h-[1.25rem] text-sm">
        {problem && (
          <p role="alert" className="text-destructive">
            {t(`pay.upload.problems.${problem}` as MessageKey)}
          </p>
        )}
        {sent && <p className="text-foreground">{t("pay.upload.sent")}</p>}
      </div>

      <Button type="button" onClick={() => void onSend()} disabled={!file || upload.isPending}>
        {upload.isPending ? t("pay.upload.sending") : t("pay.upload.send")}
      </Button>
    </div>
  );
}

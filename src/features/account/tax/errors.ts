import { t } from "@/i18n";
import { AppError } from "@/lib/errors";
import { fromDbError, type DbErrorLike } from "@/lib/db-errors";
import { LEGAL_NAME_MAX, MAX_ACTIVE_TAX_PROFILES } from "./types";

/** Qué pasó, para que el formulario ponga el mensaje junto al campo que corresponde. */
export type TaxErrorReason =
  | "cap"
  | "duplicate"
  | "doc_format"
  | "legal_name"
  | "doc_type"
  | "conflict"
  | "not_found"
  | "other";

export class TaxProfileError extends AppError {
  readonly reason: TaxErrorReason;
  constructor(
    reason: TaxErrorReason,
    code: "validation" | "conflict" | "not_found" | "unknown",
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { cause });
    this.name = "TaxProfileError";
    this.reason = reason;
  }
}

/**
 * Traduce un error de la base al español para los datos fiscales:
 *  - 23514 con «máximo de N registros» → el tope de 10 activos (regla de negocio; también al RESTAURAR uno archivado).
 *  - 23514 de `tax_profiles_doc_number` / `_legal_name` / `_doc_type` → qué campo está mal.
 *  - 23505 de `tax_profiles_no_dup_idx` → el documento ya está entre los activos; cualquier otra unicidad (p. ej. dos
 *    «predeterminado» a la vez, que la base ya serializa) se explica como cambio simultáneo.
 * Lo demás pasa por `fromDbError` (que oculta los mensajes internos). Los mensajes de Postgres NUNCA se muestran tal cual.
 */
export function fromTaxDbError(error: DbErrorLike): AppError {
  const message = error.message;
  if (error.code === "23514") {
    if (/máximo de \d+ registros/i.test(message)) {
      return new TaxProfileError(
        "cap",
        "validation",
        t("acct.tax.errors.cap", { max: MAX_ACTIVE_TAX_PROFILES }),
        error,
      );
    }
    if (message.includes("tax_profiles_doc_number")) {
      return new TaxProfileError("doc_format", "validation", t("acct.tax.errors.docFormat"), error);
    }
    if (message.includes("tax_profiles_legal_name")) {
      return new TaxProfileError(
        "legal_name",
        "validation",
        t("acct.tax.errors.legalName", { max: LEGAL_NAME_MAX }),
        error,
      );
    }
    if (message.includes("tax_profiles_doc_type")) {
      return new TaxProfileError("doc_type", "validation", t("acct.tax.errors.docType"), error);
    }
  }
  if (error.code === "23505") {
    const duplicate = message.includes("tax_profiles_no_dup_idx");
    return new TaxProfileError(
      duplicate ? "duplicate" : "conflict",
      "conflict",
      t(duplicate ? "acct.tax.errors.duplicate" : "acct.tax.errors.conflict"),
      error,
    );
  }
  return fromDbError(error);
}

export const taxNotFound = () =>
  new TaxProfileError("not_found", "not_found", t("acct.tax.errors.notFound"));

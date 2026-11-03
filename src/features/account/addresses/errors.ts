import { t } from "@/i18n";
import { fromDbError, type DbErrorLike } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { MAX_ACTIVE_ADDRESSES } from "./types";

/** Nombre de la restricción que violó el error de Postgres (`violates check constraint "…"`). */
function constraintOf(message: string): string | null {
  return /constraint "([^"]+)"/.exec(message)?.[1] ?? null;
}

const TEXT_CONSTRAINT = /^addresses_(label|recipient|line1|line2|city|department|reference)_len$/;

/**
 * Traduce un error de la base al español de la libreta de direcciones. Los mensajes estándar de Postgres (en inglés,
 * con nombres de restricciones) NUNCA se muestran: cada regla de la tabla tiene su texto. Lo desconocido cae en el
 * traductor general (`fromDbError`).
 *
 * Códigos: `unauthorized` y `forbidden` significan «la sesión ya no vale» para el formulario (conserva lo escrito).
 */
export function fromAddressDbError(error: DbErrorLike): AppError {
  const cause = error;
  const { code, message } = error;
  const make = (kind: ConstructorParameters<typeof AppError>[0], text: string) =>
    new AppError(kind, text, { cause });

  // Sesión vencida o sin permiso (la RLS rechaza al visitante y al token caducado).
  if (code === "PGRST301" || code === "PGRST303") {
    return make("unauthorized", t("acct.addresses.dbErrors.unauthorized"));
  }
  if (code === "42501") return make("forbidden", t("acct.addresses.dbErrors.forbidden"));

  // Tope de activas (trigger `account_default_guard`): «Alcanzaste el máximo de 20 registros activos…».
  if (code === "23514" && /máximo de \d+ registros activos/i.test(message)) {
    return make("validation", t("acct.addresses.dbErrors.limit", { max: MAX_ACTIVE_ADDRESSES }));
  }

  if (code === "23514") {
    const constraint = constraintOf(message);
    if (constraint === "addresses_phone_required" || constraint === "addresses_phone_format") {
      return make("validation", t("acct.addresses.dbErrors.phone"));
    }
    if (
      constraint === "addresses_coords_pair" ||
      constraint === "addresses_lat_range" ||
      constraint === "addresses_lng_range"
    ) {
      return make("validation", t("acct.addresses.dbErrors.coords"));
    }
    if (constraint === "addresses_purpose") {
      return make("validation", t("acct.addresses.dbErrors.purpose"));
    }
    if (constraint && TEXT_CONSTRAINT.test(constraint)) {
      return make("validation", t("acct.addresses.dbErrors.text"));
    }
  }

  // País no habilitado (trigger `addresses_validate`) o inexistente (clave foránea).
  if (
    (code === "22023" && /pa[ií]s/i.test(message)) ||
    (code === "23503" && constraintOf(message) === "addresses_country_fkey")
  ) {
    return make("validation", t("acct.addresses.dbErrors.country"));
  }

  if (code === "P0002") return make("not_found", t("acct.addresses.dbErrors.notFound"));

  // Sin conexión: supabase-js entrega `TypeError: Failed to fetch` como error sin código.
  if (!code && /failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return make("network", t("acct.addresses.dbErrors.network"));
  }

  return fromDbError(error);
}

/** ¿El fallo indica que la sesión venció o dejó de ser válida? (el formulario avisa y conserva lo escrito) */
export function isSessionError(error: unknown): boolean {
  return error instanceof AppError && (error.code === "unauthorized" || error.code === "forbidden");
}

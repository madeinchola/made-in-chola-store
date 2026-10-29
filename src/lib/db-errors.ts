import { AppError } from "./errors";

/** Forma mínima de los errores de PostgREST / Postgres (`PostgrestError`). */
export interface DbErrorLike {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Traduce un error de la base de datos a un AppError.
 * Los mensajes de las reglas de negocio (RAISE EXCEPTION en español, sin datos personales) se conservan
 * para mostrarlos al usuario; los errores internos o desconocidos se ocultan tras un mensaje genérico.
 */
export function fromDbError(error: DbErrorLike): AppError {
  const cause = error;
  switch (error.code) {
    case "42501": // privilegio insuficiente / RLS
      return new AppError("forbidden", "No tienes permiso para realizar esta acción.", { cause });
    case "PGRST301": // JWT inválido o vencido
    case "PGRST303":
      return new AppError("unauthorized", "Tu sesión venció. Inicia sesión de nuevo.", { cause });
    case "P0002": // no_data_found (producto/variante inexistente)
      return new AppError("not_found", error.message, { cause });
    case "23505": // unique_violation
    case "23503": // foreign_key_violation
    case "P0001": // regla de negocio (p. ej. stock comprometido)
      return new AppError("conflict", error.message, { cause });
    case "23514": // check_violation
    case "22023": // invalid_parameter_value
    case "22P02": // invalid_text_representation
    case "22001": // string_data_right_truncation
      return new AppError("validation", error.message, { cause });
    default:
      return new AppError("unknown", "No se pudo completar la operación. Inténtalo de nuevo.", {
        cause,
      });
  }
}

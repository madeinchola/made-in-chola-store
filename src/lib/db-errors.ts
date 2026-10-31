import { AppError } from "./errors";

/** Forma mínima de los errores de PostgREST / Postgres (`PostgrestError`). */
export interface DbErrorLike {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Mensajes para las restricciones únicas que el panel puede disparar (clave = nombre de la restricción o índice). */
const UNIQUE_MESSAGES: Record<string, string> = {
  products_code_key: "Ya existe un producto con ese código.",
  products_code_lower_key:
    "Ya existe un producto con ese código (no se distingue entre mayúsculas y minúsculas).",
  products_slug_key: "Esa dirección (slug) ya la usa otro producto.",
  categories_slug_key: "Ya existe una categoría con esa dirección (slug).",
  collections_slug_key: "Ya existe una colección con esa dirección (slug).",
  product_colors_name_key: "Ese color ya existe en este producto.",
  product_sizes_label_key: "Esa talla ya existe en este producto.",
  product_variants_color_only_key: "Esa variante ya existe.",
  product_variants_color_size_key: "Esa combinación de color y talla ya existe.",
  product_variants_sku_key: "Ese SKU ya está en uso.",
  product_prices_currency_key: "Ese producto ya tiene precio en esa moneda.",
  product_prices_currency_country_key: "Ese producto ya tiene precio en esa moneda y país.",
  product_images_path_key: "Esa imagen ya está registrada.",
};

const UNIQUE_FALLBACK = "Ya existe un registro con esos datos.";
const FK_FALLBACK = "No se puede completar: este dato está relacionado con otros registros.";
const CHECK_FALLBACK = "Algún dato no cumple las reglas permitidas. Revisa los valores ingresados.";

// Los mensajes ESTÁNDAR de Postgres vienen en inglés y nombran tablas/restricciones: no se muestran tal cual.
// Los de nuestras reglas de negocio (RAISE EXCEPTION, en español) sí.
const isStandardPgMessage = (m: string, fragment: string) => m.includes(fragment);

function uniqueMessage(error: DbErrorLike): string {
  if (!isStandardPgMessage(error.message, "violates unique constraint")) return error.message;
  const name = /unique constraint "([^"]+)"/.exec(error.message)?.[1];
  return (name && UNIQUE_MESSAGES[name]) || UNIQUE_FALLBACK;
}

/**
 * Traduce un error de la base de datos a un AppError.
 * Los mensajes de las reglas de negocio (RAISE EXCEPTION en español, sin datos personales) se conservan
 * para mostrarlos al usuario; los errores internos o desconocidos se ocultan tras un mensaje genérico, y los
 * mensajes estándar de Postgres (en inglés, con nombres de tablas) se traducen o se reemplazan por uno genérico.
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
      return new AppError("conflict", uniqueMessage(error), { cause });
    case "23503": // foreign_key_violation
      return new AppError(
        "conflict",
        isStandardPgMessage(error.message, "violates foreign key constraint")
          ? FK_FALLBACK
          : error.message,
        { cause },
      );
    case "P0001": // regla de negocio (p. ej. stock comprometido)
      return new AppError("conflict", error.message, { cause });
    case "23514": // check_violation
      return new AppError(
        "validation",
        isStandardPgMessage(error.message, "violates check constraint")
          ? CHECK_FALLBACK
          : error.message,
        { cause },
      );
    case "22023": // invalid_parameter_value (nuestras funciones, mensaje en español)
      return new AppError("validation", error.message, { cause });
    case "22P02": // invalid_text_representation (mensaje estándar en inglés)
      return new AppError("validation", "Algún dato tiene un formato no válido.", { cause });
    case "22001": // string_data_right_truncation (mensaje estándar en inglés)
      return new AppError("validation", "Algún texto es demasiado largo.", { cause });
    default:
      return new AppError("unknown", "No se pudo completar la operación. Inténtalo de nuevo.", {
        cause,
      });
  }
}

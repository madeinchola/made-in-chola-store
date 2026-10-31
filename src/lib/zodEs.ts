import { z } from "zod";
import { t } from "@/i18n";

const day = (timestamp: number | bigint) => new Date(Number(timestamp)).toISOString().slice(0, 10);

/**
 * Mensajes de zod en español. Los esquemas que escriben su propio mensaje (`z.string().min(3, "…")`) siguen mandando:
 * esto solo cubre los casos en que no se escribió ninguno, para que jamás se vea un "Required" o "String must
 * contain at least 1 character(s)" en inglés.
 */
export const zodErrorMapEs: z.ZodErrorMap = (issue) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.expected === "integer") return { message: t("ui.validation.integer") };
      return {
        message:
          issue.received === "undefined" || issue.received === "null"
            ? t("ui.validation.required")
            : t("ui.validation.invalidType"),
      };
    case z.ZodIssueCode.too_small: {
      const min = String(issue.minimum);
      if (issue.type === "string") {
        if (issue.exact) return { message: t("ui.validation.stringExact", { n: min }) };
        // `.min(1)` es la forma de pedir "no vacío": se dice "obligatorio", no "mínimo 1 carácter".
        return {
          message:
            Number(issue.minimum) <= 1
              ? t("ui.validation.required")
              : t("ui.validation.stringMin", { min }),
        };
      }
      if (issue.type === "array" || issue.type === "set") {
        return { message: t("ui.validation.arrayMin", { min }) };
      }
      if (issue.type === "date") {
        return { message: t("ui.validation.dateMin", { date: day(issue.minimum) }) };
      }
      // `.positive()` / `.gt(0)` rechazan el propio límite: «mayor que», no «como mínimo».
      return {
        message: issue.inclusive
          ? t("ui.validation.numberMin", { min })
          : t("ui.validation.numberGt", { min }),
      };
    }
    case z.ZodIssueCode.too_big: {
      const max = String(issue.maximum);
      if (issue.type === "string") {
        return {
          message: issue.exact
            ? t("ui.validation.stringExact", { n: max })
            : t("ui.validation.stringMax", { max }),
        };
      }
      if (issue.type === "array" || issue.type === "set") {
        return { message: t("ui.validation.arrayMax", { max }) };
      }
      if (issue.type === "date") {
        return { message: t("ui.validation.dateMax", { date: day(issue.maximum) }) };
      }
      return {
        message: issue.inclusive
          ? t("ui.validation.numberMax", { max })
          : t("ui.validation.numberLt", { max }),
      };
    }
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: t("ui.validation.email") };
      if (issue.validation === "url") return { message: t("ui.validation.url") };
      if (issue.validation === "uuid") return { message: t("ui.validation.uuid") };
      return { message: t("ui.validation.format") };
    case z.ZodIssueCode.invalid_enum_value:
      // Conserva los valores permitidos: el mensaje de la validación de entorno (`EnvError`) los necesita.
      return { message: t("ui.validation.enumOptions", { options: issue.options.join(", ") }) };
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: t("ui.validation.enum") };
    case z.ZodIssueCode.invalid_date:
      return { message: t("ui.validation.date") };
    case z.ZodIssueCode.not_multiple_of:
      return { message: t("ui.validation.multipleOf", { n: String(issue.multipleOf) }) };
    case z.ZodIssueCode.not_finite:
      return { message: t("ui.validation.notFinite") };
    default:
      return { message: t("ui.validation.invalid") };
  }
};

/** Instala los mensajes en español para todos los esquemas de la aplicación (se llama una vez al arrancar). */
export function installZodSpanish(): void {
  z.setErrorMap(zodErrorMapEs);
}

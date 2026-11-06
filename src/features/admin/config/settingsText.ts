import { es } from "@/i18n/es";

interface FieldText {
  label: string;
  hint?: string;
}

// Se lee al usarse (no al importar): los textos del panel se registran al cargar `AdminShell`.
const fields = (): Record<string, FieldText> => es.admin.config.settings.fields;

/** Etiqueta y ayuda de un ajuste, desde el archivo de textos (las claves son dinámicas, por eso no pasan por `t()`). */
export const fieldText = (key: string): FieldText => fields()[key] ?? { label: key };

/** Texto de una opción del select de comportamiento sin stock. */
export const behaviorText = (value: string): string =>
  (es.admin.config.settings.behavior as Record<string, string>)[value] ?? value;

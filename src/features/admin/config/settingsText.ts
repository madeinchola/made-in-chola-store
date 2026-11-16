import { es } from "@/i18n/es";

interface FieldText {
  label: string;
  hint?: string;
}

// Se lee al usarse (no al importar): los textos del panel se registran al cargar `AdminShell`.
const fields = (): Record<string, FieldText> => es.admin.config.settings.fields;

/** Etiqueta y ayuda de un ajuste, desde el archivo de textos (las claves son dinámicas, por eso no pasan por `t()`). */
export const fieldText = (key: string): FieldText => fields()[key] ?? { label: key };

/**
 * Texto de una opción de un select. Un ajuste de Sí/No puede tener sus propias palabras (`behaviorByKey`: «Sí: se aceptan
 * devoluciones»); si no, se usa la general del comportamiento sin stock y del carrito.
 */
export const behaviorText = (value: string, key?: string): string => {
  const own = key
    ? (es.admin.config.settings.behaviorByKey as Record<string, Record<string, string>>)[key]?.[
        value
      ]
    : undefined;
  return own ?? (es.admin.config.settings.behavior as Record<string, string>)[value] ?? value;
};

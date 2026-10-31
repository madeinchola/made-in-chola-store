import { slugify } from "@/features/catalog/slug";

/** Slug sugerido a partir del nombre: respeta el máximo de 80 caracteres y no termina en guion. */
export const suggestSlug = (name: string): string => slugify(name).slice(0, 80).replace(/-+$/, "");
